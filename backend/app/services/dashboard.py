"""PHC and district views: KPIs, the hexagon risk map, coverage blind spots, outbreak radar."""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, timedelta

import h3
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import now
from app.core.config import get_settings
from app.models import Household, Person, Referral, Screening, SyndromeEvent, User, Village
from app.services.referrals import OPEN

H3_RESOLUTION = 8  # ~0.7 km² cells: village-sized


def scope_villages(db: Session, user: User) -> list[Village]:
    q = select(Village).where(Village.block == user.block)
    if user.role == "asha":
        q = q.where(Village.id.in_(user.village_ids or []))
    return list(db.scalars(q))


def _latest_screenings(db: Session, village_ids: list[str], since=None) -> list[tuple[Screening, Household, Person]]:
    q = (
        select(Screening, Household, Person)
        .join(Person, Person.id == Screening.person_id)
        .join(Household, Household.id == Person.household_id)
        .where(Household.village_id.in_(village_ids))
        .order_by(Screening.captured_at)
    )
    if since is not None:
        q = q.where(Screening.captured_at >= since)
    latest: dict[str, tuple] = {}
    for row in db.execute(q):
        latest[row[0].person_id] = tuple(row)
    return list(latest.values())


def summary(db: Session, user: User) -> dict:
    s = get_settings()
    t = now()
    villages = scope_villages(db, user)
    vids = [v.id for v in villages]
    quarter = t - timedelta(days=90)
    population = sum(v.population_30plus for v in villages)
    recent = _latest_screenings(db, vids, quarter)
    screened = len(recent)

    refs = list(
        db.scalars(
            select(Referral).join(Person, Person.id == Referral.person_id).join(Household, Household.id == Person.household_id)
            .where(Household.village_id.in_(vids))
        )
    )
    window = timedelta(days=s.loop_window_days)
    matured = [r for r in refs if r.created_at <= t - window and r.status != "cancelled"]
    closed_in_window = [r for r in matured if r.seen_at and r.seen_at - r.created_at <= window]
    days_to_visit = [(r.seen_at - r.created_at).total_seconds() / 86400 for r in refs if r.seen_at]
    open_refs = [r for r in refs if r.status in OPEN]
    overdue = [r for r in open_refs if r.due_at and r.due_at < t]

    by_condition: dict[str, int] = defaultdict(int)
    for scr, _, _ in recent:
        for key, c in (scr.result.get("conditions") or {}).items():
            if c["band"] == "high":
                by_condition[key] += 1

    # Weekly trend, oldest first: screenings, high-risk flags, completed visits.
    weeks = []
    for w in range(7, -1, -1):
        start, end = t - timedelta(days=7 * (w + 1)), t - timedelta(days=7 * w)
        n_scr = db.scalar(
            select(func.count(Screening.id)).join(Person, Person.id == Screening.person_id)
            .join(Household, Household.id == Person.household_id)
            .where(Household.village_id.in_(vids), Screening.captured_at >= start, Screening.captured_at < end)
        ) or 0
        weeks.append({
            "week_start": start.date().isoformat(),
            "screenings": n_scr,
            "flagged": sum(1 for r in refs if start <= r.created_at < end),
            "visits": sum(1 for r in refs if r.seen_at and start <= r.seen_at < end),
        })

    return {
        "as_of": t.isoformat() + "Z",
        "population_30plus": population,
        "screened_quarter": screened,
        "coverage": round(screened / population, 3) if population else 0,
        "high_risk": sum(1 for scr, _, _ in recent if scr.urgency != "routine"),
        "emergencies_quarter": sum(1 for scr, _, _ in recent if scr.urgency == "emergency"),
        "open_referrals": len(open_refs),
        "overdue": len(overdue),
        # North-star: of referrals whose 14-day window has passed, the share seen within it.
        "loop_closure": {
            "rate": round(len(closed_in_window) / len(matured), 3) if matured else None,
            "closed": len(closed_in_window),
            "eligible": len(matured),
            "window_days": s.loop_window_days,
        },
        "median_days_to_visit": round(statistics.median(days_to_visit), 1) if days_to_visit else None,
        "by_status": {st: sum(1 for r in refs if r.status == st) for st in ("flagged", "acknowledged", "booked", "missed", "seen", "closed", "cancelled")},
        "by_condition": dict(by_condition),
        "weeks": weeks,
    }


def hexmap(db: Session, user: User) -> dict:
    """H3 cells with screened, high-risk and emergency counts. Cells under the small-count
    threshold are dropped entirely so no household can be singled out."""
    min_n = get_settings().min_cell_count
    villages = scope_villages(db, user)
    cells: dict[str, dict] = {}
    for scr, hh, _ in _latest_screenings(db, [v.id for v in villages], now() - timedelta(days=180)):
        cell = h3.latlng_to_cell(hh.lat, hh.lon, H3_RESOLUTION)
        c = cells.setdefault(cell, {"screened": 0, "high": 0, "emergency": 0, "score_sum": 0})
        c["screened"] += 1
        c["high"] += scr.urgency in ("soon", "urgent", "emergency")
        c["emergency"] += scr.urgency == "emergency"
        c["score_sum"] += scr.priority

    features, suppressed = [], 0
    for cell, c in cells.items():
        if c["screened"] < min_n:
            suppressed += 1
            continue
        boundary = [[lng, lat] for lat, lng in h3.cell_to_boundary(cell)]
        boundary.append(boundary[0])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [boundary]},
            "properties": {
                "cell": cell,
                "screened": c["screened"],
                "high": c["high"],
                "emergency": c["emergency"],
                "high_share": round(c["high"] / c["screened"], 3),
                "mean_priority": round(c["score_sum"] / c["screened"], 1),
            },
        })
    lat = statistics.mean(v.lat for v in villages) if villages else 0
    lon = statistics.mean(v.lon for v in villages) if villages else 0
    return {
        "type": "FeatureCollection",
        "features": features,
        "center": [lon, lat],
        "suppressed_cells": suppressed,
        "min_cell_count": min_n,
        "villages": [{"id": v.id, "name": v.name, "lat": v.lat, "lon": v.lon} for v in villages],
    }


def coverage(db: Session, user: User) -> list[dict]:
    """Per-village coverage and the blind spots: low coverage, far from the road."""
    t = now()
    out = []
    for v in scope_villages(db, user):
        recent = _latest_screenings(db, [v.id], t - timedelta(days=90))
        n_people = db.scalar(
            select(func.count(Person.id)).join(Household, Household.id == Person.household_id)
            .where(Household.village_id == v.id, Person.birth_year <= t.year - 30)
        ) or 0
        women_60 = db.scalar(
            select(func.count(Person.id)).join(Household, Household.id == Person.household_id)
            .where(Household.village_id == v.id, Person.sex == "female", Person.birth_year <= t.year - 60)
        ) or 0
        women_60_screened = sum(1 for _, _, p in recent if p.sex == "female" and p.birth_year <= t.year - 60)
        cov = len(recent) / n_people if n_people else 0
        open_refs = db.scalar(
            select(func.count(Referral.id)).join(Person, Person.id == Referral.person_id)
            .join(Household, Household.id == Person.household_id)
            .where(Household.village_id == v.id, Referral.status.in_(OPEN))
        ) or 0
        out.append({
            "village_id": v.id,
            "name": v.name,
            "lat": v.lat,
            "lon": v.lon,
            "eligible": n_people,
            "screened": len(recent),
            "coverage": round(cov, 3),
            "high_risk": sum(1 for s, _, _ in recent if s.urgency != "routine"),
            "open_referrals": open_refs,
            "km_from_road": v.km_from_road,
            "older_women_coverage": round(women_60_screened / women_60, 3) if women_60 else None,
            "blind_spot": cov < 0.4 or (v.km_from_road >= 3 and cov < 0.6),
        })
    return sorted(out, key=lambda r: r["coverage"])


def outbreaks(db: Session, user: User, days: int = 28) -> dict:
    """CDC EARS C2 on daily syndrome counts per village: flag a day whose count exceeds the
    mean + 3 SD of a 7-day baseline that ends 2 days earlier (the guard band)."""
    villages = {v.id: v for v in scope_villages(db, user)}
    today = now().date()
    start = today - timedelta(days=days + 9)
    counts: dict[tuple[str, str], dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for ev in db.scalars(select(SyndromeEvent).where(SyndromeEvent.village_id.in_(list(villages)), SyndromeEvent.day >= start)):
        counts[(ev.village_id, ev.syndrome)][ev.day] += ev.count

    alerts, series = [], []
    for (vid, syndrome), by_day in counts.items():
        daily = [{"day": (today - timedelta(days=d)).isoformat(), "count": by_day.get(today - timedelta(days=d), 0)} for d in range(days - 1, -1, -1)]
        series.append({"village_id": vid, "village": villages[vid].name, "syndrome": syndrome, "daily": daily})
        for d in range(days):
            day = today - timedelta(days=d)
            baseline = [by_day.get(day - timedelta(days=k), 0) for k in range(3, 10)]
            mean = statistics.mean(baseline)
            sd = max(statistics.pstdev(baseline), 0.5)
            observed = by_day.get(day, 0)
            if observed >= 3 and observed > mean + 3 * sd:
                alerts.append({"village_id": vid, "village": villages[vid].name, "syndrome": syndrome, "day": day.isoformat(),
                               "observed": observed, "expected": round(mean, 1), "threshold": round(mean + 3 * sd, 1)})
    alerts.sort(key=lambda a: a["day"], reverse=True)
    return {"method": "EARS C2", "alerts": alerts, "series": series}

"""Right-door routing: the nearest facility that is staffed, equipped for this risk and open
soon enough, by estimated travel time. Falls back to a teleconsult when the trip is too long.

Travel time is straight-line distance × a road factor at rural speed. That is an honest
estimate, not a road route; swap in an OSRM/Valhalla matrix when one is available.
The phone runs the same algorithm offline (frontend/src/services/routing.ts).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

ROAD_FACTOR = 1.4
SPEED_KMH = 22.0
# How long each urgency may wait for a facility to open.
MAX_WAIT_HOURS = {"emergency": 0, "urgent": 8, "soon": 72, "routine": 168}


@dataclass
class FacilityInfo:
    id: str
    name: str
    kind: str
    lat: float
    lon: float
    capabilities: list[str]
    opens: str
    closes: str
    days: list[int]
    open_24x7: bool
    staffed: bool
    last_verified_at: datetime | None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def travel_minutes(km: float) -> int:
    return int(math.floor(km * ROAD_FACTOR / SPEED_KMH * 60 + 0.5))


def _hm(value: str) -> int:
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def is_open(f: FacilityInfo, at: datetime) -> bool:
    if f.open_24x7:
        return True
    minute = at.hour * 60 + at.minute
    return at.weekday() in f.days and _hm(f.opens) <= minute < _hm(f.closes)


def next_opening(f: FacilityInfo, at: datetime) -> datetime | None:
    """Local time the facility is next open (`at` itself if open now), within a week."""
    if is_open(f, at):
        return at
    for d in range(8):
        day = (at + timedelta(days=d)).replace(second=0, microsecond=0)
        if day.weekday() not in f.days:
            continue
        start = day.replace(hour=_hm(f.opens) // 60, minute=_hm(f.opens) % 60)
        if start > at:
            return start
    return None


def route(
    facilities: list[FacilityInfo],
    lat: float,
    lon: float,
    needs: list[str],
    urgency: str,
    at_local: datetime,
    max_travel_minutes: int = 60,
) -> dict | None:
    """`at_local` is local wall-clock time. Returns the routing decision with its reasons."""
    emergency = urgency == "emergency" or "emergency" in needs
    required = {"emergency"} if emergency else set(needs) - {"same_day"}
    max_wait = MAX_WAIT_HOURS.get(urgency, 72)

    options = []
    for f in facilities:
        if f.kind == "tele_hub" or not f.staffed:
            continue
        covered = required & set(f.capabilities)
        if emergency and "emergency" not in f.capabilities:
            continue
        km = haversine_km(lat, lon, f.lat, f.lon)
        opening = next_opening(f, at_local)
        if opening is None:
            continue
        wait_h = (opening - at_local).total_seconds() / 3600
        if emergency and not f.open_24x7:
            continue
        if wait_h > max_wait:
            continue
        options.append(
            {
                "f": f,
                "missing": sorted(required - covered),
                "km": math.floor(km * 10 + 0.5) / 10,
                "minutes": travel_minutes(km),
                "open_now": wait_h == 0,
                "opening": opening,
                # Full coverage first, then travel, then waiting (an hour waiting ≈ 10 travel minutes).
                "rank": (len(required - covered), travel_minutes(km) + wait_h * 10),
            }
        )
    if not options:
        return None
    options.sort(key=lambda o: o["rank"])
    best = options[0]
    f: FacilityInfo = best["f"]

    reasons: list[dict] = []
    if emergency:
        reasons.append({"code": "emergency_24x7"})
    covered = sorted(required & set(f.capabilities))
    if covered:
        reasons.append({"code": "has_capabilities", "value": covered})
    reasons.append({"code": "open_now"} if best["open_now"] else {"code": "opens_at", "value": best["opening"].strftime("%a %H:%M")})
    reasons.append({"code": "travel", "value": best["minutes"]})
    if f.last_verified_at:
        days = max(0, (at_local - f.last_verified_at).days)
        reasons.append({"code": "verified_days_ago", "value": days})

    mode = "in_person"
    tele = next((t for t in facilities if t.kind == "tele_hub" and t.staffed), None)
    if not emergency and best["minutes"] > max_travel_minutes and tele is not None:
        mode = "teleconsult"
        reasons.insert(0, {"code": "teleconsult_far", "value": best["minutes"]})

    return {
        "facility_id": tele.id if mode == "teleconsult" else f.id,
        "facility_name": tele.name if mode == "teleconsult" else f.name,
        "kind": "tele_hub" if mode == "teleconsult" else f.kind,
        "mode": mode,
        # For a teleconsult, the nearest place for any tests the doctor orders.
        "test_facility_id": f.id if mode == "teleconsult" else None,
        "distance_km": best["km"],
        "travel_minutes": best["minutes"],
        "open_now": best["open_now"],
        "missing_capabilities": best["missing"],
        "reasons": reasons,
        "alternatives": [
            {"facility_id": o["f"].id, "facility_name": o["f"].name, "travel_minutes": o["minutes"], "open_now": o["open_now"]}
            for o in options[1:4]
        ],
    }


def from_model(f) -> FacilityInfo:  # noqa: ANN001
    return FacilityInfo(
        id=f.id,
        name=f.name,
        kind=f.kind,
        lat=f.lat,
        lon=f.lon,
        capabilities=list(f.capabilities or []),
        opens=f.opens,
        closes=f.closes,
        days=list(f.days or []),
        open_24x7=f.open_24x7,
        staffed=f.staffed,
        last_verified_at=f.last_verified_at,
    )

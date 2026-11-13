"""Watching the shadow model before anyone trusts it.

Four questions, each answerable from data PranaMap already collects:
1. Agreement: how often does the model flag the same people as the guidelines? (Cohen's kappa)
2. Realised calibration: of people the model gave ~40%, how many did a doctor confirm?
   Uses the loop's own outcomes (referral.outcome.evaluated / confirmed_conditions); this is
   the "recalibrate on local confirmed outcomes" edge from the blueprint.
3. Drift: have screening inputs moved away from the training data? (standardised mean difference)
4. Disagreement signals: ASHA overrides and phone/server score mismatches.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now
from app.ml.features import raw_features
from app.ml.model import artifact
from app.models import Household, Person, Referral, Screening, User
from app.services.dashboard import scope_villages

BINS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0001]
DRIFT_FEATURES = ["age", "bmi", "waist", "sbp", "glucose_random"]
DRIFT_LIMIT = 0.2  # |SMD| above this is conventionally a meaningful shift


def _kappa(a: list[bool], b: list[bool]) -> float | None:
    n = len(a)
    if n == 0:
        return None
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return round((po - pe) / (1 - pe), 3) if pe < 1 else None


def monitoring(db: Session, user: User, days: int = 180) -> dict:
    art = artifact()
    if art is None:
        return {"available": False}
    vids = [v.id for v in scope_villages(db, user)]
    since = now() - timedelta(days=days)
    screenings = list(
        db.scalars(
            select(Screening)
            .join(Person, Person.id == Screening.person_id)
            .join(Household, Household.id == Person.household_id)
            .where(Household.village_id.in_(vids), Screening.captured_at >= since)
        )
    )
    scored = [s for s in screenings if (s.result or {}).get("model")]

    # Outcomes from the loop, keyed by the screening that triggered the referral.
    outcomes: dict[str, dict] = {}
    for r in db.scalars(select(Referral).where(Referral.screening_id.in_([s.id for s in scored]), Referral.outcome.is_not(None))):
        if r.outcome and r.outcome.get("evaluated"):
            outcomes[r.screening_id] = r.outcome

    targets = {}
    for target in art["targets"]:
        rows = [(s, s.result["model"]["outputs"].get(target)) for s in scored]
        rows = [(s, o) for s, o in rows if o is not None]
        model_flag = [o["flag"] for _, o in rows]
        guide_flag = [s.result["conditions"][target]["band"] == "high" for s, _ in rows]
        reliability = []
        for lo, hi in zip(BINS, BINS[1:]):
            bucket = [
                (o["probability"], target in outcomes[s.id].get("confirmed_conditions", []))
                for s, o in rows
                if lo <= o["probability"] < hi and s.id in outcomes and target in outcomes[s.id]["evaluated"]
            ]
            reliability.append({
                "bin": [lo, min(hi, 1.0)],
                "n": len(bucket),
                "predicted": round(sum(p for p, _ in bucket) / len(bucket), 3) if bucket else None,
                "observed": round(sum(1 for _, c in bucket if c) / len(bucket), 3) if bucket else None,
            })
        targets[target] = {
            "n": len(rows),
            "mean_probability": round(sum(o["probability"] for _, o in rows) / len(rows), 3) if rows else None,
            "model_flag_rate": round(sum(model_flag) / len(rows), 3) if rows else None,
            "guideline_flag_rate": round(sum(guide_flag) / len(rows), 3) if rows else None,
            "agreement": round(sum(1 for a, b in zip(model_flag, guide_flag) if a == b) / len(rows), 3) if rows else None,
            "kappa": _kappa(model_flag, guide_flag),
            "outcomes": sum(r["n"] for r in reliability),
            "reliability": reliability,
        }

    drift = []
    for f in DRIFT_FEATURES:
        vals = [v for v in (raw_features(s.input)[f] for s in screenings) if v is not None]
        mean, sd = art["scale"][f]
        if not vals or not sd:
            continue
        cur = sum(vals) / len(vals)
        smd = (cur - mean) / sd
        drift.append({"feature": f, "training_mean": round(mean, 1), "current_mean": round(cur, 1),
                      "smd": round(smd, 3), "shifted": abs(smd) > DRIFT_LIMIT})

    return {
        "available": True,
        "model": {"name": art["name"], "version": art["version"], "validated": art["validated"],
                  "mode": art["deployment_mode"] if art["validated"] else "shadow", "card": "docs/models/ncd_risk.md",
                  "trained_on_real_data": art["trained_on"]["real_data"]},
        "window_days": days,
        "screenings": len(screenings),
        "scored": len(scored),
        "overrides": sum(1 for s in screenings if s.override),
        "score_mismatches": sum(1 for s in screenings if s.score_mismatch),
        "targets": targets,
        "drift": drift,
    }

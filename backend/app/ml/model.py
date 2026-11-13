"""Run the exported NCD risk model (shared/models/ncd_risk.json). No ML libraries: a logistic
model is a weighted sum. The phone runs the identical arithmetic (frontend/src/services/risk/model.ts).

Governance is enforced here, not trusted to config: a model whose artifact says
`validated: false` is reported in shadow mode, and the engine never lets a shadow model change
a band, an urgency or a referral.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache

from app.core.config import REPO_DIR

from .features import raw_features
from .guidelines.common import driver


HIDDEN_DRIVERS = {"bmi_missing", "waist_missing", "bp_missing", "glucose_missing", "two_readings"}
ARTIFACT = REPO_DIR / "shared" / "models" / "ncd_risk.json"


@lru_cache
def artifact() -> dict | None:
    """None until a model has been trained (training itself calls the guideline engine)."""
    return json.loads(ARTIFACT.read_text(encoding="utf-8")) if ARTIFACT.exists() else None


def predict(x: dict) -> dict | None:
    a = artifact()
    if a is None:
        return None
    raw = raw_features(x)
    z: dict[str, float] = {}
    for f in a["features"]:
        v = raw[f]
        if v is None:
            v = a["impute"][f]
        mean, sd = a["scale"][f]
        z[f] = (v - mean) / sd
    outputs: dict[str, dict | None] = {}
    for target, m in a["targets"].items():
        if x.get(m["excludes"]):
            outputs[target] = None  # already diagnosed: the model estimates undiagnosed disease only
            continue
        lp = m["intercept"]
        contributions = []
        for f in a["features"]:
            c = m["coef"][f] * z[f]
            lp += c
            contributions.append((f, c))
        p = 1 / (1 + math.exp(-lp))
        # Indicator features shape the estimate but read badly as reasons ("glucose was tested").
        ranked = sorted((fc for fc in contributions if fc[0] not in HIDDEN_DRIVERS), key=lambda fc: -abs(fc[1]))
        drivers = []
        for f, c in ranked[:3]:
            points = math.floor(c * 10 + 0.5) / 10
            if points != 0:
                drivers.append(driver(f"ml_{f}", points, None, "up" if points > 0 else "down"))
        outputs[target] = {
            "probability": math.floor(p * 10000 + 0.5) / 10000,
            "flag": p >= m["threshold"],
            "drivers": drivers,
        }
    return {
        "name": a["name"],
        "version": a["version"],
        "validated": a["validated"],
        "mode": a["deployment_mode"] if a["validated"] else "shadow",
        "outputs": outputs,
    }

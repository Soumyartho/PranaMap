"""PranaMap risk engine: safety rules first, guideline scores second.

score(input) -> the output contract the phone, the server, the packet and the dashboard share.
The same logic runs offline on the phone (frontend/src/services/risk); shared/fixtures/risk_cases.json
pins both implementations to identical output.
"""

from __future__ import annotations

from .guidelines.cbac import score_cbac
from .guidelines.common import round_half_up
from .guidelines.conditions import score_anaemia, score_cvd, score_diabetes, score_hypertension, score_tb
from .guidelines.red_flags import check_red_flags
from .model import predict as model_predict

ENGINE_VERSION = "0.2.0"
MIN_AGE = 30

NEEDS = {
    "diabetes": "glucose_test",
    "hypertension": "bp_management",
    "cvd": "ncd_clinic",
    "anaemia": "hb_test",
    "tb": "sputum_test",
}


def normalize(raw: dict) -> dict:
    x = dict(raw)
    x["age"] = int(x["age"])
    x["sex"] = x.get("sex") or "female"
    x["symptoms"] = sorted(set(x.get("symptoms") or []))
    if x["sex"] != "female":
        x["pregnant"] = False
    return x


def score(raw: dict) -> dict:
    x = normalize(raw)
    flags = check_red_flags(x)
    eligible = x["age"] >= MIN_AGE

    conditions: dict = {}
    cbac = None
    if eligible:
        cbac = score_cbac(x)
        conditions = {
            "diabetes": score_diabetes(x),
            "hypertension": score_hypertension(x),
            "cvd": score_cvd(x),
            "anaemia": score_anaemia(x),
            "tb": score_tb(x),
        }

    if any(f["level"] == "emergency" for f in flags):
        urgency = "emergency"
    elif flags:
        urgency = "urgent"
    elif any(c["band"] == "high" for c in conditions.values()) or (cbac and cbac["refer"]):
        urgency = "soon"
    else:
        urgency = "routine"

    scores = sorted((c["score"] for c in conditions.values()), reverse=True)
    if urgency == "emergency":
        priority = 100
    elif urgency == "urgent":
        priority = 90
    elif scores:
        top2 = scores[:2]
        priority = round_half_up(0.7 * scores[0] + 0.3 * (sum(top2) / len(top2))) + (5 if x["age"] >= 60 else 0)
        priority = max(0, min(89, priority))
    else:
        priority = 0

    needs = sorted({NEEDS[k] for k, c in conditions.items() if c["band"] == "high"})
    if urgency == "emergency":
        needs = ["emergency"]
    elif urgency == "urgent" and "emergency" not in needs:
        needs = sorted(set(needs) | {"same_day"})

    reasons = [f["code"] for f in flags] + [k for k, c in conditions.items() if c["band"] == "high"]
    if cbac and cbac["refer"] and "cbac_above_4" not in reasons:
        reasons.append("cbac_above_4")

    missing = sorted(set((cbac or {}).get("missing", [])) | {s for c in conditions.values() for s in c["sharpen"]})
    return {
        "engine_version": ENGINE_VERSION,
        "eligible": eligible,
        "red_flags": flags,
        "emergency": urgency == "emergency",
        "cbac": cbac,
        "conditions": conditions,
        "overall": {
            "urgency": urgency,
            "priority": priority,
            "refer": urgency != "routine",
            "needs": needs,
            "reasons": reasons,
        },
        "missing": missing,
        # The ML layer runs alongside the guidelines. In shadow mode (any unvalidated model) it is
        # recorded and monitored but nothing above depends on it.
        "model": model_predict(x) if eligible else None,
    }

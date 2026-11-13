"""Feature extraction shared by training and inference. The phone runs the same transform
(frontend/src/services/risk/model.ts); shared/fixtures/risk_cases.json pins them together.

Every feature is a plain number. Missing values are imputed with the training mean and flagged
by an indicator, so "not measured" is information, never silently treated as normal.
"""

from __future__ import annotations

from .guidelines.common import DIABETES_SYMPTOMS, bmi, bp_summary

ACTIVITY = {"vigorous": 0.0, "moderate": 1.0, "mild": 2.0, "sedentary": 3.0}
FH_DM = {"none": 0.0, "one_parent": 1.0, "both_parents": 2.0}

# name -> (extractor, has_missing_indicator)
FEATURES: list[str] = [
    "age", "male", "bmi", "bmi_missing", "waist", "waist_missing", "inactivity", "fh_diabetes", "fh_heart_or_bp",
    "tobacco_daily", "tobacco_any", "alcohol_daily", "sbp", "dbp", "bp_missing", "two_readings",
    "glucose_random", "glucose_fasting", "glucose_missing", "diabetes_symptoms",
]


def raw_features(x: dict) -> dict[str, float | None]:
    """None marks a missing value; the model artifact supplies the imputation."""
    sbp, dbp, _, _ = bp_summary(x)
    b = bmi(x)
    g = x.get("glucose_mg_dl")
    fasting = x.get("glucose_type") == "fasting"
    readings = [r for r in (x.get("bp_readings") or []) if r and r[0] and r[1]]
    symptoms = set(x.get("symptoms") or [])
    return {
        "age": float(x["age"]),
        "male": 1.0 if x.get("sex") == "male" else 0.0,
        "bmi": b,
        "bmi_missing": 1.0 if b is None else 0.0,
        "waist": x.get("waist_cm"),
        "waist_missing": 1.0 if x.get("waist_cm") is None else 0.0,
        "inactivity": ACTIVITY.get(x.get("activity") or "", None),
        "fh_diabetes": FH_DM.get(x.get("fh_diabetes") or "", None),
        "fh_heart_or_bp": 1.0 if x.get("fh_heart_or_bp") else 0.0,
        "tobacco_daily": 1.0 if x.get("tobacco") == "daily" else 0.0,
        "tobacco_any": 1.0 if x.get("tobacco") in ("daily", "past_or_sometimes") else 0.0,
        "alcohol_daily": 1.0 if x.get("alcohol_daily") else 0.0,
        "sbp": float(sbp) if sbp is not None else None,
        "dbp": float(dbp) if dbp is not None else None,
        "bp_missing": 1.0 if sbp is None else 0.0,
        "two_readings": 1.0 if len(readings) >= 2 else 0.0,
        "glucose_random": float(g) if g is not None and not fasting else None,
        "glucose_fasting": float(g) if g is not None and fasting else None,
        "glucose_missing": 1.0 if g is None else 0.0,
        "diabetes_symptoms": float(sum(1 for s in DIABETES_SYMPTOMS if s in symptoms)),
    }

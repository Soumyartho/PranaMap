"""WHO 2019 cardiovascular risk model, non-laboratory version (Kaptoge et al., Lancet Glob Health 2019).

Ten-year risk of fatal or non-fatal myocardial infarction or stroke from age, sex, systolic BP,
BMI and smoking. Two Cox sub-models (CHD and stroke) are recalibrated to a region on the
complementary log-log scale and combined assuming independence. Parameters live in
shared/who_cvd_2019.json; tests/unit/test_who_cvd.py checks this code against 200 outputs of
WHO's reference Stata implementation.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache

from app.core.config import REPO_DIR


@lru_cache
def params() -> dict:
    return json.loads((REPO_DIR / "shared" / "who_cvd_2019.json").read_text(encoding="utf-8"))


def _uncalibrated(c: dict, age_c: float, sbp_c: float, bmi_c: float, smoking: bool) -> float:
    smk = 1.0 if smoking else 0.0
    lp = (
        c["age"] * age_c
        + c["bmi"] * bmi_c
        + c["sbp"] * sbp_c
        + c["smoking"] * smk
        + c["bmi_age"] * bmi_c * age_c
        + c["sbp_age"] * sbp_c * age_c
        + c["smoking_age"] * smk * age_c
    )
    return 1 - c["baseline_survival"] ** math.exp(lp)


def _recalibrate(risk: float, cons: float, slope: float) -> float:
    return 1 - math.exp(-math.exp(cons + slope * math.log(-math.log(1 - risk))))


def ten_year_risk(age: float, sex: str, sbp: float, bmi: float, smoking: bool, calibration: dict) -> float:
    """`calibration` holds chd_cons, chd_slope, stroke_cons, stroke_slope for this sex."""
    p = params()
    cen = p["centering"]
    age_c, sbp_c, bmi_c = age - cen["age"], sbp - cen["sbp"], bmi - cen["bmi"]
    chd = _uncalibrated(p["coefficients"]["chd"][sex], age_c, sbp_c, bmi_c, smoking)
    stroke = _uncalibrated(p["coefficients"]["stroke"][sex], age_c, sbp_c, bmi_c, smoking)
    chd = _recalibrate(chd, calibration["chd_cons"], calibration["chd_slope"])
    stroke = _recalibrate(stroke, calibration["stroke_cons"], calibration["stroke_slope"])
    return 1 - (1 - chd) * (1 - stroke)


def risk_for(age: float, sex: str, sbp: float, bmi: float, smoking: bool, region: str | None = None) -> float:
    p = params()
    return ten_year_risk(age, sex, sbp, bmi, smoking, p["calibration"][region or p["default_calibration"]][sex])


def term_contributions(age: float, sex: str, sbp: float, bmi: float, smoking: bool) -> dict[str, float]:
    """Each factor's share of the CHD linear predictor (interactions folded into their factor),
    for the 'why' bars. Positive raises risk relative to a 60-year-old non-smoker, SBP 120, BMI 25."""
    c = params()["coefficients"]["chd"][sex]
    cen = params()["centering"]
    a, s, b = age - cen["age"], sbp - cen["sbp"], bmi - cen["bmi"]
    smk = 1.0 if smoking else 0.0
    return {
        "age": c["age"] * a,
        "sbp": c["sbp"] * s + c["sbp_age"] * s * a,
        "bmi": c["bmi"] * b + c["bmi_age"] * b * a,
        "smoking": c["smoking"] * smk + c["smoking_age"] * smk * a,
    }

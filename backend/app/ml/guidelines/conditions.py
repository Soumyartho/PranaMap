"""Per-condition scorers. Each returns the same contract:

{band, score 0-100, drivers (top 3), action, confidence, sharpen, instrument, ...}
"""

from __future__ import annotations

import math

from .common import (
    DIABETES_SYMPTOMS,
    TB_CORE_SYMPTOMS,
    Band,
    band_max,
    bmi,
    bp_summary,
    bump,
    clamp,
    driver,
    glucose_status,
    round_half_up,
    top_drivers,
)

# ---------------------------------------------------------------- diabetes (IDRS)

IDRS_ACTIVITY = {"vigorous": 0, "moderate": 10, "mild": 20, "sedentary": 30}
IDRS_FH = {"none": 0, "one_parent": 10, "both_parents": 20}


def score_idrs(x: dict) -> dict:
    """Indian Diabetes Risk Score (Mohan et al.). Missing inputs are imputed conservatively."""
    items: list[dict] = []
    imputed: list[str] = []
    age = x["age"]
    items.append(driver("age", 0 if age < 35 else 20 if age < 50 else 30, age))

    waist = x.get("waist_cm")
    if waist is None:
        imputed.append("waist_cm")
        items.append(driver("waist_unknown", 10))
    else:
        cut = (80, 90) if x["sex"] == "female" else (90, 100)
        items.append(driver("waist", 0 if waist < cut[0] else 10 if waist < cut[1] else 20, waist))

    activity = x.get("activity")
    if activity is None:
        imputed.append("activity")
        items.append(driver("activity_unknown", 20))
    else:
        items.append(driver("activity", IDRS_ACTIVITY[activity], activity))

    fh = x.get("fh_diabetes")
    if fh is None:
        imputed.append("fh_diabetes")
        items.append(driver("fh_diabetes_unknown", 10))
    else:
        items.append(driver("fh_diabetes", IDRS_FH[fh], fh))

    return {"score": sum(i["points"] for i in items), "items": items, "imputed": imputed}


def score_diabetes(x: dict) -> dict:
    idrs = score_idrs(x)
    score = idrs["score"]
    band: Band = "high" if score >= 60 else "moderate" if score >= 30 else "low"
    drivers = list(idrs["items"])
    symptoms = set(x.get("symptoms") or [])
    sharpen: list[str] = []

    present = [s for s in DIABETES_SYMPTOMS if s in symptoms]
    if len(present) >= 2:
        band = bump(band)
        drivers.append(driver("diabetes_symptoms", 25, len(present)))

    status = glucose_status(x)
    action = {"high": "refer_glucose_test", "moderate": "lifestyle_recheck", "low": "rescreen_yearly"}[band]
    if status == "diabetic":
        band, score = "high", max(score, 90)
        drivers.append(driver("glucose_high", 60, x["glucose_mg_dl"]))
        action = "confirm_diabetes"
    elif status == "borderline":
        band, score = band_max(band, "moderate"), max(score, 50)
        drivers.append(driver("glucose_borderline", 35, x["glucose_mg_dl"]))
        action = "refer_glucose_test" if band == "high" else "prediabetes_lifestyle"
    elif status == "normal":
        drivers.append(driver("glucose_normal", -20, x["glucose_mg_dl"], "down"))
    else:
        sharpen.append("add_glucose")

    if x.get("known_diabetes"):
        band = "high" if status == "diabetic" else "moderate"
        action = "known_uncontrolled" if status == "diabetic" else "known_followup"
        drivers.append(driver("known_diabetes", 30))

    if "waist_cm" in idrs["imputed"]:
        sharpen.append("measure_waist")
    n_imputed = len(idrs["imputed"])
    confidence = "high" if status in ("diabetic", "borderline", "normal") or n_imputed == 0 else "medium" if n_imputed == 1 else "low"
    return {
        "band": band,
        "score": min(100, score),
        "drivers": top_drivers(drivers),
        "action": action,
        "confidence": confidence,
        "sharpen": sharpen,
        "instrument": "IDRS",
        "idrs": idrs["score"],
    }


# ---------------------------------------------------------------- hypertension


def bp_stage(sbp: int, dbp: int) -> str:
    if sbp >= 180 or dbp >= 110:
        return "severe"
    if sbp >= 160 or dbp >= 100:
        return "stage2"
    if sbp >= 140 or dbp >= 90:
        return "stage1"
    if sbp >= 130 or dbp >= 85:
        return "high_normal"
    return "normal"


def _htn_risk_factors(x: dict) -> list[dict]:
    out = []
    if x["age"] >= 50:
        out.append(driver("age", 15, x["age"]))
    b = bmi(x)
    if b is not None and b >= 25:
        out.append(driver("bmi", 15, b))
    elif x.get("waist_cm") is not None and x["waist_cm"] > (80 if x["sex"] == "female" else 90):
        out.append(driver("waist", 15, x["waist_cm"]))
    if x.get("fh_heart_or_bp"):
        out.append(driver("fh_heart_or_bp", 15))
    if x.get("tobacco") == "daily":
        out.append(driver("tobacco", 15, "daily"))
    if x.get("alcohol_daily"):
        out.append(driver("alcohol_daily", 15))
    return out


def score_hypertension(x: dict) -> dict:
    sbp, dbp, _, _ = bp_summary(x)
    factors = _htn_risk_factors(x)
    sharpen: list[str] = []
    readings = len([r for r in (x.get("bp_readings") or []) if r and r[0] and r[1]])

    if sbp is None or dbp is None:
        band: Band = "moderate" if len(factors) >= 2 else "low"
        return {
            "band": band,
            "score": min(100, 15 * len(factors)),
            "drivers": top_drivers(factors),
            "action": "measure_bp",
            "confidence": "low",
            "sharpen": ["measure_bp"],
            "instrument": "NP-NCD BP thresholds",
            "stage": None,
        }

    stage = bp_stage(sbp, dbp)
    band = {"severe": "high", "stage2": "high", "stage1": "high", "high_normal": "moderate", "normal": "low"}[stage]
    score = round_half_up(clamp(max((sbp - 100) / 80, (dbp - 60) / 50)) * 100)
    bp_points = {"severe": 80, "stage2": 65, "stage1": 50, "high_normal": 30, "normal": -10}[stage]
    drivers = [driver("bp", bp_points, f"{sbp}/{dbp}", "up" if bp_points > 0 else "down"), *factors]
    if stage == "normal" and len(factors) >= 3:
        band = "moderate"

    action = {"high": "refer_bp_confirm", "moderate": "recheck_bp", "low": "rescreen_yearly"}[band]
    if x.get("known_hypertension"):
        action = "known_uncontrolled" if band == "high" else "known_followup"
        drivers.append(driver("known_hypertension", 30))
    if readings < 2 and band != "low":
        sharpen.append("repeat_bp")
    return {
        "band": band,
        "score": score,
        "drivers": top_drivers(drivers),
        "action": action,
        "confidence": "high" if readings >= 2 else "medium",
        "sharpen": sharpen,
        "instrument": "NP-NCD BP thresholds",
        "stage": stage,
        "sbp": sbp,
        "dbp": dbp,
    }


# ---------------------------------------------------------------- cardiovascular (WHO 2019)

CVD_MODERATE, CVD_HIGH = 0.10, 0.20  # WHO HEARTS: >=20% ten-year risk is high (treat), 10-20% moderate.


def score_cvd(x: dict) -> dict:
    """WHO 2019 non-laboratory model, South Asia recalibration (see who_cvd.py).

    Clinical choices, all conservative:
    - Any tobacco use counts as smoking: the CBAC question does not separate smoked from
      smokeless tobacco, or current from past use.
    - Missing BMI is imputed at the model's reference value (25) and lowers confidence.
    - Without a BP reading the risk is not computed and says so; it is never shown as "low".
    - The model is validated for ages 40-80; outside that, age is clamped and confidence drops.
    - The non-lab model has no diabetes term, so it can underestimate risk in people with
      diabetes; they are pointed to the laboratory chart.
    """
    from .who_cvd import params, risk_for, term_contributions

    age = x["age"]
    sbp, _, _, _ = bp_summary(x)
    b = bmi(x)
    diabetic = bool(x.get("known_diabetes")) or glucose_status(x) == "diabetic"
    smoker = x.get("tobacco") in ("daily", "past_or_sometimes")
    lo, hi = params()["valid_age"]
    region = params()["default_calibration"]
    instrument = f"WHO 2019 non-lab ({region.replace('_', ' ').title()})"
    sharpen: list[str] = []

    if sbp is None:
        return {
            "band": "low", "score": 0, "drivers": [], "action": "measure_bp", "confidence": "low",
            "sharpen": ["measure_bp"], "instrument": instrument, "computed": False, "risk_10y": None,
            "in_chart_range": 40 <= age <= 74,
        }

    imputed_bmi = b is None
    if imputed_bmi:
        sharpen.append("measure_height_weight")
    model_age = min(max(age, lo), hi)
    risk = risk_for(model_age, x["sex"], sbp, 25.0 if imputed_bmi else b, smoker, region)
    band: Band = "high" if risk >= CVD_HIGH else "moderate" if risk >= CVD_MODERATE else "low"

    contrib = term_contributions(model_age, x["sex"], sbp, 25.0 if imputed_bmi else b, smoker)
    drivers = []
    for key, code, value in (("age", "age", age), ("sbp", "sbp", sbp), ("bmi", "bmi", None if imputed_bmi else b), ("smoking", "tobacco", x.get("tobacco"))):
        points = math.floor(contrib[key] * 10 + 0.5) / 10
        if key == "bmi" and imputed_bmi:
            continue
        drivers.append(driver(code, points, value, "up" if points > 0 else "down"))
    if diabetic:
        sharpen.append("use_lab_chart")

    confidence = "high"
    if imputed_bmi or not (lo <= age <= hi) or diabetic:
        confidence = "low"
    return {
        "band": band,
        "score": round_half_up(min(1.0, risk / 0.30) * 100),
        "drivers": top_drivers(drivers),
        "action": {"high": "refer_ncd_clinic", "moderate": "lifestyle_followup", "low": "rescreen_yearly"}[band],
        "confidence": confidence,
        "sharpen": sharpen,
        "instrument": instrument,
        "computed": True,
        "risk_10y": math.floor(risk * 10000 + 0.5) / 10000,
        "in_chart_range": 40 <= age <= 74,
    }


# ---------------------------------------------------------------- anaemia

ANAEMIA_SYMPTOM_POINTS = {
    "pallor": 3,
    "breathless_exertion": 2,
    "heavy_menstrual_bleeding": 2,
    "fatigue": 1,
    "dizziness": 1,
}


def score_anaemia(x: dict) -> dict:
    female, pregnant = x["sex"] == "female", bool(x.get("pregnant"))
    hb = x.get("hb_g_dl")
    if hb is not None:
        normal = 11 if pregnant else 12 if female else 13
        severe = 7 if pregnant else 8
        moderate = 10 if pregnant else 11
        if hb < severe:
            category, band = "severe", "high"
        elif hb < moderate:
            category, band = "moderate", "high"
        elif hb < normal:
            category, band = "mild", "moderate"
        else:
            category, band = "none", "low"
        points = {"severe": 80, "moderate": 60, "mild": 35, "none": -20}[category]
        return {
            "band": band,
            "score": round_half_up(clamp((normal - hb) / (normal - 6)) * 100),
            "drivers": [driver("hb", points, hb, "up" if points > 0 else "down")],
            "action": {"high": "treat_anaemia_refer", "moderate": "ifa_diet_recheck", "low": "none"}[band],
            "confidence": "high",
            "sharpen": [],
            "instrument": "WHO haemoglobin thresholds",
            "category": category,
        }

    symptoms = set(x.get("symptoms") or [])
    drivers = [driver(s, p) for s, p in ANAEMIA_SYMPTOM_POINTS.items() if s in symptoms]
    if female and pregnant:
        drivers.append(driver("pregnant", 1))
    total = sum(d["points"] for d in drivers)
    band = "high" if total >= 4 else "moderate" if total >= 2 else "low"
    return {
        "band": band,
        "score": min(100, total * 15),
        "drivers": top_drivers(drivers),
        "action": {"high": "refer_hb_test", "moderate": "ifa_diet_recheck", "low": "none"}[band],
        "confidence": "low",
        "sharpen": ["add_hb"],
        "instrument": "Symptom screen (confirm with Hb)",
        "category": None,
    }


# ---------------------------------------------------------------- tuberculosis


def score_tb(x: dict) -> dict:
    symptoms = set(x.get("symptoms") or [])
    present = [s for s in TB_CORE_SYMPTOMS if s in symptoms]
    drivers = [driver(s, 25) for s in present]
    if "blood_in_sputum" in symptoms:
        drivers.append(driver("blood_in_sputum", 40))
    if "tb_contact" in symptoms:
        drivers.append(driver("tb_contact", 15))

    if present or "blood_in_sputum" in symptoms:
        band, score, action = "high", min(100, 50 + 12.5 * len(present)), "refer_sputum_test"
    elif "tb_contact" in symptoms:
        band, score, action = "moderate", 30, "watch_tb_symptoms"
    else:
        band, score, action = "low", 0, "none"
    return {
        "band": band,
        "score": round_half_up(score),
        "drivers": top_drivers(drivers),
        "action": action,
        "confidence": "medium",
        "sharpen": [],
        "instrument": "WHO four-symptom screen",
        "presumptive": band == "high",
    }

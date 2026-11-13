"""Worked examples for each instrument, plus the safety rules."""

from app.ml.engine import score
from app.ml.guidelines.cbac import score_cbac
from app.ml.guidelines.conditions import bp_stage, score_idrs

BASE = {
    "age": 45,
    "sex": "female",
    "tobacco": "never",
    "alcohol_daily": False,
    "activity": "moderate",
    "fh_diabetes": "none",
    "fh_heart_or_bp": False,
    "waist_cm": 78,
    "symptoms": [],
}


def case(**overrides):
    return {**BASE, **overrides}


# ---------------------------------------------------------------- CBAC


def test_cbac_low_risk_woman():
    r = score_cbac(case())
    assert r["score"] == 1  # age 40-49 only
    assert r["refer"] is False


def test_cbac_maximum_score_is_ten_and_refers():
    r = score_cbac(case(age=65, sex="male", tobacco="daily", alcohol_daily=True, waist_cm=104, activity="sedentary", fh_heart_or_bp=True))
    assert r["score"] == 3 + 2 + 1 + 2 + 1 + 2
    assert r["refer"] is True


def test_cbac_threshold_is_strictly_above_four():
    # age 50-59 (2) + waist 85 F (1) + inactive (1) = 4 -> not referred
    r = score_cbac(case(age=55, waist_cm=85, activity="mild"))
    assert r["score"] == 4 and r["refer"] is False
    r = score_cbac(case(age=55, waist_cm=85, activity="mild", alcohol_daily=True))
    assert r["score"] == 5 and r["refer"] is True


def test_cbac_waist_boundaries():
    assert score_cbac(case(waist_cm=80))["items"][3]["points"] == 0
    assert score_cbac(case(waist_cm=81))["items"][3]["points"] == 1
    assert score_cbac(case(waist_cm=91))["items"][3]["points"] == 2
    assert score_cbac(case(sex="male", waist_cm=90))["items"][3]["points"] == 0
    assert score_cbac(case(sex="male", waist_cm=101))["items"][3]["points"] == 2


# ---------------------------------------------------------------- IDRS


def test_idrs_published_bands():
    # 52 y (30) + male waist 95 (10) + sedentary (30) + both parents (20) = 90
    r = score_idrs(case(age=52, sex="male", waist_cm=95, activity="sedentary", fh_diabetes="both_parents"))
    assert r["score"] == 90
    # 34 y (0) + waist 78 F (0) + vigorous (0) + none (0) = 0
    assert score_idrs(case(age=34, activity="vigorous"))["score"] == 0


def test_idrs_imputes_missing_inputs_and_lowers_confidence():
    r = score(case(waist_cm=None, activity=None))
    d = r["conditions"]["diabetes"]
    assert d["confidence"] == "low"
    assert "measure_waist" in d["sharpen"]


def test_diabetic_glucose_overrides_band():
    d = score(case(age=31, glucose_mg_dl=230, glucose_type="random"))["conditions"]["diabetes"]
    assert d["band"] == "high" and d["action"] == "confirm_diabetes" and d["confidence"] == "high"


def test_fasting_prediabetes_range():
    d = score(case(age=31, glucose_mg_dl=110, glucose_type="fasting"))["conditions"]["diabetes"]
    assert d["band"] == "moderate" and d["action"] == "prediabetes_lifestyle"


# ---------------------------------------------------------------- hypertension


def test_bp_stages():
    assert bp_stage(118, 76) == "normal"
    assert bp_stage(134, 80) == "high_normal"
    assert bp_stage(142, 88) == "stage1"
    assert bp_stage(150, 100) == "stage2"
    assert bp_stage(182, 96) == "severe"


def test_two_readings_are_averaged_and_raise_confidence():
    h = score(case(bp_readings=[[150, 96], [146, 92]]))["conditions"]["hypertension"]
    assert (h["sbp"], h["dbp"]) == (148, 94)
    assert h["band"] == "high" and h["confidence"] == "high" and h["sharpen"] == []


def test_single_raised_reading_asks_for_a_repeat():
    h = score(case(bp_readings=[[146, 92]]))["conditions"]["hypertension"]
    assert "repeat_bp" in h["sharpen"]


def test_averaging_rounds_half_up_like_javascript():
    h = score(case(bp_readings=[[151, 90], [152, 91]]))["conditions"]["hypertension"]
    assert (h["sbp"], h["dbp"]) == (152, 91)  # 151.5 -> 152, 90.5 -> 91


# ---------------------------------------------------------------- anaemia, TB


def test_anaemia_hb_thresholds_depend_on_pregnancy():
    assert score(case(hb_g_dl=11.5))["conditions"]["anaemia"]["category"] == "mild"
    assert score(case(hb_g_dl=11.5, pregnant=True))["conditions"]["anaemia"]["category"] == "none"
    assert score(case(sex="male", hb_g_dl=12.5))["conditions"]["anaemia"]["category"] == "mild"


def test_tb_any_core_symptom_is_presumptive():
    t = score(case(symptoms=["cough_2_weeks"]))["conditions"]["tb"]
    assert t["band"] == "high" and t["action"] == "refer_sputum_test"
    assert score(case(symptoms=["tb_contact"]))["conditions"]["tb"]["band"] == "moderate"


# ---------------------------------------------------------------- safety layer


def test_chest_pain_is_an_emergency_regardless_of_scores():
    r = score(case(age=32, symptoms=["chest_pain"]))
    assert r["emergency"] is True
    assert r["overall"]["urgency"] == "emergency" and r["overall"]["needs"] == ["emergency"]
    assert r["red_flags"][0]["action"] == "call_108"


def test_severe_bp_without_symptoms_is_urgent_with_symptoms_is_emergency():
    assert score(case(bp_readings=[[184, 100]]))["overall"]["urgency"] == "urgent"
    assert score(case(bp_readings=[[184, 100]], symptoms=["severe_headache"]))["overall"]["urgency"] == "emergency"


def test_safety_check_uses_the_highest_reading_not_the_mean():
    r = score(case(bp_readings=[[182, 100], [150, 90]]))
    assert any(f["code"] == "severe_bp" for f in r["red_flags"])


def test_pregnancy_danger_signs_only_apply_when_pregnant():
    assert score(case(pregnant=True, symptoms=["pregnancy_bleeding"]))["emergency"] is True
    assert score(case(sex="male", pregnant=True, symptoms=["pregnancy_bleeding"]))["emergency"] is False


def test_under_30_skips_adult_scores_but_keeps_red_flags():
    r = score(case(age=24, symptoms=["face_droop"]))
    assert r["eligible"] is False and r["conditions"] == {} and r["emergency"] is True


def test_routine_case_does_not_refer():
    r = score(case(bp_readings=[[118, 76], [116, 74]], glucose_mg_dl=96, glucose_type="random", hb_g_dl=13))
    assert r["overall"]["urgency"] == "routine" and r["overall"]["refer"] is False

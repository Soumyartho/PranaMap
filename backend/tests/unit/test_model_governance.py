"""The ML layer may observe, never decide, until it is validated; and the WHO CVD wiring."""

import copy

from app.ml import model as model_mod
from app.ml.engine import score

CASE = {
    "age": 52, "sex": "male", "tobacco": "daily", "activity": "mild", "fh_diabetes": "one_parent",
    "bp_readings": [[146, 94]], "waist_cm": 96, "glucose_mg_dl": 168, "glucose_type": "random",
}


def test_unvalidated_model_is_forced_into_shadow(monkeypatch):
    art = copy.deepcopy(model_mod.artifact())
    art["deployment_mode"] = "assist"  # misconfigured: asks to assist without validation
    art["validated"] = False
    monkeypatch.setattr(model_mod, "artifact", lambda: art)
    assert model_mod.predict(CASE)["mode"] == "shadow"


def test_model_never_changes_the_guideline_decision(monkeypatch):
    with_model = score(CASE)
    monkeypatch.setattr("app.ml.engine.model_predict", lambda x: None)
    without = score(CASE)
    for key in ("red_flags", "conditions", "overall", "cbac"):
        assert with_model[key] == without[key]


def test_diagnosed_people_get_no_estimate_for_that_condition():
    out = score({**CASE, "known_diabetes": True})["model"]["outputs"]
    assert out["diabetes"] is None and out["hypertension"] is not None


def test_probabilities_are_probabilities_and_children_get_none():
    out = score(CASE)["model"]["outputs"]
    assert all(0 < o["probability"] < 1 for o in out.values())
    assert score({**CASE, "age": 25})["model"] is None


def test_noisy_single_reading_is_not_certainty():
    """A borderline single reading should not read as near-certain hypertension."""
    p = score({**CASE, "bp_readings": [[142, 88]]})["model"]["outputs"]["hypertension"]["probability"]
    assert 0.1 < p < 0.9


# ---------------------------------------------------------------- WHO CVD in the engine


def test_cvd_without_bp_is_not_computed_and_says_so():
    c = score({**CASE, "bp_readings": []})["conditions"]["cvd"]
    assert c["computed"] is False and c["risk_10y"] is None and "measure_bp" in c["sharpen"]


def test_cvd_uses_who_bands():
    low = score({"age": 42, "sex": "female", "tobacco": "never", "bp_readings": [[116, 74]], "height_cm": 152, "weight_kg": 50})
    high = score({"age": 72, "sex": "male", "tobacco": "daily", "bp_readings": [[182, 104]], "height_cm": 165, "weight_kg": 80})
    assert low["conditions"]["cvd"]["band"] == "low" and low["conditions"]["cvd"]["risk_10y"] < 0.10
    assert high["conditions"]["cvd"]["band"] == "high" and high["conditions"]["cvd"]["risk_10y"] >= 0.20


def test_cvd_flags_diabetes_and_missing_bmi():
    c = score({**CASE, "known_diabetes": True})["conditions"]["cvd"]
    assert "use_lab_chart" in c["sharpen"] and "measure_height_weight" in c["sharpen"] and c["confidence"] == "low"

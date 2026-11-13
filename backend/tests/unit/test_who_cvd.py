"""The WHO 2019 non-lab model must reproduce WHO's reference Stata implementation."""

import json
from pathlib import Path

import pytest

from app.ml.guidelines.who_cvd import risk_for, ten_year_risk

ROWS = json.loads((Path(__file__).parents[1] / "fixtures" / "who_cvd_stata_reference.json").read_text())["rows"]


@pytest.mark.parametrize("row", ROWS, ids=[f"ref{i}" for i in range(len(ROWS))])
def test_matches_who_stata_reference(row):
    got = ten_year_risk(row["age"], row["sex"], row["sbp"], row["bmi"], row["smoking"], row["calibration"])
    assert got == pytest.approx(row["expected"], abs=1e-6)


def test_risk_rises_with_each_factor():
    base = risk_for(55, "male", 130, 23, False)
    assert risk_for(65, "male", 130, 23, False) > base
    assert risk_for(55, "male", 160, 23, False) > base
    assert risk_for(55, "male", 130, 30, False) > base
    assert risk_for(55, "male", 130, 23, True) > base


def test_india_and_south_asia_calibrations_both_load():
    assert 0 < risk_for(60, "female", 150, 27, False, "IND") < 1
    assert 0 < risk_for(60, "female", 150, 27, False, "south_asia") < 1

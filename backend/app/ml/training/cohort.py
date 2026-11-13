"""Synthetic training cohort for the PranaMap risk model.

Every person gets a latent TRUE disease status first (from literature-based risk factors), and
the screening observations are then drawn from that truth with realistic measurement noise.
That is what lets a model learn something the fixed thresholds cannot: how likely a single,
noisy doorstep reading is to reflect true disease.

This is a stand-in for real labelled data. A model trained here learns the generator's
assumptions, so it is deployed in shadow mode only and its card says so. Replace with NFHS-5,
LASI or pilot data (screening inputs + confirmed diagnosis) before any clinical use.

Targets and effect sizes (adults 30+, rural India; all approximate):
- Diabetes prevalence ~13% in 30+ (ICMR-INDIAB 2023: 11.4% in all adults, higher with age);
  about half undiagnosed. Age OR ~1.6/decade; BMI OR ~1.10/unit; one parent OR ~2, both ~3.5;
  inactivity OR ~1.4.
- Hypertension prevalence ~35% (ICMR-INDIAB 2023: 35.5%). Age OR ~1.8/decade; BMI OR ~1.10/unit;
  daily alcohol OR ~1.4; family history OR ~1.6.
- Single-visit SBP varies ~9 mmHg (SD) around a person's usual value, plus ~4 mmHg white-coat effect.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

COHORT_VERSION = "synthetic-cohort-1.0"


@dataclass(frozen=True)
class CohortConfig:
    n: int = 40_000
    seed: int = 2026
    diabetes_prevalence: float = 0.13
    hypertension_prevalence: float = 0.35
    diagnosed_share: float = 0.5


def _intercept_for(logit_wo_intercept: np.ndarray, target: float) -> float:
    """Solve for the intercept that gives the target mean prevalence (bisection)."""
    lo, hi = -20.0, 20.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if (1 / (1 + np.exp(-(logit_wo_intercept + mid)))).mean() > target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def generate(cfg: CohortConfig = CohortConfig()) -> list[dict]:
    """Returns one dict per person: screening `input` (engine schema) plus `truth` labels."""
    rng = np.random.default_rng(cfg.seed)
    n = cfg.n
    age = np.clip(30 + rng.gamma(2.2, 9.5, n), 30, 90).round()
    male = rng.random(n) < 0.5
    bmi = np.clip(rng.normal(22.0 + 0.8 * (~male), 3.6, n) + 0.04 * (age - 30), 14, 45)
    # Waist tracks BMI (~2.4 cm per unit) and runs higher in men at the same BMI.
    waist = np.clip(2.4 * bmi + 27 + np.where(male, 3, 0) + rng.normal(0, 4.5, n), 55, 140).round(1)
    activity = rng.choice(4, n, p=[0.24, 0.36, 0.26, 0.14]) + (age > 60) * (rng.random(n) < 0.3)
    activity = np.clip(activity, 0, 3)
    fh_dm = rng.choice(3, n, p=[0.76, 0.20, 0.04])
    fh_cv = rng.random(n) < 0.25
    tobacco = np.where(male, rng.choice(3, n, p=[0.45, 0.17, 0.38]), rng.choice(3, n, p=[0.84, 0.06, 0.10]))
    alcohol = rng.random(n) < np.where(male, 0.12, 0.01)

    # Latent diabetes.
    lin_dm = (
        math.log(1.6) * (age - 30) / 10
        + math.log(1.10) * (bmi - 22)
        + np.select([fh_dm == 1, fh_dm == 2], [math.log(2.0), math.log(3.5)], 0.0)
        + math.log(1.4) * (activity >= 2)
    )
    dm = rng.random(n) < 1 / (1 + np.exp(-(lin_dm + _intercept_for(lin_dm, cfg.diabetes_prevalence))))

    # Latent hypertension.
    lin_htn = (
        math.log(1.8) * (age - 30) / 10
        + math.log(1.10) * (bmi - 22)
        + math.log(1.4) * alcohol
        + math.log(1.2) * (tobacco == 2)
        + math.log(1.6) * fh_cv
    )
    htn = rng.random(n) < 1 / (1 + np.exp(-(lin_htn + _intercept_for(lin_htn, cfg.hypertension_prevalence))))

    known_dm = dm & (rng.random(n) < cfg.diagnosed_share)
    known_htn = htn & (rng.random(n) < cfg.diagnosed_share * 0.6)

    # Usual BP, then noisy doorstep readings.
    usual_sbp = np.where(htn, rng.normal(152, 12, n), rng.normal(118 + 0.3 * (age - 30), 9, n))
    usual_dbp = 0.55 * usual_sbp + 12 + rng.normal(0, 5, n)
    n_readings = np.where(rng.random(n) < 0.7, 2, 1)

    people = []
    tob_codes = ["never", "past_or_sometimes", "daily"]
    act_codes = ["vigorous", "moderate", "mild", "sedentary"]
    fh_codes = ["none", "one_parent", "both_parents"]
    for i in range(n):
        readings = []
        for _ in range(int(n_readings[i])):
            s = usual_sbp[i] + 4 + rng.normal(0, 9)
            readings.append([int(round(s)), int(round(usual_dbp[i] + 2 + rng.normal(0, 6)))])
        x: dict = {
            "age": int(age[i]),
            "sex": "male" if male[i] else "female",
            "tobacco": tob_codes[tobacco[i]],
            "alcohol_daily": bool(alcohol[i]),
            "activity": act_codes[int(activity[i])],
            "fh_diabetes": fh_codes[fh_dm[i]],
            "fh_heart_or_bp": bool(fh_cv[i]),
            "bp_readings": readings,
            "known_diabetes": bool(known_dm[i]),
            "known_hypertension": bool(known_htn[i]),
            "symptoms": [],
        }
        # Realistic missingness: the waist tape, scale and glucometer are not always there.
        if rng.random() < 0.85:
            x["waist_cm"] = float(waist[i])
        if rng.random() < 0.55:
            h = rng.normal(163 if male[i] else 151, 6)
            x["height_cm"] = int(round(h))
            x["weight_kg"] = int(round(bmi[i] * (h / 100) ** 2))
        if rng.random() < 0.55:
            fasting = rng.random() < 0.2
            x["glucose_type"] = "fasting" if fasting else "random"
            if dm[i]:
                g = rng.lognormal(math.log(140 if fasting else 215), 0.25)
            else:
                g = rng.lognormal(math.log(92 if fasting else 118), 0.17)
            x["glucose_mg_dl"] = int(round(g))
        if dm[i] and rng.random() < 0.35:
            x["symptoms"] = sorted(rng.choice(["excessive_thirst", "frequent_urination", "slow_healing_wounds", "blurred_vision"], 2, replace=False).tolist())
        elif rng.random() < 0.05:
            x["symptoms"] = [str(rng.choice(["excessive_thirst", "frequent_urination", "tingling_numbness"]))]
        people.append({"input": x, "truth": {"diabetes": bool(dm[i]), "hypertension": bool(htn[i])}})
    return people

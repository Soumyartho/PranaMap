"""Shared helpers for the guideline scorers.

The scorers are deliberately plain: every number traces to a published instrument
(CBAC, IDRS, WHO thresholds) or is labelled as interim. The TypeScript port in
frontend/src/services/risk must produce identical output; shared/fixtures holds the
golden cases both test suites check.
"""

from __future__ import annotations

import math
from typing import Any, Literal

Band = Literal["low", "moderate", "high"]
BANDS: tuple[Band, ...] = ("low", "moderate", "high")

DIABETES_SYMPTOMS = ("excessive_thirst", "frequent_urination", "slow_healing_wounds", "blurred_vision", "tingling_numbness")
TB_CORE_SYMPTOMS = ("cough_2_weeks", "fever", "night_sweats", "weight_loss")
STROKE_SIGNS = ("face_droop", "arm_weakness", "speech_difficulty")
ALTERED_CONSCIOUSNESS = ("unconscious", "seizure", "confusion")
HTN_EMERGENCY_SYMPTOMS = ("chest_pain", "severe_headache", "confusion", "severe_breathlessness", "blurred_vision")
PREGNANCY_DANGER = (
    "pregnancy_bleeding",
    "pregnancy_severe_headache",
    "pregnancy_convulsions",
    "pregnancy_swelling",
    "reduced_fetal_movement",
)


def round_half_up(x: float) -> int:
    """Python's round() is banker's rounding; JavaScript's Math.round is half-up. Match JS."""
    return int(math.floor(x + 0.5))


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def band_max(a: Band, b: Band) -> Band:
    return a if BANDS.index(a) >= BANDS.index(b) else b


def bump(band: Band) -> Band:
    return BANDS[min(len(BANDS) - 1, BANDS.index(band) + 1)]


def driver(code: str, points: float, value: Any = None, direction: str = "up") -> dict:
    out: dict[str, Any] = {"code": code, "points": points, "direction": direction}
    if value is not None:
        out["value"] = value
    return out


def top_drivers(drivers: list[dict], n: int = 3) -> list[dict]:
    """Strongest reasons first; ties keep insertion order (stable sort in both languages)."""
    ranked = sorted(drivers, key=lambda d: -abs(d["points"]))
    return [d for d in ranked if d["points"] != 0][:n]


def bp_summary(x: dict) -> tuple[int | None, int | None, int | None, int | None]:
    """Mean and max of the BP readings: mean for staging, max for safety checks."""
    readings = [r for r in (x.get("bp_readings") or []) if r and r[0] and r[1]]
    if not readings:
        return None, None, None, None
    n = len(readings)
    mean_s = round_half_up(sum(r[0] for r in readings) / n)
    mean_d = round_half_up(sum(r[1] for r in readings) / n)
    return mean_s, mean_d, max(r[0] for r in readings), max(r[1] for r in readings)


def bmi(x: dict) -> float | None:
    h, w = x.get("height_cm"), x.get("weight_kg")
    if not h or not w:
        return None
    return math.floor(w / (h / 100) ** 2 * 10 + 0.5) / 10


def glucose_status(x: dict) -> str | None:
    """'diabetic' | 'borderline' | 'normal' | 'low' | None, by test type (mg/dL)."""
    g = x.get("glucose_mg_dl")
    if g is None:
        return None
    if g < 70:
        return "low"
    if x.get("glucose_type") == "fasting":
        return "diabetic" if g >= 126 else "borderline" if g >= 100 else "normal"
    return "diabetic" if g >= 200 else "borderline" if g >= 140 else "normal"

"""Hard safety rules. They run before any score and override every score.

Emergency  → call 108 now and alert the ANM.
Urgent     → same-day visit to the PHC.
These lists need sign-off from a doctor before field use (see the clinical safety checklist).
"""

from __future__ import annotations

from .common import ALTERED_CONSCIOUSNESS, HTN_EMERGENCY_SYMPTOMS, PREGNANCY_DANGER, STROKE_SIGNS, bp_summary


def _flag(code: str, level: str) -> dict:
    return {"code": code, "level": level, "action": "call_108" if level == "emergency" else "same_day_phc"}


def check_red_flags(x: dict) -> list[dict]:
    s = set(x.get("symptoms") or [])
    flags: list[dict] = []
    _, _, max_s, max_d = bp_summary(x)

    if any(k in s for k in STROKE_SIGNS):
        flags.append(_flag("stroke_signs", "emergency"))
    if "chest_pain" in s:
        flags.append(_flag("chest_pain", "emergency"))
    spo2 = x.get("spo2")
    if "severe_breathlessness" in s or (spo2 is not None and spo2 < 90):
        flags.append(_flag("breathing", "emergency"))
    if any(k in s for k in ALTERED_CONSCIOUSNESS):
        flags.append(_flag("altered_consciousness", "emergency"))
    if max_s is not None and (max_s >= 180 or max_d >= 110):
        if any(k in s for k in HTN_EMERGENCY_SYMPTOMS):
            flags.append(_flag("hypertensive_emergency", "emergency"))
        else:
            flags.append(_flag("severe_bp", "urgent"))

    g = x.get("glucose_mg_dl")
    if g is not None and g < 70:
        flags.append(_flag("low_glucose", "emergency"))
    elif g is not None and g >= 400:
        flags.append(_flag("very_high_glucose", "urgent"))

    hb = x.get("hb_g_dl")
    if hb is not None and hb < 7:
        flags.append(_flag("severe_anaemia", "urgent"))
    if "blood_in_sputum" in s:
        flags.append(_flag("haemoptysis", "urgent"))
    if x.get("pregnant") and any(k in s for k in PREGNANCY_DANGER):
        flags.append(_flag("pregnancy_danger", "emergency"))
    return flags

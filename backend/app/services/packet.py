"""Pre-consult packet: what the doctor needs before saying hello. Fixes the one-word referral."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now
from app.ml.guidelines.common import bmi, bp_summary
from app.services import media as media_svc
from app.models import Facility, Household, Person, Referral, Screening, User, Village

# Plain prompts the doctor sees for each recommended action.
QUESTIONS = {
    "confirm_diabetes": "Confirm diabetes: fasting glucose or HbA1c.",
    "refer_glucose_test": "Glucose test: fasting glucose or HbA1c.",
    "prediabetes_lifestyle": "Prediabetes range: counsel diet and activity, recheck in 3 months.",
    "refer_bp_confirm": "Confirm hypertension with repeat readings; consider starting treatment.",
    "known_uncontrolled": "Known condition, not controlled: review medicines and adherence.",
    "refer_ncd_clinic": "High cardiovascular risk: lipid profile, ECG, consider statin and aspirin per protocol.",
    "refer_hb_test": "Anaemia symptoms: check haemoglobin.",
    "treat_anaemia_refer": "Low haemoglobin: start treatment, look for cause.",
    "refer_sputum_test": "Presumptive TB: sputum NAAT (CBNAAT/TrueNat).",
}


def mask(value: str | None, keep: int = 4) -> str | None:
    if not value:
        return None
    return "•" * max(0, len(value) - keep) + value[-keep:]


def vitals_of(s: Screening) -> dict:
    x = s.input
    sbp, dbp, _, _ = bp_summary(x)
    return {
        "date": s.captured_at.isoformat() + "Z",
        "bp_readings": x.get("bp_readings") or [],
        "sbp": sbp,
        "dbp": dbp,
        "glucose_mg_dl": x.get("glucose_mg_dl"),
        "glucose_type": x.get("glucose_type"),
        "hb_g_dl": x.get("hb_g_dl"),
        "spo2": x.get("spo2"),
        "waist_cm": x.get("waist_cm"),
        "bmi": bmi(x),
        "priority": s.priority,
        "urgency": s.urgency,
    }


def build_packet(db: Session, r: Referral, *, include_identity: bool = True) -> dict:
    person = db.get(Person, r.person_id)
    household = db.get(Household, person.household_id)
    village = db.get(Village, household.village_id)
    asha = db.get(User, r.asha_id)
    facility = db.get(Facility, r.facility_id) if r.facility_id else None
    history = db.scalars(select(Screening).where(Screening.person_id == person.id).order_by(Screening.captured_at)).all()
    latest = db.get(Screening, r.screening_id) or history[-1]
    result = latest.result
    conditions = result.get("conditions", {})
    actions = {c["action"] for c in conditions.values() if c["band"] == "high"}

    return {
        "referral": {
            "id": r.id,
            "status": r.status,
            "urgency": r.urgency,
            "priority": r.priority,
            "lane": r.lane,
            "reasons": r.reasons,
            "mode": r.mode,
            "facility": facility.name if facility else None,
            "routing": r.routing,
            "created_at": r.created_at.isoformat() + "Z",
            "escalation_level": r.escalation_level,
        },
        "patient": {
            "id": person.id,
            "name": person.name if include_identity else None,
            "age": now().year - person.birth_year,
            "sex": person.sex,
            "pregnant": person.pregnant,
            "village": village.name,
            "phone": mask(person.phone),
            "abha": mask(person.abha_number),
            "known_diabetes": person.known_diabetes,
            "known_hypertension": person.known_hypertension,
            "medications": person.medications or [],
        },
        "asha": {"name": asha.name, "phone": asha.phone} if asha else None,
        "latest": vitals_of(latest),
        "trend": [vitals_of(s) for s in history[-8:]],
        "red_flags": result.get("red_flags", []),
        "symptoms": latest.input.get("symptoms", []),
        "risk": {
            k: {key: c[key] for key in ("band", "score", "drivers", "action", "confidence", "instrument")}
            for k, c in conditions.items()
        },
        "cbac": result.get("cbac"),
        "questions": [QUESTIONS[a] for a in sorted(actions) if a in QUESTIONS],
        "voice_notes": media_svc.for_referral(db, r.id),
        "engine_version": result.get("engine_version"),
        "generated_at": now().isoformat() + "Z",
    }

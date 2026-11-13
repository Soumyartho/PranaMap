"""FHIR R4 export of a referral: Patient, Observations, RiskAssessments, ServiceRequest, Appointment.

Plain dicts that follow the R4 resource shapes, so there is no heavy dependency. ABDM exchanges
FHIR bundles under a consent artefact; this is the payload, the consent flow is separate.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now
from app.ml.guidelines.common import bmi
from app.models import Appointment, Person, Referral, Screening

LOINC = "http://loinc.org"
STATUS = {"flagged": "active", "acknowledged": "active", "booked": "active", "missed": "on-hold",
          "seen": "completed", "closed": "completed", "cancelled": "revoked"}
CONDITION_TEXT = {"diabetes": "Type 2 diabetes", "hypertension": "Hypertension", "cvd": "Cardiovascular disease",
                  "anaemia": "Anaemia", "tb": "Tuberculosis"}


def _obs(id_: str, patient: str, when: str, code: str, display: str, value: float, unit: str, ucum: str) -> dict:
    return {
        "resourceType": "Observation",
        "id": id_,
        "status": "final",
        "code": {"coding": [{"system": LOINC, "code": code, "display": display}]},
        "subject": {"reference": f"Patient/{patient}"},
        "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit, "system": "http://unitsofmeasure.org", "code": ucum},
    }


def screening_observations(s: Screening, patient_id: str) -> list[dict]:
    x, when, out = s.input, s.captured_at.isoformat() + "Z", []
    for i, (sys_, dia) in enumerate(x.get("bp_readings") or []):
        out.append({
            "resourceType": "Observation",
            "id": f"{s.id}-bp{i}",
            "status": "final",
            "code": {"coding": [{"system": LOINC, "code": "85354-9", "display": "Blood pressure panel"}]},
            "subject": {"reference": f"Patient/{patient_id}"},
            "effectiveDateTime": when,
            "component": [
                {"code": {"coding": [{"system": LOINC, "code": "8480-6", "display": "Systolic blood pressure"}]},
                 "valueQuantity": {"value": sys_, "unit": "mmHg", "system": "http://unitsofmeasure.org", "code": "mm[Hg]"}},
                {"code": {"coding": [{"system": LOINC, "code": "8462-4", "display": "Diastolic blood pressure"}]},
                 "valueQuantity": {"value": dia, "unit": "mmHg", "system": "http://unitsofmeasure.org", "code": "mm[Hg]"}},
            ],
        })
    if x.get("glucose_mg_dl") is not None:
        out.append(_obs(f"{s.id}-glu", patient_id, when, "2339-0", "Glucose [Mass/volume] in Blood", x["glucose_mg_dl"], "mg/dL", "mg/dL"))
    if x.get("hb_g_dl") is not None:
        out.append(_obs(f"{s.id}-hb", patient_id, when, "718-7", "Hemoglobin [Mass/volume] in Blood", x["hb_g_dl"], "g/dL", "g/dL"))
    if x.get("spo2") is not None:
        out.append(_obs(f"{s.id}-spo2", patient_id, when, "59408-5", "Oxygen saturation by Pulse oximetry", x["spo2"], "%", "%"))
    if x.get("waist_cm") is not None:
        out.append(_obs(f"{s.id}-waist", patient_id, when, "8280-0", "Waist Circumference", x["waist_cm"], "cm", "cm"))
    if x.get("height_cm"):
        out.append(_obs(f"{s.id}-ht", patient_id, when, "8302-2", "Body height", x["height_cm"], "cm", "cm"))
    if x.get("weight_kg"):
        out.append(_obs(f"{s.id}-wt", patient_id, when, "29463-7", "Body weight", x["weight_kg"], "kg", "kg"))
    b = bmi(x)
    if b is not None:
        out.append(_obs(f"{s.id}-bmi", patient_id, when, "39156-5", "Body mass index", b, "kg/m2", "kg/m2"))
    return out


def referral_bundle(db: Session, r: Referral) -> dict:
    person = db.get(Person, r.person_id)
    screening = db.get(Screening, r.screening_id)
    pid = person.id
    patient = {
        "resourceType": "Patient",
        "id": pid,
        "identifier": ([{"system": "https://healthid.abdm.gov.in", "value": person.abha_number}] if person.abha_number else []),
        "name": [{"text": person.name}],
        "gender": person.sex if person.sex in ("male", "female") else "unknown",
        "birthDate": str(person.birth_year),
    }
    entries = [patient, *screening_observations(screening, pid)]
    for key, c in screening.result.get("conditions", {}).items():
        entries.append({
            "resourceType": "RiskAssessment",
            "id": f"{screening.id}-{key}",
            "status": "final",
            "subject": {"reference": f"Patient/{pid}"},
            "occurrenceDateTime": screening.captured_at.isoformat() + "Z",
            "method": {"text": c["instrument"]},
            "prediction": [{
                "outcome": {"text": CONDITION_TEXT[key]},
                "qualitativeRisk": {"text": c["band"]},
                "rationale": ", ".join(d["code"] for d in c["drivers"]),
            }],
            "note": [{"text": f"PranaMap engine {screening.engine_version}; decision support, not a diagnosis."}],
        })
    entries.append({
        "resourceType": "ServiceRequest",
        "id": r.id,
        "status": STATUS[r.status],
        "intent": "order",
        "priority": {"emergency": "stat", "urgent": "urgent", "soon": "asap"}.get(r.urgency, "routine"),
        "subject": {"reference": f"Patient/{pid}"},
        "authoredOn": r.created_at.isoformat() + "Z",
        "reasonCode": [{"text": reason} for reason in r.reasons],
        "supportingInfo": [{"reference": f"RiskAssessment/{screening.id}-{k}"} for k in screening.result.get("conditions", {})],
    })
    for a in db.scalars(select(Appointment).where(Appointment.referral_id == r.id)):
        entries.append({
            "resourceType": "Appointment",
            "id": a.id,
            "status": {"booked": "booked", "attended": "fulfilled", "missed": "noshow", "cancelled": "cancelled"}[a.status],
            "start": a.slot_start.isoformat() + "Z",
            "end": a.slot_end.isoformat() + "Z",
            "basedOn": [{"reference": f"ServiceRequest/{r.id}"}],
            "participant": [{"actor": {"reference": f"Patient/{pid}"}, "status": "accepted"}],
        })
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "timestamp": now().isoformat() + "Z",
        "entry": [{"fullUrl": f"urn:uuid:{e['id']}", "resource": e} for e in entries],
    }

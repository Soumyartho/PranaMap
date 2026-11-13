import hashlib

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_token, verify_pin
from app.models import User
from app.services.referrals import audit


def user_out(u: User) -> dict:
    return {"id": u.id, "name": u.name, "phone": u.phone, "role": u.role, "block": u.block,
            "facility_id": u.facility_id, "village_ids": u.village_ids or [], "language": u.language}


def login(db: Session, phone: str, pin: str) -> dict:
    user = db.scalars(select(User).where(User.phone == phone)).first()
    if user is None or not verify_pin(pin, user.pin_hash, user.pin_salt):
        raise HTTPException(401, "Wrong phone number or PIN")
    audit(db, user, "auth.login", "user", user.id)
    db.commit()
    # Salt for the phone's PBKDF2 key; derived from the server salt so it is stable per user
    # but is not the hash salt itself.
    key_salt = hashlib.sha256(f"device-key:{user.pin_salt}".encode()).hexdigest()[:32]
    return {"token": create_token(user), "user": user_out(user), "key_salt": key_salt}


DEMO_ACCOUNTS = [
    {"role": "asha", "phone": "9000000001", "label": "ASHA worker"},
    {"role": "anm", "phone": "9000000101", "label": "ANM"},
    {"role": "medical_officer", "phone": "9000000201", "label": "PHC medical officer"},
    {"role": "doctor", "phone": "9000000301", "label": "Teleconsult doctor"},
    {"role": "district_officer", "phone": "9000000401", "label": "District health officer"},
]


def demo_accounts(db: Session) -> list[dict]:
    out = []
    for acc in DEMO_ACCOUNTS:
        u = db.scalars(select(User).where(User.phone == acc["phone"])).first()
        if u:
            out.append({**acc, "name": u.name, "pin": "1234"})
    return out

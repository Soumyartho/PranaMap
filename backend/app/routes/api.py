"""URL → controller wiring. Routes stay thin: parse, authorise, delegate."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.chatbot.engine import answer
from app.integrations.bhashini import client as bhashini
from app.controllers import auth as auth_ctl
from app.controllers import care as care_ctl
from app.core import clock
from app.core.config import get_settings
from app.core.security import current_user, require
from app.db.session import get_db
from app.ml.engine import ENGINE_VERSION, score
from fastapi.responses import FileResponse

from app.models import Facility, Media, User
from app.services import media as media_svc
from app.services import dashboard as dash
from app.services import notifications as notifications_svc
from app.services.model_monitoring import monitoring
from app.services import sync as sync_svc
from app.views import schemas as v
from app.workers.escalation import tick

router = APIRouter(prefix="/api")
STAFF = ("anm", "medical_officer", "doctor", "district_officer")


@router.get("/health")
def health() -> dict:
    return {"ok": True, "engine_version": ENGINE_VERSION, "clock_offset_hours": clock.offset_hours(), "demo": get_settings().demo_mode}


# ---------------------------------------------------------------- auth


@router.post("/auth/login", response_model=v.LoginOut)
def login(body: v.LoginIn, db: Session = Depends(get_db)):
    return auth_ctl.login(db, body.phone, body.pin)


@router.get("/auth/me", response_model=v.UserOut)
def me(user: User = Depends(current_user)):
    return auth_ctl.user_out(user)


@router.get("/auth/demo-accounts")
def demo_accounts(db: Session = Depends(get_db)):
    if not get_settings().demo_mode:
        raise HTTPException(404)
    return auth_ctl.demo_accounts(db)


# ---------------------------------------------------------------- sync (ASHA phone)


@router.post("/sync/push", response_model=v.SyncPushOut)
def sync_push(body: v.SyncPushIn, user: User = Depends(require("asha")), db: Session = Depends(get_db)):
    results = sync_svc.push(db, user, body.device_id, [e.model_dump() for e in body.events])
    return {"results": results, "server_time": clock.now().isoformat() + "Z"}


@router.get("/sync/pull")
def sync_pull(since: str | None = None, user: User = Depends(require("asha")), db: Session = Depends(get_db)):
    parsed: datetime | None = sync_svc.parse_ts(since) if since else None
    return sync_svc.pull(db, user, parsed)


# ---------------------------------------------------------------- risk


@router.post("/risk/score")
def risk_score(body: v.ScoreIn, _: User = Depends(current_user)):
    """Server re-score, for audit and for clients without the offline engine."""
    if "age" not in body.input:
        raise HTTPException(422, "input.age is required")
    return score(body.input)


# ---------------------------------------------------------------- referrals and care


@router.get("/referrals")
def referrals(status: str | None = None, include_closed: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return care_ctl.list_referrals(db, user, status, include_closed)


@router.post("/referrals/{referral_id}/transition")
def referral_transition(referral_id: str, body: v.TransitionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return care_ctl.transition(db, user, referral_id, body.to, body.note, body.outcome)


@router.post("/referrals/{referral_id}/book")
def referral_book(referral_id: str, body: v.BookIn, user: User = Depends(require("anm", "medical_officer", "doctor")), db: Session = Depends(get_db)):
    return care_ctl.book(db, user, referral_id, body.facility_id, body.mode)


@router.patch("/referrals/{referral_id}/lane")
def referral_lane(referral_id: str, body: v.LaneIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return care_ctl.set_lane(db, user, referral_id, body.lane)


@router.get("/referrals/{referral_id}/packet")
def referral_packet(referral_id: str, user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    return care_ctl.packet(db, user, referral_id)


@router.get("/referrals/{referral_id}/fhir")
def referral_fhir(referral_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return care_ctl.fhir(db, user, referral_id)


@router.get("/alerts")
def alerts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return care_ctl.alerts(db, user)


@router.post("/alerts/{alert_id}/ack")
def ack_alert(alert_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return care_ctl.ack_alert(db, user, alert_id)


@router.get("/doctor/queue")
def doctor_queue(user: User = Depends(require("doctor", "medical_officer")), db: Session = Depends(get_db)):
    return care_ctl.doctor_queue(db, user)


@router.get("/facilities")
def facilities(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [
        {"id": f.id, "name": f.name, "kind": f.kind, "lat": f.lat, "lon": f.lon, "capabilities": f.capabilities, "opens": f.opens,
         "closes": f.closes, "days": f.days, "open_24x7": f.open_24x7, "staffed": f.staffed,
         "last_verified_at": f.last_verified_at.isoformat() + "Z" if f.last_verified_at else None}
        for f in db.scalars(select(Facility).where(Facility.block == user.block))
    ]


# ---------------------------------------------------------------- dashboard


@router.get("/dashboard/summary")
def dashboard_summary(user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    return dash.summary(db, user)


@router.get("/dashboard/hexmap")
def dashboard_hexmap(user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    return dash.hexmap(db, user)


@router.get("/dashboard/coverage")
def dashboard_coverage(user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    return dash.coverage(db, user)


@router.get("/dashboard/outbreaks")
def dashboard_outbreaks(user: User = Depends(require(*STAFF)), db: Session = Depends(get_db)):
    return dash.outbreaks(db, user)


@router.get("/dashboard/model")
def dashboard_model(user: User = Depends(require("medical_officer", "district_officer")), db: Session = Depends(get_db)):
    """Shadow-model monitoring: agreement, realised calibration, drift, overrides."""
    return monitoring(db, user)


@router.get("/notifications")
def notifications(user: User = Depends(require("anm", "medical_officer", "district_officer")), db: Session = Depends(get_db)):
    """Outbound message log (numbers masked; no names in the district view)."""
    return notifications_svc.recent(db, user)


@router.get("/media/{media_id}")
def media_file(media_id: str, user: User = Depends(require("anm", "medical_officer", "doctor")), db: Session = Depends(get_db)):
    """A voice note, for staff whose block the referral belongs to."""
    m = db.get(Media, media_id)
    if m is None:
        raise HTTPException(404, "Not found")
    care_ctl.get_referral(db, user, m.referral_id)  # raises 403 outside the block
    path = media_svc.path_for(m.id)
    if not path.exists():
        raise HTTPException(410, "Expired")
    return FileResponse(path, media_type=m.mime, headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- voice


@router.get("/voice/status")
def voice_status(_: User = Depends(current_user)):
    return {"bhashini": bhashini.client().available()}


@router.post("/voice/transcribe")
def voice_transcribe(body: v.TranscribeIn, _: User = Depends(current_user)):
    """Server-side Bhashini ASR. The audio is passed through and never stored."""
    c = bhashini.client()
    if not c.available():
        raise HTTPException(503, "Bhashini is not configured on this server")
    try:
        return {"text": c.transcribe(body.lang, body.audio_base64, body.sample_rate), "provider": "bhashini"}
    except bhashini.BhashiniError as exc:
        raise HTTPException(502, str(exc)) from exc


# ---------------------------------------------------------------- chatbot


@router.post("/chat")
def chat(body: v.ChatIn):
    """Open to patients too: no personal data in, none out."""
    return answer(body.message, body.lang)


# ---------------------------------------------------------------- demo controls


@router.post("/demo/advance")
def demo_advance(body: v.AdvanceIn, _: User = Depends(require(*STAFF))):
    if not get_settings().demo_mode:
        raise HTTPException(404)
    clock.advance(body.hours)
    changed = tick()
    return {"clock_offset_hours": clock.offset_hours(), "escalations": changed, "now": clock.now().isoformat() + "Z"}


@router.post("/demo/reset-clock")
def demo_reset(_: User = Depends(require(*STAFF))):
    if not get_settings().demo_mode:
        raise HTTPException(404)
    clock.reset()
    return {"clock_offset_hours": 0}

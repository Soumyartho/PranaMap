"""Synthetic village for demos. Every person, place and record here is invented.

    python -m scripts.seed_synthetic          # wipe and rebuild the database

Twelve villages in a fictional block in West Bengal, households around each village centre,
adults with correlated risk factors (age, waist, blood pressure, glucose, haemoglobin drawn
together, not independently), screenings scored by the real engine, and referrals spread
across every stage of the loop so the dashboard has something true-to-life to show.
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta

from app.core.clock import now
from app.core.security import hash_pin
from app.db.session import Base, SessionLocal, engine
from app.ml.engine import score
from app.models import (
    Alert,
    Appointment,
    Consent,
    Facility,
    Household,
    Person,
    Referral,
    ReferralEvent,
    Screening,
    SyndromeEvent,
    User,
    Village,
)
from app.services.referrals import LANE
from app.services.routing import from_model, route

BLOCK = "Shalbani Block (synthetic)"
CENTER = (23.235, 87.065)  # Bankura district area; positions are illustrative only
SEED = 42

VILLAGES = [
    ("Shimulpur", 2.1, -3.0, 0.3), ("Kadamtala", -2.6, -1.8, 0.8), ("Palashbani", 4.4, 2.2, 1.5),
    ("Bakultala", -4.8, 3.9, 4.2), ("Amlagora", 0.8, 5.6, 2.0), ("Jhilimili", -7.2, -4.4, 5.5),
    ("Sonajhuri", 6.3, -5.1, 0.6), ("Kusumdihi", -1.2, -6.9, 3.1), ("Mahuldanga", 8.1, 4.8, 6.0),
    ("Tetulia", -5.9, 0.4, 1.1), ("Nimdangi", 2.9, 8.3, 3.8), ("Rangamati", -3.4, 7.7, 7.2),
]
FIRST_F = ["Rina", "Mamata", "Sabita", "Anjali", "Purnima", "Laxmi", "Mithu", "Rupa", "Sumitra", "Chhabi", "Kalpana", "Tapati",
           "Basanti", "Shefali", "Parbati", "Malati", "Archana", "Gita", "Jharna", "Swapna"]
FIRST_M = ["Ramesh", "Sukumar", "Bablu", "Tapan", "Gopal", "Haradhan", "Nimai", "Biswanath", "Shyamal", "Kartik", "Dilip",
           "Ashok", "Bijoy", "Sanjoy", "Prakash", "Madhab", "Nitai", "Subal", "Ratan", "Bhabani"]
SURNAMES = ["Mondal", "Mahato", "Hansda", "Murmu", "Ghosh", "Bauri", "Soren", "Pal", "Das", "Bag", "Kundu", "Tudu", "Roy",
            "Sardar", "Lohar", "Mandi"]


def offset(lat: float, lon: float, north_km: float, east_km: float) -> tuple[float, float]:
    return lat + north_km / 111.0, lon + east_km / (111.0 * math.cos(math.radians(lat)))


def facilities(t: datetime) -> list[Facility]:
    def f(name, kind, n, e, caps, opens="09:00", closes="16:00", days=(0, 1, 2, 3, 4, 5), h24=False, staffed=True, slots=24):
        lat, lon = offset(*CENTER, n, e)
        return Facility(name=name, kind=kind, block=BLOCK, lat=lat, lon=lon, capabilities=caps, opens=opens, closes=closes,
                        days=list(days), open_24x7=h24, staffed=staffed, daily_slots=slots,
                        last_verified_at=t - timedelta(days=random.randint(0, 9)), phone="0324" + str(random.randint(1000000, 9999999)))

    ncd = ["glucose_test", "bp_management", "hb_test", "ncd_clinic"]
    return [
        f("Shalbani CHC", "chc", 0.2, 0.4, [*ncd, "sputum_test", "ecg", "emergency"], h24=True, days=range(7), slots=60),
        f("Kadamtala PHC", "phc", -2.9, -1.2, [*ncd, "sputum_test"], slots=32),
        f("Amlagora PHC", "phc", 1.5, 6.4, [*ncd], opens="10:00", closes="15:00", slots=24),
        f("Shimulpur AAM (sub-centre)", "sub_centre", 2.4, -2.6, ["glucose_test", "bp_management", "hb_test"], opens="09:00", closes="13:00"),
        f("Jhilimili AAM (sub-centre)", "sub_centre", -6.8, -3.9, ["glucose_test", "bp_management"], days=(0, 2, 4), opens="10:00", closes="14:00"),
        f("Mahuldanga AAM (sub-centre)", "sub_centre", 7.7, 4.3, ["glucose_test", "bp_management", "hb_test"], staffed=False),
        f("District eSanjeevani hub (synthetic)", "tele_hub", 30.0, 30.0, ["teleconsult", "ncd_clinic"], opens="08:00", closes="20:00",
          days=range(7), slots=80),
    ]


def make_input(rng: random.Random, p: Person, year: int) -> tuple[dict, dict]:
    """Screening inputs plus the hidden truth they were drawn from (used for visit outcomes)."""
    age = year - p.birth_year
    female = p.sex == "female"
    obese = rng.random() < 0.18 + 0.004 * (age - 30)
    htn = rng.random() < 0.10 + 0.006 * (age - 30) + 0.10 * obese or p.known_hypertension
    dm = rng.random() < 0.05 + 0.003 * (age - 30) + 0.07 * obese or p.known_diabetes
    pre_dm = not dm and rng.random() < 0.15

    def r1(x: float) -> float:
        return round(x * 2) / 2

    sbp = 116 + 0.42 * (age - 30) + 7 * obese + (24 if htn else 0) + rng.gauss(0, 9)
    dbp = 0.55 * sbp + 9 + rng.gauss(0, 6)
    readings = [[int(sbp), int(dbp)]]
    if rng.random() < 0.7:
        readings.append([int(sbp + rng.gauss(-3, 5)), int(dbp + rng.gauss(-2, 4))])

    x: dict = {
        "age": age,
        "sex": p.sex,
        "pregnant": p.pregnant,
        "tobacco": rng.choices(["never", "past_or_sometimes", "daily"], [0.84, 0.06, 0.10] if female else [0.45, 0.17, 0.38])[0],
        "alcohol_daily": rng.random() < (0.01 if female else 0.12),
        "activity": rng.choices(["vigorous", "moderate", "mild", "sedentary"],
                                [0.30, 0.38, 0.22, 0.10] if age < 55 else [0.10, 0.30, 0.38, 0.22])[0],
        "fh_diabetes": rng.choices(["none", "one_parent", "both_parents"], [0.76, 0.20, 0.04])[0],
        "fh_heart_or_bp": rng.random() < 0.25,
        "waist_cm": r1((76 if female else 84) + 15 * obese + 0.12 * (age - 30) + rng.gauss(0, 5)),
        "bp_readings": readings,
        "known_diabetes": p.known_diabetes,
        "known_hypertension": p.known_hypertension,
        "symptoms": [],
    }
    if rng.random() < 0.5:
        height = rng.gauss(151 if female else 163, 6)
        x["height_cm"] = round(height)
        x["weight_kg"] = round((height / 100) ** 2 * (rng.gauss(21.5, 2.6) + 5 * obese))
    if rng.random() < 0.55:
        x["glucose_type"] = "random" if rng.random() < 0.8 else "fasting"
        rand = x["glucose_type"] == "random"
        if dm:
            x["glucose_mg_dl"] = int(rng.uniform(205, 330) if rand else rng.uniform(128, 220))
        elif pre_dm:
            x["glucose_mg_dl"] = int(rng.uniform(142, 192) if rand else rng.uniform(101, 123))
        else:
            x["glucose_mg_dl"] = int(rng.uniform(84, 136) if rand else rng.uniform(78, 98))
    hb = rng.gauss(11.3 if female else 13.5, 1.5)
    if rng.random() < (0.45 if female else 0.2):
        x["hb_g_dl"] = round(max(6.2, hb), 1)
    sym = x["symptoms"]
    if hb < (10.5 if female else 12):
        sym += rng.sample(["pallor", "fatigue", "breathless_exertion", "dizziness"], k=rng.randint(1, 3))
    if dm and rng.random() < 0.4:
        sym += rng.sample(["excessive_thirst", "frequent_urination", "slow_healing_wounds", "blurred_vision"], k=2)
    if rng.random() < 0.025:
        sym += rng.sample(["cough_2_weeks", "fever", "night_sweats", "weight_loss"], k=rng.randint(1, 3))
    if rng.random() < 0.01:
        sym.append(rng.choice(["chest_pain", "face_droop", "severe_breathlessness"]))
    x["symptoms"] = sorted(set(sym))
    return x, {"diabetes": bool(dm), "hypertension": bool(htn), "anaemia": hb < (12 if female else 13)}


def main() -> None:
    rng = random.Random(SEED)
    random.seed(SEED)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    t = now()
    year = t.year
    pin_hash, pin_salt = hash_pin("1234")

    def user(name, phone, role, **kw) -> User:
        u = User(name=name, phone=phone, role=role, pin_hash=pin_hash, pin_salt=pin_salt, block=BLOCK, **kw)
        db.add(u)
        return u

    facs = facilities(t)
    db.add_all(facs)
    db.flush()
    by_kind = {f.name: f for f in facs}

    villages = []
    for name, n, e, road in VILLAGES:
        lat, lon = offset(*CENTER, n, e)
        villages.append(Village(name=name, block=BLOCK, lat=lat, lon=lon, km_from_road=road))
    db.add_all(villages)
    db.flush()

    asha_names = ["Rina Mondal", "Mamata Mahato", "Sabita Hansda", "Purnima Ghosh", "Anjali Soren", "Laxmi Bauri"]
    ashas = []
    for i, name in enumerate(asha_names):
        ashas.append(user(name, f"90000000{i + 1:02d}", "asha", village_ids=[villages[2 * i].id, villages[2 * i + 1].id], language="bn"))
    user("Shefali Das (ANM)", "9000000101", "anm", facility_id=by_kind["Kadamtala PHC"].id, language="bn")
    user("Dr. Arindam Pal (MO)", "9000000201", "medical_officer", facility_id=by_kind["Kadamtala PHC"].id, language="en")
    user("Dr. Nandini Roy", "9000000301", "doctor", facility_id=by_kind["District eSanjeevani hub (synthetic)"].id, language="en")
    user("Dr. S. Kundu (DHO)", "9000000401", "district_officer", language="en")
    db.flush()
    doctor = db.query(User).filter_by(role="doctor").first()
    mo = db.query(User).filter_by(role="medical_officer").first()

    # Coverage differs by village so blind spots show up: far-from-road villages are screened less.
    persons_by_village: dict[str, list[tuple[Person, Household]]] = {}
    for v_idx, v in enumerate(villages):
        asha = ashas[v_idx // 2]
        persons_by_village[v.id] = []
        n_households = rng.randint(18, 28)
        for h_idx in range(n_households):
            surname = rng.choice(SURNAMES)
            dist, angle = abs(rng.gauss(0, 0.35)), rng.uniform(0, 2 * math.pi)
            lat, lon = offset(v.lat, v.lon, dist * math.cos(angle), dist * math.sin(angle))
            head_sex = "male" if rng.random() < 0.8 else "female"
            head = f"{rng.choice(FIRST_M if head_sex == 'male' else FIRST_F)} {surname}"
            hh = Household(village_id=v.id, asha_id=asha.id, head_name=head, number=f"{v.name[:3].upper()}-{h_idx + 1:03d}", lat=lat, lon=lon)
            db.add(hh)
            db.flush()
            members = [(head, head_sex, rng.randint(32, 72))]
            if rng.random() < 0.85:
                members.append((f"{rng.choice(FIRST_F if head_sex == 'male' else FIRST_M)} {surname}",
                                "female" if head_sex == "male" else "male", max(19, members[0][2] + rng.randint(-8, 4))))
            for _ in range(rng.choice([0, 1, 1, 2, 2, 3])):
                sx = rng.choice(["male", "female"])
                members.append((f"{rng.choice(FIRST_M if sx == 'male' else FIRST_F)} {surname}", sx, rng.randint(14, 40)))
            if rng.random() < 0.3:
                sx = rng.choice(["male", "female"])
                members.append((f"{rng.choice(FIRST_M if sx == 'male' else FIRST_F)} {surname}", sx, rng.randint(62, 84)))
            for name, sx, age in members:
                p = Person(household_id=hh.id, name=name, sex=sx, birth_year=year - age,
                           phone=f"9{rng.randint(100000000, 999999999)}" if rng.random() < 0.6 else None,
                           abha_number=f"91-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}" if rng.random() < 0.45 else None,
                           known_diabetes=age >= 40 and rng.random() < 0.05, known_hypertension=age >= 40 and rng.random() < 0.08,
                           pregnant=sx == "female" and 19 <= age <= 34 and rng.random() < 0.08)
                if p.known_hypertension:
                    p.medications = ["Amlodipine 5 mg"]
                if p.known_diabetes:
                    p.medications = [*(p.medications or []), "Metformin 500 mg"]
                db.add(p)
                persons_by_village[v.id].append((p, hh))
            v.population_30plus += sum(1 for _, _, a in members if a >= 30)
    db.flush()

    fac_infos = [from_model(f) for f in facs]
    n_screen = n_ref = 0
    for v_idx, v in enumerate(villages):
        asha = ashas[v_idx // 2]
        target = 0.78 - 0.07 * v.km_from_road
        for p, hh in persons_by_village[v.id]:
            age = year - p.birth_year
            if age < 30 or rng.random() > target:
                continue
            # Keep a few people in the demo ASHA's first village unscreened for the live demo.
            if asha.phone == "9000000001" and v_idx == 0 and rng.random() < 0.25:
                continue
            visits = [rng.uniform(0, 95)]
            if rng.random() < 0.3:
                visits.insert(0, rng.uniform(180, 320))
            for days_ago in visits:
                captured = t - timedelta(days=days_ago, hours=rng.uniform(0, 8))
                db.add(Consent(person_id=p.id, purpose="screening", method="spoken_tap", granted=True, recorded_by=asha.id,
                               recorded_at=captured, confirmed_at=captured + timedelta(hours=2), language="bn"))
                x, truth = make_input(rng, p, year)
                result = score(x)
                s = Screening(person_id=p.id, asha_id=asha.id, device_id=f"seed-{asha.id[:6]}", captured_at=captured, input=x,
                              result=result, client_result=result, engine_version=result["engine_version"],
                              client_engine_version=result["engine_version"], urgency=result["overall"]["urgency"],
                              priority=result["overall"]["priority"], created_at=captured)
                db.add(s)
                db.flush()
                n_screen += 1
                if not result["overall"]["refer"] or days_ago > 120:
                    continue
                n_ref += 1
                _seed_referral(db, rng, t, s, p, hh, asha, result, captured, fac_infos, by_kind, doctor, mo, truth)

    # Outbreak radar: background syndrome reports, plus one diarrhoea cluster in the last 3 days.
    for v in villages:
        asha = ashas[villages.index(v) // 2]
        for d in range(40):
            day = t.date() - timedelta(days=d)
            for syndrome, rate in (("fever", 0.8), ("acute_diarrhoea", 0.35), ("cough_cold", 1.0)):
                n = sum(1 for _ in range(4) if rng.random() < rate / 4)
                if n:
                    db.add(SyndromeEvent(village_id=v.id, syndrome=syndrome, day=day, count=n, reported_by=asha.id))
    cluster = villages[1]
    for d, n in ((2, 5), (1, 7), (0, 6)):
        db.add(SyndromeEvent(village_id=cluster.id, syndrome="acute_diarrhoea", day=t.date() - timedelta(days=d), count=n,
                             reported_by=ashas[0].id))
    db.add(Alert(kind="outbreak", level="critical", target_role="medical_officer", code="outbreak_ears_c2",
                 data={"village": cluster.name, "syndrome": "acute_diarrhoea"}))
    _seed_doctor_day(db, rng, t, by_kind["District eSanjeevani hub (synthetic)"], doctor)
    db.commit()
    print(f"Seeded {BLOCK}: {len(villages)} villages, {sum(len(x) for x in persons_by_village.values())} people, "
          f"{n_screen} screenings, {n_ref} referrals. Demo PIN for every account: 1234")


def _seed_referral(db, rng, t, s, p, hh, asha, result, created, fac_infos, by_kind, doctor, mo, truth) -> None:  # noqa: ANN001, PLR0913
    urgency = result["overall"]["urgency"]
    routing = route(fac_infos, hh.lat, hh.lon, result["overall"]["needs"] or ["ncd_clinic"], urgency, created + timedelta(hours=5, minutes=30))
    facility_id = routing["facility_id"] if routing else by_kind["Kadamtala PHC"].id
    r = Referral(person_id=p.id, screening_id=s.id, asha_id=asha.id, status="flagged", urgency=urgency,
                 priority=result["overall"]["priority"], lane=LANE[urgency], reasons=result["overall"]["reasons"],
                 needs=result["overall"]["needs"], facility_id=facility_id, mode=routing["mode"] if routing else "in_person",
                 routing=routing, created_at=created, updated_at=created, due_at=created + timedelta(hours=48))
    db.add(r)
    db.flush()
    db.add(ReferralEvent(referral_id=r.id, from_status=None, to_status="flagged", actor_id=asha.id, at=created))
    age_days = (t - created).total_seconds() / 86400

    def step(to: str, at: datetime, actor=None) -> None:  # noqa: ANN001
        db.add(ReferralEvent(referral_id=r.id, from_status=r.status, to_status=to, actor_id=actor.id if actor else None, at=at))
        r.status = to
        r.updated_at = at

    def clinic(at: datetime) -> datetime:
        """Same date, a 15-minute OPD slot between 09:00 and 15:45 IST, stored as UTC."""
        local = datetime(at.year, at.month, at.day, rng.randint(9, 15), rng.choice([0, 15, 30, 45]))
        return local - timedelta(hours=5, minutes=30)

    def appointment(at: datetime, status: str) -> None:
        mode = r.mode
        db.add(Appointment(referral_id=r.id, facility_id=r.facility_id, doctor_id=doctor.id if mode == "teleconsult" else None,
                           mode=mode, slot_start=at, slot_end=at + timedelta(minutes=15), status=status,
                           meeting_url=f"https://meet.jit.si/PranaMap-{r.id[:8]}#config.startWithVideoMuted=true" if mode == "teleconsult" else None))

    roll = rng.random()
    if age_days < 2:
        return
    ack = created + timedelta(hours=rng.uniform(2, 30))
    r.acknowledged_at = ack
    step("acknowledged", ack, mo)
    slot = clinic(ack + timedelta(days=rng.uniform(1, 9)))
    # Diabetes and BP follow-ups suit a teleconsult with the district hub doctor.
    if urgency == "soon" and rng.random() < 0.3:
        r.mode = "teleconsult"
        r.facility_id = by_kind["District eSanjeevani hub (synthetic)"].id
    if age_days < 14 and roll < 0.25:
        r.due_at = ack + timedelta(hours=72)  # waiting to be booked; may already be overdue
        return
    r.booked_at = ack + timedelta(hours=2)
    step("booked", r.booked_at, mo)
    if slot > t:
        appointment(slot, "booked")
        r.due_at = slot + timedelta(days=1)
        return
    if roll < 0.70 or age_days < 14 and roll < 0.85:
        appointment(slot, "attended")
        r.seen_at = slot
        # The doctor evaluates the flagged conditions; confirmation follows the person's true status.
        evaluated = [c for c in ("diabetes", "hypertension", "anaemia") if c in result["overall"]["reasons"]]
        confirmed = [c for c in evaluated if truth.get(c)]
        r.outcome = {"confirmed": bool(confirmed), "evaluated": evaluated, "confirmed_conditions": confirmed,
                     "plan": "started treatment" if confirmed else "lifestyle advice, review in 3 months"}
        step("seen", slot, doctor if r.mode == "teleconsult" else mo)
        if slot < t - timedelta(days=2):
            r.closed_at = slot + timedelta(hours=6)
            r.due_at = None
            step("closed", r.closed_at, mo)
        else:
            r.due_at = slot + timedelta(hours=72)
    elif roll < 0.80:
        r.due_at = None
        step("cancelled", slot, asha)
    else:
        appointment(slot, "missed")
        r.missed_count = 1
        step("missed", slot + timedelta(days=1))
        r.due_at = slot + timedelta(days=3)
        r.escalation_level = 1 if age_days < 20 else 2


def _seed_doctor_day(db, rng, t, hub, doctor) -> None:  # noqa: ANN001
    """Book a handful of waiting referrals as teleconsults over the next two days, so the
    doctor's queue is never empty in a demo."""
    db.flush()
    waiting = (
        db.query(Referral).filter(Referral.status.in_(("flagged", "acknowledged")), Referral.urgency == "soon")
        .order_by(Referral.priority.desc()).limit(6).all()
    )
    local_now = t + timedelta(hours=5, minutes=30)
    for i, r in enumerate(waiting):
        day = local_now.date() + timedelta(days=0 if local_now.hour < 13 and i < 3 else 1)
        start_local = datetime(day.year, day.month, day.day, 10 + i, 0 if i % 2 else 30)
        if start_local <= local_now:
            start_local += timedelta(days=1)
        start = start_local - timedelta(hours=5, minutes=30)
        r.status, r.mode, r.facility_id = "booked", "teleconsult", hub.id
        r.acknowledged_at = r.acknowledged_at or t - timedelta(hours=3)
        r.booked_at = t - timedelta(hours=2)
        r.due_at = start + timedelta(days=1)
        db.add(ReferralEvent(referral_id=r.id, from_status="acknowledged", to_status="booked", actor_id=doctor.id, at=r.booked_at))
        db.add(Appointment(referral_id=r.id, facility_id=hub.id, doctor_id=doctor.id, mode="teleconsult", slot_start=start,
                           slot_end=start + timedelta(minutes=15), status="booked",
                           meeting_url=f"https://meet.jit.si/PranaMap-{r.id[:8]}#config.startWithVideoMuted=true"))


if __name__ == "__main__":
    main()

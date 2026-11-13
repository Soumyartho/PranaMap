"""Write shared/fixtures/risk_cases.json: random screening inputs and the Python engine's output.

The frontend test suite replays every case through the TypeScript engine and requires
identical results, so the offline score on the phone always equals the server's audit score.

    python -m scripts.make_risk_fixtures
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from datetime import datetime, timedelta

from app.chatbot.engine import answer
from app.ml.engine import score
from app.services.routing import FacilityInfo, route

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
OUT = FIXTURES / "risk_cases.json"
SYMPTOMS = [
    "fatigue", "breathless_exertion", "pallor", "dizziness", "heavy_menstrual_bleeding",
    "excessive_thirst", "frequent_urination", "blurred_vision", "slow_healing_wounds", "tingling_numbness",
    "cough_2_weeks", "fever", "night_sweats", "weight_loss", "blood_in_sputum", "tb_contact",
    "chest_pain", "face_droop", "arm_weakness", "speech_difficulty", "severe_breathlessness",
    "severe_headache", "confusion", "unconscious", "seizure",
    "pregnancy_bleeding", "pregnancy_severe_headache", "pregnancy_swelling",
]


def maybe(rng: random.Random, p: float, value):
    return value if rng.random() < p else None


def random_case(rng: random.Random) -> dict:
    sex = rng.choice(["female", "male"])
    age = rng.randint(18, 85)
    readings = []
    for _ in range(rng.choice([0, 1, 2, 2])):
        s = rng.randint(95, 200)
        readings.append([s, rng.randint(55, min(125, s - 20))])
    x = {
        "age": age,
        "sex": sex,
        "pregnant": sex == "female" and age < 45 and rng.random() < 0.15,
        "tobacco": maybe(rng, 0.92, rng.choice(["never", "past_or_sometimes", "daily"])),
        "alcohol_daily": maybe(rng, 0.92, rng.random() < 0.2),
        "activity": maybe(rng, 0.9, rng.choice(["vigorous", "moderate", "mild", "sedentary"])),
        "fh_diabetes": maybe(rng, 0.9, rng.choice(["none", "none", "one_parent", "both_parents"])),
        "fh_heart_or_bp": maybe(rng, 0.9, rng.random() < 0.3),
        "waist_cm": maybe(rng, 0.8, rng.randint(62, 118) + rng.choice([0, 0.5])),
        "height_cm": maybe(rng, 0.6, rng.randint(140, 182)),
        "weight_kg": maybe(rng, 0.6, rng.randint(38, 98)),
        "bp_readings": readings,
        "glucose_mg_dl": maybe(rng, 0.45, rng.randint(55, 420)),
        "glucose_type": rng.choice(["random", "fasting"]),
        "hb_g_dl": maybe(rng, 0.35, round(rng.uniform(5.5, 16), 1)),
        "spo2": maybe(rng, 0.3, rng.randint(84, 100)),
        "known_diabetes": rng.random() < 0.08,
        "known_hypertension": rng.random() < 0.1,
        "symptoms": rng.sample(SYMPTOMS, k=rng.choice([0, 0, 0, 1, 1, 2, 3])),
    }
    return {k: v for k, v in x.items() if v is not None}


def main() -> None:
    rng = random.Random(20261007)
    cases = [random_case(rng) for _ in range(300)]
    payload = [{"input": c, "output": score(c)} for c in cases]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    urgencies = [p["output"]["overall"]["urgency"] for p in payload]
    print(f"wrote {len(payload)} cases to {OUT}: " + ", ".join(f"{u}={urgencies.count(u)}" for u in sorted(set(urgencies))))
    routing_cases(rng)
    chat_cases()


def routing_cases(rng: random.Random) -> None:
    caps = ["glucose_test", "bp_management", "hb_test", "sputum_test", "ecg", "ncd_clinic", "emergency"]
    verified = datetime(2026, 10, 1, 4, 0)
    out = []
    for i in range(120):
        facilities = []
        for j in range(rng.randint(2, 7)):
            facilities.append({
                "id": f"f{j}", "name": f"Facility {j}", "kind": rng.choice(["sub_centre", "phc", "phc", "chc"]),
                "lat": 23.2 + rng.uniform(-0.12, 0.12), "lon": 87.0 + rng.uniform(-0.12, 0.12),
                "capabilities": sorted(rng.sample(caps, k=rng.randint(1, 6))),
                "opens": rng.choice(["08:00", "09:00", "10:00"]), "closes": rng.choice(["13:00", "16:00", "17:00"]),
                "days": sorted(rng.sample(range(7), k=rng.randint(3, 7))), "open_24x7": rng.random() < 0.15,
                "staffed": rng.random() < 0.9, "last_verified_at": (verified - timedelta(days=rng.randint(0, 20))).isoformat(),
            })
        if rng.random() < 0.6:
            facilities.append({"id": "tele", "name": "Tele hub", "kind": "tele_hub", "lat": 23.5, "lon": 87.3,
                               "capabilities": ["teleconsult", "ncd_clinic"], "opens": "08:00", "closes": "20:00",
                               "days": list(range(7)), "open_24x7": False, "staffed": True, "last_verified_at": None})
        at = datetime(2026, 10, 5, 0, 0) + timedelta(minutes=rng.randint(0, 7 * 24 * 60))
        case = {
            "facilities": facilities, "lat": 23.2 + rng.uniform(-0.1, 0.1), "lon": 87.0 + rng.uniform(-0.1, 0.1),
            "needs": sorted(rng.sample(caps[:6], k=rng.randint(0, 3))) + (["same_day"] if rng.random() < 0.1 else []),
            "urgency": rng.choice(["emergency", "urgent", "soon", "soon", "routine"]), "at_local": at.isoformat(),
            "max_travel_minutes": rng.choice([20, 40, 60]),
        }
        infos = [FacilityInfo(**{**f, "last_verified_at": datetime.fromisoformat(f["last_verified_at"]) if f["last_verified_at"] else None})
                 for f in facilities]
        case["output"] = route(infos, case["lat"], case["lon"], case["needs"], case["urgency"], at, case["max_travel_minutes"])
        out.append(case)
    (FIXTURES / "routing_cases.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"wrote {len(out)} routing cases ({sum(1 for c in out if c['output'] is None)} with no route)")


CHAT_MESSAGES = [
    ("my father has chest pain", "en"), ("how do I test for sugar fasting", "en"), ("what is the weather", "en"),
    ("how much exercise do I need", "en"), ("can my family see my data", "en"), ("how to quit bidi", "en"),
    ("can I stop tb medicine", "en"), ("what should I eat with high sugar", "en"), ("is black stool normal with iron tablet", "en"),
    ("खून की कमी कैसे दूर करें", "hi"), ("बीपी की दवा बंद कर सकते हैं", "hi"), ("सीने में दर्द हो रहा है", "hi"),
    ("दो हफ्ते से खांसी है", "hi"), ("गुटखा कैसे छोड़ें", "hi"), ("ई-संजीवनी से डॉक्टर से बात", "hi"),
    ("খুব তেষ্টা আর বারবার প্রস্রাব", "bn"), ("কাশি দুই সপ্তাহ ধরে", "bn"), ("বাবার বুকে ব্যথা হচ্ছে", "bn"),
    ("বিপি কমাতে লবণ", "bn"), ("গর্ভবতী মায়ের পা ফোলা", "bn"), ("আজ কী রান্না হবে", "bn"),
]


def chat_cases() -> None:
    out = [{"message": m, "lang": lang, "output": answer(m, lang)} for m, lang in CHAT_MESSAGES]
    (FIXTURES / "chat_cases.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(out)} chat cases: " + ", ".join(sorted({c["output"].get("id") or c["output"]["kind"] for c in out})))


if __name__ == "__main__":
    main()

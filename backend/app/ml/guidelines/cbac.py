"""Community Based Assessment Checklist (NP-NCD), Part A risk score.

Age 30-39:0, 40-49:1, 50-59:2, 60+:3 · Tobacco never:0, sometimes/past:1, daily:2 ·
Daily alcohol:1 · Waist F <=80:0, 81-90:1, >90:2; M <=90:0, 91-100:1, >100:2 ·
<150 min activity a week:1 · Family history of BP, diabetes or heart disease:2.
Total 0-10; a score above 4 means "at risk, refer to the NCD clinic".
"""

from __future__ import annotations

from .common import driver

TOBACCO_POINTS = {"never": 0, "past_or_sometimes": 1, "daily": 2}


def waist_points_cbac(sex: str, waist: float) -> int:
    if sex == "female":
        return 0 if waist <= 80 else 1 if waist <= 90 else 2
    return 0 if waist <= 90 else 1 if waist <= 100 else 2


def score_cbac(x: dict) -> dict:
    items: list[dict] = []
    missing: list[str] = []
    age = x["age"]
    items.append(driver("age", 0 if age < 40 else 1 if age < 50 else 2 if age < 60 else 3, age))

    tobacco = x.get("tobacco")
    if tobacco is None:
        missing.append("tobacco")
    else:
        items.append(driver("tobacco", TOBACCO_POINTS[tobacco], tobacco))

    if x.get("alcohol_daily") is None:
        missing.append("alcohol_daily")
    else:
        items.append(driver("alcohol_daily", 1 if x["alcohol_daily"] else 0))

    waist = x.get("waist_cm")
    if waist is None:
        missing.append("waist_cm")
    else:
        items.append(driver("waist", waist_points_cbac(x["sex"], waist), waist))

    activity = x.get("activity")
    if activity is None:
        missing.append("activity")
    else:
        items.append(driver("inactive", 0 if activity in ("vigorous", "moderate") else 1, activity))

    fh_dm, fh_cv = x.get("fh_diabetes"), x.get("fh_heart_or_bp")
    if fh_dm is None and fh_cv is None:
        missing.append("family_history")
    else:
        items.append(driver("family_history", 2 if (fh_dm not in (None, "none") or fh_cv) else 0))

    total = sum(i["points"] for i in items)
    return {"score": total, "max": 10, "refer": total > 4, "items": items, "missing": missing}

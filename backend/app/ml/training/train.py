"""Train, evaluate and export the PranaMap NCD risk model.

    python -m app.ml.training.train            # writes shared/models/ncd_risk.json + docs/models/ncd_risk.md

Glass-box by design: one logistic regression per target on standardised features, so every
prediction decomposes into per-feature contributions a doctor can read. The export is plain
JSON (coefficients, scaling, imputation, threshold, metrics); the server and the phone both run
it with a few lines of arithmetic, so the phone needs no ML runtime at all.

Evaluation reports what a reviewer should ask for: discrimination (AUC), calibration (Brier,
calibration-in-the-large and slope), the guideline baseline at the SAME referral workload, and
the same metrics broken down by sex and age band (fairness).
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score

from app.core.config import REPO_DIR
from app.ml.engine import score as guideline_score
from app.ml.features import FEATURES, raw_features
from app.ml.training.cohort import COHORT_VERSION, CohortConfig, generate

MODEL_VERSION = "1.0.0-synthetic"
TARGETS = {"diabetes": "known_diabetes", "hypertension": "known_hypertension"}
# Neutral fill-ins where "average" would mislead (a glucose not tested is not an average glucose).
FIXED_IMPUTE = {"glucose_random": 110.0, "glucose_fasting": 90.0}
ARTIFACT = REPO_DIR / "shared" / "models" / "ncd_risk.json"
CARD = REPO_DIR / "docs" / "models" / "ncd_risk.md"


def _matrix(people: list[dict], impute: dict[str, float]) -> np.ndarray:
    rows = []
    for p in people:
        raw = raw_features(p["input"])
        rows.append([impute[f] if raw[f] is None else raw[f] for f in FEATURES])
    return np.asarray(rows, dtype=float)


def _calibration(y: np.ndarray, p: np.ndarray) -> dict:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    logit = np.log(p / (1 - p)).reshape(-1, 1)
    fit = LogisticRegression(C=1e6, max_iter=1000).fit(logit, y)
    return {
        "brier": round(float(brier_score_loss(y, p)), 4),
        "in_the_large": round(float(y.mean() - p.mean()), 4),
        "slope": round(float(fit.coef_[0][0]), 3),
    }


def _operating(y: np.ndarray, flag: np.ndarray) -> dict:
    tp = float((flag & (y == 1)).sum())
    fp = float((flag & (y == 0)).sum())
    fn = float((~flag & (y == 1)).sum())
    tn = float((~flag & (y == 0)).sum())
    return {
        "referral_rate": round((tp + fp) / len(y), 4),
        "sensitivity": round(tp / (tp + fn), 4) if tp + fn else None,
        "specificity": round(tn / (tn + fp), 4) if tn + fp else None,
        "ppv": round(tp / (tp + fp), 4) if tp + fp else None,
    }


def _groups(people: list[dict]) -> dict[str, np.ndarray]:
    age = np.array([p["input"]["age"] for p in people])
    sex = np.array([p["input"]["sex"] for p in people])
    return {
        "female": sex == "female",
        "male": sex == "male",
        "age_30_44": age < 45,
        "age_45_59": (age >= 45) & (age < 60),
        "age_60_plus": age >= 60,
    }


def train(cfg: CohortConfig = CohortConfig()) -> dict:
    people = generate(cfg)
    rng = np.random.default_rng(cfg.seed + 1)
    split = rng.random(len(people))
    train_set = [p for p, s in zip(people, split) if s < 0.70]
    valid_set = [p for p, s in zip(people, split) if 0.70 <= s < 0.85]
    test_set = [p for p, s in zip(people, split) if s >= 0.85]

    # Imputation and scaling are learned on the training split only.
    impute: dict[str, float] = {}
    for f in FEATURES:
        vals = [raw_features(p["input"])[f] for p in train_set]
        present = [v for v in vals if v is not None]
        impute[f] = FIXED_IMPUTE.get(f, float(np.mean(present)) if present else 0.0)
    Xtr = _matrix(train_set, impute)
    mean, sd = Xtr.mean(axis=0), Xtr.std(axis=0)
    sd[sd == 0] = 1.0
    scale = {f: [round(float(m), 6), round(float(s), 6)] for f, m, s in zip(FEATURES, mean, sd)}

    def z(X: np.ndarray) -> np.ndarray:
        return (X - mean) / sd

    targets: dict[str, dict] = {}
    for target, exclude in TARGETS.items():
        pick = lambda rows: [p for p in rows if not p["input"].get(exclude)]  # noqa: E731
        tr, va, te = pick(train_set), pick(valid_set), pick(test_set)
        ytr = np.array([p["truth"][target] for p in tr], dtype=int)
        yva = np.array([p["truth"][target] for p in va], dtype=int)
        yte = np.array([p["truth"][target] for p in te], dtype=int)
        model = LogisticRegression(C=1.0, max_iter=5000).fit(z(_matrix(tr, impute)), ytr)
        pva = model.predict_proba(z(_matrix(va, impute)))[:, 1]
        pte = model.predict_proba(z(_matrix(te, impute)))[:, 1]

        # Baseline: the guideline engine's "high" band for this condition.
        gva = np.array([guideline_score(p["input"])["conditions"][target]["band"] == "high" for p in va])
        gte = np.array([guideline_score(p["input"])["conditions"][target]["band"] == "high" for p in te])
        # Operating point: refer the same share of people as the guideline does (equal workload).
        threshold = float(np.quantile(pva, 1 - gva.mean()))

        groups = _groups(te)
        fairness = {}
        for name, mask in groups.items():
            if mask.sum() < 50 or len(set(yte[mask])) < 2:
                continue
            fairness[name] = {
                "n": int(mask.sum()),
                "prevalence": round(float(yte[mask].mean()), 4),
                "auc": round(float(roc_auc_score(yte[mask], pte[mask])), 4),
                **_calibration(yte[mask], pte[mask]),
                "sensitivity_at_threshold": _operating(yte[mask], pte[mask] >= threshold)["sensitivity"],
            }

        targets[target] = {
            "excludes": exclude,
            "intercept": round(float(model.intercept_[0]), 6),
            "coef": {f: round(float(c), 6) for f, c in zip(FEATURES, model.coef_[0])},
            "threshold": round(threshold, 4),
            "metrics": {
                "n_train": len(tr), "n_test": len(te), "prevalence_test": round(float(yte.mean()), 4),
                "auc": round(float(roc_auc_score(yte, pte)), 4),
                **_calibration(yte, pte),
                "model_at_threshold": _operating(yte, pte >= threshold),
                "guideline_baseline": _operating(yte, gte),
            },
            "fairness": fairness,
        }

    artifact = {
        "name": "pranamap-ncd-risk",
        "version": MODEL_VERSION,
        "created": dt.date.today().isoformat(),
        "kind": "logistic_regression_standardised",
        "trained_on": {"source": COHORT_VERSION, "config": cfg.__dict__, "real_data": False},
        # Governance: an unvalidated model may only run in shadow mode, whatever the config says.
        "validated": False,
        "deployment_mode": "shadow",
        "intended_use": "Estimate the probability that a screened adult (30+) without a known diagnosis has "
                        "diabetes or hypertension, to rank follow-up. Decision support for trained health workers; "
                        "never a diagnosis; never applied to children.",
        "features": FEATURES,
        "impute": {f: round(v, 6) for f, v in impute.items()},
        "scale": scale,
        "targets": targets,
    }
    return artifact


def model_card(a: dict) -> str:
    lines = [
        f"# Model card: {a['name']} {a['version']}",
        "",
        f"Created {a['created']}. Kind: {a['kind']}. **Validated: {a['validated']}. Deployment: {a['deployment_mode']}.**",
        "",
        "## Intended use",
        a["intended_use"],
        "",
        "## Training data",
        f"Synthetic cohort `{a['trained_on']['source']}` ({a['trained_on']['config']['n']:,} adults 30+), generated from "
        "literature-based prevalence and effect sizes (see `backend/app/ml/training/cohort.py`). **No real patient data.** "
        "Because the model learns the generator's assumptions, these metrics show the pipeline works; they are not "
        "evidence of clinical performance. Retrain on NFHS-5, LASI or pilot data with confirmed diagnoses before any "
        "use beyond shadow mode.",
        "",
        "## Why shadow mode",
        "The model scores every screening alongside the guideline engine and the result is stored and monitored "
        "(agreement with the guideline, realised calibration against confirmed visit outcomes, drift). It does not "
        "change any band, referral, routing or message. Promotion to `assist` requires `validated: true`, which only "
        "a prospective validation on real outcomes can set.",
        "",
        "## Performance (synthetic test split)",
        "",
        "| Target | AUC | Brier | Calibration slope | Sensitivity (model) | Sensitivity (guideline) | Referral rate |",
        "|---|---|---|---|---|---|---|",
    ]
    for t, m in a["targets"].items():
        mm = m["metrics"]
        lines.append(
            f"| {t} | {mm['auc']} | {mm['brier']} | {mm['slope']} | {mm['model_at_threshold']['sensitivity']} | "
            f"{mm['guideline_baseline']['sensitivity']} | {mm['guideline_baseline']['referral_rate']} |"
        )
    lines += ["", "Both are compared at the same referral rate: the model's threshold is set so it refers as many "
              "people as the guideline does, and the question is which of them are truly ill.", "", "## Fairness"]
    for t, m in a["targets"].items():
        lines += ["", f"**{t}**", "", "| Group | n | Prevalence | AUC | Calibration-in-the-large | Sensitivity |", "|---|---|---|---|---|---|"]
        for g, f in m["fairness"].items():
            lines.append(f"| {g} | {f['n']} | {f['prevalence']} | {f['auc']} | {f['in_the_large']} | {f['sensitivity_at_threshold']} |")
    flags = []
    for t, m in a["targets"].items():
        overall = m["metrics"]["model_at_threshold"]["sensitivity"] or 0
        for g, f in m["fairness"].items():
            if f["sensitivity_at_threshold"] is not None and f["sensitivity_at_threshold"] < overall - 0.10:
                flags.append(f"- **{t}, {g}**: sensitivity {f['sensitivity_at_threshold']} against {overall} overall. "
                             "A single threshold under-serves this group; consider group-aware thresholds or more "
                             "features before validation.")
    lines += ["", "### Findings to resolve before validation", ""] + (flags or ["- None: no group more than 10 points below overall sensitivity."])
    lines += [
        "",
        "Caste, religion and income are never inputs.",
        "",
        "## Features",
        ", ".join(f"`{f}`" for f in a["features"]),
        "",
        "Missing values are imputed (training mean; glucose at a normal reference value) and flagged with an "
        "indicator feature, so an unmeasured value is never silently treated as normal.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    a = train()
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    CARD.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.write_text(json.dumps(a, indent=1), encoding="utf-8")
    CARD.write_text(model_card(a), encoding="utf-8")
    for t, m in a["targets"].items():
        mm = m["metrics"]
        print(f"{t}: AUC {mm['auc']}, slope {mm['slope']}, model sens {mm['model_at_threshold']['sensitivity']} vs "
              f"guideline {mm['guideline_baseline']['sensitivity']} at referral rate {mm['guideline_baseline']['referral_rate']}")
    print(f"wrote {ARTIFACT} and {CARD}")


if __name__ == "__main__":
    main()

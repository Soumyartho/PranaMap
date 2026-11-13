# Model card: pranamap-ncd-risk 1.0.0-synthetic

Created 2026-11-12. Kind: logistic_regression_standardised. **Validated: False. Deployment: shadow.**

## Intended use
Estimate the probability that a screened adult (30+) without a known diagnosis has diabetes or hypertension, to rank follow-up. Decision support for trained health workers; never a diagnosis; never applied to children.

## Training data
Synthetic cohort `synthetic-cohort-1.0` (40,000 adults 30+), generated from literature-based prevalence and effect sizes (see `backend/app/ml/training/cohort.py`). **No real patient data.** Because the model learns the generator's assumptions, these metrics show the pipeline works; they are not evidence of clinical performance. Retrain on NFHS-5, LASI or pilot data with confirmed diagnoses before any use beyond shadow mode.

## Why shadow mode
The model scores every screening alongside the guideline engine and the result is stored and monitored (agreement with the guideline, realised calibration against confirmed visit outcomes, drift). It does not change any band, referral, routing or message. Promotion to `assist` requires `validated: true`, which only a prospective validation on real outcomes can set.

## Performance (synthetic test split)

| Target | AUC | Brier | Calibration slope | Sensitivity (model) | Sensitivity (guideline) | Referral rate |
|---|---|---|---|---|---|---|
| diabetes | 0.933 | 0.0283 | 0.971 | 0.8938 | 0.8031 | 0.2978 |
| hypertension | 0.9566 | 0.0672 | 1.012 | 0.9555 | 0.9367 | 0.4579 |

Both are compared at the same referral rate: the model's threshold is set so it refers as many people as the guideline does, and the question is which of them are truly ill.

## Fairness

**diabetes**

| Group | n | Prevalence | AUC | Calibration-in-the-large | Sensitivity |
|---|---|---|---|---|---|
| female | 2758 | 0.0812 | 0.929 | 0.0072 | 0.8839 |
| male | 2854 | 0.0568 | 0.9385 | -0.0033 | 0.9074 |
| age_30_44 | 2296 | 0.0357 | 0.9151 | 0.0041 | 0.7073 |
| age_45_59 | 2160 | 0.0616 | 0.9217 | 0.0018 | 0.8797 |
| age_60_plus | 1156 | 0.1479 | 0.9214 | -0.0023 | 0.9942 |

**hypertension**

| Group | n | Prevalence | AUC | Calibration-in-the-large | Sensitivity |
|---|---|---|---|---|---|
| female | 2646 | 0.2789 | 0.9574 | -0.0027 | 0.9593 |
| male | 2728 | 0.2735 | 0.9559 | 0.0043 | 0.9517 |
| age_30_44 | 2231 | 0.1466 | 0.9651 | -0.0011 | 0.9419 |
| age_45_59 | 2067 | 0.2729 | 0.9483 | 0.0012 | 0.945 |
| age_60_plus | 1076 | 0.5511 | 0.9204 | 0.0042 | 0.973 |

### Findings to resolve before validation

- **diabetes, age_30_44**: sensitivity 0.7073 against 0.8938 overall. A single threshold under-serves this group; consider group-aware thresholds or more features before validation.

Caste, religion and income are never inputs.

## Features
`age`, `male`, `bmi`, `bmi_missing`, `waist`, `waist_missing`, `inactivity`, `fh_diabetes`, `fh_heart_or_bp`, `tobacco_daily`, `tobacco_any`, `alcohol_daily`, `sbp`, `dbp`, `bp_missing`, `two_readings`, `glucose_random`, `glucose_fasting`, `glucose_missing`, `diabetes_symptoms`

Missing values are imputed (training mean; glucose at a normal reference value) and flagged with an indicator feature, so an unmeasured value is never silently treated as normal.

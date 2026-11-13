/**
 * WHO 2019 cardiovascular risk model, non-laboratory version. Port of
 * backend/app/ml/guidelines/who_cvd.py; both read shared/who_cvd_2019.json and both are
 * tested against WHO's reference Stata outputs.
 */
import params from "../../../../shared/who_cvd_2019.json";

type Sex = "male" | "female";
interface Coef {
  age: number;
  bmi: number;
  sbp: number;
  smoking: number;
  bmi_age: number;
  sbp_age: number;
  smoking_age: number;
  baseline_survival: number;
}
export interface Calibration {
  chd_cons: number;
  chd_slope: number;
  stroke_cons: number;
  stroke_slope: number;
}

const P = params as unknown as {
  centering: { age: number; sbp: number; bmi: number };
  valid_age: [number, number];
  default_calibration: string;
  coefficients: Record<"chd" | "stroke", Record<Sex, Coef>>;
  calibration: Record<string, Record<Sex, Calibration>>;
};

export const WHO_CVD = P;

function uncalibrated(c: Coef, ageC: number, sbpC: number, bmiC: number, smoking: boolean): number {
  const smk = smoking ? 1 : 0;
  const lp =
    c.age * ageC +
    c.bmi * bmiC +
    c.sbp * sbpC +
    c.smoking * smk +
    c.bmi_age * bmiC * ageC +
    c.sbp_age * sbpC * ageC +
    c.smoking_age * smk * ageC;
  return 1 - c.baseline_survival ** Math.exp(lp);
}

const recalibrate = (risk: number, cons: number, slope: number) =>
  1 - Math.exp(-Math.exp(cons + slope * Math.log(-Math.log(1 - risk))));

export function tenYearRisk(age: number, sex: Sex, sbp: number, bmi: number, smoking: boolean, cal: Calibration): number {
  const { centering: cen, coefficients } = P;
  const a = age - cen.age;
  const s = sbp - cen.sbp;
  const b = bmi - cen.bmi;
  const chd = recalibrate(uncalibrated(coefficients.chd[sex], a, s, b, smoking), cal.chd_cons, cal.chd_slope);
  const stroke = recalibrate(uncalibrated(coefficients.stroke[sex], a, s, b, smoking), cal.stroke_cons, cal.stroke_slope);
  return 1 - (1 - chd) * (1 - stroke);
}

export const riskFor = (age: number, sex: Sex, sbp: number, bmi: number, smoking: boolean, region?: string) =>
  tenYearRisk(age, sex, sbp, bmi, smoking, P.calibration[region ?? P.default_calibration][sex]);

export function termContributions(age: number, sex: Sex, sbp: number, bmi: number, smoking: boolean) {
  const c = P.coefficients.chd[sex];
  const a = age - P.centering.age;
  const s = sbp - P.centering.sbp;
  const b = bmi - P.centering.bmi;
  const smk = smoking ? 1 : 0;
  return {
    age: c.age * a,
    sbp: c.sbp * s + c.sbp_age * s * a,
    bmi: c.bmi * b + c.bmi_age * b * a,
    smoking: c.smoking * smk + c.smoking_age * smk * a,
  };
}

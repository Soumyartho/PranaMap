/**
 * The NCD risk model on the phone. Same features, same arithmetic as backend/app/ml/features.py
 * and model.py, pinned by shared/fixtures/risk_cases.json. Unvalidated models run in shadow mode.
 */
import artifact from "../../../../shared/models/ncd_risk.json";
import type { Driver, ScreeningInput } from "@/models/types/risk";

const ACTIVITY: Record<string, number> = { vigorous: 0, moderate: 1, mild: 2, sedentary: 3 };
const FH_DM: Record<string, number> = { none: 0, one_parent: 1, both_parents: 2 };
const DIABETES_SYMPTOMS = ["excessive_thirst", "frequent_urination", "slow_healing_wounds", "blurred_vision", "tingling_numbness"];
const HIDDEN_DRIVERS = new Set(["bmi_missing", "waist_missing", "bp_missing", "glucose_missing", "two_readings"]);

interface Target {
  excludes: keyof ScreeningInput;
  intercept: number;
  coef: Record<string, number>;
  threshold: number;
}
interface Artifact {
  name: string;
  version: string;
  validated: boolean;
  deployment_mode: "shadow" | "assist";
  features: string[];
  impute: Record<string, number>;
  scale: Record<string, [number, number]>;
  targets: Record<string, Target>;
}
const A = artifact as unknown as Artifact;

export interface ModelOutput {
  probability: number;
  flag: boolean;
  drivers: Driver[];
}
export interface ModelResult {
  name: string;
  version: string;
  validated: boolean;
  mode: "shadow" | "assist";
  outputs: Record<string, ModelOutput | null>;
}

type BpSummary = (x: ScreeningInput & { symptoms: string[] }) => [number | null, number | null, number | null, number | null];

function rawFeatures(x: ScreeningInput & { symptoms: string[] }, bpSummary: BpSummary, bmi: (x: ScreeningInput) => number | null) {
  const [sbp, dbp] = bpSummary(x);
  const b = bmi(x);
  const g = x.glucose_mg_dl;
  const fasting = x.glucose_type === "fasting";
  const readings = (x.bp_readings ?? []).filter((r) => r && r[0] && r[1]);
  const has = (v: unknown) => v !== undefined && v !== null;
  const r: Record<string, number | null> = {
    age: x.age,
    male: x.sex === "male" ? 1 : 0,
    bmi: b,
    bmi_missing: b === null ? 1 : 0,
    waist: has(x.waist_cm) ? (x.waist_cm as number) : null,
    waist_missing: has(x.waist_cm) ? 0 : 1,
    inactivity: x.activity !== undefined && x.activity in ACTIVITY ? ACTIVITY[x.activity] : null,
    fh_diabetes: x.fh_diabetes !== undefined && x.fh_diabetes in FH_DM ? FH_DM[x.fh_diabetes] : null,
    fh_heart_or_bp: x.fh_heart_or_bp ? 1 : 0,
    tobacco_daily: x.tobacco === "daily" ? 1 : 0,
    tobacco_any: x.tobacco === "daily" || x.tobacco === "past_or_sometimes" ? 1 : 0,
    alcohol_daily: x.alcohol_daily ? 1 : 0,
    sbp,
    dbp,
    bp_missing: sbp === null ? 1 : 0,
    two_readings: readings.length >= 2 ? 1 : 0,
    glucose_random: has(g) && !fasting ? (g as number) : null,
    glucose_fasting: has(g) && fasting ? (g as number) : null,
    glucose_missing: has(g) ? 0 : 1,
    diabetes_symptoms: DIABETES_SYMPTOMS.filter((s) => x.symptoms.includes(s)).length,
  };
  return r;
}

export function predict(x: ScreeningInput & { symptoms: string[] }, bpSummary: BpSummary, bmi: (x: ScreeningInput) => number | null): ModelResult {
  const raw = rawFeatures(x, bpSummary, bmi);
  const z: Record<string, number> = {};
  for (const f of A.features) {
    const v = raw[f] ?? A.impute[f];
    const [mean, sd] = A.scale[f];
    z[f] = (v - mean) / sd;
  }
  const outputs: Record<string, ModelOutput | null> = {};
  for (const [target, m] of Object.entries(A.targets)) {
    if (x[m.excludes]) {
      outputs[target] = null;
      continue;
    }
    let lp = m.intercept;
    const contributions: [string, number][] = [];
    for (const f of A.features) {
      const c = m.coef[f] * z[f];
      lp += c;
      contributions.push([f, c]);
    }
    const p = 1 / (1 + Math.exp(-lp));
    const ranked = contributions.filter(([f]) => !HIDDEN_DRIVERS.has(f)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const drivers: Driver[] = [];
    for (const [f, c] of ranked.slice(0, 3)) {
      const points = Math.floor(c * 10 + 0.5) / 10;
      if (points !== 0) drivers.push({ code: `ml_${f}`, points, direction: points > 0 ? "up" : "down" });
    }
    outputs[target] = { probability: Math.floor(p * 10000 + 0.5) / 10000, flag: p >= m.threshold, drivers };
  }
  return {
    name: A.name,
    version: A.version,
    validated: A.validated,
    mode: A.validated ? A.deployment_mode : "shadow",
    outputs,
  };
}

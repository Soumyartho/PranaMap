/** Screening input and risk output. Mirrors backend/app/ml (snake_case on purpose: same JSON). */

export type Sex = "female" | "male";
export type Band = "low" | "moderate" | "high";
export type Urgency = "emergency" | "urgent" | "soon" | "routine";
export type Tobacco = "never" | "past_or_sometimes" | "daily";
export type Activity = "vigorous" | "moderate" | "mild" | "sedentary";
export type FamilyDiabetes = "none" | "one_parent" | "both_parents";
export type Confidence = "high" | "medium" | "low";
export type ConditionKey = "diabetes" | "hypertension" | "cvd" | "anaemia" | "tb";

export interface ScreeningInput {
  age: number;
  sex: Sex;
  pregnant?: boolean;
  tobacco?: Tobacco;
  alcohol_daily?: boolean;
  activity?: Activity;
  fh_diabetes?: FamilyDiabetes;
  fh_heart_or_bp?: boolean;
  waist_cm?: number;
  height_cm?: number;
  weight_kg?: number;
  bp_readings?: [number, number][];
  glucose_mg_dl?: number;
  glucose_type?: "random" | "fasting";
  hb_g_dl?: number;
  spo2?: number;
  known_diabetes?: boolean;
  known_hypertension?: boolean;
  symptoms?: string[];
}

export interface Driver {
  code: string;
  points: number;
  direction: "up" | "down";
  value?: string | number;
}

export interface ConditionResult {
  band: Band;
  score: number;
  drivers: Driver[];
  action: string;
  confidence: Confidence;
  sharpen: string[];
  instrument: string;
  [extra: string]: unknown;
}

export interface RedFlag {
  code: string;
  level: "emergency" | "urgent";
  action: "call_108" | "same_day_phc";
}

export interface CbacResult {
  score: number;
  max: number;
  refer: boolean;
  items: Driver[];
  missing: string[];
}

export interface RiskResult {
  engine_version: string;
  eligible: boolean;
  red_flags: RedFlag[];
  emergency: boolean;
  cbac: CbacResult | null;
  conditions: Partial<Record<ConditionKey, ConditionResult>>;
  overall: {
    urgency: Urgency;
    priority: number;
    refer: boolean;
    needs: string[];
    reasons: string[];
  };
  missing: string[];
  model: import("@/services/risk/model").ModelResult | null;
}

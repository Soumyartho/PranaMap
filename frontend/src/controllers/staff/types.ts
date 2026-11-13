import type { Driver, RedFlag, Urgency } from "@/models/types/risk";
import type { Referral } from "@/models/types/domain";
import type { RouteResult } from "@/services/routing";

export interface Summary {
  as_of: string;
  population_30plus: number;
  screened_quarter: number;
  coverage: number;
  high_risk: number;
  emergencies_quarter: number;
  open_referrals: number;
  overdue: number;
  loop_closure: { rate: number | null; closed: number; eligible: number; window_days: number };
  median_days_to_visit: number | null;
  by_status: Record<string, number>;
  by_condition: Record<string, number>;
  weeks: { week_start: string; screenings: number; flagged: number; visits: number }[];
}

export interface StaffReferral extends Referral {
  person: { name: string | null; age: number; sex: string; village: string };
  lane: "urgent" | "this_week" | "monitor";
  overdue: boolean;
}

export interface StaffAlert {
  id: string;
  kind: string;
  level: "info" | "warning" | "critical";
  code: string;
  referral_id: string | null;
  person: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface CoverageRow {
  village_id: string;
  name: string;
  eligible: number;
  screened: number;
  coverage: number;
  high_risk: number;
  open_referrals: number;
  km_from_road: number;
  older_women_coverage: number | null;
  blind_spot: boolean;
}

export interface OutbreakData {
  method: string;
  alerts: { village: string; syndrome: string; day: string; observed: number; expected: number; threshold: number }[];
  series: { village: string; syndrome: string; daily: { day: string; count: number }[] }[];
}

export interface Vitals {
  date: string;
  bp_readings: [number, number][];
  sbp: number | null;
  dbp: number | null;
  glucose_mg_dl?: number;
  glucose_type?: string;
  hb_g_dl?: number;
  spo2?: number;
  waist_cm?: number;
  bmi: number | null;
  priority: number;
  urgency: Urgency;
}

export interface Packet {
  referral: {
    id: string; status: string; urgency: Urgency; priority: number; lane: string; reasons: string[]; mode: string;
    facility: string | null; routing: RouteResult | null; created_at: string; escalation_level: number;
  };
  patient: {
    id: string; name: string | null; age: number; sex: string; pregnant: boolean; village: string; phone: string | null; abha: string | null;
    known_diabetes: boolean; known_hypertension: boolean; medications: string[];
  };
  asha: { name: string; phone: string } | null;
  latest: Vitals;
  trend: Vitals[];
  red_flags: RedFlag[];
  symptoms: string[];
  risk: Record<string, { band: "low" | "moderate" | "high"; score: number; drivers: Driver[]; action: string; confidence: string; instrument: string }>;
  questions: string[];
  voice_notes: { id: string; mime: string; duration_ms: number; created_at: string }[];
  engine_version: string;
}

export interface QueueItem {
  appointment_id: string;
  slot_start: string;
  mode: "in_person" | "teleconsult";
  meeting_url: string | null;
  status: string;
  facility: string | null;
  referral: { id: string; status: string; urgency: Urgency; priority: number; reasons: string[] };
  person: { name: string; age: number; sex: string };
}

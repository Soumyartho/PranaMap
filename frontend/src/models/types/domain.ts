import type { RiskResult, ScreeningInput, Urgency } from "./risk";
import type { RouteResult } from "@/services/routing";

export type Role = "asha" | "anm" | "doctor" | "medical_officer" | "district_officer";

export interface User {
  id: string;
  name: string;
  phone: string;
  role: Role;
  block: string;
  facility_id: string | null;
  village_ids: string[];
  language: string;
}

export interface Village {
  id: string;
  name: string;
  lat: number;
  lon: number;
  population_30plus: number;
}

export interface Household {
  id: string;
  village_id: string;
  head_name: string;
  number: string;
  lat: number;
  lon: number;
  updated_at?: string;
}

export interface Person {
  id: string;
  household_id: string;
  name: string;
  sex: "female" | "male";
  birth_year: number;
  phone: string | null;
  abha_number: string | null;
  known_diabetes: boolean;
  known_hypertension: boolean;
  pregnant: boolean;
  medications: string[];
  updated_at?: string;
}

export interface ScreeningRecord {
  id: string;
  person_id: string;
  captured_at: string;
  urgency: Urgency;
  priority: number;
  result: RiskResult;
  input?: ScreeningInput;
  /** True until the server has accepted it. */
  pending?: boolean;
  routing?: RouteResult | null;
}

export type ReferralStatus = "flagged" | "acknowledged" | "booked" | "missed" | "seen" | "closed" | "cancelled";

export interface Referral {
  id: string;
  person_id: string;
  status: ReferralStatus;
  urgency: Urgency;
  priority: number;
  reasons: string[];
  facility_id: string | null;
  facility_name: string | null;
  mode: "in_person" | "teleconsult";
  routing: RouteResult | null;
  escalation_level: number;
  due_at: string | null;
  created_at: string | null;
  acknowledged_at: string | null;
  booked_at: string | null;
  seen_at: string | null;
  closed_at: string | null;
  outcome: Record<string, unknown> | null;
  appointment: { slot_start: string | null; mode: string; meeting_url: string | null; status: string } | null;
  updated_at: string | null;
}

export interface Alert {
  id: string;
  kind: string;
  level: "info" | "warning" | "critical";
  code: string;
  referral_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  person?: string | null;
}

export type OutboxType =
  | "household.upsert"
  | "person.upsert"
  | "consent.record"
  | "screening.create"
  | "referral.note"
  | "referral.voice_note"
  | "syndrome.report"
  | "facility.verify";

export interface OutboxEvent {
  id: string;
  type: OutboxType;
  created_at: string;
  payload: Record<string, unknown>;
}

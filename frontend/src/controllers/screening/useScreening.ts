/**
 * One screening, one question per screen. The engine re-scores on every answer (milliseconds),
 * so the Prana Ring moves as the ASHA works, and the red-flag check fires the moment a danger
 * sign or crisis reading is entered: it never waits for the end, or for the network.
 */
import { useCallback, useMemo, useState } from "react";
import { score } from "@/services/risk/engine";
import { route, localNow, type RouteResult } from "@/services/routing";
import type { RiskResult, ScreeningInput } from "@/models/types/risk";
import type { Household, Person, Referral, ScreeningRecord } from "@/models/types/domain";
import { ageOf, data, enqueue, putReferral, putScreening } from "@/controllers/asha/data";
import { uuidv7 } from "@/utils/id";
import { currentLang } from "@/i18n";

export type StepId =
  | "consent" | "basics" | "pregnant" | "tobacco" | "alcohol" | "activity" | "fh_dm" | "fh_cv"
  | "waist" | "height" | "weight" | "bp1" | "bp2" | "glucose" | "hb" | "spo2" | "danger" | "symptoms" | "review";

/** Values outside these are almost always a mis-typed or mis-heard reading. */
export const RANGES: Record<string, [number, number]> = {
  waist_cm: [40, 160],
  height_cm: [100, 210],
  weight_kg: [20, 200],
  sbp: [60, 260],
  dbp: [30, 160],
  glucose_mg_dl: [20, 600],
  hb_g_dl: [3, 20],
  spo2: [50, 100],
};

export const plausible = (field: keyof typeof RANGES, v: number) => v >= RANGES[field][0] && v <= RANGES[field][1];

export const DANGER_SIGNS = ["chest_pain", "face_droop", "arm_weakness", "speech_difficulty", "severe_breathlessness", "unconscious", "seizure", "confusion", "severe_headache"];
export const PREGNANCY_SIGNS = ["pregnancy_bleeding", "pregnancy_severe_headache", "pregnancy_convulsions", "pregnancy_swelling", "reduced_fetal_movement"];
export const SYMPTOM_GROUPS: { key: string; items: string[]; female?: boolean }[] = [
  { key: "general", items: ["fatigue", "breathless_exertion", "pallor", "dizziness"] },
  { key: "women", items: ["heavy_menstrual_bleeding"], female: true },
  { key: "sugar", items: ["excessive_thirst", "frequent_urination", "slow_healing_wounds", "blurred_vision", "tingling_numbness"] },
  { key: "tb", items: ["cough_2_weeks", "fever", "night_sweats", "weight_loss", "blood_in_sputum", "tb_contact"] },
];

export function stepsFor(person: Person, pregnantNow: boolean): StepId[] {
  const age = ageOf(person);
  const female = person.sex === "female";
  const steps: StepId[] = ["consent", "basics"];
  if (female && age >= 15 && age <= 49) steps.push("pregnant");
  if (age >= 30) steps.push("tobacco", "alcohol", "activity", "fh_dm", "fh_cv", "waist", "height", "weight");
  steps.push("bp1", "bp2");
  if (age >= 30) steps.push("glucose", "hb");
  steps.push("spo2", "danger");
  if (age >= 30 || pregnantNow) steps.push("symptoms");
  steps.push("review");
  return steps;
}

export interface Override {
  decision: "refer" | "no_referral";
  reason: string;
}

export function useScreening(person: Person, household: Household) {
  const [input, setInput] = useState<ScreeningInput>(() => ({
    age: ageOf(person),
    sex: person.sex,
    pregnant: person.pregnant,
    known_diabetes: person.known_diabetes,
    known_hypertension: person.known_hypertension,
    symptoms: [],
    bp_readings: [],
  }));
  const [index, setIndex] = useState(0);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  const steps = useMemo(() => stepsFor({ ...person, birth_year: new Date().getFullYear() - input.age, sex: input.sex }, Boolean(input.pregnant)), [person, input.age, input.sex, input.pregnant]);
  const step = steps[Math.min(index, steps.length - 1)];
  const result: RiskResult = useMemo(() => score(input), [input]);

  /** Emergency flags the ASHA has not yet acted on: these open the emergency screen. */
  const openEmergency = result.red_flags.filter((f) => f.level === "emergency" && !acknowledged.includes(f.code));

  const set = useCallback(<K extends keyof ScreeningInput>(key: K, value: ScreeningInput[K]) => {
    setInput((prev) => {
      const next = { ...prev, [key]: value };
      if (value === undefined) delete next[key];
      return next;
    });
  }, []);

  const setReading = useCallback((i: 0 | 1, reading: [number, number] | null) => {
    setInput((prev) => {
      const readings = [...(prev.bp_readings ?? [])];
      if (reading) readings[i] = reading;
      else readings.splice(i, 1);
      return { ...prev, bp_readings: readings.filter(Boolean) };
    });
  }, []);

  const toggleSymptom = useCallback((code: string, on?: boolean) => {
    setInput((prev) => {
      const s = new Set(prev.symptoms ?? []);
      if (on ?? !s.has(code)) s.add(code);
      else s.delete(code);
      return { ...prev, symptoms: [...s] };
    });
  }, []);

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), [steps.length]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goTo = useCallback((s: StepId) => setIndex(Math.max(0, steps.indexOf(s))), [steps]);

  async function recordConsent(granted: boolean) {
    setConsented(granted);
    const id = uuidv7();
    await enqueue(
      "consent.record",
      { id, person_id: person.id, purpose: "screening", method: "spoken_tap", granted, recorded_at: new Date().toISOString(), language: currentLang() },
      person.id,
    );
    if (granted) next();
  }

  /** Offline routing from the cached facility list, the same algorithm the server runs. */
  const routing: RouteResult | null = useMemo(() => {
    if (!result.overall.refer) return null;
    return route(data.get().facilities, household.lat, household.lon, result.overall.needs.length ? result.overall.needs : ["ncd_clinic"], result.overall.urgency, localNow());
  }, [result, household.lat, household.lon]);

  async function save(opts: { book: boolean; override: Override | null }): Promise<string> {
    const id = uuidv7();
    const captured_at = new Date().toISOString();
    const record: ScreeningRecord = {
      id, person_id: person.id, captured_at, urgency: result.overall.urgency, priority: result.overall.priority,
      result, input, pending: true, routing,
    };
    await putScreening(record);
    const refer = opts.override ? opts.override.decision === "refer" : result.overall.refer;
    await enqueue(
      "screening.create",
      {
        id, person_id: person.id, captured_at, input, client_result: result, client_engine_version: result.engine_version,
        override: opts.override, booking: refer && opts.book && routing ? { facility_id: routing.facility_id, mode: routing.mode } : null,
      },
      id,
    );
    if (refer) {
      // Shown in the ASHA's referral list straight away; the server's referral replaces it on sync.
      const placeholder: Referral = {
        id: `local-${id}`, person_id: person.id, status: "flagged", urgency: result.overall.urgency, priority: result.overall.priority,
        reasons: result.overall.reasons, facility_id: routing?.facility_id ?? null, facility_name: routing?.facility_name ?? null,
        mode: routing?.mode ?? "in_person", routing, escalation_level: 0, due_at: null, created_at: captured_at, acknowledged_at: null,
        booked_at: null, seen_at: null, closed_at: null, outcome: null, appointment: null, updated_at: captured_at,
      };
      await putReferral(placeholder);
    }
    return id;
  }

  return {
    input, set, setReading, toggleSymptom, result, routing, steps, step, index, next, back, goTo,
    consented, recordConsent, openEmergency, acknowledge: (codes: string[]) => setAcknowledged((a) => [...a, ...codes]), save,
  };
}

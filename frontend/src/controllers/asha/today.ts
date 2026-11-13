/**
 * The ASHA's Today list: who to see, in what order. Works entirely offline from the local store.
 */
import type { Household, Person, Referral, ScreeningRecord } from "@/models/types/domain";
import { haversineKm } from "@/services/routing";
import { ageOf, latestScreening } from "./data";

export type GroupKey = "emergency" | "rescue" | "upcoming" | "unscreened" | "rescreen";

export interface TodayItem {
  person: Person;
  household: Household;
  referral?: Referral;
  screening?: ScreeningRecord;
  /** Minutes on foot from the previous item in walking order, when known. */
  walk?: number;
}

const DAY = 86_400_000;
const QUARTER_DAYS = 90;
const RESCREEN_DAYS = 330;
const OPEN = ["flagged", "acknowledged", "booked", "missed"];

/** Greedy nearest-neighbour walk: good enough for a few dozen houses, and needs no network. */
function walkingOrder(items: TodayItem[]): TodayItem[] {
  if (items.length < 2) return items;
  const left = [...items];
  const out: TodayItem[] = [left.shift()!];
  while (left.length) {
    const last = out[out.length - 1].household;
    let best = 0;
    let bestKm = Infinity;
    left.forEach((it, i) => {
      const km = haversineKm(last.lat, last.lon, it.household.lat, it.household.lon);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    const [next] = left.splice(best, 1);
    // ~4.5 km/h walking on village paths.
    out.push({ ...next, walk: Math.max(1, Math.round((bestKm * 1.3 * 60) / 4.5)) });
  }
  return out;
}

export function buildToday(
  persons: Person[],
  households: Household[],
  screenings: ScreeningRecord[],
  referrals: Referral[],
  now = Date.now(),
): { groups: Record<GroupKey, TodayItem[]>; coverage: { done: number; total: number } } {
  const hh = new Map(households.map((h) => [h.id, h]));
  const groups: Record<GroupKey, TodayItem[]> = { emergency: [], rescue: [], upcoming: [], unscreened: [], rescreen: [] };
  let eligible = 0;
  let screenedQuarter = 0;

  for (const person of persons) {
    const household = hh.get(person.household_id);
    if (!household) continue;
    const age = ageOf(person);
    const screening = latestScreening(screenings, person.id);
    const referral = referrals.find((r) => r.person_id === person.id && OPEN.includes(r.status));
    const ageDays = screening ? (now - new Date(screening.captured_at).getTime()) / DAY : Infinity;
    if (age >= 30) {
      eligible += 1;
      if (ageDays <= QUARTER_DAYS) screenedQuarter += 1;
    }
    const item: TodayItem = { person, household, referral, screening };

    if (referral && (referral.urgency === "emergency" || referral.urgency === "urgent")) groups.emergency.push(item);
    else if (referral && (referral.status === "missed" || (referral.due_at && new Date(referral.due_at).getTime() < now))) groups.rescue.push(item);
    else if (referral?.appointment?.slot_start && referral.status === "booked") {
      const slot = new Date(referral.appointment.slot_start).getTime();
      if (slot - now < 3 * DAY) groups.upcoming.push(item);
    } else if (age >= 30 && !screening) groups.unscreened.push(item);
    else if (age >= 30 && ageDays > RESCREEN_DAYS) groups.rescreen.push(item);
  }

  groups.emergency.sort((a, b) => (b.referral?.priority ?? 0) - (a.referral?.priority ?? 0));
  groups.rescue.sort((a, b) => (b.referral?.escalation_level ?? 0) - (a.referral?.escalation_level ?? 0) || (b.referral?.priority ?? 0) - (a.referral?.priority ?? 0));
  groups.upcoming.sort((a, b) => (a.referral?.appointment?.slot_start ?? "").localeCompare(b.referral?.appointment?.slot_start ?? ""));
  // Oldest first, then walk them in an order that saves the most steps.
  groups.unscreened = walkingOrder([...groups.unscreened].sort((a, b) => a.person.birth_year - b.person.birth_year).slice(0, 15));
  groups.rescreen = groups.rescreen.slice(0, 10);
  return { groups, coverage: { done: screenedQuarter, total: eligible } };
}

/**
 * The ASHA's working set, decrypted into memory after unlock (a few hundred people at most),
 * and the only path for writing it back: every write is sealed to IndexedDB, and every change
 * meant for the server goes into the outbox in the same step.
 */
import { createStore } from "../store";
import { requireKey } from "../auth/session";
import { db } from "@/models/db";
import { open, seal } from "@/services/crypto/vault";
import type { FacilityLite } from "@/services/routing";
import type { Alert, Household, OutboxType, Person, Referral, ScreeningRecord, Village } from "@/models/types/domain";
import { uuidv7 } from "@/utils/id";

export const data = createStore({
  loaded: false,
  villages: [] as Village[],
  facilities: [] as FacilityLite[],
  households: [] as Household[],
  persons: [] as Person[],
  screenings: [] as ScreeningRecord[],
  referrals: [] as Referral[],
  alerts: [] as Alert[],
  queued: 0,
  rejected: [] as { id: string; type: string; error?: string }[],
});

async function openAll<T>(rows: { enc: Parameters<typeof open>[1] }[]): Promise<T[]> {
  const key = requireKey();
  return Promise.all(rows.map((r) => open<T>(key, r.enc)));
}

export async function loadAll() {
  const [villages, facilities, households, persons, screenings, referrals, alerts] = await Promise.all([
    db.villages.toArray(),
    db.facilities.toArray(),
    openAll<Household>(await db.households.toArray()),
    openAll<Person>(await db.persons.toArray()),
    openAll<ScreeningRecord>(await db.screenings.toArray()),
    openAll<Referral>(await db.referrals.toArray()),
    openAll<Alert>(await db.alerts.toArray()),
  ]);
  data.set({ loaded: true, villages, facilities, households, persons, screenings, referrals, alerts });
  await refreshOutboxCount();
}

export async function refreshOutboxCount() {
  const pending = await db.outbox.where("status").equals("pending").count();
  const rejected = await db.outbox.where("status").equals("rejected").toArray();
  data.set({ queued: pending, rejected: rejected.map((r) => ({ id: r.id, type: r.type, error: r.error })) });
}

const upsert = <T extends { id: string }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
};

// ---------------------------------------------------------------- local writes

export async function putHousehold(h: Household) {
  await db.households.put({ id: h.id, village_id: h.village_id, enc: await seal(requireKey(), h) });
  data.set((s) => ({ households: upsert(s.households, h) }));
}

export async function putPerson(p: Person) {
  await db.persons.put({ id: p.id, household_id: p.household_id, enc: await seal(requireKey(), p) });
  data.set((s) => ({ persons: upsert(s.persons, p) }));
}

export async function putScreening(s: ScreeningRecord) {
  await db.screenings.put({ id: s.id, person_id: s.person_id, captured_at: s.captured_at, enc: await seal(requireKey(), s) });
  data.set((st) => ({ screenings: upsert(st.screenings, s) }));
}

export async function putReferral(r: Referral) {
  await db.referrals.put({ id: r.id, person_id: r.person_id, enc: await seal(requireKey(), r) });
  data.set((s) => ({ referrals: upsert(s.referrals, r) }));
}

export async function replaceAlerts(alerts: Alert[]) {
  const key = requireKey();
  const rows = await Promise.all(alerts.map(async (a) => ({ id: a.id, enc: await seal(key, a) })));
  await db.transaction("rw", db.alerts, async () => {
    await db.alerts.clear();
    await db.alerts.bulkPut(rows);
  });
  data.set({ alerts });
}

/** Queue a change for the server. Safe to call offline; the sync engine sends it later. */
export async function enqueue(type: OutboxType, payload: Record<string, unknown>, entityId: string) {
  const id = uuidv7();
  const created_at = new Date().toISOString();
  await db.outbox.put({
    id,
    type,
    created_at,
    entity_id: entityId,
    status: "pending",
    attempts: 0,
    enc: await seal(requireKey(), { id, type, created_at, payload }),
  });
  await refreshOutboxCount();
  window.dispatchEvent(new Event("pranamap:outbox"));
}

// ---------------------------------------------------------------- derived views

export const ageOf = (p: Person, year = new Date().getFullYear()) => year - p.birth_year;

export function latestScreening(screenings: ScreeningRecord[], personId: string): ScreeningRecord | undefined {
  let best: ScreeningRecord | undefined;
  for (const s of screenings) if (s.person_id === personId && (!best || s.captured_at > best.captured_at)) best = s;
  return best;
}

export function openReferral(referrals: Referral[], personId: string): Referral | undefined {
  return referrals.find((r) => r.person_id === personId && ["flagged", "acknowledged", "booked", "missed"].includes(r.status));
}

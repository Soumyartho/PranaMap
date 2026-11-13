/**
 * Sync engine: push the outbox, then pull what changed. Nothing in a visit waits on it.
 *
 * Triggers: unlock, coming back online, a new outbox entry, every 30 s while online, the app
 * returning to the foreground, and the "Sync now" button. (Background Sync would need the key
 * inside the service worker, and Safari lacks it anyway, so these foreground triggers are the plan.)
 */
import { createStore } from "../store";
import { requireKey, session } from "../auth/session";
import { data, loadAll, putScreening, refreshOutboxCount } from "../asha/data";
import { db, getMeta, setMeta } from "@/models/db";
import { open, seal } from "@/services/crypto/vault";
import { api, ApiError } from "@/services/api/client";
import { getDeviceId } from "./device";
import type { Alert, Household, OutboxEvent, Person, Referral, Village } from "@/models/types/domain";
import type { FacilityLite, RouteResult } from "@/services/routing";
import type { RiskResult, Urgency } from "@/models/types/risk";

export const syncState = createStore({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  phase: "idle" as "idle" | "syncing" | "error",
  lastSyncAt: null as string | null,
  error: null as string | null,
});

interface PushResult {
  id: string;
  status: "applied" | "duplicate" | "rejected";
  result: Record<string, unknown> | null;
  error: string | null;
}

interface PullResponse {
  server_time: string;
  villages: Village[];
  households: Household[];
  persons: Person[];
  screenings: { id: string; person_id: string; captured_at: string; urgency: Urgency; priority: number; result: RiskResult }[];
  referrals: Referral[];
  facilities: FacilityLite[];
  alerts: Alert[];
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (running) return running;
  running = run().finally(() => {
    running = null;
  });
  return running;
}

async function run() {
  const { status, token, user } = session.get();
  if (status !== "ready" || !token || user?.role !== "asha") return;
  if (!navigator.onLine) {
    syncState.set({ online: false, phase: "idle" });
    return;
  }
  syncState.set({ phase: "syncing", error: null });
  try {
    await push();
    await pull();
    syncState.set({ phase: "idle", online: true, lastSyncAt: new Date().toISOString() });
    await setMeta("last_sync_at", new Date().toISOString());
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) session.set({ needsSignIn: true });
    const offline = err instanceof ApiError && err.status === 0;
    syncState.set({ phase: offline ? "idle" : "error", online: !offline, error: err instanceof Error ? err.message : "sync failed" });
  }
}

async function push() {
  const key = requireKey();
  for (;;) {
    const rows = await db.outbox.where("status").equals("pending").sortBy("created_at");
    if (!rows.length) return;
    const batch = rows.slice(0, 100);
    const events = await Promise.all(batch.map((r) => open<OutboxEvent>(key, r.enc)));
    const res = await api<{ results: PushResult[] }>("/sync/push", {
      method: "POST",
      json: { device_id: await getDeviceId(), events },
      timeoutMs: 30_000,
    });
    for (const r of res.results) {
      const row = batch.find((b) => b.id === r.id);
      if (!row) continue;
      if (r.status === "rejected") {
        await db.outbox.update(r.id, { status: "rejected", error: r.error ?? "rejected", attempts: row.attempts + 1 });
        continue;
      }
      await db.outbox.delete(r.id);
      if (row.type === "screening.create" && r.result) await absorbScreeningResult(row.entity_id, r.result);
    }
    await refreshOutboxCount();
    if (batch.length < 100) return;
  }
}

/** The server's answer to a synced screening: its audit score, referral, routing and slot. */
async function absorbScreeningResult(screeningId: string, result: Record<string, unknown>) {
  const s = data.get().screenings.find((x) => x.id === screeningId);
  if (s) await putScreening({ ...s, pending: false, routing: (result.routing as RouteResult) ?? s.routing });
  // The server's referral (arriving in the pull) replaces the offline placeholder.
  await db.referrals.delete(`local-${screeningId}`);
}

async function pull() {
  const since = await getMeta<string>("last_pull_at");
  const res = await api<PullResponse>(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ""}`, { timeoutMs: 30_000 });
  const key = requireKey();
  // Local edits that have not reached the server yet win over what the server sends back.
  const pendingIds = new Set((await db.outbox.where("status").equals("pending").toArray()).map((r) => r.entity_id));
  const known = new Set((await db.screenings.toCollection().primaryKeys()) as string[]);

  const households = await Promise.all(
    res.households.filter((h) => !pendingIds.has(h.id)).map(async (h) => ({ id: h.id, village_id: h.village_id, enc: await seal(key, h) })),
  );
  const persons = await Promise.all(
    res.persons
      .filter((p) => !pendingIds.has(p.id))
      .map(async (p) => ({ id: p.id, household_id: p.household_id, enc: await seal(key, { ...p, medications: p.medications ?? [] }) })),
  );
  const screenings = await Promise.all(
    res.screenings
      .filter((s) => !known.has(s.id))
      .map(async (s) => ({ id: s.id, person_id: s.person_id, captured_at: s.captured_at, enc: await seal(key, { ...s, pending: false }) })),
  );
  const referrals = await Promise.all(res.referrals.map(async (r) => ({ id: r.id, person_id: r.person_id, enc: await seal(key, r) })));
  const alerts = await Promise.all(res.alerts.map(async (a) => ({ id: a.id, enc: await seal(key, a) })));

  // One transaction, then one reload: the screen updates once, not once per record.
  await db.transaction("rw", [db.villages, db.facilities, db.households, db.persons, db.screenings, db.referrals, db.alerts, db.meta], async () => {
    await db.villages.bulkPut(res.villages);
    await db.facilities.clear();
    await db.facilities.bulkPut(res.facilities);
    await db.households.bulkPut(households);
    await db.persons.bulkPut(persons);
    await db.screenings.bulkPut(screenings);
    await db.referrals.bulkPut(referrals);
    await db.alerts.clear();
    await db.alerts.bulkPut(alerts);
    await setMeta("last_pull_at", res.server_time);
  });
  await loadAll();
}

let started = false;

/** Wire the automatic triggers once. */
export function startAutoSync() {
  if (started) return;
  started = true;
  const kick = () => void syncNow();
  window.addEventListener("online", () => {
    syncState.set({ online: true });
    kick();
  });
  window.addEventListener("offline", () => syncState.set({ online: false }));
  window.addEventListener("pranamap:outbox", kick);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());
  setInterval(kick, 30_000);
  getMeta<string>("last_sync_at").then((v) => v && syncState.set({ lastSyncAt: v }));
}

export async function retryRejected() {
  const rows = await db.outbox.where("status").equals("rejected").toArray();
  await Promise.all(rows.map((r) => db.outbox.update(r.id, { status: "pending" })));
  await refreshOutboxCount();
  return syncNow();
}

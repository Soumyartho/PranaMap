/**
 * The phone's database (IndexedDB via Dexie). During a visit this is the source of truth.
 * Only IDs, foreign keys and public facility data are stored in the clear; everything about a
 * person is sealed with the PIN-derived key (see services/crypto/vault).
 */
import Dexie, { type Table } from "dexie";
import type { Sealed } from "@/services/crypto/vault";
import type { FacilityLite } from "@/services/routing";
import type { OutboxType, Village } from "@/models/types/domain";

export interface SealedRow {
  id: string;
  enc: Sealed;
}
export interface HouseholdRow extends SealedRow {
  village_id: string;
}
export interface PersonRow extends SealedRow {
  household_id: string;
}
export interface ScreeningRow extends SealedRow {
  person_id: string;
  captured_at: string;
}
export interface ReferralRow extends SealedRow {
  person_id: string;
}
export interface OutboxRow extends SealedRow {
  type: OutboxType;
  created_at: string;
  /** Entity the event touches, so a pull never overwrites an unsent local edit. */
  entity_id: string;
  status: "pending" | "rejected";
  error?: string;
  attempts: number;
}
export interface MetaRow {
  key: string;
  value: unknown;
}

class PranaDB extends Dexie {
  meta!: Table<MetaRow, string>;
  villages!: Table<Village, string>;
  facilities!: Table<FacilityLite, string>;
  households!: Table<HouseholdRow, string>;
  persons!: Table<PersonRow, string>;
  screenings!: Table<ScreeningRow, string>;
  referrals!: Table<ReferralRow, string>;
  alerts!: Table<SealedRow, string>;
  outbox!: Table<OutboxRow, string>;

  constructor() {
    super("pranamap");
    this.version(1).stores({
      meta: "key",
      villages: "id",
      facilities: "id",
      households: "id, village_id",
      persons: "id, household_id",
      screenings: "id, person_id, captured_at",
      referrals: "id, person_id",
      alerts: "id",
      outbox: "id, created_at, status, entity_id",
    });
  }
}

export const db = new PranaDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

/** Remove every record from this phone (supervisor revoke, or a different ASHA signing in). */
export async function wipe() {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

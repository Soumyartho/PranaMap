/**
 * Who is using the app, and the key that unlocks this phone's records.
 *
 * ASHA: signs in online once; after that she unlocks offline with her PIN. The PIN derives the
 * encryption key (never stored); a sealed verifier proves the PIN without a network.
 * Facility staff: online web sessions, token kept for the browser tab only.
 */
import { createStore } from "../store";
import { api, setToken } from "@/services/api/client";
import { deriveKey, open, seal, VERIFIER, type Sealed } from "@/services/crypto/vault";
import { getMeta, setMeta, wipe } from "@/models/db";
import type { User } from "@/models/types/domain";

type Status = "booting" | "signed_out" | "locked" | "ready";

export const session = createStore({
  status: "booting" as Status,
  user: null as User | null,
  key: null as CryptoKey | null,
  token: null as string | null,
  /** The server rejected our token: sync waits for an online sign-in. */
  needsSignIn: false,
});

const STAFF_KEY = "pranamap.staff";

interface LoginResponse {
  token: string;
  user: User;
  key_salt: string;
}

export async function boot() {
  const staff = sessionStorage.getItem(STAFF_KEY);
  if (staff) {
    const { token, user } = JSON.parse(staff) as { token: string; user: User };
    setToken(token);
    session.set({ status: "ready", user, token });
    return;
  }
  const owner = await getMeta<User>("owner");
  session.set({ status: owner ? "locked" : "signed_out", user: owner ?? null });
}

export async function signIn(phone: string, pin: string): Promise<User> {
  const res = await api<LoginResponse>("/auth/login", { method: "POST", json: { phone, pin } });
  setToken(res.token);
  if (res.user.role !== "asha") {
    sessionStorage.setItem(STAFF_KEY, JSON.stringify({ token: res.token, user: res.user }));
    session.set({ status: "ready", user: res.user, token: res.token, key: null, needsSignIn: false });
    return res.user;
  }
  const owner = await getMeta<User>("owner");
  if (owner && owner.id !== res.user.id) await wipe(); // one ASHA's records never sit under another's PIN
  const key = await deriveKey(pin, res.key_salt, res.user.id);
  await setMeta("owner", res.user);
  await setMeta("key_salt", res.key_salt);
  await setMeta("verifier", await seal(key, VERIFIER));
  await setMeta("token", await seal(key, res.token));
  session.set({ status: "ready", user: res.user, key, token: res.token, needsSignIn: false });
  return res.user;
}

/** Offline unlock with the PIN. Throws on a wrong PIN. */
export async function unlock(pin: string): Promise<User> {
  const owner = await getMeta<User>("owner");
  const salt = await getMeta<string>("key_salt");
  const verifier = await getMeta<Sealed>("verifier");
  if (!owner || !salt || !verifier) throw new Error("no_account");
  const key = await deriveKey(pin, salt, owner.id);
  try {
    if ((await open<string>(key, verifier)) !== VERIFIER) throw new Error("wrong_pin");
  } catch {
    throw new Error("wrong_pin");
  }
  const sealedToken = await getMeta<Sealed>("token");
  const token = sealedToken ? await open<string>(key, sealedToken) : null;
  setToken(token);
  session.set({ status: "ready", user: owner, key, token });
  return owner;
}

/** Lock: drop the key from memory. Records stay on the phone, sealed. */
export function lock() {
  setToken(null);
  sessionStorage.removeItem(STAFF_KEY);
  const { user, key } = session.get();
  session.set({ status: key ? "locked" : "signed_out", key: null, token: null, user: key ? user : null });
}

export async function forgetPhone() {
  await wipe();
  setToken(null);
  sessionStorage.removeItem(STAFF_KEY);
  session.set({ status: "signed_out", user: null, key: null, token: null });
}

export function requireKey(): CryptoKey {
  const key = session.get().key;
  if (!key) throw new Error("locked");
  return key;
}

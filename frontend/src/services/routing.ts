/**
 * Right-door routing on the phone, offline. Port of backend/app/services/routing.py, pinned to it
 * by shared/fixtures/routing_cases.json. Times are local wall-clock values held in a Date's UTC
 * fields, so the phone's own time zone never shifts them.
 */

export interface FacilityLite {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  capabilities: string[];
  opens: string;
  closes: string;
  days: number[];
  open_24x7: boolean;
  staffed: boolean;
  last_verified_at: string | null;
  phone?: string | null;
}

export interface RouteReason {
  code: string;
  value?: string | number | string[];
}

export interface RouteResult {
  facility_id: string;
  facility_name: string;
  kind: string;
  mode: "in_person" | "teleconsult";
  test_facility_id: string | null;
  distance_km: number;
  travel_minutes: number;
  open_now: boolean;
  missing_capabilities: string[];
  reasons: RouteReason[];
  alternatives: { facility_id: string; facility_name: string; travel_minutes: number; open_now: boolean }[];
}

const ROAD_FACTOR = 1.4;
const SPEED_KMH = 22.0;
const MAX_WAIT_HOURS: Record<string, number> = { emergency: 0, urgent: 8, soon: 72, routine: 168 };
const DAY = 86_400_000;
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0 * Math.asin(Math.sqrt(a));
}

export const travelMinutes = (km: number) => Math.floor(((km * ROAD_FACTOR) / SPEED_KMH) * 60 + 0.5);

/** "2026-10-05T13:20:00" (no zone) → Date whose UTC fields are that wall-clock time. */
export const parseLocal = (iso: string) => new Date(iso.replace(/Z$/, "") + "Z");
/** The phone's current local wall-clock time, in the same UTC-fields form. */
export const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
};

const weekday = (d: Date) => (d.getUTCDay() + 6) % 7; // Monday = 0, like Python
const hm = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};

export function isOpen(f: FacilityLite, at: Date): boolean {
  if (f.open_24x7) return true;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  return f.days.includes(weekday(at)) && hm(f.opens) <= minute && minute < hm(f.closes);
}

export function nextOpening(f: FacilityLite, at: Date): Date | null {
  if (isOpen(f, at)) return at;
  for (let d = 0; d < 8; d++) {
    const day = new Date(at.getTime() + d * DAY);
    day.setUTCSeconds(0, 0);
    if (!f.days.includes(weekday(day))) continue;
    const start = new Date(day);
    start.setUTCHours(Math.floor(hm(f.opens) / 60), hm(f.opens) % 60, 0, 0);
    if (start > at) return start;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmtOpening = (d: Date) => `${WEEKDAY[weekday(d)]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

export function route(
  facilities: FacilityLite[],
  lat: number,
  lon: number,
  needs: string[],
  urgency: string,
  atLocal: Date,
  maxTravelMinutes = 60,
): RouteResult | null {
  const emergency = urgency === "emergency" || needs.includes("emergency");
  const required = new Set(emergency ? ["emergency"] : needs.filter((n) => n !== "same_day"));
  const maxWait = MAX_WAIT_HOURS[urgency] ?? 72;

  type Option = { f: FacilityLite; missing: string[]; km: number; minutes: number; open_now: boolean; opening: Date; rank: [number, number] };
  const options: Option[] = [];
  for (const f of facilities) {
    if (f.kind === "tele_hub" || !f.staffed) continue;
    if (emergency && !f.capabilities.includes("emergency")) continue;
    const km = haversineKm(lat, lon, f.lat, f.lon);
    const opening = nextOpening(f, atLocal);
    if (opening === null) continue;
    const waitH = (opening.getTime() - atLocal.getTime()) / 3_600_000;
    if (emergency && !f.open_24x7) continue;
    if (waitH > maxWait) continue;
    const missing = [...required].filter((c) => !f.capabilities.includes(c)).sort();
    const minutes = travelMinutes(km);
    options.push({
      f,
      missing,
      km: Math.floor(km * 10 + 0.5) / 10,
      minutes,
      open_now: waitH === 0,
      opening,
      rank: [missing.length, minutes + waitH * 10],
    });
  }
  if (!options.length) return null;
  options.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
  const best = options[0];
  const f = best.f;

  const reasons: RouteReason[] = [];
  if (emergency) reasons.push({ code: "emergency_24x7" });
  const covered = [...required].filter((c) => f.capabilities.includes(c)).sort();
  if (covered.length) reasons.push({ code: "has_capabilities", value: covered });
  reasons.push(best.open_now ? { code: "open_now" } : { code: "opens_at", value: fmtOpening(best.opening) });
  reasons.push({ code: "travel", value: best.minutes });
  if (f.last_verified_at) {
    const days = Math.floor((atLocal.getTime() - parseLocal(f.last_verified_at).getTime()) / DAY);
    reasons.push({ code: "verified_days_ago", value: Math.max(0, days) });
  }

  let mode: "in_person" | "teleconsult" = "in_person";
  const tele = facilities.find((t) => t.kind === "tele_hub" && t.staffed);
  if (!emergency && best.minutes > maxTravelMinutes && tele) {
    mode = "teleconsult";
    reasons.unshift({ code: "teleconsult_far", value: best.minutes });
  }
  const isTele = mode === "teleconsult" && tele;
  return {
    facility_id: isTele ? tele.id : f.id,
    facility_name: isTele ? tele.name : f.name,
    kind: isTele ? "tele_hub" : f.kind,
    mode,
    test_facility_id: isTele ? f.id : null,
    distance_km: best.km,
    travel_minutes: best.minutes,
    open_now: best.open_now,
    missing_capabilities: best.missing,
    reasons,
    alternatives: options.slice(1, 4).map((o) => ({
      facility_id: o.f.id,
      facility_name: o.f.name,
      travel_minutes: o.minutes,
      open_now: o.open_now,
    })),
  };
}

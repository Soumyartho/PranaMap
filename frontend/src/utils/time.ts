export const DAY_MS = 86_400_000;

export const daysSince = (iso: string | null | undefined, now = Date.now()) =>
  iso ? Math.floor((now - new Date(iso).getTime()) / DAY_MS) : null;

export const isoNow = () => new Date().toISOString();

export function formatDateTime(iso: string | null | undefined, locale: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso));
}

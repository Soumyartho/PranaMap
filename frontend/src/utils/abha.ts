/** ABHA number: 14 digits, shown as XX-XXXX-XXXX-XXXX. Mirrors backend/app/integrations/abdm/abha.py. */
export function normalizeAbhaNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{14}$/.test(digits)) return null;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`;
}

export const maskAbha = (n: string) => `••-••••-••••-${n.slice(-4)}`;

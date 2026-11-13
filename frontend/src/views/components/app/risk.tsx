import { useTranslation } from "@/i18n";
import { AlertTriangle, Siren } from "lucide-react";
import type { Band, Urgency } from "@/models/types/risk";
import { cn } from "@/lib/cx";

/** Band → colour token. Always paired with a shape and a word. */
export const BAND_COLOR: Record<Band, string> = { low: "var(--color-ok)", moderate: "var(--color-warn)", high: "var(--color-signal)" };
export const URGENCY_COLOR: Record<Urgency, string> = {
  emergency: "var(--color-signal)",
  urgent: "var(--color-signal)",
  soon: "var(--color-warn)",
  routine: "var(--color-ok)",
};

/** Circle = low, triangle = watch, diamond = high: readable without colour. */
export function BandShape({ band, size = 12 }: { band: Band; size?: number }) {
  const fill = BAND_COLOR[band];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {band === "low" && <circle cx="6" cy="6" r="5" fill={fill} />}
      {band === "moderate" && <path d="M6 1 11 11H1Z" fill={fill} />}
      {band === "high" && <path d="M6 0.5 11.5 6 6 11.5 0.5 6Z" fill={fill} />}
    </svg>
  );
}

export function BandBadge({ band, className }: { band: Band; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-display text-xs font-semibold", className)}
      style={{ borderColor: BAND_COLOR[band], color: BAND_COLOR[band] }}
    >
      <BandShape band={band} size={10} />
      {t(`bands.${band}`)}
    </span>
  );
}

export function UrgencyPill({ urgency, className }: { urgency: Urgency; className?: string }) {
  const { t } = useTranslation();
  const Icon = urgency === "emergency" ? Siren : urgency === "urgent" ? AlertTriangle : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-wider",
        urgency === "emergency" && "pulse-emergency",
        className,
      )}
      style={{ background: `color-mix(in oklab, ${URGENCY_COLOR[urgency]} 18%, transparent)`, color: URGENCY_COLOR[urgency] }}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : <BandShape band={urgency === "soon" ? "moderate" : "low"} size={9} />}
      {t(`urgency.${urgency}`)}
    </span>
  );
}

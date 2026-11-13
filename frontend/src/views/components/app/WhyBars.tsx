import { m } from "framer-motion";
import { useTranslation } from "@/i18n";
import { Volume2 } from "lucide-react";
import type { Driver } from "@/models/types/risk";
import { speak, type VoiceLang } from "@/services/voice/speech";

/** "Tobacco: daily", "Waist 96 cm": a driver code + value in the ASHA's language. */
export function useDriverLabel() {
  const { t, i18n } = useTranslation();
  return (d: Driver) => {
    const raw = d.value;
    const value = typeof raw === "string" && i18n.exists(`values.${raw}`) ? t(`values.${raw}`) : raw;
    return t(`drivers.${d.code}`, { value, defaultValue: d.code });
  };
}

/** The top reasons, sliding in one by one. Tap a bar to hear it. */
export function WhyBars({ drivers }: { drivers: Driver[] }) {
  const { i18n } = useTranslation();
  const label = useDriverLabel();
  const max = Math.max(1, ...drivers.map((d) => Math.abs(d.points)));
  return (
    <ol className="space-y-3">
      {drivers.map((d, i) => {
        const up = d.direction === "up";
        return (
          <m.li
            key={`${d.code}-${i}`}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08, type: "spring", stiffness: 260, damping: 24 }}
          >
            <button
              type="button"
              onClick={() => void speak(label(d), i18n.language as VoiceLang)}
              className="group w-full text-left"
            >
              <span className="flex items-center justify-between gap-3 font-display text-[15px] text-paper/90">
                <span>{up ? "▲" : "▼"} {label(d)}</span>
                <Volume2 className="h-4 w-4 shrink-0 text-mute transition-colors group-hover:text-paper" aria-hidden="true" />
              </span>
              <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-line">
                <m.span
                  className="block h-full rounded-full"
                  style={{ background: up ? "var(--color-warn)" : "var(--color-ok)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(Math.abs(d.points) / max) * 100}%` }}
                  transition={{ delay: 0.1 + i * 0.08, type: "spring", stiffness: 120, damping: 20 }}
                />
              </span>
            </button>
          </m.li>
        );
      })}
    </ol>
  );
}

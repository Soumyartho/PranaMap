import { m } from "framer-motion";
import { useTranslation } from "@/i18n";
import type { Band, ConditionKey, RiskResult } from "@/models/types/risk";
import { BAND_COLOR, BandShape } from "./risk";

const RINGS: ConditionKey[] = ["diabetes", "hypertension", "cvd", "anaemia"];

interface Props {
  result: RiskResult;
  /** A second result drawn as a faint ghost ring (the what-if comparison). */
  ghost?: RiskResult | null;
  size?: number;
  showLegend?: boolean;
  selected?: ConditionKey | null;
  onSelect?: (k: ConditionKey) => void;
}

/**
 * Concentric rings for diabetes, BP, heart and anaemia. Each fills with spring physics as answers
 * arrive (the engine re-scores in milliseconds), so the ASHA sees each answer change the picture.
 */
export function PranaRing({ result, ghost, size = 220, showLegend = true, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const stroke = size * 0.062;
  const gap = stroke * 0.55;
  const center = size / 2;
  const tb = result.conditions.tb;

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("result.title")} className="shrink-0">
        {RINGS.map((key, i) => {
          const r = center - stroke / 2 - i * (stroke + gap);
          const c = 2 * Math.PI * r;
          const cond = result.conditions[key];
          const ghostCond = ghost?.conditions[key];
          const computed = cond && cond.computed !== false;
          const band: Band = cond?.band ?? "low";
          const value = computed ? Math.max(0.03, cond.score / 100) : 0;
          const dim = selected && selected !== key;
          return (
            <g
              key={key}
              transform={`rotate(-90 ${center} ${center})`}
              onClick={() => onSelect?.(key)}
              style={{ cursor: onSelect ? "pointer" : undefined, opacity: dim ? 0.35 : 1, transition: "opacity 200ms" }}
            >
              <circle cx={center} cy={center} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
              {ghostCond && (
                <circle
                  cx={center} cy={center} r={r} fill="none" stroke={BAND_COLOR[ghostCond.band]} strokeOpacity={0.3}
                  strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
                  strokeDashoffset={c * (1 - Math.max(0.03, ghostCond.score / 100))}
                />
              )}
              <m.circle
                cx={center} cy={center} r={r} fill="none" stroke={BAND_COLOR[band]} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={c}
                initial={false}
                animate={{ strokeDashoffset: c * (1 - value), stroke: BAND_COLOR[band] }}
                transition={{ type: "spring", stiffness: 110, damping: 18 }}
              />
            </g>
          );
        })}
        <text x={center} y={center - size * 0.02} textAnchor="middle" className="fill-paper font-display" fontSize={size * 0.15} fontWeight={600}>
          {result.overall.priority}
        </text>
        <text x={center} y={center + size * 0.1} textAnchor="middle" className="fill-mute font-display" fontSize={size * 0.055} letterSpacing="0.12em">
          PRIORITY
        </text>
      </svg>
      {showLegend && (
        <ul className="space-y-2.5">
          {RINGS.map((key) => {
            const cond = result.conditions[key];
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect?.(key)}
                  className={`flex items-center gap-2 whitespace-nowrap text-left font-display text-[15px] ${selected === key ? "text-paper" : "text-paper/75"}`}
                >
                  {cond && cond.computed !== false ? <BandShape band={cond.band} /> : <span className="h-3 w-3 rounded-full bg-line" />}
                  {t(`conditions.${key}`)}
                </button>
              </li>
            );
          })}
          {tb && (
            <li>
              <button type="button" onClick={() => onSelect?.("tb")} className={`flex items-center gap-2 whitespace-nowrap text-left font-display text-[15px] ${selected === "tb" ? "text-paper" : "text-paper/75"}`}>
                <BandShape band={tb.band} />
                {t("conditions.tb")}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

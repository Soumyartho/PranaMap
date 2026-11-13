import { BrainCircuit, ShieldAlert } from "lucide-react";
import { usePoll } from "@/controllers/staff/usePoll";
import { cn } from "@/lib/cx";

interface Reliability {
  bin: [number, number];
  n: number;
  predicted: number | null;
  observed: number | null;
}
interface TargetStats {
  n: number;
  mean_probability: number | null;
  model_flag_rate: number | null;
  guideline_flag_rate: number | null;
  agreement: number | null;
  kappa: number | null;
  outcomes: number;
  reliability: Reliability[];
}
interface Monitoring {
  available: boolean;
  model: { name: string; version: string; validated: boolean; mode: string; card: string; trained_on_real_data: boolean };
  window_days: number;
  screenings: number;
  scored: number;
  overrides: number;
  score_mismatches: number;
  targets: Record<string, TargetStats>;
  drift: { feature: string; training_mean: number; current_mean: number; smd: number; shifted: boolean }[];
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Predicted vs confirmed, per probability bin. Points on the diagonal mean the model is calibrated here. */
function ReliabilityChart({ rows }: { rows: Reliability[] }) {
  const size = 150;
  const pad = 18;
  const s = (v: number) => pad + v * (size - 2 * pad);
  const y = (v: number) => size - s(v);
  const pts = rows.filter((r) => r.predicted !== null && r.observed !== null);
  return (
    <svg width={size} height={size} role="img" aria-label="Reliability: predicted against confirmed" className="shrink-0">
      <rect x={pad} y={pad} width={size - 2 * pad} height={size - 2 * pad} fill="none" stroke="var(--color-line)" />
      <line x1={s(0)} y1={y(0)} x2={s(1)} y2={y(1)} stroke="var(--color-mute)" strokeDasharray="3 3" />
      {pts.map((r) => (
        <circle key={r.bin[0]} cx={s(r.predicted!)} cy={y(r.observed!)} r={Math.min(9, 3 + Math.sqrt(r.n))} fill="var(--color-warn)" fillOpacity={0.75}>
          <title>{`${r.n} people · predicted ${pct(r.predicted)} · confirmed ${pct(r.observed)}`}</title>
        </circle>
      ))}
      <text x={size / 2} y={size - 3} textAnchor="middle" fontSize="9" fill="var(--color-mute)">predicted</text>
      <text x={8} y={size / 2} textAnchor="middle" fontSize="9" fill="var(--color-mute)" transform={`rotate(-90 8 ${size / 2})`}>confirmed</text>
    </svg>
  );
}

export function ModelPanel() {
  const { data } = usePoll<Monitoring>("/dashboard/model", 60_000);
  if (!data?.available) return null;
  const m = data.model;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><BrainCircuit className="h-5 w-5 text-crimson" /> Risk model monitoring</h2>
        <span className="font-display text-xs text-mute">{m.name} {m.version} · last {data.window_days} days · {data.scored} of {data.screenings} screenings scored</span>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 font-serif text-[15px] text-paper/90">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
        <p>
          <b className="font-display">Shadow mode.</b> The model scores every screening and is monitored here, but it changes no band, referral or
          message. {m.trained_on_real_data ? "" : "It was trained on synthetic data. "}It can assist decisions only after validation on confirmed outcomes.
          Model card: <code className="text-xs">{m.card}</code>
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {Object.entries(data.targets).map(([target, t]) => (
          <div key={target} className="rounded-3xl border border-line bg-surface p-5">
            <p className="font-display font-semibold capitalize">{target}</p>
            <div className="mt-3 flex gap-4">
              <ReliabilityChart rows={t.reliability} />
              <dl className="grid content-start gap-2 font-display text-sm">
                <div><dt className="text-xs text-mute">Agreement with guideline</dt><dd>{pct(t.agreement)} · κ {t.kappa ?? "—"}</dd></div>
                <div><dt className="text-xs text-mute">Flags (model / guideline)</dt><dd>{pct(t.model_flag_rate)} / {pct(t.guideline_flag_rate)}</dd></div>
                <div><dt className="text-xs text-mute">Confirmed outcomes</dt><dd>{t.outcomes}</dd></div>
              </dl>
            </div>
          </div>
        ))}
        <div className="rounded-3xl border border-line bg-surface p-5">
          <p className="font-display font-semibold">Input drift vs training data</p>
          <table className="mt-3 w-full font-display text-sm">
            <thead className="text-left text-xs text-mute"><tr><th className="font-medium">Feature</th><th className="font-medium">Train</th><th className="font-medium">Now</th><th className="font-medium">SMD</th></tr></thead>
            <tbody>
              {data.drift.map((d) => (
                <tr key={d.feature} className={cn(d.shifted && "text-warn")}>
                  <td className="py-0.5">{d.feature}</td><td>{d.training_mean}</td><td>{d.current_mean}</td><td>{d.smd}{d.shifted ? " ●" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-serif text-[13px] text-mute">|SMD| above 0.2 means local inputs differ from training: recalibrate before trusting the model.</p>
          <p className="mt-2 font-display text-xs text-mute">ASHA overrides: {data.overrides} · phone/server mismatches: {data.score_mismatches}</p>
        </div>
      </div>
    </section>
  );
}

import { useRef, type CSSProperties } from "react";
import { stats, type Stat } from "../../../models/content/landing";
import { useCountUp } from "../../../controllers/landing/useCountUp";

function StatCell({ stat, index }: { stat: Stat; index: number }) {
  const number = useRef<HTMLSpanElement>(null);
  useCountUp(number, stat.value);
  return (
    <div
      data-reveal
      style={{ "--reveal-delay": `${index * 90}ms` } as CSSProperties}
      className="flex flex-col justify-between gap-10 bg-ink p-8 transition-colors duration-500 hover:bg-blood/40 md:p-10"
    >
      <p className="font-display text-[clamp(3.25rem,6vw,5.5rem)] font-semibold leading-none tracking-[-0.04em] text-paper">
        {stat.prefix}
        <span ref={number}>0</span>
        {stat.suffix && <span className="text-crimson">{stat.suffix}</span>}
        {stat.tail && <span className="text-[0.45em] tracking-tight text-mute">{stat.tail}</span>}
      </p>
      <div>
        <p className="font-serif text-lg leading-snug text-paper/85">{stat.label}</p>
        <p className="mt-4 font-display text-[11px] font-medium uppercase tracking-[0.2em] text-mute">{stat.source}</p>
      </div>
    </div>
  );
}

export function StatsSection() {
  return (
    <section className="relative px-5 py-32 md:px-10" aria-labelledby="stats-title">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end" data-reveal>
          <h2 id="stats-title" className="max-w-[16ch] font-display text-[clamp(2.25rem,5vw,4.5rem)] font-semibold">
            Care arrives late because the gaps are real.
          </h2>
          <p className="max-w-[36ch] font-serif text-lg text-mute">
            Screening volume is already huge. What is missing is ranking, routing and follow-through.
          </p>
        </div>
        <div className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => (
            <StatCell key={stat.source} stat={stat} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

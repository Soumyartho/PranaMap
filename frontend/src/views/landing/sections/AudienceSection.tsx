import type { CSSProperties } from "react";
import { audiences } from "../../../models/content/landing";

export function AudienceSection() {
  return (
    <section id="who" className="relative border-t border-line px-5 py-32 md:px-10" aria-labelledby="who-title">
      <div className="mx-auto max-w-7xl">
        <div data-reveal>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-crimson">Who it serves</p>
          <h2 id="who-title" className="mt-6 max-w-[18ch] font-display text-[clamp(2.25rem,5vw,4.5rem)] font-semibold">
            One record. Three people who act on it.
          </h2>
        </div>
        <div className="mt-20 grid gap-12 md:grid-cols-3 md:gap-0">
          {audiences.map((a, i) => (
            <article
              key={a.role}
              data-reveal
              style={{ "--reveal-delay": `${i * 120}ms` } as CSSProperties}
              className="md:border-l md:border-line md:px-10 md:first:border-l-0 md:first:pl-0"
            >
              <p className="font-display text-[13px] font-semibold uppercase tracking-[0.22em] text-signal">{a.role}</p>
              <h3 className="mt-5 font-display text-[1.9rem] font-semibold leading-tight">{a.gets}</h3>
              <ul className="mt-8 space-y-3">
                {a.points.map((point) => (
                  <li key={point} className="flex items-baseline gap-3 font-serif text-lg text-paper/75">
                    <span className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-crimson" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

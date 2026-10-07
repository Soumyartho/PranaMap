import { useEffect, useRef } from "react";
import { features } from "../../../models/content/landing";
import { useScrollProgress } from "../../../controllers/landing/useScrollProgress";
import { useReducedMotion } from "../../../controllers/landing/useReducedMotion";
import { hapticTick } from "../../../controllers/landing/haptics";
import { FeatureIcon } from "./FeatureIcon";

/** Vertical scroll drives a pinned horizontal rail of feature cards. */
export function FeatureRail() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const distance = useRef(0);
  const card = useRef(-1);
  const reduced = useReducedMotion();

  useEffect(() => {
    const s = section.current!;
    const t = track.current!;
    if (reduced) {
      s.style.height = "";
      t.style.transform = "";
      return;
    }
    const measure = () => {
      distance.current = Math.max(0, t.scrollWidth - window.innerWidth);
      s.style.height = `${window.innerHeight + distance.current}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(t);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [reduced]);

  useScrollProgress(
    section,
    (p) => {
      if (reduced) return;
      track.current!.style.transform = `translate3d(${-p * distance.current}px,0,0)`;
      meter.current!.style.transform = `scaleX(${p})`;
      const index = Math.round(p * (features.length - 1));
      if (index !== card.current) {
        if (card.current !== -1) hapticTick(6);
        card.current = index;
      }
    },
    "pin",
  );

  return (
    <section ref={section} id="features" className="relative border-t border-line" aria-labelledby="features-title">
      <div className={reduced ? "py-24" : "sticky top-0 flex h-svh flex-col justify-center overflow-hidden"}>
        <div className="mx-auto flex w-full max-w-7xl items-end justify-between gap-8 px-5 md:px-10">
          <div>
            <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-crimson">What it does</p>
            <h2 id="features-title" className="mt-5 max-w-[18ch] font-display text-[clamp(2rem,4.4vw,4rem)] font-semibold">
              Built for a 2 GB phone with no signal.
            </h2>
          </div>
          {!reduced && (
            <div className="hidden w-48 md:block" aria-hidden="true">
              <div className="h-px w-full bg-line">
                <div ref={meter} className="h-px origin-left scale-x-0 bg-signal" />
              </div>
              <p className="mt-3 text-right font-display text-[11px] uppercase tracking-[0.2em] text-mute">Keep scrolling</p>
            </div>
          )}
        </div>

        <ol
          ref={track}
          className={
            reduced
              ? "mx-auto mt-12 grid max-w-7xl gap-4 px-5 sm:grid-cols-2 md:px-10 lg:grid-cols-4"
              : "mt-12 flex w-max gap-5 pr-[8vw] pl-5 will-change-transform md:pl-[max(2.5rem,calc((100vw-80rem)/2+2.5rem))]"
          }
        >
          {features.map((feature, i) => (
            <li
              key={feature.title}
              className={`group relative flex flex-col justify-between rounded-3xl border p-7 transition-colors duration-500 md:p-9 ${
                reduced ? "min-h-64" : "h-[min(26rem,52svh)] w-[min(78vw,22rem)]"
              } ${
                i === 4
                  ? "border-crimson bg-crimson text-paper"
                  : "border-line bg-ink hover:border-blood hover:bg-blood/30"
              }`}
            >
              <div className="flex items-start justify-between">
                <FeatureIcon name={feature.icon} className={`h-9 w-9 ${i === 4 ? "text-paper" : "text-signal"}`} />
                <span className="font-display text-sm font-medium tracking-[0.18em] text-paper/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div>
                <h3 className="font-display text-[1.75rem] font-semibold">{feature.title}</h3>
                <p className={`mt-3 font-serif text-[1.05rem] leading-relaxed ${i === 4 ? "text-paper/90" : "text-paper/70"}`}>
                  {feature.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

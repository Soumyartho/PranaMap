import { useEffect, useRef, useState } from "react";
import { loopSteps } from "../../../models/content/landing";
import { hapticTick } from "../../../controllers/landing/haptics";

/** Sticky numeral on the left, steps on the right; the step crossing mid-screen is active. */
export function LoopSection() {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const activeRef = useRef(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (index === activeRef.current) continue;
          activeRef.current = index;
          setActive(index);
          hapticTick(8);
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    items.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="loop" className="relative border-t border-line px-5 pt-32 md:px-10" aria-labelledby="loop-title">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl" data-reveal>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-crimson">The closed loop</p>
          <h2 id="loop-title" className="mt-6 font-display text-[clamp(2.25rem,5vw,4.5rem)] font-semibold">
            Not a prediction model. A path from first contact to completed care.
          </h2>
        </div>

        <div className="mt-8 grid gap-x-16 md:grid-cols-[1fr_1.1fr]">
          <div className="sticky top-0 hidden h-svh items-center md:flex" aria-hidden="true">
            <div className="relative w-full">
              <div className="relative h-[clamp(9rem,17vw,16rem)] overflow-hidden">
                {loopSteps.map((step, i) => (
                  <span
                    key={step.key}
                    className="absolute inset-0 font-display text-[clamp(9rem,17vw,16rem)] font-semibold leading-none tracking-[-0.06em] text-crimson transition-[transform,opacity] duration-700 ease-out-expo"
                    style={{
                      transform: `translate3d(0, ${(i - active) * 100}%, 0)`,
                      opacity: i === active ? 1 : 0,
                    }}
                  >
                    0{i + 1}
                  </span>
                ))}
              </div>
              <div className="mt-8 flex gap-2">
                {loopSteps.map((step, i) => (
                  <span
                    key={step.key}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i === active ? "w-12 bg-signal" : i < active ? "w-6 bg-blood" : "w-6 bg-line"
                    }`}
                  />
                ))}
              </div>
              <p className="mt-6 font-display text-sm font-medium uppercase tracking-[0.24em] text-mute">
                {loopSteps[active].key}
              </p>
            </div>
          </div>

          <ol className="pb-[20svh]">
            {loopSteps.map((step, i) => (
              <li
                key={step.key}
                data-index={i}
                ref={(el) => {
                  items.current[i] = el;
                }}
                className="flex min-h-[70svh] flex-col justify-center border-b border-line/60 py-16 last:border-b-0"
              >
                <span className="font-display text-sm font-semibold tracking-[0.2em] text-crimson md:hidden">0{i + 1}</span>
                <h3
                  className={`mt-3 font-display text-[clamp(1.9rem,3.4vw,3rem)] font-semibold transition-colors duration-500 ${
                    i === active ? "text-paper" : "text-paper/30"
                  }`}
                >
                  {step.title}
                </h3>
                <p
                  className={`mt-5 max-w-[46ch] font-serif text-lg leading-relaxed transition-colors duration-500 md:text-xl ${
                    i === active ? "text-paper/85" : "text-paper/25"
                  }`}
                >
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

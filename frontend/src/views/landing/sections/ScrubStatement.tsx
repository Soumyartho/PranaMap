import { useRef } from "react";
import { statement, statementAccents } from "../../../models/content/landing";
import { useScrollProgress } from "../../../controllers/landing/useScrollProgress";

const words = statement.split(" ");

/** A pinned statement whose words light up one by one as you scroll. */
export function ScrubStatement() {
  const section = useRef<HTMLElement>(null);
  const spans = useRef<(HTMLSpanElement | null)[]>([]);

  useScrollProgress(
    section,
    (p) => {
      const lit = p * words.length * 1.15;
      spans.current.forEach((span, i) => span?.style.setProperty("--w", String(Math.min(1, Math.max(0, lit - i)))));
    },
    "pin",
  );

  return (
    <section ref={section} id="problem" className="relative h-[240svh]" aria-label="The gap">
      <div className="sticky top-0 flex h-svh items-center">
        <div className="mx-auto w-full max-w-6xl px-5 md:px-10">
          <p className="mb-10 font-display text-xs font-semibold uppercase tracking-[0.3em] text-crimson">
            The market gap
          </p>
          <p className="font-serif text-[clamp(1.75rem,4.2vw,3.6rem)] leading-[1.18] tracking-[-0.01em]">
            {words.map((word, i) => (
              <span
                key={i}
                ref={(el) => {
                  spans.current[i] = el;
                }}
                className={`scrub-word ${statementAccents.has(word) ? "italic text-signal" : "text-paper"}`}
              >
                {word}{" "}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}

import { useRef, type CSSProperties } from "react";
import { features, type Feature } from "@/models/content/landing";
import { Marquee } from "@/views/components/ui/3d-testimonails";
import { useScrollProgress } from "@/controllers/landing/useScrollProgress";
import { cn } from "@/lib/utils";
import { FeatureIcon } from "./FeatureIcon";

/** Each column starts at a different feature so rows never line up. */
const columns = [0, 3, 6, 1].map((offset) => features.map((_, i) => features[(i + offset) % features.length]));
const HIGHLIGHT = "Right-door routing";

/** Fades all four edges into the page. A mask, because the 3D plane composites above overlays. */
const fadeMask =
  "linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent), linear-gradient(to right, transparent, #000 16%, #000 84%, transparent)";
const edgeFade: CSSProperties = {
  maskImage: fadeMask,
  WebkitMaskImage: fadeMask,
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};

function FeatureCard({ feature }: { feature: Feature }) {
  const hot = feature.title === HIGHLIGHT;
  return (
    <article
      className={cn(
        "w-56 rounded-2xl border p-5 transition-colors duration-300 md:w-60",
        hot ? "border-crimson bg-crimson" : "border-line bg-[#0b0707] hover:border-blood hover:bg-[#1a0606]",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            hot ? "bg-paper text-crimson" : "bg-blood/40 text-signal",
          )}
        >
          <FeatureIcon name={feature.icon} className="h-[18px] w-[18px]" />
        </span>
        <h3 className="font-display text-[17px] font-semibold leading-tight text-paper">{feature.title}</h3>
      </div>
      <p className={cn("mt-3 font-serif text-[14.5px] leading-snug", hot ? "text-paper/90" : "text-paper/65")}>
        {feature.body}
      </p>
    </article>
  );
}

/** A tilted 3D wall of feature cards drifting in opposite directions; tilt eases as you scroll. */
export function FeatureWall() {
  const section = useRef<HTMLElement>(null);
  const plane = useRef<HTMLDivElement>(null);

  useScrollProgress(section, (p) => {
    plane.current?.style.setProperty("--sp", String(p));
  });

  return (
    <section
      ref={section}
      id="features"
      className="relative overflow-x-clip border-t border-line px-5 py-28 md:px-10"
      aria-labelledby="features-title"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.85fr_1.15fr]">
        <div data-reveal>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-crimson">What it does</p>
          <h2 id="features-title" className="mt-6 max-w-[14ch] font-display text-[clamp(2.25rem,5vw,4.5rem)] font-semibold">
            Built for a 2&nbsp;GB phone with no signal.
          </h2>
          <p className="mt-6 max-w-[42ch] font-serif text-lg leading-relaxed text-mute">
            Eight pieces, one loop. Everything runs on the ASHA's phone first and reaches the cloud when it can.
          </p>
          <ul className="mt-10 grid max-w-md grid-cols-2 gap-x-6 gap-y-3">
            {features.map((f) => (
              <li key={f.title} className="flex items-center gap-2.5 font-display text-[14px] font-medium text-paper/80">
                <FeatureIcon name={f.icon} className="h-4 w-4 shrink-0 text-signal" />
                {f.title}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="relative flex h-[34rem] items-center justify-center overflow-hidden [perspective:320px] md:h-[40rem] lg:-mr-[max(2.5rem,calc((100vw-80rem)/2+2.5rem))]"
          style={edgeFade}
          aria-hidden="true"
        >
          <div
            ref={plane}
            className="flex flex-row items-center gap-4 will-change-transform"
            style={{
              transform:
                "translateX(-40px) translateY(calc((0.5 - var(--sp, 0.5)) * 80px)) translateZ(-100px) rotateX(20deg) rotateY(-10deg) rotateZ(calc(14deg + var(--sp, 0.5) * 12deg))",
            }}
          >
            {columns.map((column, i) => (
              <Marquee
                key={i}
                vertical
                pauseOnHover
                reverse={i % 2 === 1}
                repeat={3}
                className="[--duration:46s]"
              >
                {column.map((feature) => (
                  <FeatureCard key={feature.title} feature={feature} />
                ))}
              </Marquee>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

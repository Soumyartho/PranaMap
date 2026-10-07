import { useRef } from "react";
import GlyphPortal from "../../components/landing/GlyphPortal";
import { hero } from "../../../models/content/landing";
import { hapticTick } from "../../../controllers/landing/haptics";
import { PortalField } from "./PortalField";
import { portalStyle, PORTAL_FONT } from "./portalTheme";

export function HeroPortal() {
  const entered = useRef(false);
  const onProgress = (p: number) => {
    const now = p >= 0.9;
    if (now !== entered.current) {
      entered.current = now;
      if (now) hapticTick([10, 40, 14]);
    }
  };

  return (
    <GlyphPortal
      word={hero.word}
      fontFamily={PORTAL_FONT}
      fontWeight={700}
      scrollLength={2.6}
      enterLabel="Enter PranaMap"
      className="portal font-display"
      style={portalStyle}
      onProgress={onProgress}
      background={<PortalField id="hex-hero" tone="blood" />}
      front={
        <div className="absolute inset-x-0 top-[15%] px-6 text-center">
          <p className="font-display text-[11px] font-medium uppercase tracking-[0.32em] text-mute">{hero.eyebrow}</p>
          <p className="mt-4 font-serif text-xl italic text-paper md:text-[1.75rem]">
            {hero.tagline}
          </p>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-6xl">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-paper/70">{hero.kicker}</p>
        <h1 className="mt-6 max-w-[14ch] font-display text-[clamp(2.75rem,7.5vw,7rem)] font-semibold leading-[0.95] tracking-[-0.035em] text-paper">
          {hero.title}
        </h1>
        <p className="mt-8 max-w-[52ch] font-serif text-lg leading-relaxed text-paper/85 md:text-[1.35rem]">
          {hero.body}
        </p>
        <dl className="mt-14 grid max-w-4xl grid-cols-1 gap-px overflow-hidden rounded-2xl bg-paper/15 sm:grid-cols-3">
          {hero.facts.map((fact) => (
            <div key={fact.label} className="bg-ink/25 px-6 py-5 backdrop-blur-sm">
              <dt className="font-display text-3xl font-semibold tracking-tight text-paper">{fact.value}</dt>
              <dd className="mt-1 font-serif text-[15px] text-paper/75">{fact.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </GlyphPortal>
  );
}

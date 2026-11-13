import { useRef } from "react";
import GlyphPortal from "@/views/components/landing/GlyphPortal";
import { closing } from "@/models/content/landing";
import { hapticTick } from "@/controllers/landing/haptics";
import { CtaButton } from "@/views/components/ui/cta-button";
import { PortalField } from "./PortalField";
import { portalStyle, PORTAL_FONT } from "./portalTheme";

/** Second portal: scroll through "CARE" into the call to action, same camera as the hero. */
export function ClosingPortal() {
  const entered = useRef(false);
  const onProgress = (p: number) => {
    const now = p >= 0.9;
    if (now !== entered.current) {
      entered.current = now;
      if (now) hapticTick([10, 40, 14]);
    }
  };

  return (
    <div id="cta" className="border-t border-line">
      <GlyphPortal
        word={closing.word}
        fontFamily={PORTAL_FONT}
        fontWeight={700}
        scrollLength={2.6}
        enterLabel="Close the loop"
        className="portal font-display"
        style={portalStyle}
        onProgress={onProgress}
        background={<PortalField id="hex-close" tone="crimson" />}
        front={
          <div className="absolute inset-x-0 top-[15%] px-6 text-center">
            <p className="font-display text-[11px] font-medium uppercase tracking-[0.32em] text-mute">
              The north-star metric
            </p>
            <p className="mt-4 font-serif text-xl italic text-paper md:text-[1.75rem]">{closing.front}</p>
          </div>
        }
      >
        <div className="mx-auto w-full max-w-5xl text-center">
          <h2 className="mx-auto max-w-[14ch] font-display text-[clamp(2.75rem,7vw,6.5rem)] font-semibold leading-[0.95] tracking-[-0.035em] text-paper">
            {closing.title}
          </h2>
          <p className="mx-auto mt-8 max-w-[48ch] font-serif text-lg leading-relaxed text-paper/85 md:text-xl">
            {closing.body}
          </p>
          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <CtaButton href={closing.primary.href} variant="light" size="lg">
              {closing.primary.label}
            </CtaButton>
            <CtaButton href={closing.secondary.href} variant="ghost" size="lg">
              {closing.secondary.label}
            </CtaButton>
          </div>
        </div>
      </GlyphPortal>
    </div>
  );
}

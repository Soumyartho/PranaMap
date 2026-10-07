import { useRef } from "react";
import GlyphPortal from "../../components/landing/GlyphPortal";
import { closing } from "../../../models/content/landing";
import { hapticTick } from "../../../controllers/landing/haptics";
import { PortalField } from "./PortalField";
import { portalStyle, PORTAL_FONT } from "./portalTheme";

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
        scrollLength={2.2}
        interactive={false}
        enterLabel="Close the loop"
        className="portal font-display"
        style={portalStyle}
        onProgress={onProgress}
        background={<PortalField id="hex-close" tone="crimson" />}
        front={
          <p className="absolute inset-x-0 top-[16%] px-6 text-center font-serif text-xl italic text-paper/80 md:text-2xl">
            {closing.front}
          </p>
        }
      >
        <div className="mx-auto w-full max-w-5xl text-center">
          <h2 className="mx-auto max-w-[14ch] font-display text-[clamp(2.75rem,7vw,6.5rem)] font-semibold leading-[0.95] tracking-[-0.035em] text-paper">
            {closing.title}
          </h2>
          <p className="mx-auto mt-8 max-w-[48ch] font-serif text-lg leading-relaxed text-paper/85 md:text-xl">{closing.body}</p>
          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={closing.primary.href}
              className="rounded-full bg-paper px-8 py-4 font-display text-[15px] font-semibold text-ink transition-transform duration-300 ease-out-expo hover:scale-[1.04] active:scale-[0.98]"
            >
              {closing.primary.label}
            </a>
            <a
              href={closing.secondary.href}
              className="rounded-full border border-paper/40 px-8 py-4 font-display text-[15px] font-semibold text-paper transition-colors duration-300 hover:border-paper hover:bg-paper/10"
            >
              {closing.secondary.label}
            </a>
          </div>
        </div>
      </GlyphPortal>
    </div>
  );
}

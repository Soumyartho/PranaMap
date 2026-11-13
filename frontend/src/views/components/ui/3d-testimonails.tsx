import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Marquee from sean0205/3d-testimonails (21st.dev). */

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  className?: string;
  /** Reverse the animation direction. */
  reverse?: boolean;
  /** Pause the animation on hover. */
  pauseOnHover?: boolean;
  children: ReactNode;
  /** Animate vertically instead of horizontally. */
  vertical?: boolean;
  /** Number of times to repeat the content. */
  repeat?: number;
  ariaLabel?: string;
  ariaLive?: "off" | "polite" | "assertive";
  ariaRole?: string;
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ariaLabel,
  ariaLive = "off",
  ariaRole = "marquee",
  ...props
}: MarqueeProps) {
  const copies = useMemo(
    () =>
      Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 ? true : undefined}
          className={cn(
            "flex shrink-0 justify-around [gap:var(--gap)]",
            vertical ? "animate-marquee-vertical flex-col" : "animate-marquee flex-row",
            pauseOnHover && "group-hover:[animation-play-state:paused]",
            reverse && "[animation-direction:reverse]",
          )}
        >
          {children}
        </div>
      )),
    [repeat, children, vertical, pauseOnHover, reverse],
  );

  return (
    <div
      {...props}
      data-slot="marquee"
      className={cn(
        "group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]",
        vertical ? "flex-col" : "flex-row",
        className,
      )}
      aria-label={ariaLabel}
      aria-live={ariaLive}
      role={ariaRole}
    >
      {copies}
    </div>
  );
}

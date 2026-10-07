import { useEffect } from "react";
import Lenis from "lenis";

/** Inertial page scrolling. Drives native scroll, so sticky and scroll listeners keep working. */
export function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.1,
      anchors: true,
      autoRaf: true,
    });
    return () => lenis.destroy();
  }, []);
}

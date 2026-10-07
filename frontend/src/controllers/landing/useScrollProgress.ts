import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Calls onProgress (0–1) once per animation frame while scrolling, without React state.
 * "pin":  progress through a tall section whose child is sticky (0 = top hits viewport top).
 * "pass": progress from the element's top entering the viewport bottom to its bottom leaving the top.
 */
export function useScrollProgress<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onProgress: (progress: number) => void,
  mode: "pin" | "pass" = "pass",
) {
  const callback = useRef(onProgress);
  useLayoutEffect(() => {
    callback.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = mode === "pin" ? -rect.top / Math.max(1, rect.height - vh) : (vh - rect.top) / (vh + rect.height);
      callback.current(clamp(p));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ref, mode]);
}

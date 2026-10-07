import { useEffect, type RefObject } from "react";
import { hapticTick } from "./haptics";

const format = new Intl.NumberFormat("en-IN");

/** Counts the element's text from 0 to `value` once it scrolls into view. */
export function useCountUp(ref: RefObject<HTMLElement | null>, value: number, duration = 1600) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = format.format(value);
      return;
    }
    el.textContent = "0";
    let raf = 0;
    const run = () => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(2, -10 * t);
        el.textContent = format.format(Math.round(value * (t === 1 ? 1 : eased)));
        if (t < 1) raf = requestAnimationFrame(step);
        else hapticTick(6);
      };
      raf = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        run();
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, value, duration]);
}

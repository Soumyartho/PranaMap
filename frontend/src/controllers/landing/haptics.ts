/**
 * Light haptic ticks for scroll milestones. Android Chrome supports the Vibration API
 * after the first user gesture; everywhere else this is a silent no-op.
 */
let last = 0;

export function hapticTick(pattern: number | number[] = 8) {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const now = performance.now();
  if (now - last < 70) return;
  last = now;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* blocked until the user has interacted with the page */
  }
}

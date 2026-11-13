import { useEffect, useRef, type ReactNode } from "react";
import { m, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/i18n";
import { CloudOff, RefreshCw, Check, AlertCircle } from "lucide-react";
import { LANGUAGES, setLanguage, type AppLang } from "@/i18n";
import { data } from "@/controllers/asha/data";
import { syncNow, syncState } from "@/controllers/sync/engine";
import { session } from "@/controllers/auth/session";
import { cn } from "@/lib/cx";

/** Offline / syncing / synced, with the queue counter: "12 changes safe on this phone". */
export function SyncChip({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { online, phase } = syncState.use((s) => s);
  const queued = data.use((s) => s.queued);
  const needsSignIn = session.use((s) => s.needsSignIn);
  const state = !online ? "offline" : phase === "syncing" ? "syncing" : phase === "error" ? "error" : "synced";
  const Icon = { offline: CloudOff, syncing: RefreshCw, error: AlertCircle, synced: Check }[state];
  const color = { offline: "text-warn", syncing: "text-paper", error: "text-signal", synced: "text-ok" }[state];
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      data-testid="sync-chip"
      data-state={state}
      data-queued={queued}
      className="flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5 font-display text-xs font-semibold"
      aria-live="polite"
    >
      <Icon className={cn("h-4 w-4", color, state === "syncing" && "animate-spin")} />
      <span className={color}>{t(`sync.${state}`)}</span>
      {!compact && queued > 0 && <span className="text-paper/80">· {t("sync.queued", { count: queued })}</span>}
      {!compact && needsSignIn && <span className="text-signal">· {t("sync.sign_in_again")}</span>}
    </button>
  );
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  return (
    <label className={cn("relative", className)}>
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={i18n.language}
        onChange={(e) => setLanguage(e.target.value as AppLang)}
        className="appearance-none rounded-full border border-line bg-raised px-3 py-1.5 font-display text-xs font-semibold text-paper"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Ring that fills to `value` (0-1): screening coverage, loop closure. */
export function ProgressRing({ value, size = 96, stroke = 10, color = "var(--color-ok)", children }: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <m.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ type: "spring", stiffness: 70, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 32, color = "var(--color-warn)" }: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / Math.max(1, max - min)) * (height - 6);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={3} fill={color} />
    </svg>
  );
}

/** Animated number that counts up when it changes. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(2, -10 * t);
      el.textContent = (a + (value - a) * (t === 1 ? 1 : eased)).toFixed(decimals) + suffix;
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals, suffix]);
  return <span ref={ref}>{value.toFixed(decimals) + suffix}</span>;
}

/** Bottom sheet for quick tasks (add member, report illness, rescue a referral). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  // Escape closes it, as any modal dialog should (keyboard, switch access, TalkBack with a keyboard).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <m.div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <m.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="max-h-[88svh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-8"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            <h2 className="mb-4 font-display text-xl font-semibold">{title}</h2>
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, 3200);
    return () => clearTimeout(id);
  }, [message, onDone]);
  return (
    <AnimatePresence>
      {message && (
        <m.div
          role="status"
          className="fixed inset-x-4 bottom-24 z-[60] mx-auto max-w-md rounded-2xl border border-ok/40 bg-raised px-4 py-3 font-display text-sm text-paper shadow-2xl"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        >
          {message}
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-3xl border border-line bg-surface p-5", className)}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-mute">{children}</h2>
      {aside}
    </div>
  );
}

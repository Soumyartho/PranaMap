import { useState, type ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { m } from "framer-motion";
import { Check, Minus, Plus } from "lucide-react";
import { haptic } from "@/services/voice/speech";
import { Keypad } from "@/views/components/app/Keypad";
import { VoiceCapture } from "@/views/components/app/VoiceCapture";
import { DeviceInput } from "@/views/components/app/DeviceInput";
import { speak, type VoiceLang } from "@/services/voice/speech";
import { extractNumbers, parseBloodPressure } from "@/services/voice/numbers";
import { RANGES, plausible } from "@/controllers/screening/useScreening";
import { cn } from "@/lib/cx";

/** Big tappable answer cards. One tap answers and moves on. */
export function Options<T extends string | boolean>({ options, value, onPick }: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T | undefined;
  onPick: (v: T) => void;
}) {
  return (
    <div className="grid gap-3">
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <m.button
            key={String(o.value)}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => {
              haptic(10);
              onPick(o.value);
            }}
            aria-pressed={on}
            className={cn(
              "flex min-h-16 items-center gap-4 rounded-2xl border px-5 py-4 text-left font-display text-lg font-semibold transition-colors",
              on ? "border-crimson bg-crimson/25" : "border-line bg-surface active:bg-raised",
            )}
          >
            {o.icon && <span className="text-2xl" aria-hidden="true">{o.icon}</span>}
            <span className="flex-1">{o.label}</span>
            {on && <Check className="h-5 w-5 text-paper" />}
          </m.button>
        );
      })}
    </div>
  );
}

export function YesNo({ value, onPick }: { value: boolean | undefined; onPick: (v: boolean) => void }) {
  const { t } = useTranslation();
  return <Options options={[{ value: true, label: t("common.yes"), icon: "✓" }, { value: false, label: t("common.no"), icon: "✕" }]} value={value} onPick={onPick} />;
}

/** One number: keypad always, voice when there is network, read-back before it counts. */
export function NumberStep({ field, label, unit, initial, decimals, onDone, onSkip, children, device }: {
  field: keyof typeof RANGES;
  label: string;
  unit: string;
  initial?: number;
  decimals?: boolean;
  onDone: (v: number) => void;
  onSkip?: () => void;
  children?: ReactNode;
  /** Offer Bluetooth/camera input for this measurement. */
  device?: "spo2" | "number";
}) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState(initial !== undefined ? String(initial) : "");
  const [error, setError] = useState<string | null>(null);
  const n = Number(value);
  const check = (v: number) => (plausible(field, v) ? null : t("screen.implausible", { value: v }));

  function done(v = n) {
    const problem = check(v);
    if (problem) {
      setError(problem);
      haptic([20, 40, 20]);
      return;
    }
    onDone(v);
  }

  return (
    <div className="flex flex-col gap-4">
      {children}
      <div className="flex items-baseline justify-center gap-2 py-2">
        <span className="font-display text-6xl font-semibold tabular-nums">{value || "—"}</span>
        <span className="font-display text-xl text-mute">{unit}</span>
      </div>
      <p className="min-h-5 text-center font-display text-sm text-warn" role="alert">{error}</p>
      <VoiceCapture<number>
        label={label}
        parse={(heard) => extractNumbers(heard)[0] ?? null}
        describe={(v) => `${v} ${unit}`}
        validate={check}
        onValue={(v) => {
          setValue(String(v));
          setError(null);
          done(v);
        }}
      />
      {device && (
        <DeviceInput
          kind={device}
          onReading={([v]) => {
            setValue(String(v));
            setError(check(v));
            // Fill, then read back: the ASHA confirms with Next, never silently.
            void speak(t("screen.read_back", { label, value: `${v} ${unit}` }), i18n.language as VoiceLang);
          }}
        />
      )}
      <Keypad value={value} onChange={(v) => { setValue(v); setError(null); }} decimals={decimals} />
      <div className={cn("grid gap-3", onSkip ? "grid-cols-2" : "grid-cols-1")}>
        {onSkip && <button type="button" onClick={onSkip} className="h-14 rounded-2xl border border-line font-display font-semibold text-paper/80">{t("common.skip")}</button>}
        <button type="button" disabled={!value} onClick={() => done()} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold disabled:opacity-40">{t("common.next")}</button>
      </div>
    </div>
  );
}

/** Blood pressure: two numbers, or one sentence ("150 over 95"). */
export function BpStep({ label, initial, onDone, onSkip }: {
  label: string;
  initial?: [number, number];
  onDone: (r: [number, number]) => void;
  onSkip: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [sys, setSys] = useState(initial ? String(initial[0]) : "");
  const [dia, setDia] = useState(initial ? String(initial[1]) : "");
  const [active, setActive] = useState<"sys" | "dia">("sys");
  const [error, setError] = useState<string | null>(null);

  const check = ([s, d]: [number, number]) => {
    if (!plausible("sbp", s)) return t("screen.implausible", { value: s });
    if (!plausible("dbp", d) || d >= s) return t("screen.implausible", { value: d });
    return null;
  };
  function done(r: [number, number] = [Number(sys), Number(dia)]) {
    const problem = check(r);
    if (problem) {
      setError(problem);
      haptic([20, 40, 20]);
      return;
    }
    onDone(r);
  }

  const box = (which: "sys" | "dia", v: string) => (
    <button type="button" onClick={() => setActive(which)}
      className={cn("flex flex-1 flex-col items-center rounded-2xl border py-3", active === which ? "border-crimson bg-crimson/15" : "border-line bg-surface")}>
      <span className="font-display text-xs text-mute">{t(`screen.${which}`)}</span>
      <span className="font-display text-5xl font-semibold tabular-nums">{v || "—"}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {box("sys", sys)}
        <span className="font-display text-3xl text-mute">/</span>
        {box("dia", dia)}
      </div>
      <p className="min-h-5 text-center font-display text-sm text-warn" role="alert">{error}</p>
      <VoiceCapture<[number, number]>
        label={label}
        parse={parseBloodPressure}
        describe={([s, d]) => `${s} / ${d}`}
        validate={check}
        onValue={(r) => {
          setSys(String(r[0]));
          setDia(String(r[1]));
          done(r);
        }}
      />
      <DeviceInput
        kind="bp"
        onReading={([s, d]) => {
          setSys(String(s));
          setDia(String(d));
          setError(check([s, d]));
          void speak(t("screen.read_back", { label, value: `${s} / ${d}` }), i18n.language as VoiceLang);
        }}
      />
      <Keypad
        value={active === "sys" ? sys : dia}
        maxLength={3}
        onChange={(v) => {
          setError(null);
          if (active === "sys") {
            setSys(v);
            if (v.length === 3) setActive("dia");
          } else setDia(v);
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onSkip} className="h-14 rounded-2xl border border-line font-display font-semibold text-paper/80">{t("common.skip")}</button>
        <button type="button" disabled={!sys || !dia} onClick={() => done()} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold disabled:opacity-40">{t("common.next")}</button>
      </div>
    </div>
  );
}

/** Icon chips for symptoms and danger signs: tap to toggle, no reading needed. */
export function SymptomGrid({ codes, selected, onToggle, danger }: {
  codes: string[];
  selected: string[];
  onToggle: (code: string) => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {codes.map((c) => {
        const on = selected.includes(c);
        return (
          <button key={c} type="button" aria-pressed={on} onClick={() => { haptic(on ? 6 : 12); onToggle(c); }}
            className={cn(
              "flex min-h-16 items-center gap-2 rounded-2xl border px-3 py-3 text-left font-display text-[15px] font-semibold leading-tight transition-colors",
              on ? (danger ? "border-signal bg-signal/25" : "border-warn bg-warn/15") : "border-line bg-surface",
            )}>
            <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", on ? "border-transparent bg-paper text-ink" : "border-line")}>
              {on && <Check className="h-4 w-4" />}
            </span>
            {t(`symptoms.${c}`)}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="flex items-center justify-center gap-6">
      <button type="button" aria-label="-" onClick={() => onChange(Math.max(min, value - 1))} className="grid h-14 w-14 place-items-center rounded-full border border-line"><Minus className="h-6 w-6" /></button>
      <span className="w-24 text-center font-display text-5xl font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label="+" onClick={() => onChange(Math.min(max, value + 1))} className="grid h-14 w-14 place-items-center rounded-full bg-crimson"><Plus className="h-6 w-6" /></button>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { Mic, Square } from "lucide-react";
import { haptic, micLevel, speak, stopSpeaking, type VoiceLang } from "@/services/voice/speech";
import { chooseEngine, hear } from "@/services/voice/engine";
import { cn } from "@/lib/cx";

interface Props<T> {
  /** Turn what was heard into a value, or null if it made no sense. */
  parse: (heard: string) => T | null;
  /** Spoken back for confirmation, e.g. "150 over 95". */
  describe: (value: T) => string;
  label: string;
  onValue: (value: T) => void;
  validate?: (value: T) => string | null;
}

/**
 * Mic orb with a live waveform. Constrained listening (numbers only), then a spoken read-back the
 * ASHA must confirm with a tap: a mis-heard "150" never slips in as "115".
 */
export function VoiceCapture<T>({ parse, describe, label, onValue, validate }: Props<T>) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as VoiceLang;
  const [phase, setPhase] = useState<"idle" | "listening" | "processing" | "confirm" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [heard, setHeard] = useState<T | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stopMic = useRef<(() => void) | null>(null);
  const stopRec = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    stopMic.current?.();
    stopRec.current?.();
    stopSpeaking();
  }, []);

  async function start() {
    const engine = await chooseEngine(lang);
    if (!engine) {
      setPhase("error");
      setMessage(t("screen.voice_unavailable"));
      return;
    }
    setPhase("listening");
    setMessage(null);
    haptic(10);
    const ctrl = new AbortController();
    stopRec.current = () => ctrl.abort();
    // The browser recogniser owns the mic itself; draw its waveform from a parallel level meter.
    if (engine === "browser") {
      try {
        stopMic.current = await micLevel((_, wave) => draw(wave));
      } catch {
        stopMic.current = null;
      }
    }
    try {
      const heard = await hear(lang, { signal: ctrl.signal, onLevel: (_, wave) => draw(wave), onProcessing: () => setPhase("processing") });
      const value = heard.alternatives.map(parse).find((v) => v !== null) ?? null;
      if (value === null) throw new Error("not-understood");
      const problem = validate?.(value);
      if (problem) {
        setPhase("error");
        setMessage(problem);
        return;
      }
      setHeard(value);
      setPhase("confirm");
      haptic([8, 30, 8]);
      void speak(t("screen.read_back", { label, value: describe(value) }), lang);
    } catch (err) {
      setPhase("error");
      const m = (err as Error).message;
      setMessage(m === "network" ? t("screen.voice_offline") : m === "model_not_downloaded" ? t("screen.voice_unavailable") : t("screen.not_understood"));
    } finally {
      stopMic.current?.();
      stopMic.current = null;
    }
  }

  function draw(wave: Uint8Array) {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#f4efe9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    wave.forEach((v, i) => {
      const x = (i / (wave.length - 1)) * c.width;
      const y = (v / 255) * c.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (phase === "confirm" && heard !== null) {
    return (
      <div className="rounded-2xl border border-line bg-raised p-4">
        <p className="font-display text-sm text-mute">{t("screen.heard")}</p>
        <p className="mt-1 font-display text-3xl font-semibold text-paper">{describe(heard)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setPhase("idle")} className="h-12 rounded-xl border border-line font-display font-semibold text-paper">
            {t("common.retry")}
          </button>
          <button
            type="button"
            onClick={() => {
              onValue(heard);
              setPhase("idle");
              haptic(14);
            }}
            className="h-12 rounded-xl bg-ok font-display font-semibold text-ink"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={phase === "listening" ? () => stopRec.current?.() : start}
        disabled={phase === "processing"}
        aria-label={phase === "listening" ? t("screen.listening") : t("screen.tap_speak")}
        className={cn(
          "relative grid h-20 w-20 place-items-center rounded-full transition-transform active:scale-95",
          phase === "listening" ? "bg-signal pulse-emergency" : phase === "processing" ? "animate-pulse bg-blood" : "bg-crimson",
        )}
      >
        {phase === "listening" ? <Square className="h-7 w-7 text-paper" /> : <Mic className="h-8 w-8 text-paper" />}
      </button>
      <canvas ref={canvas} width={200} height={36} className={cn("h-9 w-48", phase !== "listening" && "opacity-0")} aria-hidden="true" />
      <p className={cn("min-h-5 text-center font-display text-sm", phase === "error" ? "text-warn" : "text-mute")}>
        {phase === "listening" ? t("screen.listening") : phase === "processing" ? t("screen.processing") : (message ?? t("screen.tap_speak"))}
      </p>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { Mic, Send, Square } from "lucide-react";
import { enqueue } from "@/controllers/asha/data";
import type { Referral } from "@/models/types/domain";
import { Sheet } from "@/views/components/app/bits";
import { uuidv7 } from "@/utils/id";
import { cn } from "@/lib/cx";

const MAX_MS = 60_000;

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Store-and-forward consult: when a call cannot hold, the ASHA records what she sees and hears
 * (up to a minute). The note is sealed in the outbox like every other change and reaches the
 * doctor's pre-consult packet on the next sync.
 */
export function VoiceNoteSheet({ referral, onClose, onQueued }: { referral: Referral | null; onClose: () => void; onQueued: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "recording" | "recorded">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= MAX_MS) rec.current?.stop();
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  function reset() {
    rec.current?.state === "recording" && rec.current.stop();
    setState("idle");
    setBlob(null);
    setElapsed(0);
    setUrl(null);
  }

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    // Opus at a low bitrate: a minute of speech is about 120 KB.
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const r = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: 16_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      const b = new Blob(chunks, { type: r.mimeType });
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      setState("recorded");
    };
    rec.current = r;
    started.current = Date.now();
    r.start();
    setState("recording");
  }

  async function send() {
    if (!blob || !referral) return;
    await enqueue(
      "referral.voice_note",
      { id: uuidv7(), referral_id: referral.id, mime: blob.type || "audio/webm", duration_ms: Math.min(elapsed, MAX_MS), data_base64: await toBase64(blob) },
      referral.id,
    );
    reset();
    onQueued();
  }

  const secs = Math.floor(elapsed / 1000);
  return (
    <Sheet open={referral !== null} onClose={() => { reset(); onClose(); }} title={t("referral.voice_note")}>
      <p className="font-serif text-[15px] text-paper/80">{t("referral.voice_note_hint")}</p>
      <div className="mt-5 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={state === "recording" ? () => rec.current?.stop() : start}
          disabled={state === "recorded"}
          aria-label={state === "recording" ? t("referral.stop") : t("referral.record")}
          className={cn("grid h-20 w-20 place-items-center rounded-full", state === "recording" ? "bg-signal pulse-emergency" : "bg-crimson", state === "recorded" && "opacity-30")}
        >
          {state === "recording" ? <Square className="h-7 w-7" /> : <Mic className="h-8 w-8" />}
        </button>
        <p className="font-display text-2xl tabular-nums">{String(Math.floor(secs / 60)).padStart(1, "0")}:{String(secs % 60).padStart(2, "0")} <span className="text-sm text-mute">/ 1:00</span></p>
        {url && <audio controls src={url} className="w-full" />}
      </div>
      {state === "recorded" && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={reset} className="h-12 rounded-xl border border-line font-display font-semibold">{t("common.retry")}</button>
          <button type="button" onClick={send} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-crimson font-display font-semibold">
            <Send className="h-4 w-4" /> {t("referral.send_note")}
          </button>
        </div>
      )}
    </Sheet>
  );
}

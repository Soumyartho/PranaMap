/**
 * Which recogniser hears this answer.
 *
 * 1. On-device model, if downloaded: works with no signal, and the audio never leaves the phone.
 * 2. Bhashini via our server, when online and configured: strongest Indic accuracy.
 * 3. The browser's recogniser, when online.
 * Otherwise voice is unavailable and the keypad is the path. Every result is read back and
 * confirmed by the ASHA before it counts, whichever engine produced it.
 */
import { api } from "@/services/api/client";
import { canListen, listen, type VoiceLang } from "./speech";
import { isReady, transcribe } from "./offline";
import { encodeWav, recordUtterance, type RecordOptions } from "./recorder";

export type Engine = "offline" | "bhashini" | "browser";

let bhashini: { available: boolean; checkedAt: number } = { available: false, checkedAt: 0 };

async function bhashiniAvailable(): Promise<boolean> {
  if (!navigator.onLine) return false;
  if (Date.now() - bhashini.checkedAt < 10 * 60_000) return bhashini.available;
  try {
    const r = await api<{ bhashini: boolean }>("/voice/status", { timeoutMs: 4000 });
    bhashini = { available: r.bhashini, checkedAt: Date.now() };
  } catch {
    bhashini = { available: false, checkedAt: Date.now() };
  }
  return bhashini.available;
}

export async function chooseEngine(lang: VoiceLang): Promise<Engine | null> {
  if (isReady(lang)) return "offline";
  if (await bhashiniAvailable()) return "bhashini";
  if (navigator.onLine && canListen()) return "browser";
  return null;
}

export interface Heard {
  engine: Engine;
  alternatives: string[];
  ms?: number;
}

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Listen once and return what was heard. `onListening` fires when the mic is live. */
export async function hear(lang: VoiceLang, opts: RecordOptions & { onProcessing?: () => void } = {}): Promise<Heard> {
  const engine = await chooseEngine(lang);
  if (!engine) throw new Error("no_engine");
  if (engine === "browser") {
    const session = listen(lang);
    opts.signal?.addEventListener("abort", () => session.stop());
    return { engine, alternatives: await session.result };
  }
  const rec = await recordUtterance(opts);
  opts.onProcessing?.();
  if (engine === "offline") {
    const { text, ms } = await transcribe(lang, rec.pcm);
    return { engine, alternatives: text ? [text] : [], ms };
  }
  const r = await api<{ text: string }>("/voice/transcribe", {
    method: "POST",
    json: { lang, sample_rate: 16000, audio_base64: toBase64(encodeWav(rec.pcm)) },
    timeoutMs: 20_000,
  });
  return { engine, alternatives: r.text ? [r.text] : [] };
}

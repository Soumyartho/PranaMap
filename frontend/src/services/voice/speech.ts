/**
 * Speaking and listening. Prompts use the phone's speech synthesiser (on-device voices work
 * offline on most Android phones). Listening uses the browser recogniser, which needs a network
 * on Chrome; offline, the big keypad is always there. Bhashini/Sarvam plug in behind `listen`.
 */

export type VoiceLang = "en" | "hi" | "bn";
const LOCALE: Record<VoiceLang, string> = { en: "en-IN", hi: "hi-IN", bn: "bn-IN" };

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

function pickVoice(lang: VoiceLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const locale = LOCALE[lang];
  return voices.find((v) => v.lang === locale) ?? voices.find((v) => v.lang.startsWith(locale.slice(0, 2)));
}

/** True when the phone has a voice for this language; otherwise prompts are shown, not spoken. */
export const hasVoiceFor = (lang: VoiceLang) => canSpeak() && Boolean(pickVoice(lang));

export function speak(text: string, lang: VoiceLang, rate = 0.95): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALE[lang];
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

// ------------------------------------------------------------------ listening

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => typeof window !== "undefined" && recognitionCtor() !== null;

export interface Listening {
  /** All alternatives the recogniser heard, best first. */
  result: Promise<string[]>;
  stop(): void;
}

export function listen(lang: VoiceLang): Listening {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject(new Error("unsupported")), stop: () => {} };
  const rec = new Ctor();
  rec.lang = LOCALE[lang];
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  const result = new Promise<string[]>((resolve, reject) => {
    let done = false;
    rec.onresult = (e) => {
      done = true;
      const first = e.results[0];
      resolve(Array.from({ length: first.length }, (_, i) => first[i].transcript));
    };
    rec.onerror = (e) => {
      done = true;
      reject(new Error(e.error === "network" ? "network" : e.error));
    };
    rec.onend = () => {
      if (!done) reject(new Error("no-speech"));
    };
  });
  rec.start();
  return { result, stop: () => rec.stop() };
}

/** Microphone level 0-1 for the listening orb's waveform; returns a stop function. */
export async function micLevel(onLevel: (level: number, wave: Uint8Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const wave = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(wave);
    let sum = 0;
    for (const v of wave) sum += ((v - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(sum / wave.length) * 4), wave);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

export function haptic(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed yet */
  }
}

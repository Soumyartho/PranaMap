/// <reference lib="webworker" />
/**
 * On-device speech recognition, off the main thread so the screening UI never stutters.
 *
 * IndicConformer (hi, bn): waveform → nemo80 log-mel graph → Conformer-CTC → greedy CTC decode.
 * The decode mirrors onnx-asr: argmax per frame, drop the blank token, collapse repeats, "▁" → space.
 * Whisper (en): transformers.js pipeline.
 */
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { ASR_CACHE, CATALOG, NEMO80_URL, type OfflineLang } from "@/services/voice/catalog";

declare const self: DedicatedWorkerGlobalScope;

// Single-threaded WASM: no cross-origin isolation needed, and predictable on 2 GB phones.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = 1;

interface Conformer {
  pre: ort.InferenceSession;
  model: ort.InferenceSession;
  vocab: string[];
  blank: number;
}
type WhisperPipe = (audio: Float32Array, opts: object) => Promise<{ text: string } | { text: string }[]>;

const conformers = new Map<OfflineLang, Conformer>();
let whisper: WhisperPipe | null = null;

export type AsrRequest =
  | { id: number; type: "load"; lang: OfflineLang }
  | { id: number; type: "transcribe"; lang: OfflineLang; audio: Float32Array };
export type AsrResponse =
  | { id: number; ok: true; text?: string; ms?: number }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number };

async function cachedBytes(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open(ASR_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  // The feature graph ships with the app; model weights must already be downloaded.
  if (url === NEMO80_URL) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    await cache.put(url, res.clone());
    return res.arrayBuffer();
  }
  throw new Error("model_not_downloaded");
}

async function loadConformer(lang: OfflineLang): Promise<Conformer> {
  const existing = conformers.get(lang);
  if (existing) return existing;
  const spec = CATALOG[lang];
  const file = (key: string) => spec.files.find((f) => f.key === key)!.url;
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  const [pre, model, vocabText] = await Promise.all([
    cachedBytes(NEMO80_URL).then((b) => ort.InferenceSession.create(new Uint8Array(b), opts)),
    cachedBytes(file("model")).then((b) => ort.InferenceSession.create(new Uint8Array(b), opts)),
    cachedBytes(file("vocab")).then((b) => new TextDecoder().decode(b)),
  ]);
  // vocab.txt: "<token> <id>" per line; "<blk>" is the CTC blank.
  const vocab: string[] = [];
  let blank = -1;
  for (const line of vocabText.split("\n")) {
    if (!line.trim()) continue;
    const sp = line.lastIndexOf(" ");
    const token = line.slice(0, sp);
    const id = Number(line.slice(sp + 1));
    vocab[id] = token.replaceAll("▁", " ");
    if (token === "<blk>") blank = id;
  }
  if (blank < 0) blank = vocab.length;
  const c = { pre, model, vocab, blank };
  conformers.set(lang, c);
  return c;
}

export function ctcGreedy(logprobs: Float32Array, frames: number, vocabSize: number, blank: number): number[] {
  const out: number[] = [];
  let prev = blank;
  for (let t = 0; t < frames; t++) {
    let best = 0;
    let bestVal = -Infinity;
    const row = t * vocabSize;
    for (let v = 0; v < vocabSize; v++) {
      const x = logprobs[row + v];
      if (x > bestVal) {
        bestVal = x;
        best = v;
      }
    }
    if (best !== blank && best !== prev) out.push(best);
    prev = best;
  }
  return out;
}

async function transcribeConformer(lang: OfflineLang, audio: Float32Array): Promise<string> {
  const c = await loadConformer(lang);
  const waveforms = new ort.Tensor("float32", audio, [1, audio.length]);
  const waveformsLens = new ort.Tensor("int64", BigInt64Array.from([BigInt(audio.length)]), [1]);
  const pre = await c.pre.run({ waveforms, waveforms_lens: waveformsLens });
  const features = pre.features;
  const featuresLens = pre.features_lens;
  const out = await c.model.run({ audio_signal: features, length: featuresLens });
  const logprobs = out.logprobs;
  const [, timeSteps, vocabSize] = logprobs.dims as number[];
  const encLen = Math.min(timeSteps, Math.floor((Number((featuresLens.data as BigInt64Array)[0]) - 1) / 4) + 1);
  const ids = ctcGreedy(logprobs.data as Float32Array, encLen, vocabSize, c.blank);
  return ids
    .map((i) => c.vocab[i] ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadWhisper(onProgress?: (p: number) => void): Promise<WhisperPipe> {
  if (whisper) return whisper;
  // Lazy: only an English-speaking user ever downloads transformers.js and Whisper.
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // transformers.js bundles its own ONNX Runtime build (asyncify); leave its WASM paths alone.
  const onnxEnv = env.backends.onnx as { wasm?: { numThreads?: number } };
  if (onnxEnv.wasm) onnxEnv.wasm.numThreads = 1;
  const files = new Map<string, number>();
  whisper = (await pipeline("automatic-speech-recognition", CATALOG.en.whisperId!, {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    device: "wasm",
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === "progress" && p.file) {
        files.set(p.file, p.progress ?? 0);
        const all = [...files.values()];
        onProgress?.(all.reduce((s, v) => s + v, 0) / Math.max(all.length, 1) / 100);
      }
    },
  })) as unknown as WhisperPipe;
  return whisper;
}

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const msg = e.data;
  const reply = (r: AsrResponse) => self.postMessage(r);
  try {
    const spec = CATALOG[msg.lang];
    if (msg.type === "load") {
      if (spec.engine === "whisper") await loadWhisper((p) => reply({ id: msg.id, progress: p }));
      else await loadConformer(msg.lang);
      reply({ id: msg.id, ok: true });
      return;
    }
    const t0 = performance.now();
    let text: string;
    if (spec.engine === "whisper") {
      const pipe = await loadWhisper();
      const r = await pipe(msg.audio, { language: "english", task: "transcribe" });
      text = (Array.isArray(r) ? r[0].text : r.text).trim();
    } else {
      text = await transcribeConformer(msg.lang, msg.audio);
    }
    reply({ id: msg.id, ok: true, text, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

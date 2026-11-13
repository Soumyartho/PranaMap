/**
 * Offline speech models on the phone: download with progress, check, delete, transcribe.
 * IndicConformer files are streamed into Cache Storage by this module; Whisper is downloaded by
 * transformers.js inside the worker. "Ready" is only marked after a model has loaded once.
 */
import { createStore } from "@/controllers/store";
import { ASR_CACHE, CATALOG, NEMO80_URL, readyMarker, type OfflineLang } from "./catalog";
import type { AsrRequest, AsrResponse } from "@/workers/asr.worker";

export type ModelState = { status: "absent" | "downloading" | "ready" | "error"; progress: number; error?: string };

export const offlineVoice = createStore({
  hi: { status: "absent", progress: 0 } as ModelState,
  bn: { status: "absent", progress: 0 } as ModelState,
  en: { status: "absent", progress: 0 } as ModelState,
});

type Done = Extract<AsrResponse, { ok: true }>;
// Distributes over the union, so each request variant keeps its own fields.
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: Done) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../../workers/asr.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<AsrResponse>) => {
    const r = e.data;
    const p = pending.get(r.id);
    if (!p) return;
    if ("progress" in r) {
      p.progress?.(r.progress);
      return;
    }
    pending.delete(r.id);
    if (r.ok) p.resolve(r as Done);
    else p.reject(new Error(r.error));
  };
  return worker;
}

function call(req: WithoutId<AsrRequest>, progress?: (p: number) => void, transfer: Transferable[] = []) {
  const id = nextId++;
  return new Promise<Done>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    getWorker().postMessage({ ...req, id } as AsrRequest, transfer);
  });
}

const supported = () => typeof caches !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";

export async function refreshStatus(): Promise<void> {
  if (!supported()) return;
  const cache = await caches.open(ASR_CACHE);
  for (const lang of Object.keys(CATALOG) as OfflineLang[]) {
    const ready = Boolean(await cache.match(readyMarker(lang)));
    const current = offlineVoice.get()[lang];
    if (current.status !== "downloading") offlineVoice.set({ [lang]: { status: ready ? "ready" : "absent", progress: ready ? 1 : 0 } });
  }
}

export const isReady = (lang: string) => (offlineVoice.get() as Record<string, ModelState>)[lang]?.status === "ready";

/** Stream a file into the cache, reporting bytes as they arrive. */
async function fetchInto(cache: Cache, url: string, onBytes: (n: number, total: number) => void) {
  if (await cache.match(url)) return;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(received, total);
  }
  await cache.put(url, new Response(new Blob(chunks as BlobPart[]), { headers: { "content-type": "application/octet-stream" } }));
}

export async function download(lang: OfflineLang): Promise<void> {
  const spec = CATALOG[lang];
  const set = (s: ModelState) => offlineVoice.set({ [lang]: s });
  set({ status: "downloading", progress: 0 });
  try {
    const cache = await caches.open(ASR_CACHE);
    if (spec.engine === "indicconformer") {
      await fetchInto(cache, NEMO80_URL, () => {});
      const expected = spec.sizeMb * 1_000_000;
      for (const f of spec.files) {
        await fetchInto(cache, f.url, (n, total) => {
          if (f.key === "model") set({ status: "downloading", progress: Math.min(0.97, n / (total || expected)) });
        });
      }
      await call({ type: "load", lang });
    } else {
      await call({ type: "load", lang }, (p) => set({ status: "downloading", progress: Math.min(0.97, p) }));
    }
    // Warm-up on a short silence: proves the model runs and caches the runtime's WASM.
    await call({ type: "transcribe", lang, audio: new Float32Array(16000) });
    await cache.put(readyMarker(lang), new Response("ok"));
    set({ status: "ready", progress: 1 });
  } catch (err) {
    set({ status: "error", progress: 0, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function remove(lang: OfflineLang): Promise<void> {
  const cache = await caches.open(ASR_CACHE);
  await cache.delete(readyMarker(lang));
  for (const f of CATALOG[lang].files) await cache.delete(f.url);
  if (CATALOG[lang].engine === "whisper") {
    // transformers.js keeps Whisper in its own cache.
    const tf = await caches.open("transformers-cache");
    for (const req of await tf.keys()) if (req.url.includes(CATALOG.en.whisperId!)) await tf.delete(req);
  }
  offlineVoice.set({ [lang]: { status: "absent", progress: 0 } });
}

export async function transcribe(lang: OfflineLang, audio: Float32Array): Promise<{ text: string; ms: number }> {
  const copy = audio.slice();
  const r = await call({ type: "transcribe", lang, audio: copy }, undefined, [copy.buffer]);
  return { text: r.text ?? "", ms: r.ms ?? 0 };
}

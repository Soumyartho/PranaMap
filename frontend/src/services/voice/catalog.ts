/**
 * On-device speech models. Downloaded once (ideally over PHC Wi-Fi), kept in Cache Storage,
 * then voice works with no network and the audio never leaves the phone.
 *
 * Hindi and Bengali: AI4Bharat IndicConformer (NeMo Conformer-CTC, int8), MIT licence, via the
 *   OpenVoiceOS ONNX export. Feature extraction uses the nemo80 graph from onnx-asr (MIT), shipped
 *   in /models/asr, so the phone computes exactly what the reference implementation does.
 * English: Whisper base (q8) through transformers.js.
 */

export type OfflineLang = "hi" | "bn" | "en";

export interface ModelSpec {
  lang: OfflineLang;
  engine: "indicconformer" | "whisper";
  name: string;
  sizeMb: number;
  licence: string;
  /** Files this app fetches and caches itself (IndicConformer). Whisper is cached by transformers.js. */
  files: { key: "model" | "vocab"; url: string }[];
  whisperId?: string;
}

const HF = "https://huggingface.co";
const conformer = (lang: "hi" | "bn", name: string): ModelSpec => ({
  lang,
  engine: "indicconformer",
  name,
  sizeMb: 138,
  licence: "MIT (AI4Bharat IndicConformer; OpenVoiceOS ONNX export)",
  files: [
    { key: "model", url: `${HF}/OpenVoiceOS/ai4bharat-indicconformer-${lang}-onnx/resolve/main/model.int8.onnx` },
    { key: "vocab", url: `${HF}/OpenVoiceOS/ai4bharat-indicconformer-${lang}-onnx/resolve/main/vocab.txt` },
  ],
});

export const CATALOG: Record<OfflineLang, ModelSpec> = {
  hi: conformer("hi", "IndicConformer Hindi"),
  bn: conformer("bn", "IndicConformer Bengali"),
  en: {
    lang: "en",
    engine: "whisper",
    name: "Whisper base",
    sizeMb: 77,
    licence: "MIT (OpenAI Whisper; onnx-community export)",
    files: [],
    whisperId: "onnx-community/whisper-base",
  },
};

/** Shipped with the app (89 KB): log-mel feature extraction for NeMo models. */
export const NEMO80_URL = "/models/asr/nemo80.onnx";
export const ASR_CACHE = "pranamap-asr-v1";
/** Marker written once a model has loaded successfully, so "ready" means "proven to work". */
export const readyMarker = (lang: OfflineLang) => `/__pranamap/asr-ready/${lang}`;

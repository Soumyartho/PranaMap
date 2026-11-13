/**
 * Record one spoken answer and return it as 16 kHz mono PCM, the format every recogniser here
 * wants. Recording stops by itself after the speaker goes quiet, so the ASHA taps once, speaks,
 * and waits.
 */

export interface Recording {
  pcm: Float32Array;
  sampleRate: 16000;
  durationMs: number;
}

export interface RecordOptions {
  maxMs?: number;
  /** Silence after speech that ends the recording. */
  silenceMs?: number;
  onLevel?: (level: number, wave: Uint8Array) => void;
  signal?: AbortSignal;
}

const SPEECH_LEVEL = 0.06;

export async function recordUtterance({ maxMs = 7000, silenceMs = 1100, onLevel, signal }: RecordOptions = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const wave = new Uint8Array(analyser.fftSize);
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const started = performance.now();
  let heardSpeech = false;
  let quietSince = 0;
  let raf = 0;

  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  const stop = () => recorder.state !== "inactive" && recorder.stop();
  signal?.addEventListener("abort", stop);

  const tick = () => {
    analyser.getByteTimeDomainData(wave);
    let sum = 0;
    for (const v of wave) sum += ((v - 128) / 128) ** 2;
    const level = Math.min(1, Math.sqrt(sum / wave.length) * 4);
    onLevel?.(level, wave);
    const now = performance.now();
    if (level > SPEECH_LEVEL) {
      heardSpeech = true;
      quietSince = 0;
    } else if (heardSpeech) {
      quietSince ||= now;
      if (now - quietSince > silenceMs) return stop();
    }
    if (now - started > maxMs) return stop();
    raf = requestAnimationFrame(tick);
  };
  recorder.start();
  tick();
  await stopped;
  cancelAnimationFrame(raf);
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close();

  const blob = new Blob(chunks, { type: recorder.mimeType });
  const pcm = await to16kMono(await blob.arrayBuffer());
  return { pcm, sampleRate: 16000, durationMs: Math.round(performance.now() - started) };
}

/** Decode any browser-recorded audio and resample to 16 kHz mono. */
export async function to16kMono(encoded: ArrayBuffer): Promise<Float32Array> {
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(encoded);
  await decodeCtx.close();
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, frames, 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

/** 16-bit PCM WAV, for recognisers that take a file (Bhashini). */
export function encodeWav(pcm: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

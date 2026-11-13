/**
 * Read numbers off a seven-segment display (BP monitors, glucometers, thermometers) from a photo.
 * Dependency-free and offline. The ASHA frames the digits; every result is read back to confirm.
 *
 * 1. Luminance → Otsu threshold. Ink is the minority class, so dark-on-light LCDs and
 *    light-on-dark LEDs both work.
 * 2. Rows of text by horizontal projection (BP monitors stack SYS / DIA / pulse).
 * 3. Digits in each row by vertical projection, bridging the small gaps between segments.
 * 4. Each digit: sample the seven segment zones, look the on/off pattern up. A narrow tall blob is "1".
 */

export interface Gray {
  width: number;
  height: number;
  /** 0-255 luminance, row-major. */
  data: Uint8Array;
}

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return { width, height, data };
}

export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** 1 = ink. Polarity chosen so ink is the minority. */
export function binarize(g: Gray): Uint8Array {
  const t = otsu(g);
  const dark = new Uint8Array(g.data.length);
  let darkCount = 0;
  for (let i = 0; i < g.data.length; i++) {
    dark[i] = g.data[i] <= t ? 1 : 0;
    darkCount += dark[i];
  }
  if (darkCount <= g.data.length / 2) return dark;
  for (let i = 0; i < dark.length; i++) dark[i] = dark[i] ? 0 : 1;
  return dark;
}

interface Span {
  start: number;
  end: number; // exclusive
}

/** Runs of indexes whose profile exceeds `min`, merging runs separated by gaps shorter than `bridge`. */
function runs(profile: number[], min: number, bridge: number): Span[] {
  const out: Span[] = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > min;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ start, end: i });
      start = -1;
    }
  }
  const merged: Span[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < bridge) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

// Segment order: a b c d e f g  (top, top-right, bottom-right, bottom, bottom-left, top-left, middle).
const PATTERNS: Record<string, string> = {
  "1111110": "0",
  "0110000": "1",
  "1101101": "2",
  "1111001": "3",
  "0110011": "4",
  "1011011": "5",
  "1011111": "6",
  "0011111": "6", // 6 without its top bar on some displays
  "1110000": "7",
  "1110010": "7", // 7 with the top-left serif
  "1111111": "8",
  "1111011": "9",
  "1110011": "9", // 9 without its bottom bar
};

function inkFraction(ink: Uint8Array, width: number, x0: number, x1: number, y0: number, y1: number): number {
  let on = 0;
  let n = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      on += ink[y * width + x];
      n++;
    }
  }
  return n ? on / n : 0;
}

function readDigit(ink: Uint8Array, width: number, box: { x0: number; x1: number; y0: number; y1: number }): string | null {
  const W = box.x1 - box.x0;
  const H = box.y1 - box.y0;
  if (H < 8) return null;
  if (W / H < 0.38) return "1";
  const at = (fx0: number, fx1: number, fy0: number, fy1: number) =>
    inkFraction(ink, width, box.x0 + fx0 * W, box.x0 + fx1 * W, box.y0 + fy0 * H, box.y0 + fy1 * H);
  const zones = [
    at(0.3, 0.7, 0.0, 0.14), // a
    at(0.75, 1.0, 0.15, 0.42), // b
    at(0.75, 1.0, 0.58, 0.85), // c
    at(0.3, 0.7, 0.86, 1.0), // d
    at(0.0, 0.25, 0.58, 0.85), // e
    at(0.0, 0.25, 0.15, 0.42), // f
    at(0.3, 0.7, 0.43, 0.57), // g
  ];
  const key = zones.map((z) => (z > 0.3 ? "1" : "0")).join("");
  return PATTERNS[key] ?? null;
}

export interface RowResult {
  text: string;
  value: number | null;
  box: { x0: number; x1: number; y0: number; y1: number };
}

/** All numbers on the display, top to bottom. A row with an unreadable digit has value null. */
export function readSevenSegment(g: Gray): RowResult[] {
  const { width, height } = g;
  const ink = binarize(g);
  const rowProfile = Array.from({ length: height }, (_, y) => {
    let s = 0;
    for (let x = 0; x < width; x++) s += ink[y * width + x];
    return s;
  });
  // Rows: a segment gap is a few pixels, a gap between lines of digits is much larger.
  const rows = runs(rowProfile, width * 0.01, Math.max(2, Math.round(height * 0.04))).filter((r) => r.end - r.start >= height * 0.08);
  const results: RowResult[] = [];
  for (const row of rows) {
    const rh = row.end - row.start;
    const colProfile = Array.from({ length: width }, (_, x) => {
      let s = 0;
      for (let y = row.start; y < row.end; y++) s += ink[y * width + x];
      return s;
    });
    // Bridge gaps inside a digit (between its segments) but not between digits.
    const digits = runs(colProfile, rh * 0.03, Math.max(2, Math.round(rh * 0.12))).filter((d) => d.end - d.start >= rh * 0.08);
    let text = "";
    for (const d of digits) {
      // Tight vertical extent of this digit.
      let y0 = row.end;
      let y1 = row.start;
      for (let y = row.start; y < row.end; y++) {
        for (let x = d.start; x < d.end; x++) {
          if (ink[y * width + x]) {
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y + 1);
            break;
          }
        }
      }
      // A short blob low in the row is a decimal point.
      if (y1 - y0 < rh * 0.25) {
        if (y0 > row.start + rh * 0.6) text += ".";
        continue;
      }
      // A "1" sits on the right of its cell: keep its true height but use the row height for shape.
      const box = { x0: d.start, x1: d.end, y0: row.start, y1: row.end };
      text += readDigit(ink, width, box) ?? "?";
    }
    const clean = text.replace(/^\.+|\.+$/g, "");
    results.push({ text: clean, value: clean && !clean.includes("?") ? Number(clean) : null, box: { x0: 0, x1: width, y0: row.start, y1: row.end } });
  }
  return results.filter((r) => r.text.length > 0);
}

/** Load an image file, optionally crop (fractions of the image), downscale, and read it. */
export async function readFromImage(file: Blob, crop?: { x: number; y: number; w: number; h: number }): Promise<RowResult[]> {
  const bitmap = await createImageBitmap(file);
  const sx = crop ? crop.x * bitmap.width : 0;
  const sy = crop ? crop.y * bitmap.height : 0;
  const sw = crop ? crop.w * bitmap.width : bitmap.width;
  const sh = crop ? crop.h * bitmap.height : bitmap.height;
  const scale = Math.min(1, 480 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  bitmap.close();
  return readSevenSegment(toGray(ctx.getImageData(0, 0, w, h).data, w, h));
}

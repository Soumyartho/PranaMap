import { describe, expect, it } from "vitest";
import { readSevenSegment, type Gray } from "@/services/device/sevenSegment";

// Segment rectangles in a unit digit cell (width 0.6, height 1), as a typical LCD draws them,
// with small gaps between segments like a real display.
const SEG: Record<string, [number, number, number, number]> = {
  a: [0.08, 0.0, 0.52, 0.09],
  b: [0.51, 0.05, 0.6, 0.47],
  c: [0.51, 0.53, 0.6, 0.95],
  d: [0.08, 0.91, 0.52, 1.0],
  e: [0.0, 0.53, 0.09, 0.95],
  f: [0.0, 0.05, 0.09, 0.47],
  g: [0.08, 0.455, 0.52, 0.545],
};
const DIGIT_SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

/** Draw lines of seven-segment numbers into a grayscale image, with optional noise and LED polarity. */
function render(lines: string[], opts: { digitH?: number; noise?: number; led?: boolean; seed?: number } = {}): Gray {
  const H = opts.digitH ?? 60;
  const W = H * 0.6;
  const gap = H * 0.25;
  const lineGap = H * 0.5;
  const margin = 20;
  const width = Math.ceil(margin * 2 + Math.max(...lines.map((l) => l.length)) * (W + gap));
  const height = Math.ceil(margin * 2 + lines.length * H + (lines.length - 1) * lineGap);
  const bg = opts.led ? 20 : 200;
  const fg = opts.led ? 230 : 40;
  const data = new Uint8Array(width * height).fill(bg);
  let s = opts.seed ?? 7;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  lines.forEach((line, li) => {
    const top = margin + li * (H + lineGap);
    // Right-align like a real display: a "1" occupies the right side of a full cell.
    const offset = (Math.max(...lines.map((l) => l.length)) - line.length) * (W + gap);
    [...line].forEach((ch, ci) => {
      const left = margin + offset + ci * (W + gap);
      for (const seg of DIGIT_SEGS[ch]) {
        const [x0, y0, x1, y1] = SEG[seg];
        for (let y = Math.round(top + y0 * H); y < Math.round(top + y1 * H); y++) {
          for (let x = Math.round(left + (x0 / 0.6) * W); x < Math.round(left + (x1 / 0.6) * W); x++) data[y * width + x] = fg;
        }
      }
    });
  });
  if (opts.noise) for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i] + (rand() - 0.5) * 2 * opts.noise));
  return { width, height, data };
}

describe("seven-segment reader", () => {
  it("reads every digit", () => {
    expect(readSevenSegment(render(["0123456789"])).map((r) => r.text)).toEqual(["0123456789"]);
  });

  it("reads a blood pressure monitor's stacked SYS / DIA / pulse", () => {
    expect(readSevenSegment(render(["152", "96", "78"])).map((r) => r.value)).toEqual([152, 96, 78]);
  });

  it("handles 1s, which are narrow and right-aligned", () => {
    expect(readSevenSegment(render(["118", "71"])).map((r) => r.value)).toEqual([118, 71]);
  });

  it("works on light-on-dark LED displays", () => {
    expect(readSevenSegment(render(["234"], { led: true })).map((r) => r.value)).toEqual([234]);
  });

  it("survives sensor noise", () => {
    expect(readSevenSegment(render(["147", "92"], { noise: 40 })).map((r) => r.value)).toEqual([147, 92]);
  });

  it("works at small sizes (a far-away photo)", () => {
    expect(readSevenSegment(render(["98"], { digitH: 24 })).map((r) => r.value)).toEqual([98]);
  });
});

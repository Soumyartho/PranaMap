import { describe, expect, it } from "vitest";
import { parseBloodPressure, parsePlx, sfloat } from "@/services/device/ble";

/** Little-endian bytes → DataView, as a characteristic notification delivers them. */
const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
/** Encode an SFLOAT (mantissa, exponent) the way a device would. */
const sf = (mantissa: number, exponent = 0) => {
  const raw = ((exponent & 0xf) << 12) | (mantissa & 0x0fff);
  return [raw & 0xff, raw >> 8];
};

describe("IEEE-11073 SFLOAT", () => {
  it("decodes positive, negative-exponent and negative values", () => {
    expect(sfloat(0x0078)).toBe(120);
    expect(sfloat(0xf0a0)).toBe(16); // 160 × 10^-1
    expect(sfloat(0xf3e7)).toBe(99.9); // 999 × 10^-1
    expect(sfloat(0x0fff)).toBe(-1);
  });
  it("maps reserved codes to NaN", () => {
    expect(sfloat(0x07ff)).toBeNaN(); // NaN
    expect(sfloat(0x0800)).toBeNaN(); // NRes
  });
});

describe("Blood Pressure Measurement (0x2A35)", () => {
  it("reads mmHg with pulse", () => {
    const r = parseBloodPressure(view(0x04, ...sf(152), ...sf(96), ...sf(115), ...sf(78)));
    expect(r).toMatchObject({ systolic: 152, diastolic: 96, map: 115, pulse: 78, unit: "mmHg" });
  });
  it("converts kPa to mmHg", () => {
    const r = parseBloodPressure(view(0x01, ...sf(160, -1), ...sf(107, -1), ...sf(124, -1)));
    expect(r.systolic).toBe(120);
    expect(r.diastolic).toBe(80);
  });
  it("skips the timestamp to reach the pulse", () => {
    const ts = [0xea, 0x07, 11, 12, 9, 30, 0]; // 2026-11-12 09:30:00
    const r = parseBloodPressure(view(0x06, ...sf(140), ...sf(90), ...sf(107), ...ts, ...sf(70)));
    expect(r.pulse).toBe(70);
    expect(r.measuredAt?.getFullYear()).toBe(2026);
    expect(r.measuredAt?.getHours()).toBe(9);
  });
});

describe("Pulse oximeter (0x2A5E / 0x2A5F)", () => {
  it("reads SpO2 and pulse", () => {
    expect(parsePlx(view(0x00, ...sf(97), ...sf(72)))).toEqual({ spo2: 97, pulse: 72 });
  });
});

/**
 * Bluetooth Low Energy medical devices, via the standard Bluetooth SIG GATT profiles (Web Bluetooth,
 * Chrome on Android). Removes typing and transcription errors: the reading arrives as numbers.
 *
 * - Blood Pressure Profile: service 0x1810, characteristic 0x2A35 (Blood Pressure Measurement).
 * - Pulse Oximeter Profile: service 0x1822, characteristics 0x2A5E (spot-check) / 0x2A5F (continuous).
 * Values use IEEE-11073 16-bit SFLOAT. Many cheap oximeters speak a vendor protocol instead of the
 * standard profile; those are not supported, and the keypad/voice/camera paths remain.
 * Every reading is still shown and read back for the ASHA to confirm.
 */

export const BP_SERVICE = 0x1810;
export const BP_MEASUREMENT = 0x2a35;
export const PLX_SERVICE = 0x1822;
export const PLX_SPOT_CHECK = 0x2a5e;
export const PLX_CONTINUOUS = 0x2a5f;
const KPA_TO_MMHG = 7.50062;

/** IEEE-11073 SFLOAT: 4-bit signed exponent, 12-bit signed mantissa. Special values become NaN. */
export function sfloat(raw: number): number {
  const mantissa12 = raw & 0x0fff;
  if ([0x07ff, 0x0800, 0x07fe, 0x0802, 0x0801].includes(mantissa12) && (raw >> 12 & 0xf) === 0) return Number.NaN;
  const exponent = raw >> 12 >= 8 ? (raw >> 12) - 16 : raw >> 12;
  const mantissa = mantissa12 >= 0x0800 ? mantissa12 - 0x1000 : mantissa12;
  // Round away binary noise (16.0 * 10^-1 must be exactly 1.6).
  return Number((mantissa * 10 ** exponent).toFixed(Math.max(0, -exponent)));
}

export interface BpReading {
  systolic: number;
  diastolic: number;
  map: number;
  pulse?: number;
  unit: "mmHg";
  measuredAt?: Date;
}

export function parseBloodPressure(v: DataView): BpReading {
  const flags = v.getUint8(0);
  const kpa = (flags & 0x01) !== 0;
  let o = 1;
  const read = () => {
    const x = sfloat(v.getUint16(o, true));
    o += 2;
    return x;
  };
  let systolic = read();
  let diastolic = read();
  let map = read();
  let measuredAt: Date | undefined;
  if (flags & 0x02) {
    const year = v.getUint16(o, true);
    measuredAt = new Date(year, v.getUint8(o + 2) - 1, v.getUint8(o + 3), v.getUint8(o + 4), v.getUint8(o + 5), v.getUint8(o + 6));
    o += 7;
  }
  const pulse = flags & 0x04 ? read() : undefined;
  if (kpa) {
    systolic *= KPA_TO_MMHG;
    diastolic *= KPA_TO_MMHG;
    map *= KPA_TO_MMHG;
  }
  const r = (x: number) => Math.round(x);
  return { systolic: r(systolic), diastolic: r(diastolic), map: r(map), pulse: pulse === undefined ? undefined : r(pulse), unit: "mmHg", measuredAt };
}

export interface OxReading {
  spo2: number;
  pulse: number;
}

/** Spot-check and continuous measurements both start: flags, SpO2 (SFLOAT), pulse rate (SFLOAT). */
export function parsePlx(v: DataView): OxReading {
  return { spo2: Math.round(sfloat(v.getUint16(1, true))), pulse: Math.round(sfloat(v.getUint16(3, true))) };
}

// ------------------------------------------------------------------ Web Bluetooth

interface Characteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<Characteristic>;
}
interface BluetoothLike {
  requestDevice(opts: { filters: { services: number[] }[] }): Promise<{
    gatt?: { connect(): Promise<{ getPrimaryService(s: number): Promise<{ getCharacteristic(c: number): Promise<Characteristic> }>; disconnect(): void }> };
  }>;
}

export const bluetoothAvailable = () => typeof navigator !== "undefined" && "bluetooth" in navigator;

async function firstValue<T>(service: number, characteristics: number[], parse: (v: DataView) => T, timeoutMs: number): Promise<T> {
  const bt = (navigator as unknown as { bluetooth: BluetoothLike }).bluetooth;
  const device = await bt.requestDevice({ filters: [{ services: [service] }] });
  const server = await device.gatt!.connect();
  try {
    const svc = await server.getPrimaryService(service);
    let ch: Characteristic | null = null;
    for (const c of characteristics) {
      try {
        ch = await svc.getCharacteristic(c);
        break;
      } catch {
        /* try the next one */
      }
    }
    if (!ch) throw new Error("characteristic_not_found");
    const char = ch;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      char.addEventListener("characteristicvaluechanged", () => {
        if (!char.value) return;
        clearTimeout(timer);
        try {
          resolve(parse(char.value));
        } catch (e) {
          reject(e);
        }
      });
      void char.startNotifications();
    });
  } finally {
    server.disconnect();
  }
}

/** Pair (first time), then wait for the cuff to finish a measurement. */
export const readBloodPressureCuff = (timeoutMs = 90_000) => firstValue(BP_SERVICE, [BP_MEASUREMENT], parseBloodPressure, timeoutMs);
export const readPulseOximeter = (timeoutMs = 60_000) => firstValue(PLX_SERVICE, [PLX_SPOT_CHECK, PLX_CONTINUOUS], parsePlx, timeoutMs);

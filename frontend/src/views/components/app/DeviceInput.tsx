import { useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "@/i18n";
import { Bluetooth, Camera, Loader2 } from "lucide-react";
import { bluetoothAvailable, readBloodPressureCuff, readPulseOximeter } from "@/services/device/ble";
import { readFromImage, type RowResult } from "@/services/device/sevenSegment";
import { haptic } from "@/services/voice/speech";
import { Sheet } from "./bits";
import { cn } from "@/lib/cx";

type Kind = "bp" | "spo2" | "number";

/**
 * Two ways to take a reading without typing: a Bluetooth device (standard GATT profiles) or a
 * photo of its display (seven-segment reader). Both only fill the fields; the ASHA still confirms.
 */
export function DeviceInput({ kind, onReading }: { kind: Kind; onReading: (values: number[], source: "bluetooth" | "camera") => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const ble = bluetoothAvailable() && (kind === "bp" || kind === "spo2");

  async function readBluetooth() {
    setBusy(true);
    setMessage(t("device.pair_hint"));
    try {
      if (kind === "bp") {
        const r = await readBloodPressureCuff();
        onReading([r.systolic, r.diastolic], "bluetooth");
      } else {
        const r = await readPulseOximeter();
        onReading([r.spo2], "bluetooth");
      }
      haptic([8, 30, 8]);
      setMessage(null);
    } catch (err) {
      const m = (err as Error).name === "NotFoundError" ? null : t("device.failed");
      setMessage(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-2">
        {ble && (
          <button type="button" onClick={readBluetooth} disabled={busy}
            className="flex items-center gap-2 rounded-full border border-line px-4 py-2 font-display text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bluetooth className="h-4 w-4" />} {t("device.bluetooth")}
          </button>
        )}
        <button type="button" onClick={() => setCamera(true)} className="flex items-center gap-2 rounded-full border border-line px-4 py-2 font-display text-sm font-semibold">
          <Camera className="h-4 w-4" /> {t("device.camera")}
        </button>
      </div>
      {message && <p className="text-center font-display text-xs text-mute">{message}</p>}
      <CameraSheet open={camera} kind={kind} onClose={() => setCamera(false)} onValues={(v) => { setCamera(false); onReading(v, "camera"); }} />
    </div>
  );
}

interface Rect { x: number; y: number; w: number; h: number }

function CameraSheet({ open, kind, onClose, onValues }: { open: boolean; kind: Kind; onClose: () => void; onValues: (v: number[]) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [rows, setRows] = useState<RowResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const need = kind === "bp" ? 2 : 1;

  function pick(f: File | undefined) {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setCrop(null);
    setRows(null);
  }

  const point = (e: PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  async function read() {
    if (!file) return;
    setBusy(true);
    try {
      setRows(await readFromImage(file, crop && crop.w > 0.03 && crop.h > 0.03 ? crop : undefined));
    } finally {
      setBusy(false);
    }
  }

  const values = (rows ?? []).map((r) => r.value).filter((v): v is number => v !== null);
  const usable = values.length >= need;

  return (
    <Sheet open={open} onClose={onClose} title={t("device.camera")}>
      <div className="flex flex-col gap-3">
        <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-crimson font-display font-semibold">
          <Camera className="h-5 w-5" /> {file ? t("device.retake") : t("device.take_photo")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {url && (
          <>
            <p className="font-serif text-sm text-mute">{t("device.frame_hint")}</p>
            <div
              ref={frame}
              className="relative touch-none select-none overflow-hidden rounded-xl border border-line"
              onPointerDown={(e) => { drag.current = point(e); setCrop({ ...point(e), w: 0, h: 0 }); (e.target as Element).setPointerCapture?.(e.pointerId); }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                const p = point(e);
                const s = drag.current;
                setCrop({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
              }}
              onPointerUp={() => { drag.current = null; setRows(null); }}
            >
              <img src={url} alt="" className="block w-full" draggable={false} />
              {crop && crop.w > 0 && (
                <div className="pointer-events-none absolute border-2 border-warn bg-warn/10"
                  style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
              )}
            </div>
            <button type="button" onClick={read} disabled={busy} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line font-display font-semibold">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("device.read")}
            </button>
          </>
        )}
        {rows && (
          <div className={cn("rounded-2xl p-4", usable ? "bg-raised" : "bg-warn/15")}>
            {usable ? (
              <>
                <p className="font-display text-sm text-mute">{t("screen.heard")}</p>
                <p className="mt-1 font-display text-3xl font-semibold">{values.slice(0, need).join(" / ")}</p>
                <button type="button" onClick={() => onValues(values.slice(0, need))} className="mt-3 h-12 w-full rounded-xl bg-ok font-display font-semibold text-ink">
                  {t("device.use")}
                </button>
              </>
            ) : (
              <p className="font-display text-sm text-warn">{t("device.none_found")}</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

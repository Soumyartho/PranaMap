import { Delete } from "lucide-react";
import { haptic } from "@/services/voice/speech";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

/** Big-number keypad: the always-available input path, with or without network or voice. */
export function Keypad({ value, onChange, decimals = false, maxLength = 5 }: {
  value: string;
  onChange: (v: string) => void;
  decimals?: boolean;
  maxLength?: number;
}) {
  function press(k: string) {
    haptic(6);
    if (k === "del") return onChange(value.slice(0, -1));
    if (k === "." && (!decimals || value.includes("."))) return;
    if (value.length >= maxLength) return;
    onChange(value === "0" && k !== "." ? k : value + k);
  }
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          disabled={k === "." && !decimals}
          aria-label={k === "del" ? "Delete" : k}
          className="grid h-14 place-items-center rounded-2xl bg-raised font-display text-2xl font-semibold text-paper transition-colors active:bg-blood disabled:opacity-20"
        >
          {k === "del" ? <Delete className="h-6 w-6" /> : k}
        </button>
      ))}
    </div>
  );
}

/**
 * Translation QA. These checks do not judge whether a translation is good (that needs a native
 * speaker with health-worker experience: `npm run i18n:export` produces the review sheet). They catch
 * the mechanical faults that break a screen or change a clinical message:
 *
 * - a key present in English but missing in Hindi/Bengali (silent English fallback mid-flow);
 * - a `{{placeholder}}` dropped or renamed (the value never shows, e.g. a blood pressure);
 * - a key the code calls that no locale defines (the raw key is shown to the ASHA);
 * - FAQ answers whose numbers differ between languages (140/90 in English, 130/90 in Hindi).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/locales/en.json";
import hi from "@/i18n/locales/hi.json";
import bn from "@/i18n/locales/bn.json";
import faq from "../../../shared/faq.json";

type Dict = { [k: string]: string | Dict };

function flatten(d: Dict, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
// Numbers in any script, normalised to ASCII digits ("১৪০/৯০" → "140/90").
const DIGITS: Record<string, string> = {};
"०१२३४५६७८९".split("").forEach((c, i) => (DIGITS[c] = String(i)));
"০১২৩৪৫৬৭৮৯".split("").forEach((c, i) => (DIGITS[c] = String(i)));
// Compared as sets: "30-30 मिनट" (30 minutes each) is the idiomatic Hindi for "30 minutes".
const numbers = (s: string) =>
  [...new Set([...s.replace(/[०-९০-৯]/g, (c) => DIGITS[c]).matchAll(/\d+(?:[.,/]\d+)*/g)].map((m) => m[0]))].sort();

const EN = flatten(en as Dict);
const LOCALES = { hi: flatten(hi as Dict), bn: flatten(bn as Dict) };
const baseKey = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");

describe.each(Object.entries(LOCALES))("%s locale", (lang, dict) => {
  it("has every English key", () => {
    const missing = [...EN.keys()].filter((k) => !dict.has(k) && !(dict.has(`${baseKey(k)}_other`) && k !== baseKey(k)));
    expect(missing).toEqual([]);
  });

  it("has no keys English lacks", () => {
    const extra = [...dict.keys()].filter((k) => !EN.has(k) && !EN.has(`${baseKey(k)}_other`) && !EN.has(baseKey(k)));
    expect(extra).toEqual([]);
  });

  it("keeps every {{placeholder}}", () => {
    const wrong = [...EN.entries()]
      .filter(([k]) => dict.has(k))
      .filter(([k, v]) => placeholders(v).join() !== placeholders(dict.get(k)!).join())
      .map(([k]) => `${k}: en {${placeholders(EN.get(k)!)}} vs ${lang} {${placeholders(dict.get(k)!)}}`);
    expect(wrong).toEqual([]);
  });

  it("has no empty strings", () => {
    expect([...dict.entries()].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it("is written in its own script, not left in English", () => {
    const script = lang === "hi" ? /[ऀ-ॿ]/ : /[ঀ-৿]/;
    // Clinical abbreviations and units are written in Latin script in Indian clinics too.
    const ACCEPTED_LATIN = /\b(mmHg|BMI|Hb|SpO2|ABHA|ASHA|ANM|PHC|OTP|PIN|mg\/dL|kg|cm)\b/g;
    const untranslated = [...dict.entries()]
      .map(([k, v]) => [k, v, v.replace(/\{\{\s*\w+\s*\}\}/g, "").replace(ACCEPTED_LATIN, "")] as const)
      .filter(([, , rest]) => /[A-Za-z]{3,}/.test(rest) && !script.test(rest))
      .map(([k, v]) => `${k}: ${v}`);
    expect(untranslated).toEqual([]);
  });
});

describe("keys used in code", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !p.includes("i18n")) files.push(p);
    }
  };
  walk(join(__dirname, "../../src"));
  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // Static keys only: t("a.b") / t("a.b", …). Template keys (t(`flags.${c}`)) are covered by the
    // parity tests above plus the engine fixtures, which exercise every flag and driver code.
    for (const m of src.matchAll(/\bt\(\s*"([a-z_]+(?:\.[A-Za-z0-9_]+)+)"/g)) used.add(m[1]);
  }

  it("finds the keys (sanity)", () => expect(used.size).toBeGreaterThan(100));

  it("every static key exists in English", () => {
    const missing = [...used].filter((k) => !EN.has(k) && !EN.has(`${k}_other`) && !EN.has(`${k}_one`));
    expect(missing).toEqual([]);
  });
});

describe("FAQ pack", () => {
  type Item = { id: string; q: Record<string, string>; a: Record<string, string>; keywords: Record<string, string[]> };
  const items: Item[] = faq.items;

  it.each(items.map((i) => [i.id, i] as const))("%s is complete in all three languages", (_, item) => {
    for (const lang of ["en", "hi", "bn"]) {
      expect(item.q[lang]?.trim(), `${lang} question`).toBeTruthy();
      expect(item.a[lang]?.trim(), `${lang} answer`).toBeTruthy();
      expect(item.keywords[lang]?.length, `${lang} keywords`).toBeGreaterThan(0);
    }
  });

  it.each(items.map((i) => [i.id, i] as const))("%s states the same numbers in every language", (_, item) => {
    expect(numbers(item.a.hi), "hi").toEqual(numbers(item.a.en));
    expect(numbers(item.a.bn), "bn").toEqual(numbers(item.a.en));
  });
});

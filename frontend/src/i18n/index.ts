/**
 * Translations. A small replacement for i18next (which cost ~25 KB gzipped on a 2 GB phone's
 * first load) that keeps the same call shapes: `const { t, i18n } = useTranslation()`,
 * `t("a.b", { value, count, defaultValue })`, `i18n.language`, `i18n.exists(key)`.
 *
 * - `{{name}}` interpolation; with `count`, the plural form `key_one` / `key_other` is used
 *   when present (CLDR rules via Intl.PluralRules), otherwise `key`.
 * - Only the active language is loaded; English is the fallback for any missing key.
 */
import { useSyncExternalStore } from "react";
import en from "./locales/en.json";

export const LANGUAGES = [
  { code: "bn", label: "বাংলা" },
  { code: "hi", label: "हिन्दी" },
  { code: "en", label: "English" },
] as const;
export type AppLang = (typeof LANGUAGES)[number]["code"];

type Dict = { [k: string]: string | Dict };
type Options = { count?: number; defaultValue?: string; [name: string]: unknown };

const STORAGE_KEY = "pranamap.lang";
const loaders = import.meta.glob<Dict>(["./locales/hi.json", "./locales/bn.json"], { import: "default" });
const dicts: Partial<Record<AppLang, Dict>> = { en: en as Dict };
const listeners = new Set<() => void>();
let language: AppLang = "en";

function lookup(dict: Dict | undefined, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function resolve(key: string, count?: number): string | undefined {
  // The active language wins over English in every form: an untranslated plural must not pull an
  // English sentence into a Hindi screen when the plain Hindi key exists.
  const form = typeof count === "number" ? new Intl.PluralRules(language).select(count) : null;
  for (const d of [dicts[language], dicts.en]) {
    const v = (form ? lookup(d, `${key}_${form}`) ?? lookup(d, `${key}_other`) : undefined) ?? lookup(d, key);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function t(key: string, options: Options = {}): string {
  const template = resolve(key, options.count) ?? options.defaultValue ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const v = options[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

export const i18n = {
  get language(): AppLang {
    return language;
  },
  exists: (key: string) => resolve(key) !== undefined,
  t,
};

async function load(code: AppLang): Promise<void> {
  if (dicts[code]) return;
  const loader = loaders[`./locales/${code}.json`];
  if (loader) dicts[code] = await loader();
}

export async function setLanguage(code: AppLang): Promise<void> {
  await load(code);
  language = code;
  document.documentElement.lang = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

/** Load the saved language before the first render. */
export async function initI18n(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
  const code = LANGUAGES.some((l) => l.code === saved) ? (saved as AppLang) : "en";
  await load(code).catch(() => undefined);
  language = dicts[code] ? code : "en";
  document.documentElement.lang = language;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Re-renders the component when the language changes. */
export function useTranslation() {
  useSyncExternalStore(subscribe, () => language);
  return { t, i18n };
}

export const currentLang = () => language;

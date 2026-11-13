#!/usr/bin/env node
/**
 * Performance budget for the first load on a 2 GB Android phone over 2G/3G. Run after `vite build`.
 *
 *   npm run budget
 *
 * Counts what the browser must fetch before first paint, as index.html declares it: the entry
 * module, every <link rel="modulepreload">, and the stylesheets, gzip-compressed (what travels the
 * wire). Lazy routes, locales, the risk models and the offline-speech runtime load later and are
 * reported separately, not budgeted here. Exits non-zero when a budget is exceeded, so CI fails.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const dist = resolve(fileURLToPath(new URL("..", import.meta.url)), "dist");
const BUDGET_KB = {
  // Current: ~170 KB. React DOM (~60), Dexie (~30) and React Router (~29) are most of it; the
  // ratchet only goes down. Lowering it further means replacing the router or loading Dexie lazily.
  initialJs: 180,
  initialCss: 25,
  largestLazyChunk: 60, // any phone route chunk, so no ASHA screen stalls on a slow link
  // The PHC dashboard's block map (MapLibre GL + worker). Desktop-only, on facility broadband;
  // never loaded on the ASHA's phone. Budgeted so it cannot grow unnoticed.
  staffMap: 300,
};
const STAFF_MAP = /(HexMap|maplibre)/;

const gz = (path) => gzipSync(readFileSync(path), { level: 9 }).length / 1024;
const html = readFileSync(join(dist, "index.html"), "utf8");
const refs = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\//, ""));
const initialJs = [...new Set([...refs(/<script[^>]+src="([^"]+\.js)"/g), ...refs(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)])];
const initialCss = refs(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g);

const sum = (files) => files.reduce((a, f) => a + gz(join(dist, f)), 0);
const assets = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
const lazy = assets
  .map((f) => `assets/${f}`)
  .filter((f) => !initialJs.includes(f))
  // Offline speech runtime is downloaded on demand from Settings, with its own progress UI.
  .filter((f) => !/(ort|transformers|asr\.worker)/.test(f))
  .map((f) => ({ f, kb: gz(join(dist, f)), raw: statSync(join(dist, f)).size / 1024 }))
  .sort((a, b) => b.kb - a.kb);

const phone = lazy.filter((c) => !STAFF_MAP.test(c.f));
const map = lazy.filter((c) => STAFF_MAP.test(c.f));
const rows = [
  ["initial JS", sum(initialJs), BUDGET_KB.initialJs, initialJs.join(", ")],
  ["initial CSS", sum(initialCss), BUDGET_KB.initialCss, initialCss.join(", ")],
  ["largest lazy chunk", phone[0]?.kb ?? 0, BUDGET_KB.largestLazyChunk, phone[0]?.f ?? "-"],
  ["staff map (desktop)", Math.max(0, ...map.map((c) => c.kb)), BUDGET_KB.staffMap, map.map((c) => c.f).join(", ")],
];
let failed = false;
for (const [name, kb, budget, files] of rows) {
  const ok = kb <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(20)} ${kb.toFixed(1).padStart(6)} KB gz / budget ${budget} KB   ${files}`);
}
console.log("\nlazy chunks (gz KB):", phone.slice(0, 8).map((c) => `${c.f.replace("assets/", "")} ${c.kb.toFixed(1)}`).join(" · "));
process.exit(failed ? 1 : 0);

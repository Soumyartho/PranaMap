#!/usr/bin/env node
/**
 * Export every UI string and FAQ answer as a review sheet for native Hindi/Bengali reviewers.
 *
 *   npm run i18n:export            → ../docs/translation-review.csv
 *
 * One row per string: where it appears, English, Hindi, Bengali, and empty columns for the
 * reviewer's verdict and corrected text. Rows marked "clinical" (risk reasons, advice, FAQ answers,
 * referral and SMS wording) need a reviewer with health-worker experience, not only a linguist.
 * Written as UTF-8 with a BOM so Excel shows Devanagari and Bengali script correctly.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(resolve(here, p), "utf8"));
const out = resolve(here, process.argv[2] ?? "../../docs/translation-review.csv");

const flatten = (d, prefix = "", acc = new Map()) => {
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") acc.set(key, v);
    else flatten(v, key, acc);
  }
  return acc;
};

const [en, hi, bn] = ["en", "hi", "bn"].map((l) => flatten(read(`../src/i18n/locales/${l}.json`)));
const CLINICAL = /^(syndromes|screen\.q|symptoms|bands|conditions|urgency|result|teach|drivers|values|flags|emergency|route_reasons|referral)\./;

const rows = [["id", "area", "clinical", "en", "hi", "bn", "verdict (ok / fix)", "corrected text", "reviewer", "notes"]];
for (const [key, text] of en) {
  rows.push([key, key.split(".")[0], CLINICAL.test(key) ? "yes" : "", text, hi.get(key) ?? "(missing)", bn.get(key) ?? "(missing)", "", "", "", ""]);
}

const faq = read("../../shared/faq.json");
for (const item of faq.items) {
  for (const part of ["q", "a"]) {
    rows.push([`faq.${item.id}.${part}`, "faq", part === "a" ? "yes" : "", item[part].en, item[part].hi, item[part].bn, "", "", "", `source: ${item.source ?? ""}`]);
  }
}

const cell = (v) => (/[",\n]/.test(v) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", "utf8");
const clinical = rows.filter((r) => r[2] === "yes").length;
console.log(`${rows.length - 1} strings (${clinical} clinical) → ${out}`);

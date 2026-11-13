/**
 * Turn a spoken answer into numbers, in English, Hindi and Bengali.
 *
 * Recognisers return numbers in three ways: digits (Latin, Devanagari or Bengali script), or
 * words ("one hundred fifty", "एक सौ पचास", "একশো পঞ্চাশ"). Constrained parsing (numbers,
 * units, yes/no) is far more reliable on accented speech than open dictation, and every value is
 * read back for confirmation before it counts.
 */

const DIGIT_BLOCKS = [0x0966, 0x09e6]; // Devanagari ०, Bengali ০

export function normalizeDigits(text: string): string {
  return text.replace(/[०-९০-৯]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = DIGIT_BLOCKS.find((b) => code >= b && code <= b + 9)!;
    return String(code - base);
  });
}

/**
 * Spelling-insensitive form of Indic text: decompose, drop nukta and Bengali chandrabindu,
 * map Devanagari chandrabindu to anusvara, drop zero-width joiners. "पाँच"="पांच", "দেড়"="দেড"…
 */
export function foldIndic(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[़়ঁ‌‍]/g, "")
    .replace(/ँ/g, "ं")
    .normalize("NFC");
}

// ------------------------------------------------------------------ lexicons

const EN_UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Index = value. Every Hindi number word from 0 to 99.
const HI_0_99 = (
  "शून्य एक दो तीन चार पांच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस " +
  "बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस " +
  "चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ " +
  "साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी " +
  "अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे"
).split(" ");
const HI_VARIANTS: Record<string, number> = {
  "छः": 6, "छे": 6, "छ": 6, "पाच": 5, "अठ्ठाईस": 28, "अट्ठाइस": 28, "अठ्ठावन": 58, "अठ्ठासी": 88, "अठ्ठानवे": 98,
  // Single-ट spellings (IndicConformer writes these): अठानवे = 98.
  "अठाईस": 28, "अठावन": 58, "अठासी": 88, "अठानवे": 98, "अठहत्तर": 78,
  "पंचानवे": 95, "पच्चानवे": 95, "उन्नासी": 79, "उनासी": 79, "इकसठ": 61, "चवालिस": 44, "बयालिस": 42, "सौ": 100,
};
// Index = value. Every Bengali number word from 0 to 99.
const BN_0_99 = (
  "শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চোদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ " +
  "কুড়ি একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আঠাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ " +
  "চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন ঊনষাট " +
  "ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর সত্তর একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি " +
  "আশি একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি আটাশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই"
).split(" ");
const BN_VARIANTS: Record<string, number> = {
  "দু": 2, "ছ": 6, "ন": 9, "চৌদ্দ": 14, "ষোল": 16, "এগার": 11, "তের": 13, "পনের": 15, "সতের": 17, "আঠার": 18,
  "বিশ": 20, "তিরিশ": 30, "একশো": 100, "একশ": 100, "শো": 100, "শ": 100,
};
// Compound hundreds written as one word ("দুশো", "দেড়শো"), and the "half" forms.
const BN_HUNDREDS: Record<string, number> = { "দেড়শো": 150, "দেড়শ": 150, "আড়াইশো": 250, "আড়াইশ": 250 };
const HI_HUNDREDS: Record<string, number> = { "डेढ़": 1.5, "ढाई": 2.5 }; // "डेढ़ सौ" = 150, "ढाई सौ" = 250
const HALF = new Set(["साढ़े", "साढे", "সাড়ে"]); // "साढ़े ग्यारह" = 11.5

type Lexicon = Map<string, number>;
function buildLexicon(): Lexicon {
  const lex: Lexicon = new Map();
  EN_UNITS.forEach((w, i) => lex.set(w, i));
  Object.entries(EN_TENS).forEach(([w, v]) => lex.set(w, v));
  const add = (w: string, v: number) => {
    const f = foldIndic(w);
    lex.set(f, v);
    // Common spelling alternations in recogniser output.
    if (f.endsWith("वे")) lex.set(f.slice(0, -2) + "बे", v); // पचानवे / पचानबे
    if (f.startsWith("ঊ")) lex.set("উ" + f.slice(1), v); // ঊনত্রিশ / উনত্রিশ
  };
  HI_0_99.forEach((w, i) => add(w, i));
  BN_0_99.forEach((w, i) => add(w, i));
  Object.entries(HI_VARIANTS).forEach(([w, v]) => add(w, v));
  Object.entries(BN_VARIANTS).forEach(([w, v]) => add(w, v));
  // Bengali "<unit>শো": দুশো = 200, তিনশো = 300 ...
  BN_0_99.slice(1, 10).forEach((w, i) => {
    add(`${w}শো`, (i + 1) * 100);
    add(`${w}শ`, (i + 1) * 100);
  });
  add("দুশো", 200);
  add("দুশ", 200);
  Object.entries(BN_HUNDREDS).forEach(([w, v]) => add(w, v));
  return lex;
}
const LEX = buildLexicon();
const HUNDRED_WORDS = new Set(["hundred", foldIndic("सौ"), foldIndic("শো"), foldIndic("শ")]);
const HI_FRACTIONS = new Map(Object.entries(HI_HUNDREDS).map(([w, v]) => [foldIndic(w), v]));
const HALF_WORDS = new Set([...HALF].map(foldIndic));

// "point" for decimals, in the three app languages.
const POINT = /\b(point|dot)\b|दशमलव|पॉइंट|पाइंट|দশমিক|পয়েন্ট/g;
// Separators people say between systolic and diastolic.
const OVER = /\b(over|by|upon)\b|बटा|बाय|ओवर|ওভার|বাই|বাট্টা/g;

/** Replace runs of number words with digits; leave everything else alone. */
function wordsToDigits(text: string): string {
  const out: string[] = [];
  let current: number | null = null;
  let pendingFraction: number | null = null; // डेढ़/ढाई waiting for सौ
  let half = false; // साढ़े waiting for its number
  const flush = () => {
    if (current !== null) out.push(String(current));
    current = null;
  };
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const w = foldIndic(raw.toLowerCase()).replace(/[.,!?।]+$/g, "");
    if (HALF_WORDS.has(w)) {
      flush();
      half = true;
      continue;
    }
    if (HI_FRACTIONS.has(w)) {
      flush();
      pendingFraction = HI_FRACTIONS.get(w)!;
      continue;
    }
    if (HUNDRED_WORDS.has(w)) {
      if (pendingFraction !== null) {
        current = pendingFraction * 100;
        pendingFraction = null;
      } else current = (current ?? 1) * 100;
      continue;
    }
    if (w === "and" && current !== null) continue;
    const hyphen = w.includes("-") && w.split("-").every((p) => LEX.has(p));
    const value = hyphen ? w.split("-").reduce((s, p) => s + LEX.get(p)!, 0) : LEX.get(w);
    if (value !== undefined) {
      if (half) {
        current = value + 0.5;
        half = false;
        flush();
        continue;
      }
      // "एक सौ पचास" → 100 + 50; "fifty two" → 50 + 2; a new full number after a complete one starts fresh.
      if (current !== null && (current % 100 === 0 ? value >= 100 : current % 10 !== 0 || value >= 10)) flush();
      current = (current ?? 0) + value;
      continue;
    }
    flush();
    half = false;
    pendingFraction = null;
    out.push(raw);
  }
  flush();
  return out.join(" ");
}

export function extractNumbers(text: string): number[] {
  let t = normalizeDigits(text.toLowerCase());
  t = wordsToDigits(t.replace(POINT, " . "));
  t = t.replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** "150 over 95", "150/95", "१५० बटा ९५", "একশো পঞ্চাশ বাই পঁচানব্বই" → [150, 95]. */
export function parseBloodPressure(text: string): [number, number] | null {
  const t = normalizeDigits(text.toLowerCase()).replace(OVER, " / ");
  const nums = extractNumbers(t);
  return nums.length >= 2 ? [Math.round(nums[0]), Math.round(nums[1])] : null;
}

export function parseYesNo(text: string): boolean | null {
  const t = text.toLowerCase();
  if (/\b(yes|yeah|haan|ha)\b|हां|हाँ|जी|হ্যাঁ|হ্যা|আছে/.test(t)) return true;
  if (/\b(no|nope|nahi)\b|नहीं|ना\b|না|নেই/.test(t)) return false;
  return null;
}

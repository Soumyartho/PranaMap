/**
 * Offline triage chatbot over the shared FAQ pack. Port of backend/app/chatbot/engine.py, pinned
 * by shared/fixtures/chat_cases.json. Emergency phrases are checked before anything else.
 */
import faq from "../../../shared/faq.json";

export type Lang = "en" | "hi" | "bn";
type Localised = Record<Lang, string>;
interface FaqItem {
  id: string;
  keywords: Record<Lang, string[]>;
  q: Localised;
  a: Localised;
  source: string;
}

export interface ChatAnswer {
  kind: "emergency" | "faq" | "fallback";
  answer: string;
  id?: string;
  question?: string;
  source: string | null;
  call?: string;
  related: { id: string; q: string }[];
}

const SPLIT = /[\s,.!?।॥;:()"'/-]+/;
const STOPWORDS = new Set([
  "what", "is", "the", "a", "an", "how", "do", "does", "i", "my", "me", "can", "to", "of", "for", "and", "in", "on",
  "should", "are", "it", "when", "who", "if", "with", "be", "get", "have", "has", "there",
  "क्या", "है", "हैं", "कैसे", "की", "का", "के", "में", "से", "हो", "तो", "और", "कब", "किसकी", "करें", "मेरी", "मेरा",
  "কী", "কি", "কীভাবে", "আর", "এর", "হয়", "করব", "কখন", "আমার", "কে", "কাদের", "এবং",
]);

// Python's len() counts code points; JS .length counts UTF-16 units. Same for these scripts, but be exact.
const cpLength = (s: string) => [...s].length;

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(SPLIT).filter((t) => cpLength(t) > 1 && !STOPWORDS.has(t)));
}

export function answer(message: string, lang: Lang = "en"): ChatAnswer {
  const data = faq as unknown as {
    emergency: { keywords: Record<Lang, string[]>; answer: Localised };
    fallback: Localised;
    items: FaqItem[];
  };
  const text = message.toLowerCase().trim();

  for (const keywords of Object.values(data.emergency.keywords)) {
    if (keywords.some((k) => text.includes(k.toLowerCase()))) {
      return { kind: "emergency", answer: data.emergency.answer[lang], call: "108", source: null, related: [] };
    }
  }

  const words = tokens(text);
  const scored = data.items.map((item) => {
    const hits = Object.values(item.keywords).flatMap((kws) => kws.filter((k) => text.includes(k.toLowerCase())));
    const overlap = Object.values(item.q).reduce((s, q) => s + [...tokens(q)].filter((t) => words.has(t)).length, 0);
    const confident = hits.length > 0 || overlap >= 2;
    return [confident ? hits.reduce((s, k) => s + cpLength(k), 0) + 5 * overlap : 0, item] as const;
  });
  scored.sort((a, b) => b[0] - a[0]);
  const [bestScore, best] = scored[0];
  if (bestScore === 0) {
    return {
      kind: "fallback",
      answer: data.fallback[lang],
      source: null,
      related: scored.slice(0, 3).map(([, i]) => ({ id: i.id, q: i.q[lang] })),
    };
  }
  return {
    kind: "faq",
    id: best.id,
    question: best.q[lang],
    answer: best.a[lang],
    source: best.source,
    related: scored
      .slice(1, 4)
      .filter(([s]) => s > 0)
      .map(([, i]) => ({ id: i.id, q: i.q[lang] })),
  };
}

export const faqQuestions = (lang: Lang) => (faq as unknown as { items: FaqItem[] }).items.map((i) => ({ id: i.id, q: i.q[lang] }));

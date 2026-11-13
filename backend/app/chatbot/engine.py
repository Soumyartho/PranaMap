"""Triage chatbot. Order matters: emergency phrases first, then grounded FAQ retrieval.

There is no free-form generation: every answer is a reviewed FAQ entry with its source, so the
bot cannot invent medical advice. The phone runs the same matcher over the same pack offline.
An LLM can later rephrase retrieved answers, but only behind this red-flag layer.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache

from app.core.config import REPO_DIR

LANGS = ("en", "hi", "bn")
_SPLIT = re.compile(r"[\s,.!?।॥;:()\"'/-]+")
# Filler words carry no meaning for matching ("what is the weather" must not match an FAQ).
STOPWORDS = {
    "what", "is", "the", "a", "an", "how", "do", "does", "i", "my", "me", "can", "to", "of", "for", "and", "in", "on",
    "should", "are", "it", "when", "who", "if", "with", "be", "get", "have", "has", "there",
    "क्या", "है", "हैं", "कैसे", "की", "का", "के", "में", "से", "हो", "तो", "और", "कब", "किसकी", "करें", "मेरी", "मेरा",
    "কী", "কি", "কীভাবে", "আর", "এর", "হয়", "করব", "কখন", "আমার", "কে", "কাদের", "এবং",
}


@lru_cache
def corpus() -> dict:
    return json.loads((REPO_DIR / "shared" / "faq.json").read_text(encoding="utf-8"))


def _tokens(text: str) -> set[str]:
    return {t for t in _SPLIT.split(text.lower()) if len(t) > 1 and t not in STOPWORDS}


def answer(message: str, lang: str = "en") -> dict:
    lang = lang if lang in LANGS else "en"
    data = corpus()
    text = message.lower().strip()

    # 1. Emergency phrases in any language win, before anything else.
    for keywords in data["emergency"]["keywords"].values():
        if any(k.lower() in text for k in keywords):
            return {"kind": "emergency", "answer": data["emergency"]["answer"][lang], "call": "108", "source": None, "related": []}

    # 2. Score each FAQ: matched keyword phrases (longer = more specific = heavier), then words
    #    shared with the question. Keep in step with frontend/src/services/chat.ts.
    words = _tokens(text)
    scored = []
    for item in data["items"]:
        hits = [k for kws in item["keywords"].values() for k in kws if k.lower() in text]
        overlap = sum(len(words & _tokens(q)) for q in item["q"].values())
        confident = bool(hits) or overlap >= 2
        scored.append((sum(len(k) for k in hits) + 5 * overlap if confident else 0, item))
    scored.sort(key=lambda s: -s[0])
    best_score, best = scored[0]
    if best_score == 0:
        return {"kind": "fallback", "answer": data["fallback"][lang], "source": None,
                "related": [{"id": i["id"], "q": i["q"][lang]} for _, i in scored[:3]]}
    return {
        "kind": "faq",
        "id": best["id"],
        "question": best["q"][lang],
        "answer": best["a"][lang],
        "source": best["source"],
        "related": [{"id": i["id"], "q": i["q"][lang]} for s, i in scored[1:4] if s > 0],
    }

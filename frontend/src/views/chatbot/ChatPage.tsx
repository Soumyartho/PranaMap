import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/i18n";
import { m } from "framer-motion";
import { ArrowLeft, Mic, Phone, Send, Siren, WifiOff } from "lucide-react";
import { answer, faqQuestions, type ChatAnswer, type Lang } from "@/services/chat";
import { canListen, listen, speak, type VoiceLang } from "@/services/voice/speech";
import { LanguageSwitch } from "@/views/components/app/bits";
import { Logo } from "@/views/landing/sections/Logo";
import { cn } from "@/lib/cx";

type Msg = { from: "me"; text: string } | { from: "bot"; reply: ChatAnswer };

/**
 * Triage chatbot. Runs on the phone over the reviewed FAQ pack, so it answers with no signal.
 * Emergency phrases in any language go straight to "call 108". It never generates advice.
 */
export function ChatPage({ standalone = false }: { standalone?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const suggestions = faqQuestions(lang).slice(0, 5);

  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect must not return one.
    void end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function ask(q: string) {
    const question = q.trim();
    if (!question) return;
    const reply = answer(question, lang);
    setMessages((m) => [...m, { from: "me", text: question }, { from: "bot", reply }]);
    setText("");
    if (reply.kind === "emergency") navigator.vibrate?.([200, 100, 200]);
  }

  async function voice() {
    if (!canListen() || !navigator.onLine) return;
    setListening(true);
    try {
      const [best] = await listen(lang as VoiceLang).result;
      if (best) ask(best);
    } catch {
      /* nothing heard */
    } finally {
      setListening(false);
    }
  }

  return (
    <div className={cn("flex flex-col", standalone ? "min-h-svh bg-ink px-4 text-paper" : "min-h-[calc(100svh-9rem)]")}>
      {standalone && (
        <header className="mx-auto flex h-16 w-full max-w-lg items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display font-semibold"><ArrowLeft className="h-4 w-4" /><Logo className="h-7 w-7" /> PranaMap</Link>
          <LanguageSwitch />
        </header>
      )}
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 pb-28">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("chat.title")}</h1>
          <p className="mt-1 flex items-center gap-1.5 font-display text-xs text-ok"><WifiOff className="h-3.5 w-3.5" /> {t("chat.offline_ok")}</p>
        </div>
        <p className="rounded-2xl border border-line bg-surface p-4 font-serif text-[15px] text-paper/85">{t("chat.intro")}</p>

        {messages.length === 0 && (
          <div>
            <p className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.2em] text-mute">{t("chat.suggested")}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s.id} type="button" onClick={() => ask(s.q)} className="rounded-full border border-line px-3.5 py-2 text-left font-display text-sm text-paper/85 hover:border-crimson">{s.q}</button>
              ))}
            </div>
          </div>
        )}

        <ul className="flex flex-col gap-3" aria-live="polite">
          {messages.map((msg, i) => (
            <m.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-[88%]", msg.from === "me" ? "self-end" : "self-start")}>
              {msg.from === "me" ? (
                <p className="rounded-2xl rounded-br-md bg-crimson px-4 py-2.5 font-serif text-[16px]">{msg.text}</p>
              ) : msg.reply.kind === "emergency" ? (
                <div className="pulse-emergency rounded-2xl bg-[#3a0000] p-4">
                  <p className="flex items-center gap-2 font-display text-lg font-semibold text-signal"><Siren className="h-5 w-5" /> {t("chat.emergency")}</p>
                  <p className="mt-2 font-serif text-[16px]">{msg.reply.answer}</p>
                  <a href="tel:108" className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-signal font-display font-semibold"><Phone className="h-5 w-5" /> 108</a>
                </div>
              ) : (
                <div className="rounded-2xl rounded-bl-md border border-line bg-surface p-4">
                  {msg.reply.question && <p className="font-display text-sm font-semibold text-paper/70">{msg.reply.question}</p>}
                  <p className="mt-1 font-serif text-[16px] leading-relaxed">{msg.reply.answer}</p>
                  {msg.reply.source && <p className="mt-2 font-display text-xs text-mute">{t("chat.source", { source: msg.reply.source })}</p>}
                  <button type="button" onClick={() => void speak(msg.reply.answer, lang as VoiceLang)} className="mt-2 font-display text-xs font-semibold text-paper/70 underline-offset-4 hover:underline">{t("common.listen")}</button>
                  {msg.reply.related.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {msg.reply.related.map((r) => (
                        <button key={r.id} type="button" onClick={() => ask(r.q)} className="rounded-full border border-line px-3 py-1 font-display text-xs text-paper/75">{r.q}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </m.li>
          ))}
        </ul>
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className={cn("fixed inset-x-0 z-30 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur", standalone ? "bottom-0" : "bottom-16")}
      >
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("chat.placeholder")} aria-label={t("chat.placeholder")}
            className="h-12 flex-1 rounded-full border border-line bg-raised px-4 font-serif text-paper outline-none focus:border-crimson" />
          {canListen() && (
            <button type="button" onClick={voice} aria-label={t("screen.tap_speak")} className={cn("grid h-12 w-12 place-items-center rounded-full border border-line", listening && "pulse-emergency bg-signal")}>
              <Mic className="h-5 w-5" />
            </button>
          )}
          <button type="submit" aria-label={t("chat.send")} className="grid h-12 w-12 place-items-center rounded-full bg-crimson"><Send className="h-5 w-5" /></button>
        </div>
      </form>
    </div>
  );
}

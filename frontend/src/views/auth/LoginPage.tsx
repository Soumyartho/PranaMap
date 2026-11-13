import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "@/i18n";
import { Lock, MessageCircle, UserRound } from "lucide-react";
import { forgetPhone, session, signIn, unlock } from "@/controllers/auth/session";
import { api, ApiError } from "@/services/api/client";
import { homeFor } from "@/routes/home";
import { Logo } from "@/views/landing/sections/Logo";
import { Keypad } from "@/views/components/app/Keypad";
import { LanguageSwitch } from "@/views/components/app/bits";
import { setLanguage, type AppLang } from "@/i18n";
import type { User } from "@/models/types/domain";
import { cn } from "@/lib/cx";

interface DemoAccount {
  role: string;
  phone: string;
  label: string;
  name: string;
  pin: string;
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, user } = session.use((s) => s);
  const [mode, setMode] = useState<"unlock" | "signin">(status === "locked" ? "unlock" : "signin");

  useEffect(() => {
    if (status === "locked") setMode("unlock");
    if (status === "ready" && user) navigate(homeFor(user.role), { replace: true });
  }, [status, user, navigate]);

  const done = (u: User) => {
    if (u.role === "asha" && !localStorage.getItem("pranamap.lang")) setLanguage(u.language as AppLang);
    navigate(homeFor(u.role), { replace: true });
  };

  return (
    <main className="min-h-svh bg-ink px-5 py-8 text-paper">
      <div className="mx-auto flex max-w-md flex-col gap-8">
        <header className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-semibold">
            <Logo className="h-8 w-8" /> PranaMap
          </Link>
          <LanguageSwitch />
        </header>
        {mode === "unlock" && user ? (
          <Unlock user={user} onDone={done} onOther={() => setMode("signin")} />
        ) : (
          <SignIn onDone={done} />
        )}
        <Link to="/chat" className="flex items-center justify-center gap-2 rounded-2xl border border-line py-3 font-display text-sm font-semibold text-paper/80">
          <MessageCircle className="h-4 w-4" /> {t("auth.patient_chat")}
        </Link>
      </div>
    </main>
  );
}

function Unlock({ user, onDone, onOther }: { user: User; onDone: (u: User) => void; onOther: () => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    unlock(pin)
      .then(onDone)
      .catch(() => {
        setError(t("auth.wrong_pin"));
        setPin("");
        navigator.vibrate?.([30, 40, 30]);
      })
      .finally(() => setBusy(false));
  }, [pin, busy, onDone, t]);

  return (
    <section className="flex flex-col gap-6">
      <div className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-raised">
          <Lock className="h-7 w-7 text-paper" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold">{t("auth.unlock_as", { name: user.name })}</h1>
        <p className="mx-auto mt-2 max-w-[34ch] font-serif text-[15px] text-mute">{t("auth.unlock_hint")}</p>
      </div>
      <div className="flex justify-center gap-3" aria-label={t("auth.pin")}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-4 w-4 rounded-full border-2 border-paper/60 transition-colors", i < pin.length && "bg-paper")} />
        ))}
      </div>
      <p className="min-h-5 text-center font-display text-sm text-signal" role="alert">{error}</p>
      <Keypad value={pin} onChange={(v) => { setError(null); setPin(v); }} maxLength={4} />
      <div className="flex flex-col gap-2 text-center font-display text-sm">
        <button type="button" onClick={onOther} className="py-2 text-paper/80 underline-offset-4 hover:underline">{t("auth.other_account")}</button>
        <button
          type="button"
          onClick={() => {
            if (confirm(t("auth.forget_confirm"))) void forgetPhone();
          }}
          className="py-2 text-mute underline-offset-4 hover:underline"
        >
          {t("auth.forget")}
        </button>
      </div>
    </section>
  );
}

function SignIn({ onDone }: { onDone: (u: User) => void }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoAccount[]>([]);

  useEffect(() => {
    api<DemoAccount[]>("/auth/demo-accounts").then(setDemo).catch(() => setDemo([]));
  }, []);

  async function submit(p = phone, code = pin) {
    setBusy(true);
    setError(null);
    try {
      onDone(await signIn(p, code));
    } catch (err) {
      const offline = err instanceof ApiError && err.status === 0;
      setError(offline ? t("auth.offline_first_time") : t("auth.wrong_login"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">{t("auth.title")}</h1>
        <p className="mt-2 font-serif text-[15px] text-mute">{t("auth.subtitle")}</p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 font-display text-sm text-paper/80">
          {t("auth.phone")}
          <input
            value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} inputMode="numeric" autoComplete="tel" maxLength={10}
            className="h-14 rounded-2xl border border-line bg-raised px-4 font-display text-xl tracking-wider text-paper outline-none focus:border-crimson"
          />
        </label>
        <label className="flex flex-col gap-1.5 font-display text-sm text-paper/80">
          {t("auth.pin")}
          <input
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" type="password" maxLength={8} autoComplete="current-password"
            className="h-14 rounded-2xl border border-line bg-raised px-4 font-display text-xl tracking-[0.5em] text-paper outline-none focus:border-crimson"
          />
        </label>
        <p className="min-h-5 font-display text-sm text-signal" role="alert">{error}</p>
        <button
          type="submit" disabled={busy || phone.length < 6 || pin.length < 4}
          className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold text-paper transition-colors hover:bg-signal disabled:opacity-40"
        >
          {busy ? t("auth.signing_in") : t("auth.sign_in")}
        </button>
      </form>
      {demo.length > 0 && (
        <div>
          <h2 className="mb-3 font-display text-xs font-semibold uppercase tracking-[0.22em] text-mute">{t("auth.demo")}</h2>
          <ul className="grid gap-2">
            {demo.map((d) => (
              <li key={d.phone}>
                <button
                  type="button" disabled={busy}
                  onClick={() => {
                    setPhone(d.phone);
                    setPin(d.pin);
                    void submit(d.phone, d.pin);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-crimson"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised"><UserRound className="h-5 w-5 text-paper/80" /></span>
                  <span className="min-w-0">
                    <span className="block font-display text-[15px] font-semibold text-paper">{d.label}</span>
                    <span className="block truncate font-serif text-sm text-mute">{d.name} · {d.phone}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

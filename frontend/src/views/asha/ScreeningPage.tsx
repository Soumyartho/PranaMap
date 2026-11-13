import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "@/i18n";
import { AnimatePresence, m } from "framer-motion";
import { ArrowLeft, Volume2, VolumeX, X } from "lucide-react";
import { data } from "@/controllers/asha/data";
import { DANGER_SIGNS, PREGNANCY_SIGNS, SYMPTOM_GROUPS, useScreening, type StepId } from "@/controllers/screening/useScreening";
import { speak, stopSpeaking, type VoiceLang } from "@/services/voice/speech";
import type { Household, Person } from "@/models/types/domain";
import { PranaRing } from "@/views/components/app/PranaRing";
import { Toast } from "@/views/components/app/bits";
import { BpStep, NumberStep, Options, Stepper, SymptomGrid, YesNo } from "./screening/steps";
import { EmergencyOverlay } from "./screening/EmergencyOverlay";
import { ResultView } from "./screening/ResultView";
import { cn } from "@/lib/cx";

const MUTE_KEY = "pranamap.prompts.muted";

export function ScreeningPage() {
  const { personId } = useParams();
  const persons = data.use((s) => s.persons);
  const households = data.use((s) => s.households);
  const person = persons.find((p) => p.id === personId);
  const household = person && households.find((h) => h.id === person.household_id);
  if (!person || !household) return <p className="py-10 text-center text-mute">—</p>;
  return <Flow person={person} household={household} />;
}

function Flow({ person, household }: { person: Person; household: Household }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language as VoiceLang;
  const s = useScreening(person, household);
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === "1");
  const [toast, setToast] = useState<string | null>(null);
  const { step, input } = s;

  const prompt = step === "consent" ? t("screen.consent.text") : t(`screen.q.${step}`);

  // Every screen speaks (unless muted): the prompt plays in the chosen language.
  useEffect(() => {
    if (!muted && step !== "review") void speak(prompt, lang);
    return () => stopSpeaking();
  }, [step, lang, muted, prompt]);

  const pick = <K extends keyof typeof input>(key: K) => (v: (typeof input)[K]) => {
    s.set(key, v);
    setTimeout(s.next, 180);
  };

  function body(id: StepId) {
    switch (id) {
      case "consent":
        return (
          <div className="flex flex-col gap-4">
            <p className="rounded-3xl bg-surface p-5 font-serif text-xl leading-relaxed text-paper/95">{t("screen.consent.text")}</p>
            {s.consented === false && <p className="rounded-2xl bg-warn/15 p-4 font-serif text-warn">{t("screen.consent.refused")}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => void s.recordConsent(false).then(() => setTimeout(() => navigate(-1), 1500))} className="h-16 rounded-2xl border border-line font-display text-lg font-semibold">{t("screen.consent.no")}</button>
              <button type="button" onClick={() => void s.recordConsent(true)} className="h-16 rounded-2xl bg-ok font-display text-lg font-semibold text-ink">{t("screen.consent.yes")}</button>
            </div>
          </div>
        );
      case "basics":
        return (
          <div className="flex flex-col gap-6">
            <Stepper value={input.age} min={14} max={110} onChange={(v) => s.set("age", v)} />
            <div className="grid grid-cols-2 gap-3">
              {(["female", "male"] as const).map((sx) => (
                <button key={sx} type="button" onClick={() => s.set("sex", sx)} className={cn("h-14 rounded-2xl border font-display text-lg font-semibold", input.sex === sx ? "border-crimson bg-crimson/25" : "border-line")}>{t(`household.${sx}`)}</button>
              ))}
            </div>
            <button type="button" onClick={s.next} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold">{t("common.next")}</button>
          </div>
        );
      case "pregnant":
        return <YesNo value={input.pregnant} onPick={pick("pregnant")} />;
      case "tobacco":
        return <Options options={(["never", "past_or_sometimes", "daily"] as const).map((v) => ({ value: v, label: t(`screen.opt.${v}`), icon: v === "never" ? "🚭" : v === "daily" ? "🚬" : "◐" }))} value={input.tobacco} onPick={pick("tobacco")} />;
      case "alcohol":
        return <YesNo value={input.alcohol_daily} onPick={pick("alcohol_daily")} />;
      case "activity":
        return <Options options={(["vigorous", "moderate", "mild", "sedentary"] as const).map((v, i) => ({ value: v, label: t(`screen.opt.${v}`), icon: ["🏃", "🚶", "🧹", "🪑"][i] }))} value={input.activity} onPick={pick("activity")} />;
      case "fh_dm":
        return <Options options={(["none", "one_parent", "both_parents"] as const).map((v) => ({ value: v, label: t(`screen.opt.${v}`) }))} value={input.fh_diabetes} onPick={pick("fh_diabetes")} />;
      case "fh_cv":
        return <YesNo value={input.fh_heart_or_bp} onPick={pick("fh_heart_or_bp")} />;
      case "waist":
        return <NumberStep key={id} field="waist_cm" label={t("screen.q.waist")} unit={t("screen.units.waist")} initial={input.waist_cm} decimals onDone={(v) => { s.set("waist_cm", v); s.next(); }} onSkip={() => { s.set("waist_cm", undefined); s.next(); }} />;
      case "height":
        return <NumberStep key={id} field="height_cm" label={t("screen.q.height")} unit={t("screen.units.height")} initial={input.height_cm} onDone={(v) => { s.set("height_cm", v); s.next(); }} onSkip={() => { s.set("height_cm", undefined); s.next(); }} />;
      case "weight":
        return <NumberStep key={id} field="weight_kg" label={t("screen.q.weight")} unit={t("screen.units.weight")} initial={input.weight_kg} decimals onDone={(v) => { s.set("weight_kg", v); s.next(); }} onSkip={() => { s.set("weight_kg", undefined); s.next(); }} />;
      case "bp1":
      case "bp2": {
        const i = id === "bp1" ? 0 : 1;
        return <BpStep key={id} label={t(`screen.q.${id}`)} initial={input.bp_readings?.[i]} onDone={(r) => { s.setReading(i, r); s.next(); }} onSkip={() => { s.setReading(i, null); s.next(); }} />;
      }
      case "glucose":
        return (
          <NumberStep key={id} field="glucose_mg_dl" label={t("screen.q.glucose")} unit={t("screen.units.glucose")} initial={input.glucose_mg_dl} device="number"
            onDone={(v) => { s.set("glucose_mg_dl", v); s.set("glucose_type", input.glucose_type ?? "random"); s.next(); }}
            onSkip={() => { s.set("glucose_mg_dl", undefined); s.next(); }}>
            <div className="grid grid-cols-2 gap-2">
              {(["random", "fasting"] as const).map((g) => (
                <button key={g} type="button" onClick={() => s.set("glucose_type", g)} className={cn("h-11 rounded-xl border font-display text-sm font-semibold", (input.glucose_type ?? "random") === g ? "border-crimson bg-crimson/25" : "border-line")}>{t(`screen.opt.${g}`)}</button>
              ))}
            </div>
          </NumberStep>
        );
      case "hb":
        return <NumberStep key={id} field="hb_g_dl" label={t("screen.q.hb")} unit={t("screen.units.hb")} initial={input.hb_g_dl} decimals device="number" onDone={(v) => { s.set("hb_g_dl", v); s.next(); }} onSkip={() => { s.set("hb_g_dl", undefined); s.next(); }} />;
      case "spo2":
        return <NumberStep key={id} field="spo2" label={t("screen.q.spo2")} unit={t("screen.units.spo2")} initial={input.spo2} device="spo2" onDone={(v) => { s.set("spo2", v); s.next(); }} onSkip={() => { s.set("spo2", undefined); s.next(); }} />;
      case "danger": {
        const codes = input.pregnant ? [...DANGER_SIGNS, ...PREGNANCY_SIGNS] : DANGER_SIGNS;
        return (
          <div className="flex flex-col gap-4">
            <SymptomGrid codes={codes} selected={input.symptoms ?? []} onToggle={(c) => s.toggleSymptom(c)} danger />
            <button type="button" onClick={() => { codes.forEach((c) => s.toggleSymptom(c, false)); s.next(); }} className="h-14 rounded-2xl border border-line font-display text-lg font-semibold">{t("screen.none_of_these")}</button>
            <button type="button" onClick={s.next} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold">{t("common.next")}</button>
          </div>
        );
      }
      case "symptoms":
        return (
          <div className="flex flex-col gap-5">
            {SYMPTOM_GROUPS.filter((g) => !g.female || input.sex === "female").map((g) => (
              <SymptomGrid key={g.key} codes={g.items} selected={input.symptoms ?? []} onToggle={(c) => s.toggleSymptom(c)} />
            ))}
            <button type="button" onClick={s.next} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold">{t("screen.finish")}</button>
          </div>
        );
      case "review":
        return (
          <ResultView
            person={person} input={input} result={s.result} routing={s.routing}
            onSave={async (opts) => {
              await s.save(opts);
              setToast(t("result.saved"));
              setTimeout(() => navigate(`/asha/homes/${household.id}`, { replace: true }), 900);
            }}
          />
        );
    }
  }

  const progress = (s.index + 1) / s.steps.length;
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 -mx-4 border-b border-line bg-ink/95 px-4 pt-3 pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => navigate(-1)} aria-label={t("common.close")} className="grid h-10 w-10 place-items-center rounded-full border border-line"><X className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-semibold">{person.name}</p>
            <p className="font-display text-xs text-mute">{t("screen.step", { n: s.index + 1, total: s.steps.length })}</p>
          </div>
          {s.consented && step !== "review" && <PranaRing result={s.result} size={52} showLegend={false} />}
          <button
            type="button"
            onClick={() => {
              const m = !muted;
              setMuted(m);
              localStorage.setItem(MUTE_KEY, m ? "1" : "0");
              if (m) stopSpeaking();
            }}
            aria-label={t("screen.speak")}
            className="grid h-10 w-10 place-items-center rounded-full border border-line"
          >
            {muted ? <VolumeX className="h-5 w-5 text-mute" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
          <m.div className="h-full rounded-full bg-crimson" animate={{ width: `${progress * 100}%` }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
        </div>
      </header>

      <AnimatePresence mode="wait">
        <m.section
          key={step}
          data-step={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
          className="flex flex-1 flex-col gap-5 pt-5"
        >
          {step !== "review" && (
            <div className="flex items-start justify-between gap-3">
              <h1 className="font-display text-[1.65rem] font-semibold leading-tight">{step === "consent" ? t("screen.consent.title") : t(`screen.q.${step}`)}</h1>
              <button type="button" onClick={() => void speak(prompt, lang)} aria-label={t("screen.speak")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-raised"><Volume2 className="h-5 w-5" /></button>
            </div>
          )}
          {["waist", "height", "weight", "glucose", "hb", "spo2", "bp2"].includes(step) && <p className="-mt-3 font-serif text-sm text-mute">{t("screen.optional")} · {t("screen.skip_hint")}</p>}
          {body(step)}
          {s.index > 1 && step !== "review" && (
            <button type="button" onClick={s.back} className="mt-auto flex items-center gap-2 self-start py-3 font-display text-sm text-mute"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
          )}
        </m.section>
      </AnimatePresence>

      {s.openEmergency.length > 0 && (
        <EmergencyOverlay flags={s.openEmergency} person={person} household={household} onCalled={() => s.acknowledge(s.openEmergency.map((f) => f.code))} />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

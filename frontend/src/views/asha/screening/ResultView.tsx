import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { m } from "framer-motion";
import { MapPin, MessageCircle, PhoneCall, Play, Sparkles } from "lucide-react";
import { score } from "@/services/risk/engine";
import { speak, type VoiceLang } from "@/services/voice/speech";
import type { ConditionKey, RiskResult, ScreeningInput } from "@/models/types/risk";
import type { Person } from "@/models/types/domain";
import type { RouteReason, RouteResult } from "@/services/routing";
import type { Override } from "@/controllers/screening/useScreening";
import { PranaRing } from "@/views/components/app/PranaRing";
import { WhyBars } from "@/views/components/app/WhyBars";
import { BandBadge, URGENCY_COLOR } from "@/views/components/app/risk";
import { Card, SectionTitle } from "@/views/components/app/bits";
import { cn } from "@/lib/cx";

export function useReasonLabel() {
  const { t } = useTranslation();
  return (r: RouteReason) => {
    const value = Array.isArray(r.value) ? r.value.map((c) => t(`caps.${c}`)).join(", ") : r.value;
    return t(`route_reasons.${r.code}`, typeof value === "number" ? { value, count: value } : { value });
  };
}

interface Props {
  person: Person;
  input: ScreeningInput;
  result: RiskResult;
  routing: RouteResult | null;
  onSave: (opts: { book: boolean; override: Override | null }) => Promise<void>;
}

export function ResultView({ person, input, result, routing, onSave }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as VoiceLang;
  const reasonLabel = useReasonLabel();
  const urgency = result.overall.urgency;
  const ranked = (Object.entries(result.conditions) as [ConditionKey, NonNullable<RiskResult["conditions"][ConditionKey]>][]).sort(
    (a, b) => b[1].score - a[1].score,
  );
  const [selected, setSelected] = useState<ConditionKey | null>(ranked[0]?.[0] ?? null);
  const [book, setBook] = useState(true);
  const [taught, setTaught] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [override, setOverride] = useState<Override>({ decision: result.overall.refer ? "no_referral" : "refer", reason: "" });
  const [saving, setSaving] = useState(false);

  // What-if: re-score a changed copy of the input. Estimates, shown as a ghost ring.
  const [whatIf, setWhatIf] = useState({ waist: 0, active: false, quit: false });
  const ghost = useMemo(() => {
    if (!whatIf.waist && !whatIf.active && !whatIf.quit) return null;
    const x: ScreeningInput = { ...input };
    if (whatIf.waist && x.waist_cm) x.waist_cm = x.waist_cm - whatIf.waist;
    if (whatIf.active) x.activity = "moderate";
    if (whatIf.quit) x.tobacco = "never";
    return score(x);
  }, [input, whatIf]);

  const cond = selected ? result.conditions[selected] : null;
  const top = ranked.find(([, c]) => c.band !== "low");
  const advice = top ? t(`actions.${top[1].action}`) : t("urgency.routine_text");
  const when = urgency === "emergency" || urgency === "urgent" ? t("teach.when_today") : t("teach.when_week");
  const steps = [
    routing ? t(routing.mode === "teleconsult" ? "teach.go_tele" : "teach.go", { place: routing.facility_name, when }) : null,
    advice,
    t("teach.danger"),
  ].filter(Boolean) as string[];
  const summary = t("summary", { name: person.name, urgency: t(`urgency.${urgency}`), advice: `${advice} ${steps[0] ?? ""}` });

  return (
    <div className="flex flex-col gap-4 pb-8">
      <m.section
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className={cn("rounded-3xl p-5", urgency === "emergency" && "pulse-emergency")}
        style={{ background: `color-mix(in oklab, ${URGENCY_COLOR[urgency]} 22%, #0c0a0a)` }}
      >
        <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-paper/70">{t("result.title")}</p>
        <h2 className="mt-1 font-display text-3xl font-semibold" style={{ color: URGENCY_COLOR[urgency] }}>{t(`urgency.${urgency}`)}</h2>
        <p className="mt-2 font-serif text-[17px] text-paper/90">{t(`urgency.${urgency}_text`)}</p>
        {result.red_flags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {result.red_flags.map((f) => <li key={f.code} className="rounded-full bg-ink/40 px-3 py-1 font-display text-sm">{t(`flags.${f.code}`)}</li>)}
          </ul>
        )}
      </m.section>

      {!result.eligible ? (
        <Card><p className="font-serif text-paper/85">{t("result.not_eligible")}</p></Card>
      ) : (
        <Card>
          <PranaRing result={result} ghost={ghost} size={176} selected={selected} onSelect={setSelected} />
          {result.cbac && <p className="mt-4 font-display text-sm text-mute">{t("result.cbac", { score: result.cbac.score, max: result.cbac.max })}</p>}
        </Card>
      )}

      {cond && selected && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-xl font-semibold">{t(`conditions.${selected}`)}</h3>
            {cond.computed === false ? <span className="font-display text-xs text-mute">—</span> : <BandBadge band={cond.band} />}
          </div>
          {cond.computed === false ? (
            <p className="mt-2 rounded-xl bg-raised px-3 py-2 font-serif text-[16px] text-warn">{t("result.not_computed")}</p>
          ) : typeof cond.risk_10y === "number" ? (
            <p className="mt-2 font-display text-[15px] text-paper/85">{t("result.risk_10y", { value: Math.round(cond.risk_10y * 100) })}</p>
          ) : null}
          <p className="mt-2 font-serif text-[17px] text-paper/90">{t(`actions.${cond.action}`)}</p>
          <div className="mt-4">
            <SectionTitle aside={<span className="font-display text-xs text-mute">{t(`confidence.${cond.confidence}`)}</span>}>{t("result.why")}</SectionTitle>
            {cond.drivers.length ? <WhyBars drivers={cond.drivers} /> : <p className="font-serif text-mute">—</p>}
          </div>
          {cond.sharpen.length > 0 && (
            <div className="mt-4 rounded-2xl bg-raised p-3">
              <p className="flex items-center gap-1.5 font-display text-sm font-semibold text-warn"><Sparkles className="h-4 w-4" /> {t("result.sharpen")}</p>
              <ul className="mt-1 list-inside list-disc font-serif text-[15px] text-paper/80">
                {cond.sharpen.map((s) => <li key={s}>{t(`sharpen.${s}`)}</li>)}
              </ul>
            </div>
          )}
          <p className="mt-3 font-display text-xs text-mute">{t("result.instrument", { name: cond.instrument })}</p>
        </Card>
      )}

      {result.eligible && (
        <Card>
          <SectionTitle>{t("result.whatif")}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {input.waist_cm !== undefined && [5, 10].map((cm) => (
              <Chip key={cm} on={whatIf.waist === cm} onClick={() => setWhatIf((w) => ({ ...w, waist: w.waist === cm ? 0 : cm }))}>{t("result.waist_less", { count: cm })}</Chip>
            ))}
            {(input.activity === "mild" || input.activity === "sedentary") && (
              <Chip on={whatIf.active} onClick={() => setWhatIf((w) => ({ ...w, active: !w.active }))}>{t("result.more_active")}</Chip>
            )}
            {input.tobacco && input.tobacco !== "never" && (
              <Chip on={whatIf.quit} onClick={() => setWhatIf((w) => ({ ...w, quit: !w.quit }))}>{t("result.quit_tobacco")}</Chip>
            )}
          </div>
          {ghost && (
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {ranked.map(([k, c]) => {
                const d = (ghost.conditions[k]?.score ?? c.score) - c.score;
                return (
                  <li key={k} className="flex justify-between rounded-xl bg-raised px-3 py-2 font-display text-sm">
                    <span>{t(`conditions.${k}`)}</span>
                    <span className={d < 0 ? "text-ok" : "text-mute"}>{d === 0 ? "—" : d > 0 ? `+${d}` : d}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 font-display text-xs text-mute">{t("result.whatif_note")}</p>
        </Card>
      )}

      {result.overall.refer && (
        <Card>
          <SectionTitle>{t("result.route")}</SectionTitle>
          {routing ? (
            <>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-crimson">
                  {routing.mode === "teleconsult" ? <PhoneCall className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                </span>
                <div>
                  <p className="font-display text-lg font-semibold">{routing.facility_name}</p>
                  <p className="font-display text-sm text-mute">{routing.mode === "teleconsult" ? t("result.teleconsult") : t("result.in_person")}</p>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {routing.reasons.map((r) => (
                  <li key={r.code} className="flex gap-2 font-serif text-[15px] text-paper/85"><span className="text-ok">✓</span>{reasonLabel(r)}</li>
                ))}
              </ul>
              {routing.alternatives.length > 0 && (
                <p className="mt-3 font-display text-xs text-mute">
                  {t("result.alternatives")}: {routing.alternatives.map((a) => `${a.facility_name} (${t("common.minutes", { count: a.travel_minutes })})`).join(" · ")}
                </p>
              )}
              <label className="mt-4 flex items-center gap-3 rounded-2xl bg-raised p-3 font-display text-[15px]">
                <input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} className="h-5 w-5 accent-[#bc0202]" />
                {t("result.book")}
              </label>
            </>
          ) : (
            <p className="font-serif text-paper/85">{t("result.no_route")}</p>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle>{t("result.teach")}</SectionTitle>
        <p className="mb-3 font-serif text-sm text-mute">{t("result.teach_hint")}</p>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 font-serif text-[16px] text-paper/90">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-raised font-display text-sm font-semibold">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void speak(steps.join(" "), lang)} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line font-display text-sm font-semibold"><Play className="h-4 w-4" /> {t("common.listen")}</button>
          <button type="button" onClick={() => setTaught((v) => !v)} aria-pressed={taught} className={cn("h-12 rounded-xl border font-display text-sm font-semibold", taught ? "border-ok bg-ok/20 text-ok" : "border-line")}>{t("result.teach_ok")}</button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => void speak(summary, lang)} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line font-display text-sm font-semibold"><Play className="h-4 w-4" /> {t("result.play")}</button>
        {person.phone ? (
          <a href={`https://wa.me/91${person.phone}?text=${encodeURIComponent(summary)}`} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line font-display text-sm font-semibold">
            <MessageCircle className="h-4 w-4" /> {t("result.whatsapp")}
          </a>
        ) : <span />}
      </div>

      <details open={overriding} onToggle={(e) => setOverriding((e.target as HTMLDetailsElement).open)} className="rounded-2xl border border-line bg-surface p-4">
        <summary className="cursor-pointer font-display text-sm font-semibold text-paper/80">{t("result.override")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {(["refer", "no_referral"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setOverride((o) => ({ ...o, decision: d }))}
                className={cn("h-12 rounded-xl border font-display text-sm font-semibold", override.decision === d ? "border-crimson bg-crimson/25" : "border-line")}>
                {t(d === "refer" ? "result.override_refer" : "result.override_none")}
              </button>
            ))}
          </div>
          <textarea value={override.reason} onChange={(e) => setOverride((o) => ({ ...o, reason: e.target.value }))} placeholder={t("result.override_reason")} rows={2}
            className="rounded-xl border border-line bg-raised p-3 font-serif text-paper outline-none focus:border-crimson" />
        </div>
      </details>

      <button
        type="button"
        disabled={saving || (overriding && override.reason.trim().length < 3)}
        onClick={async () => {
          setSaving(true);
          await onSave({ book, override: overriding ? override : null });
        }}
        className="h-16 rounded-2xl bg-crimson font-display text-xl font-semibold transition-colors hover:bg-signal disabled:opacity-40"
      >
        {t("result.save")}
      </button>
      <p className="text-center font-display text-xs text-mute">{t("result.decision_support")} · {t("result.engine", { v: result.engine_version })}</p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("rounded-full border px-3.5 py-2 font-display text-sm font-semibold", on ? "border-ok bg-ok/20 text-ok" : "border-line text-paper/80")}>
      {children}
    </button>
  );
}

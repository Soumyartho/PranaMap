import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/i18n";
import { m } from "framer-motion";
import { ChevronRight, Footprints, Megaphone, Minus, Plus } from "lucide-react";
import { data, enqueue } from "@/controllers/asha/data";
import { session } from "@/controllers/auth/session";
import { buildToday, type GroupKey, type TodayItem } from "@/controllers/asha/today";
import { ProgressRing, SectionTitle, Sheet, SyncChip, Toast } from "@/views/components/app/bits";
import { UrgencyPill } from "@/views/components/app/risk";
import { formatDateTime } from "@/utils/time";
import { uuidv7 } from "@/utils/id";
import { cn } from "@/lib/cx";

const ORDER: GroupKey[] = ["emergency", "rescue", "upcoming", "unscreened", "rescreen"];
const SYNDROMES = ["fever", "acute_diarrhoea", "fever_with_rash", "jaundice", "cough_cold"];

export function TodayPage() {
  const { t, i18n } = useTranslation();
  const user = session.use((s) => s.user)!;
  const persons = data.use((s) => s.persons);
  const households = data.use((s) => s.households);
  const screenings = data.use((s) => s.screenings);
  const referrals = data.use((s) => s.referrals);
  const alerts = data.use((s) => s.alerts);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { groups, coverage } = useMemo(
    () => buildToday(persons, households, screenings, referrals),
    [persons, households, screenings, referrals],
  );
  const pct = coverage.total ? coverage.done / coverage.total : 0;
  const empty = ORDER.every((g) => groups[g].length === 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center gap-5 pt-2">
        <ProgressRing value={pct} size={104} stroke={11}>
          <span className="font-display text-2xl font-semibold">{Math.round(pct * 100)}%</span>
        </ProgressRing>
        <div className="min-w-0">
          <p className="font-display text-sm text-mute">{t("today.greeting", { name: user.name.split(" ")[0] })}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold leading-tight">{t("today.coverage")}</h1>
          <p className="mt-1 font-serif text-[15px] text-paper/75">{t("today.coverage_caption", { done: coverage.done, total: coverage.total })}</p>
        </div>
      </section>

      <SyncChip />

      {alerts.length > 0 && (
        <section>
          <SectionTitle>{t("today.alerts")}</SectionTitle>
          <ul className="space-y-2">
            {alerts.slice(0, 3).map((a) => (
              <li key={a.id} className={cn("rounded-2xl border px-4 py-3 font-serif text-[15px]", a.level === "critical" ? "border-signal/50 bg-blood/25" : "border-warn/40 bg-raised")}>
                {t(`alerts.${a.code}`, { person: (a.data?.person as string) ?? "", defaultValue: t("alerts.default") })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {empty && <p className="rounded-3xl border border-line bg-surface p-6 text-center font-serif text-paper/80">{t("today.empty")}</p>}

      {ORDER.map((g) =>
        groups[g].length ? (
          <section key={g}>
            <SectionTitle aside={g === "unscreened" ? <span className="flex items-center gap-1 font-display text-xs text-mute"><Footprints className="h-3.5 w-3.5" />{t("today.walk_order")}</span> : null}>
              {t(`today.groups.${g}`)} · {groups[g].length}
            </SectionTitle>
            <ul className="space-y-2">
              {groups[g].map((item, i) => (
                <m.li key={item.person.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                  <TodayRow item={item} group={g} locale={i18n.language} />
                </m.li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      <button type="button" onClick={() => setReporting(true)} className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-4 font-display font-semibold text-paper/90">
        <Megaphone className="h-5 w-5 text-warn" /> {t("today.report")}
      </button>

      <ReportSheet open={reporting} onClose={() => setReporting(false)} onSaved={() => { setReporting(false); setToast(t("today.report_saved")); }} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function TodayRow({ item, group, locale }: { item: TodayItem; group: GroupKey; locale: string }) {
  const { t } = useTranslation();
  const { person, household, referral } = item;
  const age = new Date().getFullYear() - person.birth_year;
  const to = group === "unscreened" || group === "rescreen" ? `/asha/screen/${person.id}` : group === "emergency" ? `/asha/homes/${household.id}` : "/asha/referrals";
  let sub = `${household.number} · ${t("common.years", { count: age })}`;
  if (referral?.status === "missed") sub += ` · ${t("today.missed_on", { when: formatDateTime(referral.appointment?.slot_start, locale) })}`;
  else if (group === "upcoming") sub += ` · ${t("today.visit_on", { when: formatDateTime(referral?.appointment?.slot_start, locale) })}`;
  else if (group === "rescue") sub += ` · ${t("today.overdue")}`;
  return (
    <Link to={to} className="cv-auto flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition-colors active:bg-raised">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[17px] font-semibold">{person.name}</p>
        <p className="truncate font-serif text-sm text-mute">{sub}</p>
      </div>
      {referral ? <UrgencyPill urgency={referral.urgency} /> : item.walk ? <span className="font-display text-xs text-mute">{t("common.minutes", { count: item.walk })}</span> : null}
      <ChevronRight className="h-5 w-5 shrink-0 text-mute" />
    </Link>
  );
}

/** Doorstep syndrome counts feed the outbreak radar on the PHC dashboard. */
function ReportSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const villages = data.use((s) => s.villages);
  const [village, setVillage] = useState<string>("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const villageId = village || villages[0]?.id;

  async function save() {
    const day = new Date().toISOString().slice(0, 10);
    for (const [syndrome, count] of Object.entries(counts)) {
      if (count > 0) await enqueue("syndrome.report", { id: uuidv7(), village_id: villageId, syndrome, day, count }, villageId);
    }
    setCounts({});
    onSaved();
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("today.report_title")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("today.village")}>
          {villages.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={villageId === v.id} onClick={() => setVillage(v.id)}
              className={cn("rounded-full border px-4 py-2 font-display text-sm font-semibold", villageId === v.id ? "border-crimson bg-crimson text-paper" : "border-line text-paper/80")}>
              {v.name}
            </button>
          ))}
        </div>
        <ul className="space-y-2">
          {SYNDROMES.map((s) => (
            <li key={s} className="flex items-center justify-between rounded-2xl bg-raised px-4 py-2">
              <span className="font-display text-[16px]">{t(`syndromes.${s}`)}</span>
              <span className="flex items-center gap-3">
                <button type="button" aria-label="-" onClick={() => setCounts((c) => ({ ...c, [s]: Math.max(0, (c[s] ?? 0) - 1) }))} className="grid h-10 w-10 place-items-center rounded-full border border-line"><Minus className="h-4 w-4" /></button>
                <span className="w-6 text-center font-display text-xl font-semibold">{counts[s] ?? 0}</span>
                <button type="button" aria-label="+" onClick={() => setCounts((c) => ({ ...c, [s]: (c[s] ?? 0) + 1 }))} className="grid h-10 w-10 place-items-center rounded-full bg-crimson"><Plus className="h-4 w-4" /></button>
              </span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={save} disabled={!Object.values(counts).some(Boolean)} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold disabled:opacity-40">
          {t("common.save")}
        </button>
      </div>
    </Sheet>
  );
}

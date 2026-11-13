import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "@/i18n";
import { ArrowLeft, Plus, Stethoscope } from "lucide-react";
import { ageOf, data, enqueue, latestScreening, openReferral, putPerson } from "@/controllers/asha/data";
import { Sheet } from "@/views/components/app/bits";
import { UrgencyPill } from "@/views/components/app/risk";
import type { Person } from "@/models/types/domain";
import { formatDate } from "@/utils/time";
import { uuidv7 } from "@/utils/id";
import { Field } from "./HouseholdsPage";
import { maskAbha, normalizeAbhaNumber } from "@/utils/abha";
import { cn } from "@/lib/cx";

export function HouseholdPage() {
  const { householdId } = useParams();
  const { t, i18n } = useTranslation();
  const households = data.use((s) => s.households);
  const persons = data.use((s) => s.persons);
  const screenings = data.use((s) => s.screenings);
  const referrals = data.use((s) => s.referrals);
  const villages = data.use((s) => s.villages);
  const [adding, setAdding] = useState(false);
  const household = households.find((h) => h.id === householdId);
  const members = useMemo(() => persons.filter((p) => p.household_id === householdId).sort((a, b) => a.birth_year - b.birth_year), [persons, householdId]);

  if (!household) return <p className="py-10 text-center text-mute">—</p>;
  const village = villages.find((v) => v.id === household.village_id);

  return (
    <div className="flex flex-col gap-5">
      <Link to="/asha/homes" className="flex items-center gap-2 font-display text-sm text-mute"><ArrowLeft className="h-4 w-4" /> {t("household.title")}</Link>
      <header>
        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-crimson">{village?.name} · {household.number}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold">{household.head_name}</h1>
      </header>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-mute">{t("household.members")}</h2>
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 font-display text-sm font-semibold text-paper"><Plus className="h-4 w-4" /> {t("household.add_member")}</button>
        </div>
        <ul className="space-y-2">
          {members.map((p) => {
            const age = ageOf(p);
            const last = latestScreening(screenings, p.id);
            const ref = openReferral(referrals, p.id);
            return (
              <li key={p.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-[17px] font-semibold">{p.name}</p>
                    <p className="font-serif text-sm text-mute">
                      {t(`household.${p.sex}`)} · {t("common.years", { count: age })}
                      {p.pregnant && ` · ${t("household.pregnant")}`}
                      {p.known_diabetes && ` · ${t("household.known_dm")}`}
                      {p.known_hypertension && ` · ${t("household.known_htn")}`}
                      {p.abha_number && ` · ABHA ${maskAbha(p.abha_number)}`}
                    </p>
                    <p className="mt-1 font-serif text-sm text-paper/70">
                      {last ? t("household.last", { when: formatDate(last.captured_at, i18n.language) }) : age >= 30 ? t("household.never") : t("household.under_30")}
                    </p>
                  </div>
                  {(ref || (last && last.urgency !== "routine")) && <UrgencyPill urgency={ref?.urgency ?? last!.urgency} />}
                </div>
                <Link to={`/asha/screen/${p.id}`} className={cn("mt-3 flex h-12 items-center justify-center gap-2 rounded-xl font-display font-semibold", last ? "border border-line text-paper" : "bg-crimson text-paper")}>
                  <Stethoscope className="h-5 w-5" /> {last ? t("household.rescreen") : t("household.screen")}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <AddMemberSheet open={adding} householdId={household.id} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddMemberSheet({ open, onClose, householdId }: { open: boolean; onClose: () => void; householdId: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [sex, setSex] = useState<"female" | "male">("female");
  const [age, setAge] = useState("");
  const [phone, setPhone] = useState("");
  const [abha, setAbha] = useState("");
  const abhaNumber = normalizeAbhaNumber(abha);
  const abhaInvalid = abha.trim() !== "" && abhaNumber === null;
  const [flags, setFlags] = useState({ pregnant: false, known_diabetes: false, known_hypertension: false });

  async function save() {
    const now = new Date().toISOString();
    const p: Person = {
      id: uuidv7(), household_id: householdId, name: name.trim(), sex, birth_year: new Date().getFullYear() - Number(age),
      phone: phone || null, abha_number: abhaNumber, medications: [], ...flags, pregnant: sex === "female" && flags.pregnant,
    };
    await putPerson(p);
    // Every field carries its own timestamp so the server can merge per field (last writer wins).
    const fields = ["name", "sex", "birth_year", "phone", "abha_number", "pregnant", "known_diabetes", "known_hypertension"];
    await enqueue("person.upsert", { ...p, field_clock: Object.fromEntries(fields.map((f) => [f, now])) }, p.id);
    setName("");
    setAge("");
    setPhone("");
    setAbha("");
    onClose();
  }

  const toggle = (k: keyof typeof flags) => setFlags((f) => ({ ...f, [k]: !f[k] }));
  return (
    <Sheet open={open} onClose={onClose} title={t("household.add_member")}>
      <div className="flex flex-col gap-4">
        <Field label={t("household.name")} value={name} onChange={setName} />
        <div className="grid grid-cols-2 gap-2">
          {(["female", "male"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSex(s)} className={cn("h-12 rounded-xl border font-display font-semibold", sex === s ? "border-crimson bg-crimson" : "border-line")}>{t(`household.${s}`)}</button>
          ))}
        </div>
        <Field label={t("household.age")} value={age} onChange={(v) => setAge(v.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
        <Field label={t("household.phone")} value={phone} onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 10))} inputMode="tel" />
        <Field label={t("household.abha")} value={abha} onChange={(v) => setAbha(v.replace(/[^\d\s-]/g, "").slice(0, 17))} inputMode="numeric" />
        {abhaInvalid && <p className="-mt-2 font-display text-sm text-warn">{t("household.abha_invalid")}</p>}
        <div className="flex flex-wrap gap-2">
          {(sex === "female" ? (["pregnant", "known_diabetes", "known_hypertension"] as const) : (["known_diabetes", "known_hypertension"] as const)).map((k) => (
            <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={flags[k]}
              className={cn("rounded-full border px-4 py-2 font-display text-sm font-semibold", flags[k] ? "border-warn bg-warn/20 text-warn" : "border-line text-paper/75")}>
              {t(k === "pregnant" ? "household.pregnant" : k === "known_diabetes" ? "household.known_dm" : "household.known_htn")}
            </button>
          ))}
        </div>
        <button type="button" onClick={save} disabled={!name.trim() || !age || Number(age) > 110 || abhaInvalid} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold disabled:opacity-40">{t("common.save")}</button>
      </div>
    </Sheet>
  );
}

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "@/i18n";
import { ChevronRight, Plus, Search } from "lucide-react";
import { data, enqueue, latestScreening, putHousehold } from "@/controllers/asha/data";
import { Sheet } from "@/views/components/app/bits";
import { UrgencyPill } from "@/views/components/app/risk";
import type { Household } from "@/models/types/domain";
import { uuidv7 } from "@/utils/id";
import { cn } from "@/lib/cx";

export function HouseholdsPage() {
  const { t } = useTranslation();
  const villages = data.use((s) => s.villages);
  const households = data.use((s) => s.households);
  const persons = data.use((s) => s.persons);
  const screenings = data.use((s) => s.screenings);
  const [village, setVillage] = useState<string>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return households
      .filter((h) => village === "all" || h.village_id === village)
      .map((h) => {
        const members = persons.filter((p) => p.household_id === h.id);
        const urgent = members
          .map((m) => latestScreening(screenings, m.id))
          .filter(Boolean)
          .sort((a, b) => (b!.priority ?? 0) - (a!.priority ?? 0))[0];
        return { h, members, urgent };
      })
      .filter(({ h, members }) => !query || h.number.toLowerCase().includes(query) || h.head_name.toLowerCase().includes(query) || members.some((m) => m.name.toLowerCase().includes(query)))
      .sort((a, b) => a.h.number.localeCompare(b.h.number));
  }, [households, persons, screenings, village, q]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t("household.title")}</h1>
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-full bg-crimson px-4 py-2 font-display text-sm font-semibold">
          <Plus className="h-4 w-4" /> {t("household.add_home")}
        </button>
      </div>
      <label className="flex h-12 items-center gap-2 rounded-2xl border border-line bg-raised px-4">
        <Search className="h-4 w-4 text-mute" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("household.search")} className="h-full flex-1 bg-transparent font-display text-paper outline-none placeholder:text-mute" />
      </label>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: "all", name: "All" }, ...villages].map((v) => (
          <button key={v.id} type="button" onClick={() => setVillage(v.id)}
            className={cn("shrink-0 rounded-full border px-4 py-2 font-display text-sm font-semibold", village === v.id ? "border-crimson bg-crimson" : "border-line text-paper/75")}>
            {v.name}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {rows.map(({ h, members, urgent }) => (
          <li key={h.id}>
            <Link to={`/asha/homes/${h.id}`} className="cv-auto flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
              <span className="grid h-11 w-14 shrink-0 place-items-center rounded-xl bg-raised font-display text-xs font-semibold text-paper/80">{h.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[16px] font-semibold">{h.head_name}</span>
                <span className="block font-serif text-sm text-mute">{t("household.members")}: {members.length}</span>
              </span>
              {urgent && urgent.urgency !== "routine" && <UrgencyPill urgency={urgent.urgency} />}
              <ChevronRight className="h-5 w-5 text-mute" />
            </Link>
          </li>
        ))}
      </ul>
      <AddHomeSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddHomeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const villages = data.use((s) => s.villages);
  const [villageId, setVillageId] = useState("");
  const [head, setHead] = useState("");
  const [number, setNumber] = useState("");
  const vid = villageId || villages[0]?.id;

  async function save() {
    const v = villages.find((x) => x.id === vid)!;
    // Use the phone's location when it has a fix; otherwise the village centre.
    const pos = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 4000, maximumAge: 600_000 });
    });
    const h: Household = {
      id: uuidv7(), village_id: v.id, head_name: head.trim(), number: number.trim() || `${v.name.slice(0, 3).toUpperCase()}-NEW`,
      lat: pos?.coords.latitude ?? v.lat, lon: pos?.coords.longitude ?? v.lon,
    };
    await putHousehold(h);
    await enqueue("household.upsert", { ...h }, h.id);
    onClose();
    navigate(`/asha/homes/${h.id}`);
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("household.add_home")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {villages.map((v) => (
            <button key={v.id} type="button" onClick={() => setVillageId(v.id)}
              className={cn("rounded-full border px-4 py-2 font-display text-sm font-semibold", vid === v.id ? "border-crimson bg-crimson" : "border-line text-paper/80")}>
              {v.name}
            </button>
          ))}
        </div>
        <Field label={t("household.head")} value={head} onChange={setHead} />
        <Field label={t("household.number")} value={number} onChange={setNumber} />
        <button type="button" disabled={!head.trim()} onClick={save} className="h-14 rounded-2xl bg-crimson font-display text-lg font-semibold disabled:opacity-40">{t("common.save")}</button>
      </div>
    </Sheet>
  );
}

export function Field({ label, value, onChange, inputMode, type = "text" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric" | "tel" | "text";
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 font-display text-sm text-paper/80">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} type={type}
        className="h-13 rounded-2xl border border-line bg-raised px-4 py-3 font-display text-lg text-paper outline-none focus:border-crimson" />
    </label>
  );
}

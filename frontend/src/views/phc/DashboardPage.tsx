import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { AnimatePresence, m } from "framer-motion";
import { Activity, AlertTriangle, Bell, Clock, FastForward, LogOut, MapPinned, RotateCcw, Users, X } from "lucide-react";
import { lock, session } from "@/controllers/auth/session";
import { usePoll } from "@/controllers/staff/usePoll";
import type { CoverageRow, OutbreakData, Packet, StaffAlert, StaffReferral, Summary } from "@/controllers/staff/types";
import { api } from "@/services/api/client";
import { CountUp, ProgressRing, Sparkline } from "@/views/components/app/bits";
import { UrgencyPill } from "@/views/components/app/risk";
import { Logo } from "@/views/landing/sections/Logo";
import { ReferralStepper } from "@/views/asha/ReferralsPage";
import { PacketView } from "@/views/doctor/PacketView";
import { TriageBoard } from "./TriageBoard";
import { ModelPanel } from "./ModelPanel";
import type { HexData } from "./HexMap";
import { formatDateTime } from "@/utils/time";
import { cn } from "@/lib/cx";

const HexMap = lazy(() => import("./HexMap").then((m) => ({ default: m.HexMap })));

const ROLE_LABEL: Record<string, string> = {
  anm: "ANM", medical_officer: "PHC medical officer", doctor: "Doctor", district_officer: "District health officer",
};

export default function DashboardPage() {
  const user = session.use((s) => s.user)!;
  const summary = usePoll<Summary>("/dashboard/summary", 20_000);
  const hex = usePoll<HexData>("/dashboard/hexmap", 60_000);
  const refs = usePoll<StaffReferral[]>("/referrals", 15_000);
  const alerts = usePoll<StaffAlert[]>("/alerts", 15_000);
  const coverage = usePoll<CoverageRow[]>("/dashboard/coverage", 60_000);
  const outbreaks = usePoll<OutbreakData>("/dashboard/outbreaks", 60_000);
  const [open, setOpen] = useState<string | null>(null);
  const [clock, setClock] = useState<string | null>(null);
  const canTriage = user.role === "medical_officer" || user.role === "doctor";
  const isDistrict = user.role === "district_officer";

  async function advance(hours: number) {
    const res = await api<{ clock_offset_hours: number; escalations: number }>("/demo/advance", { method: "POST", json: { hours } });
    setClock(`Clock +${res.clock_offset_hours}h · ${res.escalations} escalations`);
    void Promise.all([summary.reload(), refs.reload(), alerts.reload()]);
  }
  async function resetClock() {
    await api("/demo/reset-clock", { method: "POST" });
    setClock(null);
    void Promise.all([summary.reload(), refs.reload()]);
  }

  const s = summary.data;
  return (
    <div className="min-h-svh bg-ink text-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8" />
            <div>
              <p className="font-display text-[15px] font-semibold leading-tight">{user.block}</p>
              <p className="font-display text-xs text-mute">{ROLE_LABEL[user.role]} · {user.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 rounded-full border border-line p-1 md:flex" title="Demo only: move the server clock forward to show escalations">
              <span className="px-2 font-display text-[11px] text-mute">Demo clock</span>
              <button type="button" onClick={() => advance(24)} className="flex items-center gap-1 rounded-full px-3 py-1 font-display text-xs font-semibold hover:bg-raised"><FastForward className="h-3.5 w-3.5" /> 1 day</button>
              <button type="button" onClick={() => advance(72)} className="flex items-center gap-1 rounded-full px-3 py-1 font-display text-xs font-semibold hover:bg-raised"><FastForward className="h-3.5 w-3.5" /> 3 days</button>
              <button type="button" onClick={resetClock} aria-label="Reset clock" className="rounded-full p-1.5 hover:bg-raised"><RotateCcw className="h-3.5 w-3.5" /></button>
            </div>
            <button type="button" onClick={lock} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-display text-xs font-semibold"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
          </div>
        </div>
        {clock && <p className="bg-warn/15 py-1 text-center font-display text-xs text-warn">{clock}</p>}
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 py-6">
        {summary.error && !s && <p className="rounded-2xl bg-blood/30 p-4 font-display">Cannot reach the server ({summary.error}).</p>}
        {s && <Kpis s={s} />}

        <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
          <section className="flex flex-col gap-3">
            <Title icon={MapPinned} aside="H3 cells · 180 days">Risk map</Title>
            <div className="h-[30rem]">
              {hex.data ? (
                <Suspense fallback={<Skeleton />}><HexMap data={hex.data} /></Suspense>
              ) : <Skeleton />}
            </div>
          </section>
          <Alerts alerts={alerts.data ?? []} onAck={async (id) => { await api(`/alerts/${id}/ack`, { method: "POST" }); void alerts.reload(); }} onOpen={setOpen} />
        </div>

        {!isDistrict && refs.data && (
          <section className="flex flex-col gap-3">
            <Title icon={Activity} aside={canTriage ? "Drag cases between lanes" : "Read only"}>Triage board</Title>
            <TriageBoard
              referrals={refs.data}
              canEdit={canTriage}
              onOpen={setOpen}
              onChanged={(id, lane) => refs.setData((list) => list?.map((r) => (r.id === id ? { ...r, lane } : r)) ?? null)}
            />
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          {s && <Trend s={s} />}
          <Outbreaks data={outbreaks.data} />
          <Coverage rows={coverage.data ?? []} />
        </div>

        {refs.data && <Tracker referrals={refs.data} onOpen={setOpen} hideNames={isDistrict} />}

        {(user.role === "medical_officer" || isDistrict) && <ModelPanel />}
      </main>

      <AnimatePresence>
        {open && <PacketDrawer id={open} onClose={() => setOpen(null)} role={user.role} onChanged={() => void Promise.all([refs.reload(), summary.reload()])} />}
      </AnimatePresence>
    </div>
  );
}

function Title({ icon: Icon, children, aside }: { icon: typeof Activity; children: React.ReactNode; aside?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><Icon className="h-5 w-5 text-crimson" /> {children}</h2>
      {aside && <span className="font-display text-xs text-mute">{aside}</span>}
    </div>
  );
}

const Skeleton = () => <div className="h-full min-h-48 animate-pulse rounded-3xl border border-line bg-surface" />;

function Kpis({ s }: { s: Summary }) {
  const rate = s.loop_closure.rate;
  const cards = [
    { label: "Coverage (30+, quarter)", value: s.coverage * 100, suffix: "%", sub: `${s.screened_quarter} of ${s.population_30plus}` },
    { label: "Need follow-up", value: s.high_risk, sub: `${s.emergencies_quarter} emergencies` },
    { label: "Open referrals", value: s.open_referrals, sub: `${s.by_status.booked ?? 0} booked · ${s.by_status.missed ?? 0} missed` },
    { label: "Overdue", value: s.overdue, sub: "escalating", warn: s.overdue > 0 },
    { label: "Median days to visit", value: s.median_days_to_visit ?? 0, decimals: 1, sub: "screening → clinician" },
  ];
  return (
    <section className="grid gap-3 md:grid-cols-[1.25fr_repeat(5,1fr)]">
      <div className="flex items-center gap-4 rounded-3xl border border-crimson/60 bg-blood/20 p-5 md:row-span-1">
        <ProgressRing value={rate ?? 0} size={92} stroke={10} color="var(--color-signal)">
          <span className="font-display text-xl font-semibold">{rate === null ? "—" : <CountUp value={rate * 100} suffix="%" />}</span>
        </ProgressRing>
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-paper/70">North star</p>
          <p className="mt-1 font-display text-[15px] font-semibold leading-snug">Flagged people seen within {s.loop_closure.window_days} days</p>
          <p className="mt-1 font-serif text-sm text-mute">{s.loop_closure.closed} of {s.loop_closure.eligible} referrals</p>
        </div>
      </div>
      {cards.map((c) => (
        <div key={c.label} className="rounded-3xl border border-line bg-surface p-5">
          <p className="font-display text-xs text-mute">{c.label}</p>
          <p className={cn("mt-2 font-display text-3xl font-semibold", c.warn && "text-warn")}>
            <CountUp value={c.value} decimals={c.decimals ?? 0} suffix={c.suffix ?? ""} />
          </p>
          <p className="mt-1 font-serif text-sm text-mute">{c.sub}</p>
        </div>
      ))}
    </section>
  );
}

function Alerts({ alerts, onAck, onOpen }: { alerts: StaffAlert[]; onAck: (id: string) => void; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const label = (a: StaffAlert) => {
    if (a.kind === "outbreak") return `Outbreak signal: ${a.data.syndrome} in ${a.data.village}`;
    if (a.kind === "escalation") return `Escalated (level ${a.code.slice(-1)}): ${a.data.status} referral overdue`;
    if (a.kind === "emergency") return "Emergency flagged at the doorstep";
    if (a.kind === "no_show") return "Missed appointment: ASHA asked to rescue";
    if (a.kind === "score_mismatch") return "Phone and server scores differ: engine check";
    return "New referral";
  };
  return (
    <section className="flex flex-col gap-3">
      <Title icon={Bell} aside={`${alerts.length} open`}>Alerts</Title>
      <ul className="flex max-h-[30rem] flex-col gap-2 overflow-y-auto pr-1">
        {alerts.length === 0 && <li className="rounded-2xl border border-line bg-surface p-4 font-serif text-mute">No open alerts.</li>}
        {alerts.slice(0, 60).map((a) => (
          <m.li key={a.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className={cn("rounded-2xl border p-3", a.level === "critical" ? "border-signal/50 bg-blood/20" : a.level === "warning" ? "border-warn/40 bg-surface" : "border-line bg-surface")}>
            <div className="flex items-start gap-2">
              {a.level === "critical" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
              <button type="button" disabled={!a.referral_id} onClick={() => a.referral_id && onOpen(a.referral_id)} className="min-w-0 flex-1 text-left">
                <p className="font-display text-sm font-semibold">{label(a)}</p>
                <p className="font-serif text-[13px] text-mute">{a.person ?? ""} {a.person && "· "}{formatDateTime(a.created_at, "en")}</p>
              </button>
              <button type="button" onClick={() => onAck(a.id)} className="rounded-full border border-line px-2.5 py-1 font-display text-[11px]">{t("common.done")}</button>
            </div>
          </m.li>
        ))}
      </ul>
    </section>
  );
}

function Trend({ s }: { s: Summary }) {
  const max = Math.max(1, ...s.weeks.map((w) => w.screenings));
  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <Title icon={Activity} aside="8 weeks">Weekly trend</Title>
      <div className="mt-4 flex h-40 items-end gap-2" role="img" aria-label="Screenings, flags and completed visits per week">
        {s.weeks.map((w) => (
          <div key={w.week_start} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-0.5">
              <m.span className="w-1/3 rounded-t bg-paper/70" initial={{ height: 0 }} animate={{ height: `${(w.screenings / max) * 100}%` }} title={`${w.screenings} screenings`} />
              <m.span className="w-1/3 rounded-t bg-warn" initial={{ height: 0 }} animate={{ height: `${(w.flagged / max) * 100}%` }} title={`${w.flagged} flagged`} />
              <m.span className="w-1/3 rounded-t bg-ok" initial={{ height: 0 }} animate={{ height: `${(w.visits / max) * 100}%` }} title={`${w.visits} visits`} />
            </div>
            <span className="font-display text-[10px] text-mute">{w.week_start.slice(5)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 flex gap-4 font-display text-xs text-mute">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-paper/70" />screened</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-warn" />flagged</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-ok" />seen</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(s.by_condition).map(([k, v]) => (
          <span key={k} className="rounded-full bg-raised px-3 py-1 font-display text-xs">{k}: {v}</span>
        ))}
      </div>
    </section>
  );
}

function Outbreaks({ data }: { data: OutbreakData | null }) {
  // One entry per cluster (village + syndrome), showing its most recent alert day.
  const flagged = (data?.alerts ?? []).filter((a, i, all) => all.findIndex((b) => b.village === a.village && b.syndrome === a.syndrome) === i);
  const series = data?.series.filter((x) => flagged.some((a) => a.village === x.village && a.syndrome === x.syndrome)) ?? [];
  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <Title icon={AlertTriangle} aside={data?.method ?? "EARS C2"}>Outbreak radar</Title>
      {flagged.length === 0 ? (
        <p className="mt-4 font-serif text-mute">No unusual clusters in the last 28 days.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {flagged.slice(0, 4).map((a) => {
            const line = series.find((x) => x.village === a.village && x.syndrome === a.syndrome);
            return (
              <li key={`${a.village}-${a.syndrome}-${a.day}`} className="rounded-2xl border border-signal/40 bg-blood/15 p-3">
                <p className="font-display text-sm font-semibold">{a.syndrome.replace("_", " ")} · {a.village}</p>
                <p className="font-serif text-[13px] text-paper/80">{a.observed} cases on {a.day}; expected ≈ {a.expected} (alert above {a.threshold})</p>
                {line && <Sparkline values={line.daily.map((d) => d.count)} width={220} height={30} color="var(--color-signal)" />}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 font-display text-[11px] text-mute">From ASHA doorstep reports. Export to IHIP when confirmed.</p>
    </section>
  );
}

function Coverage({ rows }: { rows: CoverageRow[] }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5">
      <Title icon={Users} aside="Lowest first">Blind spots</Title>
      <ul className="mt-4 space-y-2">
        {rows.slice(0, 7).map((r) => (
          <li key={r.village_id}>
            <div className="flex items-center justify-between font-display text-sm">
              <span className={cn("font-semibold", r.blind_spot && "text-warn")}>{r.name}{r.blind_spot && " ●"}</span>
              <span className="text-mute">{Math.round(r.coverage * 100)}% · {r.km_from_road} km from road</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
              <m.div className={cn("h-full rounded-full", r.blind_spot ? "bg-warn" : "bg-ok")} initial={{ width: 0 }} animate={{ width: `${r.coverage * 100}%` }} />
            </div>
            {r.older_women_coverage !== null && r.older_women_coverage < 0.5 && (
              <p className="mt-0.5 font-serif text-[12px] text-mute">Women 60+: {Math.round(r.older_women_coverage * 100)}% screened</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tracker({ referrals, onOpen, hideNames }: { referrals: StaffReferral[]; onOpen: (id: string) => void; hideNames: boolean }) {
  const [filter, setFilter] = useState<"all" | "overdue" | "missed">("all");
  const rows = useMemo(
    () => referrals.filter((r) => filter === "all" || (filter === "overdue" ? r.overdue : r.status === "missed")).slice(0, 80),
    [referrals, filter],
  );
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Title icon={Clock}>Referral tracker</Title>
        <div className="flex rounded-full border border-line p-1">
          {(["all", "overdue", "missed"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1 font-display text-xs font-semibold capitalize", filter === f && "bg-crimson")}>{f}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-line">
        <table className="w-full min-w-[760px] border-collapse font-display text-sm">
          <thead className="bg-surface text-left text-xs text-mute">
            <tr>
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Urgency</th>
              <th className="px-4 py-3 font-medium">Facility</th>
              <th className="w-[34%] px-4 py-3 font-medium">Loop</th>
              <th className="px-4 py-3 font-medium">Escalation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer border-t border-line hover:bg-surface">
                <td className="px-4 py-3">
                  <p className="font-semibold">{hideNames ? `${r.person.sex}, ${r.person.age}` : r.person.name}</p>
                  <p className="text-xs text-mute">{r.person.village}</p>
                </td>
                <td className="px-4 py-3"><UrgencyPill urgency={r.urgency} /></td>
                <td className="px-4 py-3 text-paper/85">{r.facility_name ?? "—"}<p className="text-xs text-mute">{r.mode === "teleconsult" ? "teleconsult" : ""}</p></td>
                <td className="px-4 py-3"><ReferralStepper r={r} /></td>
                <td className="px-4 py-3">{r.escalation_level ? <span className="rounded-full bg-warn/20 px-2 py-0.5 text-xs text-warn">L{r.escalation_level}</span> : <span className="text-mute">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PacketDrawer({ id, onClose, role, onChanged }: { id: string; onClose: () => void; role: string; onChanged: () => void }) {
  const packet = usePoll<Packet>(`/referrals/${id}/packet`, 30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = packet.data?.referral.status;

  async function act(path: string, json: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", json });
      await packet.reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const staff = role !== "district_officer";
  const clinician = role === "medical_officer" || role === "doctor";
  return (
    <m.div className="fixed inset-0 z-50 flex justify-end bg-ink/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.aside
        className="h-full w-full max-w-3xl overflow-y-auto border-l border-line bg-surface p-6"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="mb-4 grid h-10 w-10 place-items-center rounded-full border border-line"><X className="h-5 w-5" /></button>
        {!packet.data ? <Skeleton /> : (
          <PacketView
            packet={packet.data}
            actions={staff && (
              <>
                {status === "flagged" && <Action busy={busy} onClick={() => act(`/referrals/${id}/transition`, { to: "acknowledged" })}>Acknowledge</Action>}
                {["flagged", "acknowledged", "missed"].includes(status ?? "") && <Action busy={busy} onClick={() => act(`/referrals/${id}/book`, {})}>Book next slot</Action>}
                {clinician && status === "booked" && <Action busy={busy} onClick={() => act(`/referrals/${id}/transition`, { to: "seen", outcome: { confirmed: true, plan: "Seen at PHC" } })}>Mark seen</Action>}
                {clinician && status === "seen" && <Action busy={busy} onClick={() => act(`/referrals/${id}/transition`, { to: "closed" })}>Close loop</Action>}
              </>
            )}
          />
        )}
        {error && <p className="mt-3 font-display text-sm text-signal">{error}</p>}
      </m.aside>
    </m.div>
  );
}

function Action({ busy, onClick, children }: { busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className="rounded-full bg-crimson px-4 py-2 font-display text-sm font-semibold transition-colors hover:bg-signal disabled:opacity-40">
      {children}
    </button>
  );
}

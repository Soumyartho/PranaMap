import { useState } from "react";
import { m } from "framer-motion";
import { LogOut, PhoneCall, Video, Wifi, WifiOff } from "lucide-react";
import { lock, session } from "@/controllers/auth/session";
import { usePoll } from "@/controllers/staff/usePoll";
import type { Packet, QueueItem } from "@/controllers/staff/types";
import { api } from "@/services/api/client";
import { UrgencyPill } from "@/views/components/app/risk";
import { Logo } from "@/views/landing/sections/Logo";
import { formatDateTime } from "@/utils/time";
import { PacketView } from "./PacketView";
import { cn } from "@/lib/cx";

/** Connection hint so the doctor starts audio-only on a weak link instead of a frozen video. */
function useBandwidth() {
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  const type = c?.effectiveType ?? "unknown";
  const level = type === "4g" ? "video" : type === "3g" ? "audio" : type === "unknown" ? "unknown" : "recorded";
  return { type, level };
}

export default function DoctorPage() {
  const user = session.use((s) => s.user)!;
  const queue = usePoll<QueueItem[]>("/doctor/queue", 15_000);
  const [selected, setSelected] = useState<string | null>(null);
  const items = queue.data ?? [];
  const current = items.find((q) => q.referral.id === selected) ?? items.find((q) => q.status === "booked") ?? items[0];

  return (
    <div className="min-h-svh bg-ink text-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8" />
            <div>
              <p className="font-display text-[15px] font-semibold leading-tight">Teleconsult queue</p>
              <p className="font-display text-xs text-mute">{user.name}</p>
            </div>
          </div>
          <button type="button" onClick={lock} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-display text-xs font-semibold"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </header>
      <main className="mx-auto grid max-w-[1400px] gap-5 px-5 py-6 lg:grid-cols-[22rem_1fr]">
        <aside className="flex flex-col gap-2">
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-mute">Next 14 days · {items.length}</h2>
          {queue.error && !queue.data && <p className="font-display text-sm text-signal">Cannot reach the server.</p>}
          <ul className="flex max-h-[calc(100svh-10rem)] flex-col gap-2 overflow-y-auto pr-1">
            {items.map((q) => (
              <li key={q.appointment_id}>
                <button type="button" onClick={() => setSelected(q.referral.id)}
                  className={cn("w-full rounded-2xl border p-3 text-left transition-colors", current?.appointment_id === q.appointment_id ? "border-crimson bg-blood/20" : "border-line bg-surface hover:border-paper/30")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-display font-semibold">{q.person.name}</span>
                    <UrgencyPill urgency={q.referral.urgency} />
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 font-display text-xs text-mute">
                    {q.mode === "teleconsult" ? <PhoneCall className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5 opacity-0" />}
                    {formatDateTime(q.slot_start, "en")} · {q.person.age} y · {q.status}
                  </span>
                </button>
              </li>
            ))}
            {queue.data && items.length === 0 && <li className="rounded-2xl border border-line p-4 font-serif text-mute">No consults booked.</li>}
          </ul>
        </aside>
        <section className="rounded-3xl border border-line bg-surface p-6">
          {current ? <Consult key={current.referral.id} item={current} onDone={() => void queue.reload()} /> : <p className="font-serif text-mute">Select a patient.</p>}
        </section>
      </main>
    </div>
  );
}

function Consult({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const packet = usePoll<Packet>(`/referrals/${item.referral.id}/packet`, 60_000);
  const bw = useBandwidth();
  // Conditions the referral was for; the doctor marks which of them the visit confirmed.
  const evaluated = ["diabetes", "hypertension", "cvd", "anaemia", "tb"].filter((c) => item.referral.reasons.includes(c));
  const [confirmedSet, setConfirmedSet] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [plan, setPlan] = useState("");
  const [followUp, setFollowUp] = useState("3 months");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setError(null);
    try {
      const outcome = { confirmed: confirmedSet.length > 0, evaluated, confirmed_conditions: confirmedSet, plan, follow_up: followUp };
      await api(`/referrals/${item.referral.id}/transition`, { method: "POST", json: { to: "seen", outcome } });
      await api(`/referrals/${item.referral.id}/transition`, { method: "POST", json: { to: "closed" } });
      setSaved(true);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const open = item.referral.status === "booked" || item.referral.status === "missed";
  return (
    <div className="flex flex-col gap-6">
      {item.meeting_url && open && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised p-4">
          <a href={item.meeting_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-crimson px-5 py-2.5 font-display font-semibold hover:bg-signal">
            <PhoneCall className="h-4 w-4" /> Start call (audio first)
          </a>
          <span className={cn("flex items-center gap-1.5 font-display text-sm", bw.level === "video" ? "text-ok" : bw.level === "audio" ? "text-warn" : "text-mute")}>
            {bw.level === "recorded" ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            {bw.level === "video" && "Good link: video is fine"}
            {bw.level === "audio" && "Weak link: keep video off"}
            {bw.level === "recorded" && "Very weak link: ask the ASHA for a recorded consult"}
            {bw.level === "unknown" && "Link quality unknown: start with audio"}
          </span>
        </div>
      )}
      {packet.data ? <PacketView packet={packet.data} /> : <div className="h-64 animate-pulse rounded-2xl bg-raised" />}
      {open && !saved && (
        <m.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-line p-5">
          <h3 className="font-display text-lg font-semibold">Record the visit</h3>
          <p className="font-serif text-sm text-mute">This closes the loop and the outcome goes back to the ASHA's phone.</p>
          <p className="mt-4 font-display text-sm text-paper/80">Confirmed at this visit (feeds the model's realised calibration):</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {evaluated.map((c) => {
              const on = confirmedSet.includes(c);
              return (
                <button key={c} type="button" aria-pressed={on}
                  onClick={() => { setReviewed(true); setConfirmedSet((s) => (on ? s.filter((x) => x !== c) : [...s, c])); }}
                  className={cn("rounded-full border px-4 py-2 font-display text-sm font-semibold capitalize", on ? "border-crimson bg-crimson/25" : "border-line")}>
                  {c}
                </button>
              );
            })}
            <button type="button" aria-pressed={reviewed && confirmedSet.length === 0}
              onClick={() => { setReviewed(true); setConfirmedSet([]); }}
              className={cn("rounded-full border px-4 py-2 font-display text-sm font-semibold", reviewed && confirmedSet.length === 0 ? "border-ok bg-ok/20 text-ok" : "border-line")}>
              None confirmed
            </button>
          </div>
          <textarea value={plan} onChange={(e) => setPlan(e.target.value)} rows={3} placeholder="Plan (medicines started, tests ordered, advice)" className="mt-3 w-full rounded-xl border border-line bg-raised p-3 font-serif text-paper outline-none focus:border-crimson" />
          <label className="mt-3 flex items-center gap-3 font-display text-sm">
            Follow-up
            <select value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="rounded-lg border border-line bg-raised px-3 py-2">
              {["2 weeks", "1 month", "3 months", "6 months"].map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          {error && <p className="mt-2 font-display text-sm text-signal">{error}</p>}
          <button type="button" disabled={!reviewed || plan.trim().length < 3} onClick={record} className="mt-4 rounded-full bg-crimson px-6 py-3 font-display font-semibold disabled:opacity-40">Save and close loop</button>
        </m.section>
      )}
      {saved && <p className="rounded-2xl bg-ok/15 p-4 font-display text-ok">Saved. The ASHA will see the outcome on her next sync.</p>}
    </div>
  );
}

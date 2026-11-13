import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { m } from "framer-motion";
import { Check, Mic, PhoneCall, Video } from "lucide-react";
import { VoiceNoteSheet } from "./VoiceNoteSheet";
import { data, enqueue } from "@/controllers/asha/data";
import type { Referral, ReferralStatus } from "@/models/types/domain";
import { Sheet, Toast } from "@/views/components/app/bits";
import { UrgencyPill } from "@/views/components/app/risk";
import { formatDate, formatDateTime } from "@/utils/time";
import { uuidv7 } from "@/utils/id";
import { cn } from "@/lib/cx";

const STEPS: ReferralStatus[] = ["flagged", "acknowledged", "booked", "seen", "closed"];
const OPEN: ReferralStatus[] = ["flagged", "acknowledged", "booked", "missed"];

/** flagged → acknowledged → booked → seen → closed. A step pulses amber when its deadline has passed. */
export function ReferralStepper({ r }: { r: Referral }) {
  const { t } = useTranslation();
  const current = r.status === "missed" ? 2 : r.status === "cancelled" ? -1 : STEPS.indexOf(r.status);
  const overdue = Boolean(r.due_at && new Date(r.due_at) < new Date() && OPEN.includes(r.status));
  return (
    <ol className="flex items-start" aria-label={t(`referral.status.${r.status}`)}>
      {STEPS.map((s, i) => {
        const done = i <= current;
        const here = i === current;
        return (
          <li key={s} className="relative flex flex-1 flex-col items-center">
            {i > 0 && <span className={cn("absolute top-3 right-1/2 h-0.5 w-full", i <= current ? "bg-ok" : "bg-line")} aria-hidden="true" />}
            <m.span
              initial={false}
              animate={{ scale: here ? 1.12 : 1 }}
              className={cn(
                "relative z-10 grid h-6 w-6 place-items-center rounded-full border-2",
                done ? "border-ok bg-ok text-ink" : "border-line bg-ink",
                here && r.status === "missed" && "border-signal bg-signal",
                here && overdue && "pulse-amber border-warn bg-warn",
              )}
            >
              {done && !(here && (overdue || r.status === "missed")) && <Check className="h-3.5 w-3.5" />}
            </m.span>
            <span className={cn("mt-1.5 text-center font-display text-[10px] leading-tight", here ? "text-paper" : "text-mute")}>{t(`referral.steps.${s}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ReferralsPage() {
  const { t, i18n } = useTranslation();
  const referrals = data.use((s) => s.referrals);
  const persons = data.use((s) => s.persons);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [rescue, setRescue] = useState<Referral | null>(null);
  const [noteFor, setNoteFor] = useState<Referral | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const list = useMemo(() => {
    const byId = new Map(persons.map((p) => [p.id, p]));
    return referrals
      .filter((r) => (tab === "open" ? OPEN.includes(r.status) : !OPEN.includes(r.status)))
      .map((r) => ({ r, p: byId.get(r.person_id) }))
      .filter((x) => x.p)
      .sort((a, b) => (tab === "open" ? b.r.priority - a.r.priority : (b.r.updated_at ?? "").localeCompare(a.r.updated_at ?? "")));
  }, [referrals, persons, tab]);

  async function note(r: Referral, action: string) {
    await enqueue("referral.note", { referral_id: r.id, action, note: null, client_id: uuidv7() }, r.id);
    setRescue(null);
    setToast(t("referral.note_saved"));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold">{t("referral.title")}</h1>
      <div className="grid grid-cols-2 rounded-full border border-line p-1">
        {(["open", "done"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("h-10 rounded-full font-display text-sm font-semibold", tab === k ? "bg-crimson" : "text-mute")}>{t(`referral.${k}`)}</button>
        ))}
      </div>
      {list.length === 0 && <p className="py-10 text-center font-serif text-mute">{t("referral.empty")}</p>}
      <ul className="space-y-3">
        {list.map(({ r, p }) => (
          <li key={r.id} className="cv-auto rounded-3xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-display text-[17px] font-semibold">{p!.name}</p>
                <p className="font-serif text-sm text-mute">{r.reasons.slice(0, 3).map((c) => t(`flags.${c}`)).join(" · ")}</p>
              </div>
              <UrgencyPill urgency={r.urgency} />
            </div>
            <div className="mt-4"><ReferralStepper r={r} /></div>
            <div className="mt-4 space-y-1 font-serif text-[15px] text-paper/85">
              {r.facility_name && <p>{t("referral.facility")}: {r.facility_name}</p>}
              {r.appointment?.slot_start && <p>{t("referral.slot", { when: formatDateTime(r.appointment.slot_start, i18n.language) })}</p>}
              {r.escalation_level > 0 && OPEN.includes(r.status) && <p className="text-warn">{t("referral.escalated", { level: r.escalation_level })}</p>}
              {r.outcome && (
                <p className="rounded-xl bg-raised px-3 py-2">{t("referral.outcome")}: {String(r.outcome.plan ?? r.outcome.note ?? (r.outcome.confirmed ? "✓" : "—"))}</p>
              )}
              {r.status === "closed" && r.closed_at && <p className="text-ok">✓ {formatDate(r.closed_at, i18n.language)}</p>}
            </div>
            <div className="mt-4 flex gap-2">
              {r.appointment?.meeting_url && r.status === "booked" && (
                <a href={r.appointment.meeting_url} target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-crimson font-display text-sm font-semibold">
                  {r.mode === "teleconsult" ? <PhoneCall className="h-4 w-4" /> : <Video className="h-4 w-4" />} {t("referral.join_call")}
                </a>
              )}
              {OPEN.includes(r.status) && !r.id.startsWith("local-") && (
                <button type="button" onClick={() => setNoteFor(r)} aria-label={t("referral.voice_note")} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line">
                  <Mic className="h-4 w-4" />
                </button>
              )}
              {OPEN.includes(r.status) && !r.id.startsWith("local-") && (
                <button type="button" onClick={() => setRescue(r)} className={cn("h-11 flex-1 rounded-xl border font-display text-sm font-semibold", r.status === "missed" ? "border-signal text-signal" : "border-line")}>{t("referral.rescue")}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={rescue !== null} onClose={() => setRescue(null)} title={t("referral.rescue")}>
        <div className="grid gap-2">
          {["reached", "not_home", "rebook", "refused", "moved"].map((a) => (
            <button key={a} type="button" onClick={() => rescue && void note(rescue, a)} className="h-14 rounded-2xl border border-line bg-raised font-display text-lg font-semibold">{t(`referral.${a}`)}</button>
          ))}
        </div>
      </Sheet>
      <VoiceNoteSheet referral={noteFor} onClose={() => setNoteFor(null)} onQueued={() => { setNoteFor(null); setToast(t("referral.note_queued")); }} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

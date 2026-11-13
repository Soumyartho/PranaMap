import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { Download, Phone, Stethoscope } from "lucide-react";
import type { Packet } from "@/controllers/staff/types";
import { api, apiBlob } from "@/services/api/client";
import { BandBadge, UrgencyPill } from "@/views/components/app/risk";
import { Sparkline } from "@/views/components/app/bits";
import { WhyBars } from "@/views/components/app/WhyBars";
import { useReasonLabel } from "@/views/asha/screening/ResultView";
import { formatDate } from "@/utils/time";

/**
 * The pre-consult packet: everything the doctor needs before the call starts. Replaces the
 * one-word referral ("pain") with vitals, trend, risk drivers, red flags and medicines.
 */
export function PacketView({ packet, actions }: { packet: Packet; actions?: ReactNode }) {
  const { t } = useTranslation();
  const reasonLabel = useReasonLabel();
  const { patient, latest, trend, referral } = packet;

  async function exportFhir() {
    const bundle = await api<object>(`/referrals/${referral.id}/fhir`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `pranamap-${referral.id.slice(0, 8)}.fhir.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const vitals: [string, string | null][] = [
    ["BP", latest.sbp ? `${latest.sbp}/${latest.dbp}` : null],
    [latest.glucose_type === "fasting" ? "FBS" : "RBS", latest.glucose_mg_dl ? `${latest.glucose_mg_dl} mg/dL` : null],
    ["Hb", latest.hb_g_dl ? `${latest.hb_g_dl} g/dL` : null],
    ["SpO₂", latest.spo2 ? `${latest.spo2}%` : null],
    ["Waist", latest.waist_cm ? `${latest.waist_cm} cm` : null],
    ["BMI", latest.bmi ? String(latest.bmi) : null],
  ];

  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-crimson">Pre-consult packet</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{patient.name ?? "Patient (name hidden)"}</h2>
          <p className="font-serif text-[15px] text-mute">
            {patient.age} y · {patient.sex} · {patient.village}
            {patient.pregnant && " · pregnant"}
            {patient.abha && ` · ABHA ${patient.abha}`}
          </p>
        </div>
        <UrgencyPill urgency={referral.urgency} />
      </header>

      {packet.red_flags.length > 0 && (
        <div className="rounded-2xl border border-signal/50 bg-blood/25 p-3 font-display text-sm">
          <span className="font-semibold text-signal">Red flags:</span> {packet.red_flags.map((f) => t(`flags.${f.code}`)).join(" · ")}
        </div>
      )}

      <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {vitals.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-raised p-3">
            <p className="font-display text-[11px] uppercase tracking-wider text-mute">{k}</p>
            <p className="mt-1 font-display text-lg font-semibold">{v ?? "—"}</p>
          </div>
        ))}
      </section>

      {trend.length > 1 && (
        <section className="flex flex-wrap gap-6 rounded-2xl bg-raised p-4">
          <div>
            <p className="font-display text-xs text-mute">Systolic trend ({trend.length} visits)</p>
            <Sparkline values={trend.map((v) => v.sbp)} width={180} height={40} />
          </div>
          <div>
            <p className="font-display text-xs text-mute">Glucose trend</p>
            <Sparkline values={trend.map((v) => v.glucose_mg_dl ?? null)} width={180} height={40} color="var(--color-signal)" />
          </div>
          <p className="self-end font-display text-xs text-mute">since {formatDate(trend[0].date, "en")}</p>
        </section>
      )}

      {packet.voice_notes?.length > 0 && (
        <section className="rounded-2xl border border-line p-4">
          <p className="font-display text-sm font-semibold">Voice notes from the ASHA ({packet.voice_notes.length})</p>
          <ul className="mt-2 space-y-2">
            {packet.voice_notes.map((n) => <VoiceNote key={n.id} id={n.id} createdAt={n.created_at} durationMs={n.duration_ms} />)}
          </ul>
          <p className="mt-2 font-display text-[11px] text-mute">Deleted automatically after the retention period.</p>
        </section>
      )}

      {packet.questions.length > 0 && (
        <section className="rounded-2xl border border-line p-4">
          <p className="flex items-center gap-2 font-display text-sm font-semibold"><Stethoscope className="h-4 w-4 text-crimson" /> Suggested for this consult</p>
          <ul className="mt-2 list-inside list-disc space-y-1 font-serif text-[15px] text-paper/90">
            {packet.questions.map((q) => <li key={q}>{q}</li>)}
          </ul>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {Object.entries(packet.risk)
          .sort((a, b) => b[1].score - a[1].score)
          .map(([k, c]) => (
            <div key={k} className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-display font-semibold">{t(`conditions.${k}`)}</p>
                <BandBadge band={c.band} />
              </div>
              {c.drivers.length ? <WhyBars drivers={c.drivers} /> : <p className="font-serif text-sm text-mute">No raised factors</p>}
              <p className="mt-3 font-display text-[11px] text-mute">{c.instrument} · confidence {c.confidence}</p>
            </div>
          ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-raised p-4 font-serif text-[15px]">
          <p className="font-display text-xs uppercase tracking-wider text-mute">History</p>
          <p className="mt-1">
            {[patient.known_diabetes && "Known diabetes", patient.known_hypertension && "Known hypertension"].filter(Boolean).join(", ") || "No known NCD"}
          </p>
          <p className="mt-1 text-paper/80">Medicines: {patient.medications.length ? patient.medications.join(", ") : "none recorded"}</p>
          {packet.symptoms.length > 0 && <p className="mt-1 text-paper/80">Symptoms: {packet.symptoms.map((s) => t(`symptoms.${s}`)).join(", ")}</p>}
        </div>
        <div className="rounded-2xl bg-raised p-4 font-serif text-[15px]">
          <p className="font-display text-xs uppercase tracking-wider text-mute">Routing</p>
          <p className="mt-1">{referral.facility ?? "—"} · {referral.mode === "teleconsult" ? "teleconsult" : "in person"}</p>
          {referral.routing?.reasons.slice(0, 3).map((r) => <p key={r.code} className="text-paper/75">· {reasonLabel(r)}</p>)}
          {packet.asha && (
            <a href={`tel:${packet.asha.phone}`} className="mt-2 inline-flex items-center gap-1.5 font-display text-sm text-paper underline-offset-4 hover:underline">
              <Phone className="h-3.5 w-3.5" /> ASHA {packet.asha.name}
            </a>
          )}
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-2">
        {actions}
        <button type="button" onClick={exportFhir} className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-4 py-2 font-display text-sm"><Download className="h-4 w-4" /> FHIR R4</button>
      </footer>
      <p className="font-display text-[11px] text-mute">Engine v{packet.engine_version} · decision support, not a diagnosis</p>
    </article>
  );
}

function VoiceNote({ id, createdAt, durationMs }: { id: string; createdAt: string; durationMs: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    apiBlob(`/media/${id}`)
      .then((b) => {
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch(() => setError(true));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-raised p-2">
      <span className="font-display text-xs text-mute">{formatDate(createdAt, "en")} · {Math.round(durationMs / 1000)} s</span>
      {url ? <audio controls src={url} className="h-9 flex-1" /> : <span className="font-display text-xs text-mute">{error ? "Not available" : "Loading…"}</span>}
    </li>
  );
}

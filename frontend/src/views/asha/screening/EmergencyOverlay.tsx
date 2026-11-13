import { m } from "framer-motion";
import { useTranslation } from "@/i18n";
import { MessageSquare, Phone, Siren } from "lucide-react";
import type { RedFlag } from "@/models/types/risk";
import type { Household, Person } from "@/models/types/domain";
import { session } from "@/controllers/auth/session";
import { useEffect } from "react";
import { haptic, speak, type VoiceLang } from "@/services/voice/speech";

/**
 * Fires the moment a danger sign or crisis reading is entered, before any score, before any sync.
 * One tap to call 108; one tap to text the ANM even with no mobile data (plain SMS).
 */
export function EmergencyOverlay({ flags, person, household, onCalled }: {
  flags: RedFlag[];
  person: Person;
  household: Household;
  onCalled: () => void;
}) {
  const { t, i18n } = useTranslation();
  const asha = session.use((s) => s.user);
  const labels = flags.map((f) => t(`flags.${f.code}`));
  const sms = t("emergency.sms_text", { flags: labels.join(", "), name: person.name, house: household.number, asha: asha?.name ?? "" });

  useEffect(() => {
    haptic([200, 100, 200, 100, 200]);
    void speak(`${t("emergency.title")}. ${labels.join(". ")}. ${t("emergency.text")}`, i18n.language as VoiceLang);
    // Run once when the overlay opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <m.div
      role="alertdialog"
      aria-modal="true"
      aria-label={t("emergency.title")}
      className="fixed inset-0 z-[70] flex flex-col bg-[#3a0000] px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-8 text-paper"
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex items-center gap-3">
          <span className="pulse-emergency grid h-14 w-14 place-items-center rounded-full bg-signal"><Siren className="h-7 w-7" /></span>
          <h1 className="font-display text-4xl font-semibold">{t("emergency.title")}</h1>
        </div>
        <ul className="mt-6 space-y-2">
          {labels.map((l) => (
            <li key={l} className="rounded-2xl bg-ink/40 px-4 py-3 font-display text-xl font-semibold">{l}</li>
          ))}
        </ul>
        <p className="mt-6 font-serif text-xl leading-snug">{t("emergency.text")}</p>
        {flags.some((f) => f.code === "low_glucose") && <p className="mt-3 rounded-2xl bg-warn/20 px-4 py-3 font-display text-lg text-warn">{t("emergency.glucose_tip")}</p>}
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <a href="tel:108" className="flex h-20 items-center justify-center gap-3 rounded-2xl bg-signal font-display text-2xl font-semibold">
            <Phone className="h-7 w-7" /> {t("emergency.call")}
          </a>
          <a href={`sms:?body=${encodeURIComponent(sms)}`} className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-paper/40 font-display text-lg font-semibold">
            <MessageSquare className="h-5 w-5" /> {t("emergency.sms")}
          </a>
          <button type="button" onClick={onCalled} className="h-14 rounded-2xl bg-paper font-display text-lg font-semibold text-ink">
            {t("emergency.called")}
          </button>
        </div>
      </div>
    </m.div>
  );
}

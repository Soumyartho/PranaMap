import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { Check, Download, HardDrive, Trash2, Wifi } from "lucide-react";
import { CATALOG, type OfflineLang } from "@/services/voice/catalog";
import { download, offlineVoice, refreshStatus, remove } from "@/services/voice/offline";
import { Sheet } from "@/views/components/app/bits";
import { cn } from "@/lib/cx";

const LANG_LABEL: Record<OfflineLang, string> = { bn: "বাংলা", hi: "हिन्दी", en: "English" };

/**
 * Offline voice: download each language's model once (ideally over PHC Wi-Fi), then voice works
 * with no signal. Storage is marked persistent so the browser does not evict the models.
 */
export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const models = offlineVoice.use((s) => s);
  const [storage, setStorage] = useState<{ usedMb: number; quotaMb: number; persisted: boolean } | null>(null);

  async function readStorage() {
    if (!navigator.storage?.estimate) return;
    const e = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    setStorage({ usedMb: Math.round((e.usage ?? 0) / 1e6), quotaMb: Math.round((e.quota ?? 0) / 1e6), persisted });
  }

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    void readStorage();
  }, [open]);

  async function get(lang: OfflineLang) {
    await navigator.storage?.persist?.();
    try {
      await download(lang);
    } finally {
      void readStorage();
    }
  }

  const connection = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
  const onWifi = connection?.type === "wifi" || connection?.type === "ethernet";

  return (
    <Sheet open={open} onClose={onClose} title={t("settings.title")}>
      <section className="flex flex-col gap-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-mute">{t("settings.voice_title")}</h3>
        <p className="font-serif text-[15px] text-paper/80">{t("settings.voice_hint")}</p>
        {!onWifi && connection?.type && (
          <p className="flex items-center gap-2 rounded-xl bg-warn/15 px-3 py-2 font-display text-sm text-warn"><Wifi className="h-4 w-4" /> {t("settings.wifi")}</p>
        )}
        <ul className="space-y-2">
          {(Object.keys(CATALOG) as OfflineLang[]).map((lang) => {
            const m = models[lang];
            const spec = CATALOG[lang];
            return (
              <li key={lang} className="rounded-2xl border border-line bg-raised p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display font-semibold">{LANG_LABEL[lang]}</p>
                    <p className="font-display text-xs text-mute">{spec.name} · {spec.sizeMb} MB</p>
                  </div>
                  {m.status === "ready" ? (
                    <span className="flex items-center gap-2">
                      <span className="flex items-center gap-1 font-display text-sm text-ok"><Check className="h-4 w-4" /> {t("settings.ready")}</span>
                      <button type="button" onClick={() => void remove(lang).then(readStorage)} aria-label={t("settings.delete")} className="grid h-9 w-9 place-items-center rounded-full border border-line">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  ) : (
                    <button type="button" disabled={m.status === "downloading"} onClick={() => void get(lang)}
                      className={cn("flex items-center gap-1.5 rounded-full px-4 py-2 font-display text-sm font-semibold", m.status === "downloading" ? "bg-line" : "bg-crimson")}>
                      <Download className="h-4 w-4" /> {m.status === "downloading" ? `${Math.round(m.progress * 100)}%` : t("settings.download")}
                    </button>
                  )}
                </div>
                {m.status === "downloading" && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-crimson transition-[width] duration-300" style={{ width: `${m.progress * 100}%` }} />
                  </div>
                )}
                {m.status === "error" && <p className="mt-2 font-display text-xs text-signal">{t("settings.failed")}: {m.error}</p>}
              </li>
            );
          })}
        </ul>
        {storage && (
          <p className="flex items-center gap-2 font-display text-xs text-mute">
            <HardDrive className="h-3.5 w-3.5" />
            {t("settings.storage", { used: storage.usedMb, quota: storage.quotaMb })} · {storage.persisted ? t("settings.persisted") : t("settings.not_persisted")}
          </p>
        )}
      </section>
    </Sheet>
  );
}

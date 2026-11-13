import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useTranslation } from "@/i18n";
import { CalendarCheck, Home, Lock, MessageCircle, Route, Settings } from "lucide-react";
import { data, loadAll } from "@/controllers/asha/data";
import { lock } from "@/controllers/auth/session";
import { startAutoSync, syncNow } from "@/controllers/sync/engine";
import { LanguageSwitch, SyncChip } from "@/views/components/app/bits";
import { Logo } from "@/views/landing/sections/Logo";
import { Splash } from "@/views/app/Splash";
import { cn } from "@/lib/cx";
import { refreshStatus } from "@/services/voice/offline";
import { SettingsSheet } from "./SettingsSheet";

const TABS = [
  { to: "/asha", icon: CalendarCheck, key: "today", end: true },
  { to: "/asha/homes", icon: Home, key: "households" },
  { to: "/asha/referrals", icon: Route, key: "referrals" },
  { to: "/asha/chat", icon: MessageCircle, key: "chat" },
];

export function AshaLayout() {
  const { t } = useTranslation();
  const loaded = data.use((s) => s.loaded);
  const { pathname } = useLocation();
  const screening = pathname.includes("/screen/");
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    void refreshStatus();
    void loadAll().then(() => {
      startAutoSync();
      void syncNow();
    });
  }, []);

  if (!loaded) return <Splash />;

  return (
    <div className="min-h-svh bg-ink text-paper">
      {!screening && (
        <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-2 px-4">
            <Logo className="h-7 w-7 shrink-0" />
            <div className="flex items-center gap-2">
              <SyncChip compact />
              <LanguageSwitch />
              <button type="button" onClick={() => setSettings(true)} aria-label={t("settings.title")} className="grid h-8 w-8 place-items-center rounded-full border border-line bg-raised">
                <Settings className="h-4 w-4" />
              </button>
              <button type="button" onClick={lock} aria-label={t("common.lock")} className="grid h-8 w-8 place-items-center rounded-full border border-line bg-raised">
                <Lock className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
      )}
      <main className={cn("mx-auto max-w-lg px-4", screening ? "pb-6" : "pt-4 pb-28")}>
        <Outlet />
      </main>
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      {!screening && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md" aria-label="ASHA">
          <ul className="mx-auto grid max-w-lg grid-cols-4">
            {TABS.map(({ to, icon: Icon, key, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn("flex h-16 flex-col items-center justify-center gap-1 font-display text-[11px] font-semibold", isActive ? "text-paper" : "text-mute")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={cn("grid h-8 w-14 place-items-center rounded-full transition-colors", isActive && "bg-crimson")}>
                        <Icon className="h-5 w-5" />
                      </span>
                      {t(`nav.${key}`)}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink px-5 py-14 md:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="flex items-center gap-2.5 font-display text-lg font-semibold">
            <Logo className="h-7 w-7" />
            PranaMap
          </p>
          <p className="mt-4 max-w-[52ch] font-serif text-[15px] leading-relaxed text-mute">
            Decision support for trained health workers, not a diagnosis. Demo data is a synthetic village; no real
            patient records are used.
          </p>
        </div>
        <p className="font-display text-[11px] uppercase tracking-[0.22em] text-mute">
          IEMHACKS 4.0 · IEMH4-HC-01 · {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}

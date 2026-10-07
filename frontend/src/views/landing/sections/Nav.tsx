import { useEffect, useState } from "react";
import { navLinks } from "../../../models/content/landing";
import { Logo } from "./Logo";

export function Nav() {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-500 ${
        solid ? "border-b border-line/70 bg-ink/55 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:px-10" aria-label="Main">
        <a href="#top" className="flex items-center gap-2.5 font-display text-[17px] font-semibold tracking-tight text-paper">
          <Logo className="h-7 w-7" />
          PranaMap
        </a>
        <ul className="hidden items-center gap-9 md:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="font-display text-[13px] font-medium uppercase tracking-[0.14em] text-mute transition-colors duration-300 hover:text-paper"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href="#cta"
          className="rounded-full bg-crimson px-5 py-2.5 font-display text-[13px] font-semibold tracking-wide text-paper transition-colors duration-300 hover:bg-signal"
        >
          Launch app
        </a>
      </nav>
    </header>
  );
}

import { useEffect, useState } from "react";
import { navLinks } from "@/models/content/landing";
import { SlideTabs } from "@/views/components/ui/slide-tabs";
import { CtaButton } from "@/views/components/ui/cta-button";
import { Logo } from "./Logo";

/** Index of the nav section crossing the middle of the viewport, or -1 (hero, CTA). */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActive(ids.findIndex((id) => visible.has(id)));
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);
  return [active, setActive] as const;
}

const sectionIds = navLinks.map((link) => link.href.slice(1));

export function Nav() {
  const [active, setActive] = useActiveSection(sectionIds);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 -z-10 h-32 bg-linear-to-b from-ink via-ink/85 to-transparent transition-opacity duration-500 ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
      />
      <nav
        className="mx-auto grid h-20 max-w-7xl grid-cols-[1fr_auto] items-center gap-4 px-5 md:grid-cols-[1fr_auto_1fr] md:px-10"
        aria-label="Main"
      >
        <a
          href="#top"
          className="pointer-events-auto flex w-fit items-center gap-2.5 font-display text-[17px] font-semibold tracking-tight text-paper"
        >
          <Logo className="h-7 w-7" />
          PranaMap
        </a>
        <SlideTabs
          tabs={navLinks}
          selected={active}
          onSelect={setActive}
          className="pointer-events-auto hidden md:flex"
        />
        <CtaButton href="/app" className="pointer-events-auto justify-self-end">
          Launch app
        </CtaButton>
      </nav>
    </header>
  );
}

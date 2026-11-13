import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Adapted from minhxthanh/slide-tabs (21st.dev): typed, link-based, palette colours. */

export type SlideTab = { href: string; label: string };

type Position = { left: number; width: number; opacity: number };

type SlideTabsProps = {
  tabs: SlideTab[];
  /** Index of the current tab; -1 hides the cursor until a tab is hovered. */
  selected: number;
  onSelect?: (index: number) => void;
  className?: string;
};

export function SlideTabs({ tabs, selected, onSelect, className }: SlideTabsProps) {
  const [position, setPosition] = useState<Position>({ left: 0, width: 0, opacity: 0 });
  const [hovered, setHovered] = useState(-1);
  const tabsRef = useRef<(HTMLLIElement | null)[]>([]);

  const moveTo = useCallback((index: number) => {
    const tab = tabsRef.current[index];
    if (!tab) {
      setPosition((p) => ({ ...p, opacity: 0 }));
      return;
    }
    setPosition({ left: tab.offsetLeft, width: tab.offsetWidth, opacity: 1 });
  }, []);

  // Follow the selected tab whenever it changes and nothing is hovered.
  useLayoutEffect(() => {
    if (hovered === -1) moveTo(selected);
  }, [selected, hovered, moveTo]);

  const lit = hovered !== -1 ? hovered : selected;

  return (
    <ul
      onMouseLeave={() => setHovered(-1)}
      className={cn(
        "relative mx-auto flex w-fit rounded-full border border-paper/20 bg-ink/60 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md",
        className,
      )}
    >
      {tabs.map((tab, i) => (
        <li
          key={tab.href}
          ref={(el) => {
            tabsRef.current[i] = el;
          }}
          onMouseEnter={() => {
            setHovered(i);
            moveTo(i);
          }}
          className="relative z-10"
        >
          <a
            href={tab.href}
            onClick={() => onSelect?.(i)}
            onFocus={() => moveTo(i)}
            aria-current={i === selected ? "true" : undefined}
            className={cn(
              "block rounded-full px-4 py-2 font-display text-[12px] font-medium uppercase tracking-[0.14em] transition-colors duration-300 lg:px-5 lg:py-2.5 lg:text-[13px]",
              i === lit ? "text-paper" : "text-paper/60",
            )}
          >
            {tab.label}
          </a>
        </li>
      ))}
      <Cursor position={position} />
    </ul>
  );
}

function Cursor({ position }: { position: Position }) {
  return (
    <motion.li
      aria-hidden="true"
      initial={false}
      animate={position}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
      className="absolute top-1 bottom-1 z-0 rounded-full bg-crimson shadow-[0_0_24px_rgba(255,0,0,0.35)]"
    />
  );
}

import type { FeatureIcon as Icon } from "../../../models/content/landing";

const paths: Record<Icon, string> = {
  offline: "M3 9.5a13 13 0 0 1 18 0M6.5 13a8 8 0 0 1 11 0M10 16.5a3 3 0 0 1 4 0M3 3l18 18",
  voice: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3",
  explain: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  flag: "M12 3 2 20h20L12 3ZM12 10v4M12 17h.01",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  packet: "M6 3h9l4 4v14H6V3ZM15 3v4h4M9 12h7M9 16h5",
  loop: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  map: "M12 2 20.5 7v10L12 22l-8.5-5V7L12 2ZM12 8v8M8.5 10 12 12l3.5-2",
};

export function FeatureIcon({ name, className }: { name: Icon; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

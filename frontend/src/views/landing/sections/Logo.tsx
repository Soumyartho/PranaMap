/** Hexagon (one map cell) carrying a breath line: prana, mapped. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25L16 2.5Z" fill="#BC0202" />
      <path
        d="M7.5 17h4.2l2-5 3.3 9.5 2.2-6.5 1.3 2h4"
        stroke="#F4EFE9"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

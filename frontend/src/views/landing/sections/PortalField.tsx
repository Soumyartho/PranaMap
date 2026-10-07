/**
 * The scene revealed through the letters: layered palette gradients over a faint
 * hexagon grid (a nod to the risk map). Scales slightly as the camera dives in.
 */
export function PortalField({ id, tone = "blood" }: { id: string; tone?: "blood" | "crimson" }) {
  const base =
    tone === "blood"
      ? "linear-gradient(135deg,#830000 0%,#BC0202 52%,#4d0000 100%)"
      : "linear-gradient(160deg,#BC0202 0%,#830000 55%,#1a0000 100%)";
  return (
    <div className="absolute inset-0" style={{ transform: "scale(var(--gp-field-scale,1))" }}>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 18% 12%, rgba(255,0,0,.55), transparent 38%), radial-gradient(circle at 84% 22%, rgba(244,239,233,.10), transparent 30%), radial-gradient(circle at 50% 88%, rgba(0,0,0,.5), transparent 52%), ${base}`,
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.13]" aria-hidden="true">
        <defs>
          <pattern id={id} width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(.9)">
            <path
              d="M28 0 56 16.2v32.3L28 64.7 0 48.5V16.2ZM28 64.7V97M0 113 0 97M56 97 56 113"
              fill="none"
              stroke="#F4EFE9"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}

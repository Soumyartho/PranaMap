import type { AnchorHTMLAttributes } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "light" | "ghost";
type Size = "sm" | "lg";

type CtaButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size };

const variants: Record<Variant, { shell: string; chip: string }> = {
  primary: {
    shell:
      "bg-crimson text-paper ring-1 ring-paper/25 shadow-[0_10px_30px_-8px_rgba(255,0,0,0.55)] hover:bg-signal hover:shadow-[0_14px_40px_-8px_rgba(255,0,0,0.75)]",
    chip: "bg-paper text-crimson",
  },
  light: {
    shell: "bg-paper text-ink shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] hover:bg-white",
    chip: "bg-crimson text-paper",
  },
  ghost: {
    shell: "border border-paper/35 text-paper backdrop-blur-sm hover:border-paper hover:bg-paper/10",
    chip: "bg-paper/15 text-paper",
  },
};

const sizes: Record<Size, { shell: string; chip: string; icon: string }> = {
  sm: { shell: "gap-3 py-1.5 pr-1.5 pl-5 text-[13px]", chip: "h-8 w-8", icon: "h-4 w-4" },
  lg: { shell: "gap-4 py-2 pr-2 pl-7 text-[15px]", chip: "h-11 w-11", icon: "h-5 w-5" },
};

/** Pill link with a round arrow chip that turns and nudges on hover. */
export function CtaButton({ variant = "primary", size = "sm", className, children, ...rest }: CtaButtonProps) {
  const v = variants[variant];
  const s = sizes[size];
  return (
    <a
      {...rest}
      className={cn(
        "group inline-flex items-center rounded-full font-display font-semibold tracking-wide transition-[background-color,box-shadow,border-color,transform] duration-300 ease-out-expo active:scale-[0.97]",
        v.shell,
        s.shell,
        className,
      )}
    >
      <span>{children}</span>
      <span
        className={cn(
          "grid place-items-center rounded-full transition-transform duration-500 ease-out-expo group-hover:rotate-45",
          v.chip,
          s.chip,
        )}
        aria-hidden="true"
      >
        <ArrowUpRight className={s.icon} strokeWidth={2.25} />
      </span>
    </a>
  );
}

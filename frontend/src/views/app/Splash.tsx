import { Logo } from "@/views/landing/sections/Logo";

export function Splash() {
  return (
    <div className="grid min-h-svh place-items-center bg-ink">
      <Logo className="h-12 w-12 animate-pulse" />
    </div>
  );
}

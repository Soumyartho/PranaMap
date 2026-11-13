import type { Role } from "@/models/types/domain";

/** Where each role lands after signing in. */
export function homeFor(role: Role | undefined) {
  if (role === "asha") return "/asha";
  if (role === "doctor") return "/doctor";
  return role ? "/phc" : "/login";
}

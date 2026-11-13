import { clsx, type ClassValue } from "clsx";

/**
 * Class names for app views: conditional joins only (clsx, under 1 KB). The landing page's
 * shadcn-style components keep `cn` from ./utils, which also resolves Tailwind conflicts
 * (tailwind-merge), because they accept overriding classes from callers.
 */
export const cn = (...inputs: ClassValue[]) => clsx(inputs);

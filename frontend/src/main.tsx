import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { LazyMotion } from "framer-motion";
import "./styles/index.css";
import { initI18n } from "./i18n";
import { router } from "./routes";
import { boot } from "./controllers/auth/session";

/**
 * GlyphPortal measures the live font when it mounts, so wait for the display face
 * (capped, so a slow network never blocks the page; the portal falls back to static).
 */
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('700 100px "General Sans"', "PranaMapCARE"),
    document.fonts.load('400 16px "Gambetta"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 2000)),
]);

void boot();

Promise.all([fontsReady, initI18n()]).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <LazyMotion features={() => import("./motion-features").then((r) => r.default)}>
        <RouterProvider router={router} />
      </LazyMotion>
    </StrictMode>,
  );
});

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import LandingPage from "./views/landing/LandingPage";

/**
 * GlyphPortal measures the live font when it mounts, so wait for the display face
 * (capped, so a slow network never blocks the page; the portal falls back to static).
 */
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('700 100px "General Sans"', "PRANACE"),
    document.fonts.load('400 16px "Gambetta"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 2000)),
]);

fontsReady.finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <LandingPage />
    </StrictMode>,
  );
});

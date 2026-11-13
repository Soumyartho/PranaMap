import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Where /api goes in dev and preview. The e2e suite points this at its own backend and database.
const API_TARGET = process.env.PRANAMAP_API_TARGET ?? "http://localhost:8000";
// `npm run dev:phone` / `preview:phone`: serve on the LAN over HTTPS (self-signed), because a phone
// only gets the microphone and WebCrypto in a secure context. See docs/PHONE_TESTING.md.
const PHONE = process.env.PRANAMAP_PHONE === "1";

export default defineConfig({
  plugins: [
    PHONE && basicSsl({ name: "pranamap-dev" }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "fonts/*.woff2"],
      manifest: {
        name: "PranaMap",
        short_name: "PranaMap",
        description: "Offline, voice-first health screening for ASHA workers.",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#000000",
        theme_color: "#000000",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The ASHA app must open with no network: precache the shell, fonts and code.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,json,onnx}"],
        // Offline-voice runtime (14 MB WASM) and the English Whisper code are not pushed to every
        // phone at install: they are fetched when the ASHA downloads offline voice, then cached below.
        globIgnores: ["**/transformers*.js", "**/ort*.mjs", "**/*.wasm"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /\/assets\/(ort.*\.(mjs|wasm)|transformers.*\.js)$/.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "asr-runtime", expiration: { maxEntries: 20 } },
          },
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: "CacheFirst",
            options: { cacheName: "map-tiles", expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  worker: { format: "es" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: PHONE ? true : undefined,
    // The FAQ pack and engine fixtures live in ../shared, used by both backend and frontend.
    fs: { allow: [".."] },
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
  preview: {
    host: PHONE ? true : undefined,
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
});

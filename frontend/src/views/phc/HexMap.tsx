import { useEffect, useRef, useState } from "react";
import {
  Map as MLMap,
  Marker,
  NavigationControl,
  Popup,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre v6 renders tiles in an ES-module worker. Vite bundles it (with its shared chunk) here;
// without this the pre-bundled library looks for the worker next to itself and the map stays blank.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
import { Layers } from "lucide-react";

interface HexProps {
  cell: string;
  screened: number;
  high: number;
  emergency: number;
  high_share: number;
  mean_priority: number;
}

export interface HexData {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Polygon"; coordinates: number[][][] }; properties: HexProps }[];
  center: [number, number];
  suppressed_cells: number;
  min_cell_count: number;
  villages: { id: string; name: string; lat: number; lon: number }[];
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0c0a0a" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.38, "raster-saturation": -1, "raster-brightness-max": 0.55 } },
  ],
};

/** Low-end devices get the flat map: no extrusion, no pitch. */
function prefersLite() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 2 || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The "map" in PranaMap: H3 hexagons rising by high-risk count, coloured by the share at risk.
 * Cells with fewer than 5 screened people never reach the browser (suppressed server-side).
 */
export function HexMap({ data }: { data: HexData }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [lite, setLite] = useState(prefersLite);

  useEffect(() => {
    if (!el.current) return;
    const m = new MLMap({
      container: el.current,
      style: STYLE,
      center: data.center,
      zoom: 11.6,
      pitch: lite ? 0 : 48,
      bearing: lite ? 0 : -12,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    m.on("load", () => {
      // Frame the block: every village in view, hexagons large enough to read.
      if (data.villages.length > 1) {
        const lons = data.villages.map((v) => v.lon);
        const lats = data.villages.map((v) => v.lat);
        m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60, duration: 0, pitch: lite ? 0 : 48 });
      }
      m.addSource("hex", { type: "geojson", data });
      const color: ExpressionSpecification = [
        "interpolate", ["linear"], ["get", "high_share"],
        0, "#43c486", 0.35, "#f4a62a", 0.6, "#bc0202", 0.85, "#ff0000",
      ];
      if (lite) {
        m.addLayer({ id: "hex", type: "fill", source: "hex", paint: { "fill-color": color, "fill-opacity": 0.6, "fill-outline-color": "#000" } });
      } else {
        m.addLayer({
          id: "hex",
          type: "fill-extrusion",
          source: "hex",
          paint: {
            "fill-extrusion-color": color,
            "fill-extrusion-height": ["*", ["get", "high"], 55],
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.82,
          },
        });
      }
      for (const v of data.villages) {
        const label = document.createElement("div");
        label.className = "rounded-full bg-ink/80 px-2 py-0.5 font-display text-[11px] font-semibold text-paper border border-line";
        label.textContent = v.name;
        new Marker({ element: label }).setLngLat([v.lon, v.lat]).addTo(m);
      }
      m.on("click", "hex", (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties as HexProps | undefined;
        if (!p) return;
        new Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:General Sans,sans-serif;color:#000"><b>${p.high} of ${p.screened}</b> need follow-up<br/>${p.emergency} emergencies · mean priority ${p.mean_priority}</div>`,
          )
          .addTo(m);
        m.flyTo({ center: e.lngLat, zoom: Math.max(m.getZoom(), 13), speed: 0.8 });
      });
      m.on("mouseenter", "hex", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "hex", () => (m.getCanvas().style.cursor = ""));
    });
    // The container can settle after the map measures it (lazy load, fonts): keep the canvas in step.
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, [data, lite]);

  return (
    <div className="relative h-full min-h-[22rem] overflow-hidden rounded-3xl border border-line">
      {/* Sized explicitly: maplibre-gl.css sets position:relative on this node, so inset-0 would collapse it. */}
      <div ref={el} style={{ width: "100%", height: "100%", minHeight: "22rem" }} />
      <button
        type="button"
        onClick={() => setLite((v) => !v)}
        className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-line bg-ink/85 px-3 py-1.5 font-display text-xs font-semibold text-paper"
      >
        <Layers className="h-3.5 w-3.5" /> {lite ? "3D" : "Lite 2D"}
      </button>
      <div className="absolute bottom-3 left-3 z-10 rounded-2xl border border-line bg-ink/85 px-3 py-2 font-display text-[11px] text-paper/85">
        <div className="flex items-center gap-2">
          <span className="h-2 w-16 rounded-full" style={{ background: "linear-gradient(90deg,#43c486,#f4a62a,#bc0202,#ff0000)" }} />
          share needing follow-up
        </div>
        <p className="mt-1 text-mute">Height = people flagged · {data.suppressed_cells} cells under {data.min_cell_count} people hidden</p>
      </div>
    </div>
  );
}

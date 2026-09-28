"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Map as MapLibreMap, Popup, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Next.js/Turbopack resolves MapLibre's internal worker chunk to a URL that
// 404s in production (Next's HTML 404 page gets served where a .mjs was
// expected, so the browser refuses it as a module script — MIME mismatch).
// Pointing the worker at a plain static file under /public sidesteps
// Turbopack's bundling of it entirely: Next's static file server always
// returns the right JS content type for it, regardless of that bug.
// public/maplibre-gl-worker.mjs is a committed copy of
// node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs — re-copy it if
// maplibre-gl is ever upgraded.
setWorkerUrl("/maplibre-gl-worker.mjs");

export type MapStop = {
  lat: number;
  lon: number;
  label: string | null;
  boardingsEst: number;
  inOfficialPadron: boolean;
  runsObserved: number;
  confidence: string;
  dwellSecondsAvg: number;
};

export function DashboardMap({
  routeCoordinates,
  stops,
}: {
  routeCoordinates: [number, number][];
  stops: MapStop[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const centerIndex = Math.floor(routeCoordinates.length / 2);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: routeCoordinates[centerIndex] ?? [-99.25, 19.47],
      zoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: routeCoordinates },
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#1F6F6B", "line-width": 3 },
      });

      const maxBoardings = Math.max(1, ...stops.map((s) => s.boardingsEst));

      map.addSource("stops", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: stops.map((s) => ({
            type: "Feature",
            properties: {
              label: s.label ?? "Parada",
              boardingsEst: s.boardingsEst,
              inOfficialPadron: s.inOfficialPadron,
              runsObserved: s.runsObserved,
              confidence: s.confidence,
              dwellSecondsAvg: s.dwellSecondsAvg,
            },
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          })),
        },
      });

      map.addLayer({
        id: "stop-circles",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "boardingsEst"],
            0,
            6,
            maxBoardings,
            20,
          ],
          "circle-color": ["case", ["get", "inOfficialPadron"], "#16171A", "#B85C1E"],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#F7F5F1",
        },
      });

      map.on("click", "stop-circles", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as Record<string, unknown>;
        new Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${props.label}</strong><br/>` +
              `${props.boardingsEst} ascensos est. · ${props.dwellSecondsAvg}s detención media<br/>` +
              `${props.runsObserved} corridas · confianza ${props.confidence}` +
              (props.inOfficialPadron
                ? ""
                : "<br/><em>Parada real no registrada en el padrón</em>")
          )
          .addTo(map);
      });

      map.on("mouseenter", "stop-circles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "stop-circles", () => {
        map.getCanvas().style.cursor = "";
      });

      // Fixed callout for the one stop not in the official padrón — the
      // mockup shows this always visible, not just discoverable on hover.
      const informal = stops.find((s) => !s.inOfficialPadron);
      if (informal) {
        new Popup({ closeButton: false, closeOnClick: false })
          .setLngLat([informal.lon, informal.lat])
          .setHTML(
            `<strong>Parada real no registrada en el padrón</strong><br/>` +
              `${informal.boardingsEst} ascensos/turno · detención media ${informal.dwellSecondsAvg}s`
          )
          .addTo(map);
      }

      const bounds = new LngLatBounds();
      routeCoordinates.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, { padding: 40, duration: 0 });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [routeCoordinates, stops]);

  return <div ref={containerRef} className="h-full min-h-[320px] w-full" />;
}

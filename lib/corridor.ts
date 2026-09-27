import type { LatLon } from "@/lib/geo";

export type CorridorStop = LatLon & {
  id: string;
  label: string;
  /** Whether this stop is on the (fictional, for this simulated slice) official padrón. */
  official: boolean;
  /** Dwell range in seconds once a run arrives here — not the base fill-up wait. */
  dwellSecondsRange: [number, number];
};

export const ROUTE_LABEL = "San Bartolo – Toreo";

/**
 * Synthetic corridor near Naucalpan de Juárez, San Bartolo → Toreo/Cuatro
 * Caminos. All coordinates are fabricated for this simulated slice — see
 * Security Floor #5. Stop 4 ("informal") is the one run generator deliberately
 * places off the (fictional) official padrón, so Commit 4's inference can
 * surface it as an unregistered stop.
 */
export const CORRIDOR_STOPS: CorridorStop[] = [
  {
    id: "base",
    label: "Base San Bartolo",
    lat: 19.479,
    lon: -99.254,
    official: true,
    dwellSecondsRange: [0, 0],
  },
  {
    id: "p2",
    label: "Parada 2",
    lat: 19.4772,
    lon: -99.2518,
    official: true,
    dwellSecondsRange: [15, 35],
  },
  {
    id: "p3",
    label: "Parada 3",
    lat: 19.4753,
    lon: -99.2497,
    official: true,
    dwellSecondsRange: [15, 40],
  },
  {
    id: "p4",
    label: "Parada 4",
    lat: 19.4735,
    lon: -99.2478,
    official: true,
    dwellSecondsRange: [15, 35],
  },
  {
    id: "p5-informal",
    label: "Parada 5 (informal)",
    lat: 19.4715,
    lon: -99.246,
    official: false,
    dwellSecondsRange: [10, 25],
  },
  {
    id: "p6",
    label: "Parada 6",
    lat: 19.4693,
    lon: -99.2442,
    official: true,
    dwellSecondsRange: [15, 40],
  },
  {
    id: "p7",
    label: "Parada 7",
    lat: 19.467,
    lon: -99.2423,
    official: true,
    dwellSecondsRange: [15, 35],
  },
  {
    id: "p8",
    label: "Parada 8",
    lat: 19.4645,
    lon: -99.24,
    official: true,
    dwellSecondsRange: [15, 40],
  },
  {
    id: "terminal",
    label: "Terminal El Toreo",
    lat: 19.4586,
    lon: -99.2367,
    official: true,
    dwellSecondsRange: [15, 30],
  },
];

/** Nominal seated+standing capacity used only to turn a target occupancy
 * fraction into a passenger count for the wait-time model — never stored. */
export const VEHICLE_CAPACITY = 18;

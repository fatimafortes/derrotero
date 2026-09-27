import { dbscan } from "@/lib/dbscan";
import { haversineMeters } from "@/lib/geo";
import { CORRIDOR_STOPS } from "@/lib/corridor";

// Por debajo de esta velocidad asumimos que la unidad está detenida, no
// avanzando. El generador nunca deja una lectura "en movimiento" por debajo
// de 5 km/h, así que 4 km/h separa limpio sin arriesgar falsos positivos.
const LOW_SPEED_KMH = 4;

// Qué tan cerca deben estar dos lecturas detenidas para contar como la misma
// parada. Las paradas de este corredor están a cientos de metros entre sí;
// 25 m agrupa el ruido normal de un GPS de teléfono sin fusionar dos
// paradas reales.
const EPS_METERS = 25;

// Cuántas lecturas detenidas hacen falta, en cualquier combinación de
// corridas, para confiar en que ahí hay una parada y no un GPS que tembló.
const MIN_POINTS = 3;

// Qué tan cerca de una parada oficial conocida cuenta como "es esa parada"
// al momento de decidir si algo está o no en el padrón.
const PADRON_MATCH_METERS = 60;

// No hay sensor de pasajeros en este dispositivo — nunca lo habrá, por
// diseño. Esta es una tasa de referencia de operación de transporte urbano
// (segundos por persona que sube o baja), no una medición de este corredor.
// Boardings_est es, y se muestra como, una estimación.
const SECONDS_PER_BOARDING = 3;

export type PingRow = {
  shift_id: string;
  lat: number;
  lon: number;
  speed_kmh: number | null;
  captured_at: string;
};

export type Confidence = "baja" | "media" | "alta";

export type InferredStop = {
  lat: number;
  lon: number;
  label: string | null;
  dwell_seconds_avg: number;
  boardings_est: number;
  runs_observed: number;
  confidence: Confidence;
  in_official_padron: boolean;
};

function confidenceFromCoverage(runsObserved: number, totalRuns: number): Confidence {
  const coverage = totalRuns === 0 ? 0 : runsObserved / totalRuns;
  // Umbral, explícito: si casi todas las corridas pasan por aquí (80% o
  // más), es una parada consolidada de la ruta. Si menos de 4 de cada 10
  // corridas la registran, es más probable que sea un evento aislado — un
  // semáforo, un desvío de un solo día — que una parada real y repetida.
  if (coverage >= 0.8) return "alta";
  if (coverage >= 0.4) return "media";
  return "baja";
}

export function inferStops(pings: PingRow[], totalRuns: number): InferredStop[] {
  const lowSpeed = pings.filter((p) => (p.speed_kmh ?? 0) <= LOW_SPEED_KMH);
  if (lowSpeed.length === 0) return [];

  const labels = dbscan(lowSpeed, { epsMeters: EPS_METERS, minPoints: MIN_POINTS });

  const clusters = new Map<number, PingRow[]>();
  labels.forEach((clusterId, i) => {
    if (clusterId === -1) return; // ruido: se descarta, nunca se muestra como parada
    const list = clusters.get(clusterId) ?? [];
    list.push(lowSpeed[i]);
    clusters.set(clusterId, list);
  });

  const stops: InferredStop[] = [];

  for (const points of clusters.values()) {
    const centroid = {
      lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
      lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
    };

    // Cuánto duró la parada, corrida por corrida: el tiempo entre la
    // primera y la última lectura lenta que dejó ESA corrida en este grupo.
    const byShift = new Map<string, PingRow[]>();
    for (const p of points) {
      const list = byShift.get(p.shift_id) ?? [];
      list.push(p);
      byShift.set(p.shift_id, list);
    }

    const dwellsPerRun: number[] = [];
    for (const shiftPoints of byShift.values()) {
      const times = shiftPoints
        .map((p) => new Date(p.captured_at).getTime())
        .sort((a, b) => a - b);
      const spanSeconds = (times[times.length - 1] - times[0]) / 1000;
      dwellsPerRun.push(spanSeconds + 10); // +10s: la última lectura también cuenta como presencia
    }

    const dwellAvg =
      dwellsPerRun.reduce((sum, d) => sum + d, 0) / dwellsPerRun.length;

    const boardingsEst = Math.max(1, Math.round(dwellAvg / SECONDS_PER_BOARDING));
    const runsObserved = byShift.size;
    const confidence = confidenceFromCoverage(runsObserved, totalRuns);

    let nearestStop: (typeof CORRIDOR_STOPS)[number] | null = null;
    let nearestDistance = Infinity;
    for (const stop of CORRIDOR_STOPS) {
      const distance = haversineMeters(centroid, stop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestStop = stop;
      }
    }
    const matched = nearestStop && nearestDistance <= PADRON_MATCH_METERS ? nearestStop : null;

    stops.push({
      lat: centroid.lat,
      lon: centroid.lon,
      label: matched?.label ?? null,
      dwell_seconds_avg: Math.round(dwellAvg),
      boardings_est: boardingsEst,
      runs_observed: runsObserved,
      confidence,
      in_official_padron: matched?.official ?? false,
    });
  }

  return stops;
}

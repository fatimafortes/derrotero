import type { Confidence, PingRow } from "@/lib/inference/stops";

// Misma línea que separa "detenido" de "en movimiento" que usa stops.ts —
// aquí decide el instante exacto de salida, no una parada.
const LOW_SPEED_KMH = 4;

// La dirigencia reporta que sus unidades salen entre 60% y 85% de ocupación
// — el hallazgo real de su investigación con usuaria. No hay sensor de
// pasajeros que mida esto directo; se usa como el rango conocido sobre el
// que se proyecta cada espera observada (ver estimateOccupancy).
const KNOWN_MIN_OCCUPANCY = 0.6;
const KNOWN_MAX_OCCUPANCY = 0.85;

export type ShiftRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
};

export type RunMetric = {
  shift_id: string;
  departed_at: string;
  headway_minutes: number | null;
  occupancy_at_departure: number;
  confidence: Confidence;
};

function confidenceFromWaitSamples(count: number): Confidence {
  // Cuántas lecturas de GPS vimos MIENTRAS la unidad seguía detenida en
  // base, antes de arrancar. Con más lecturas, el instante de salida que
  // calculamos es más confiable; con pocas o ninguna, es una aproximación
  // — por ejemplo, si el teléfono empezó a mandar datos ya en movimiento.
  if (count >= 5) return "alta";
  if (count >= 2) return "media";
  return "baja";
}

/**
 * El momento real de salida no es "cuando el operador tocó Iniciar turno" —
 * eso es cuándo empezó a esperar pasajeros. La salida real es la primera
 * lectura de GPS de esa corrida que ya no está detenida: el primer punto en
 * movimiento. Todo lo que sigue (intervalo real, ocupación estimada) se
 * calcula a partir de ESE instante, nunca del reloj de turno.
 */
export function inferRunMetrics(
  pings: PingRow[],
  shifts: ShiftRow[]
): RunMetric[] {
  const byShift = new Map<string, PingRow[]>();
  for (const p of pings) {
    const list = byShift.get(p.shift_id) ?? [];
    list.push(p);
    byShift.set(p.shift_id, list);
  }

  type Departure = {
    shift_id: string;
    departedAtMs: number;
    waitSeconds: number;
    waitSamples: number;
  };
  const departures: Departure[] = [];

  for (const shift of shifts) {
    const shiftPings = (byShift.get(shift.id) ?? [])
      .slice()
      .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
    if (shiftPings.length === 0) continue;

    const firstMovingIndex = shiftPings.findIndex(
      (p) => (p.speed_kmh ?? 0) > LOW_SPEED_KMH
    );
    const departureIndex = firstMovingIndex === -1 ? 0 : firstMovingIndex;
    const departedAtMs = new Date(shiftPings[departureIndex].captured_at).getTime();
    const startedAtMs = new Date(shift.started_at).getTime();

    departures.push({
      shift_id: shift.id,
      departedAtMs,
      waitSeconds: Math.max(0, (departedAtMs - startedAtMs) / 1000),
      waitSamples: departureIndex,
    });
  }

  // El intervalo es entre salidas consecutivas DE BASE, contando todas las
  // unidades juntas — es lo que vive el pasajero parado esperando, no el
  // ritmo de una sola unidad. Por eso se ordena y compara globalmente.
  departures.sort((a, b) => a.departedAtMs - b.departedAtMs);

  const allWaits = departures.map((d) => d.waitSeconds).sort((a, b) => a - b);

  function estimateOccupancy(waitSeconds: number): number {
    const countAtOrBelow = allWaits.filter((w) => w <= waitSeconds).length;
    const percentile =
      allWaits.length <= 1 ? 0.5 : (countAtOrBelow - 1) / (allWaits.length - 1);
    return (
      KNOWN_MIN_OCCUPANCY + percentile * (KNOWN_MAX_OCCUPANCY - KNOWN_MIN_OCCUPANCY)
    );
  }

  return departures.map((d, i) => ({
    shift_id: d.shift_id,
    departed_at: new Date(d.departedAtMs).toISOString(),
    headway_minutes:
      i === 0 ? null : (d.departedAtMs - departures[i - 1].departedAtMs) / 60000,
    occupancy_at_departure: Number(estimateOccupancy(d.waitSeconds).toFixed(3)),
    confidence: confidenceFromWaitSamples(d.waitSamples),
  }));
}

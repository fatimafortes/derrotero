import { haversineMeters, type LatLon } from "@/lib/geo";

/**
 * DBSCAN agrupa puntos que están cerca unos de otros en el mapa, sin que
 * nadie le diga de antemano cuántos grupos ("paradas") existen ni dónde
 * están. En palabras simples, para cada punto:
 *
 *   1. Cuenta cuántos otros puntos hay a menos de `epsMeters` de distancia.
 *   2. Si hay suficientes vecinos cercanos (`minPoints` o más), este punto
 *      es el inicio de una parada real: nace un grupo nuevo y se le suman
 *      todos esos vecinos.
 *   3. Cada vecino recién sumado repite el mismo paso 1: si ÉL también
 *      tiene suficientes vecinos, el grupo crece hacia allá — así se va
 *      "contagiando" mientras haya densidad de puntos cerca uno del otro.
 *   4. Un punto que nunca tiene suficientes vecinos cerca se queda fuera de
 *      todo grupo: es ruido — un GPS que tembló un instante, no una parada.
 *
 * No hace falta decirle cuántas paradas buscar: una parada real es,
 * literalmente, el lugar donde los puntos se acumulan juntos.
 */

const NOISE = -1;
const UNVISITED = -2;

export type ClusterAssignment = number[]; // -1 = ruido; 0,1,2… = id de grupo

export function dbscan(
  points: LatLon[],
  { epsMeters, minPoints }: { epsMeters: number; minPoints: number }
): ClusterAssignment {
  const labels: number[] = new Array(points.length).fill(UNVISITED);

  function neighborsOf(index: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i !== index && haversineMeters(points[index], points[i]) <= epsMeters) {
        result.push(i);
      }
    }
    return result;
  }

  let nextClusterId = 0;

  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors = neighborsOf(i);
    if (neighbors.length < minPoints) {
      labels[i] = NOISE; // puede rescatarse más abajo si otro grupo lo alcanza
      continue;
    }

    const clusterId = nextClusterId++;
    labels[i] = clusterId;

    const queue = [...neighbors];
    while (queue.length > 0) {
      const j = queue.shift()!;
      if (labels[j] === NOISE) {
        labels[j] = clusterId; // era ruido visto desde otro punto, pero es borde de esta parada
      }
      if (labels[j] !== UNVISITED) continue;

      labels[j] = clusterId;
      const jNeighbors = neighborsOf(j);
      if (jNeighbors.length >= minPoints) {
        queue.push(...jNeighbors); // j también es denso: la parada sigue creciendo a través de él
      }
    }
  }

  return labels;
}

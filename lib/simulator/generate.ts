import { CORRIDOR_STOPS, VEHICLE_CAPACITY } from "@/lib/corridor";
import { haversineMeters, interpolate } from "@/lib/geo";
import { mulberry32 } from "@/lib/simulator/rng";

export type SimPing = {
  captured_at: string;
  lat: number;
  lon: number;
  speed_kmh: number;
};

export type SimRun = {
  startedAt: Date;
  endedAt: Date;
  pings: SimPing[];
};

export type SimUnitPlan = {
  economicNumber: string;
  runs: SimRun[];
};

const PING_INTERVAL_SECONDS = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Meter-scale GPS jitter, converted to degrees. Cosmetic noise only — not
 * precise enough to matter at the corridor's scale, only to avoid pings
 * landing on the exact same point. */
function jitterDegrees(rng: () => number, meters: number): number {
  const degreesPerMeter = 1 / 111_320;
  return (rng() - 0.5) * 2 * meters * degreesPerMeter;
}

/** How many passengers per minute show up at base, by time of day. This is
 * the real user-research finding this whole generator exists to reproduce
 * honestly: demand is heaviest 06:00–07:00 and tapers after. */
function passengersPerMinute(at: Date): number {
  const hour = at.getHours() + at.getMinutes() / 60;
  if (hour < 6) return 5;
  if (hour < 7) return 7.5;
  return 3;
}

/**
 * One run = one one-way trip, base → terminal. The departure from base is
 * never scheduled by clock time: it happens when simulated occupancy lands
 * somewhere in 60–85%, and how long that takes depends on how fast
 * passengers are arriving at that hour. That is what makes headways between
 * runs uneven — the unevenness is a byproduct of the model, not a value we
 * pick and insert.
 */
function generateUnitRuns(
  runsPerUnit: number,
  unitStagger: Date,
  rng: () => number
): SimRun[] {
  const runs: SimRun[] = [];
  let cursor = unitStagger;
  const base = CORRIDOR_STOPS[0];

  for (let runIndex = 0; runIndex < runsPerUnit; runIndex++) {
    const pings: SimPing[] = [];
    let clock = cursor;

    // 1. Wait at base until occupancy reaches the 60–85% trigger band.
    const targetOccupancy = 0.6 + rng() * 0.25;
    const targetPassengers = Math.round(targetOccupancy * VEHICLE_CAPACITY);
    const rate = passengersPerMinute(clock);
    const waitMinutes = clamp(
      (targetPassengers / rate) * (0.8 + rng() * 0.5),
      2,
      25
    );
    const waitSeconds = Math.round(waitMinutes * 60);

    for (let s = 0; s <= waitSeconds; s += PING_INTERVAL_SECONDS) {
      pings.push({
        captured_at: new Date(clock.getTime() + s * 1000).toISOString(),
        lat: base.lat + jitterDegrees(rng, 3),
        lon: base.lon + jitterDegrees(rng, 3),
        speed_kmh: Math.max(0, rng() * 2),
      });
    }
    clock = new Date(clock.getTime() + waitSeconds * 1000);

    // 2. Departure: travel each segment, dwell briefly at every stop that
    //    follows (including the informal one and the terminal).
    for (let segment = 0; segment < CORRIDOR_STOPS.length - 1; segment++) {
      const from = CORRIDOR_STOPS[segment];
      const to = CORRIDOR_STOPS[segment + 1];
      const distanceMeters = haversineMeters(from, to);
      const speedKmh = 18 + rng() * 14; // urban traffic, not a highway cruise
      const travelSeconds = Math.max(
        10,
        (distanceMeters / 1000 / speedKmh) * 3600
      );
      const steps = Math.max(1, Math.round(travelSeconds / PING_INTERVAL_SECONDS));

      for (let step = 1; step <= steps; step++) {
        const position = interpolate(from, to, step / steps);
        pings.push({
          captured_at: new Date(
            clock.getTime() + step * PING_INTERVAL_SECONDS * 1000
          ).toISOString(),
          lat: position.lat + jitterDegrees(rng, 6),
          lon: position.lon + jitterDegrees(rng, 6),
          speed_kmh: clamp(speedKmh + (rng() - 0.5) * 8, 5, 45),
        });
      }
      clock = new Date(clock.getTime() + steps * PING_INTERVAL_SECONDS * 1000);

      const [minDwell, maxDwell] = to.dwellSecondsRange;
      const dwellSeconds = Math.round(minDwell + rng() * (maxDwell - minDwell));
      for (let s = PING_INTERVAL_SECONDS; s <= dwellSeconds; s += PING_INTERVAL_SECONDS) {
        pings.push({
          captured_at: new Date(clock.getTime() + s * 1000).toISOString(),
          lat: to.lat + jitterDegrees(rng, 3),
          lon: to.lon + jitterDegrees(rng, 3),
          speed_kmh: Math.max(0, rng() * 2),
        });
      }
      clock = new Date(clock.getTime() + dwellSeconds * 1000);
    }

    runs.push({ startedAt: cursor, endedAt: clock, pings });

    // The return trip to base isn't tracked (out of scope for this slice —
    // see DECISIONS.md); just advance the clock past a plausible turnaround.
    const returnMinutes = 15 + rng() * 10;
    cursor = new Date(clock.getTime() + returnMinutes * 60_000);
  }

  return runs;
}

export function generateSeededCorridorData({
  unitEconomicNumbers,
  runsPerUnit,
  windowStart,
  seed,
}: {
  unitEconomicNumbers: string[];
  runsPerUnit: number;
  windowStart: Date;
  seed: number;
}): SimUnitPlan[] {
  const rng = mulberry32(seed);
  return unitEconomicNumbers.map((economicNumber, unitIndex) => ({
    economicNumber,
    runs: generateUnitRuns(
      runsPerUnit,
      new Date(windowStart.getTime() + unitIndex * 3 * 60_000),
      rng
    ),
  }));
}

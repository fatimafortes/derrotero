import { CORRIDOR_STOPS } from "@/lib/corridor";
import { formatHourLabel, mexicoHourOfDay } from "@/lib/mexicoTime";

export type Confidence = "baja" | "media" | "alta";

export type InferredStopRow = {
  lat: number;
  lon: number;
  label: string | null;
  dwell_seconds_avg: number;
  boardings_est: number;
  runs_observed: number;
  confidence: Confidence;
  in_official_padron: boolean;
};

export type RunMetricRow = {
  departed_at: string;
  headway_minutes: number | null;
  occupancy_at_departure: number;
  confidence: Confidence;
};

const WINDOW_START_HOUR = 5;
const WINDOW_END_HOUR = 8;
const BUCKET_MINUTES = 30;
const BUCKET_COUNT = ((WINDOW_END_HOUR - WINDOW_START_HOUR) * 60) / BUCKET_MINUTES;

const BASE_LABEL = CORRIDOR_STOPS[0].label;

export type HeadwayBucket = {
  label: string;
  averageMinutes: number | null;
  sampleCount: number;
};

/** Buckets departures into 30-minute windows within 05:00–08:00 Mexico
 * time and averages their headway. The seeded corridor runs well past this
 * window (each unit's 14 runs span several hours) — this is a deliberate
 * slice matching the packet's "05:00–08:00" chart, not the whole dataset. */
export function computeHeadwayBuckets(runMetrics: RunMetricRow[]): HeadwayBucket[] {
  const buckets: { sum: number; count: number }[] = Array.from(
    { length: BUCKET_COUNT },
    () => ({ sum: 0, count: 0 })
  );

  for (const row of runMetrics) {
    if (row.headway_minutes === null) continue;
    const hour = mexicoHourOfDay(row.departed_at);
    if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) continue;
    const bucketIndex = Math.floor(((hour - WINDOW_START_HOUR) * 60) / BUCKET_MINUTES);
    buckets[bucketIndex].sum += row.headway_minutes;
    buckets[bucketIndex].count += 1;
  }

  return buckets.map((b, i) => ({
    label: formatHourLabel(WINDOW_START_HOUR + (i * BUCKET_MINUTES) / 60),
    averageMinutes: b.count > 0 ? b.sum / b.count : null,
    sampleCount: b.count,
  }));
}

export function dominantConfidence(rows: { confidence: Confidence }[]): Confidence {
  const counts: Record<Confidence, number> = { baja: 0, media: 0, alta: 0 };
  for (const r of rows) counts[r.confidence] += 1;
  let best: Confidence = "media";
  let bestCount = -1;
  (["baja", "media", "alta"] as const).forEach((tier) => {
    if (counts[tier] > bestCount) {
      bestCount = counts[tier];
      best = tier;
    }
  });
  return best;
}

export function averageOccupancy(runMetrics: RunMetricRow[]): number {
  if (runMetrics.length === 0) return 0;
  return (
    runMetrics.reduce((sum, r) => sum + r.occupancy_at_departure, 0) /
    runMetrics.length
  );
}

/** Excludes the base stop: its "dwell" is the occupancy fill-wait, a
 * different thing from boarding/alighting dwell at a regular stop, and
 * mixing them would skew this figure upward without meaning anything. */
export function averageDwellExcludingBase(stops: InferredStopRow[]): number {
  const regularStops = stops.filter((s) => s.label !== BASE_LABEL);
  if (regularStops.length === 0) return 0;
  return (
    regularStops.reduce((sum, s) => sum + s.dwell_seconds_avg, 0) /
    regularStops.length
  );
}

export type HallazgoHeadway = {
  minutes: number;
  label: string;
  confidence: Confidence;
} | null;

/** The single largest headway within the displayed 05:00–08:00 window —
 * the concrete number the "hallazgo del turno" card points at. */
export function maxHeadwayInWindow(runMetrics: RunMetricRow[]): HallazgoHeadway {
  let best: RunMetricRow | null = null;
  for (const row of runMetrics) {
    if (row.headway_minutes === null) continue;
    const hour = mexicoHourOfDay(row.departed_at);
    if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) continue;
    if (!best || row.headway_minutes > (best.headway_minutes ?? 0)) best = row;
  }
  if (!best || best.headway_minutes === null) return null;
  return {
    minutes: best.headway_minutes,
    label: formatHourLabel(mexicoHourOfDay(best.departed_at)),
    confidence: best.confidence,
  };
}

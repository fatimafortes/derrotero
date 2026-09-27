"use server";

import { createClient } from "@/lib/supabase/server";
import { generateSeededCorridorData } from "@/lib/simulator/generate";
import { inferStops, type PingRow } from "@/lib/inference/stops";
import { inferRunMetrics, type ShiftRow } from "@/lib/inference/runMetrics";
import { ROUTE_LABEL } from "@/lib/corridor";
import type { SupabaseClient } from "@supabase/supabase-js";

const SEED_UNIT_NUMBERS = ["SB-01", "SB-02", "SB-03"];
const RUNS_PER_UNIT = 14;
const PING_INSERT_CHUNK = 500;
const PING_PAGE_SIZE = 1000; // Supabase corta en 1000 filas por consulta si no se pagina.

type SeedResult =
  | { ok: true; shifts: number; pings: number }
  | { ok: false; error: string };

type MembershipCheck =
  | { ok: true; associationId: string }
  | { ok: false; error: string };

async function requireDirigencia(
  supabase: SupabaseClient
): Promise<MembershipCheck> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sin sesión." };
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("association_id, role")
    .limit(1);
  const membership = memberships?.[0];
  if (!membership) {
    return { ok: false, error: "No perteneces a ninguna asociación." };
  }
  if (membership.role !== "dirigencia") {
    return { ok: false, error: "Solo la dirigencia puede hacer esto." };
  }

  return { ok: true, associationId: membership.association_id as string };
}

export async function seedDemoData(): Promise<SeedResult> {
  const supabase = await createClient();
  const membership = await requireDirigencia(supabase);
  if (!membership.ok) {
    return { ok: false, error: membership.error };
  }
  const associationId = membership.associationId;

  const { data: units, error: unitsError } = await supabase
    .from("units")
    .select("id, economic_number")
    .eq("association_id", associationId)
    .in("economic_number", SEED_UNIT_NUMBERS);

  if (unitsError || !units || units.length !== SEED_UNIT_NUMBERS.length) {
    return {
      ok: false,
      error: "Faltan unidades SB-01/SB-02/SB-03 en esta asociación.",
    };
  }

  const unitIdByNumber = new Map<string, string>(
    units.map((u) => [u.economic_number as string, u.id as string])
  );
  const unitIds = units.map((u) => u.id as string);

  // Limpia solo lo simulado de estas tres unidades — nunca toca PRUEBA-01
  // ni ninguna captura real. Borrar shifts arrastra sus pings por cascada.
  const { data: oldShifts } = await supabase
    .from("shifts")
    .select("id")
    .in("unit_id", unitIds)
    .eq("is_simulated", true);

  if (oldShifts && oldShifts.length > 0) {
    await supabase
      .from("shifts")
      .delete()
      .in(
        "id",
        oldShifts.map((s) => s.id as string)
      );
  }

  // 05:00 América/Ciudad_de_México, expressed in UTC (fixed UTC-6 — Mexico
  // dropped DST nationally in 2022). Built from UTC date parts and a fixed
  // offset on purpose: Vercel's serverless runtime clock is UTC, so
  // `new Date().setHours(5, ...)` would silently seed 05:00 UTC (11pm the
  // previous night in Mexico City) instead of the intended rush-hour window.
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 11, 0, 0, 0)
  );

  const plan = generateSeededCorridorData({
    unitEconomicNumbers: SEED_UNIT_NUMBERS,
    runsPerUnit: RUNS_PER_UNIT,
    windowStart,
    seed: 20260927,
  });

  let totalShifts = 0;
  let totalPings = 0;

  for (const unitPlan of plan) {
    const unitId = unitIdByNumber.get(unitPlan.economicNumber);
    if (!unitId) continue;

    for (const run of unitPlan.runs) {
      const { data: shift, error: shiftError } = await supabase
        .from("shifts")
        .insert({
          association_id: associationId,
          unit_id: unitId,
          started_at: run.startedAt.toISOString(),
          ended_at: run.endedAt.toISOString(),
          is_simulated: true,
        })
        .select("id")
        .single();

      if (shiftError || !shift) continue;
      totalShifts += 1;

      const rows = run.pings.map((p) => ({
        association_id: associationId,
        shift_id: shift.id as string,
        captured_at: p.captured_at,
        lat: p.lat,
        lon: p.lon,
        speed_kmh: p.speed_kmh,
        is_simulated: true,
      }));

      for (let i = 0; i < rows.length; i += PING_INSERT_CHUNK) {
        await supabase.from("pings").insert(rows.slice(i, i + PING_INSERT_CHUNK));
      }
      totalPings += rows.length;
    }
  }

  return { ok: true, shifts: totalShifts, pings: totalPings };
}

type InferResult =
  | { ok: true; stops: number; runs: number }
  | { ok: false; error: string };

export async function computeInference(): Promise<InferResult> {
  const supabase = await createClient();
  const membership = await requireDirigencia(supabase);
  if (!membership.ok) {
    return { ok: false, error: membership.error };
  }
  const associationId = membership.associationId;

  const { data: shifts, error: shiftsError } = await supabase
    .from("shifts")
    .select("id, started_at, ended_at")
    .eq("association_id", associationId)
    .eq("is_simulated", true);

  if (shiftsError) {
    return { ok: false, error: `Error leyendo turnos: ${shiftsError.message}` };
  }
  if (!shifts || shifts.length === 0) {
    return { ok: false, error: "No hay turnos simulados todavía. Siembra primero." };
  }

  const shiftIds = shifts.map((s) => s.id as string);
  const pings: PingRow[] = [];
  for (let offset = 0; ; offset += PING_PAGE_SIZE) {
    const { data: page, error: pingsError } = await supabase
      .from("pings")
      .select("shift_id, lat, lon, speed_kmh, captured_at")
      .in("shift_id", shiftIds)
      .order("captured_at", { ascending: true })
      .range(offset, offset + PING_PAGE_SIZE - 1);

    if (pingsError) {
      return { ok: false, error: `Error leyendo pings: ${pingsError.message}` };
    }
    if (!page || page.length === 0) break;
    pings.push(...(page as PingRow[]));
    if (page.length < PING_PAGE_SIZE) break;
  }

  if (pings.length === 0) {
    return { ok: false, error: "Los turnos simulados no tienen pings todavía." };
  }

  // Limpia solo resultados simulados previos de esta asociación — nunca
  // toca inferencia que en el futuro venga de captura real.
  await supabase
    .from("inferred_stops")
    .delete()
    .eq("association_id", associationId)
    .eq("is_simulated", true);
  await supabase
    .from("run_metrics")
    .delete()
    .eq("association_id", associationId)
    .eq("is_simulated", true);

  const stops = inferStops(pings, shifts.length);
  if (stops.length > 0) {
    const { error: stopsError } = await supabase.from("inferred_stops").insert(
      stops.map((s) => ({
        association_id: associationId,
        route_label: ROUTE_LABEL,
        lat: s.lat,
        lon: s.lon,
        label: s.label,
        dwell_seconds_avg: s.dwell_seconds_avg,
        boardings_est: s.boardings_est,
        runs_observed: s.runs_observed,
        confidence: s.confidence,
        in_official_padron: s.in_official_padron,
        is_simulated: true,
      }))
    );
    if (stopsError) {
      return { ok: false, error: `Error guardando paradas: ${stopsError.message}` };
    }
  }

  const metrics = inferRunMetrics(pings, shifts as ShiftRow[]);
  if (metrics.length > 0) {
    const { error: metricsError } = await supabase.from("run_metrics").insert(
      metrics.map((m) => ({
        association_id: associationId,
        shift_id: m.shift_id,
        departed_at: m.departed_at,
        headway_minutes: m.headway_minutes,
        occupancy_at_departure: m.occupancy_at_departure,
        confidence: m.confidence,
        is_simulated: true,
      }))
    );
    if (metricsError) {
      return { ok: false, error: `Error guardando métricas: ${metricsError.message}` };
    }
  }

  return { ok: true, stops: stops.length, runs: metrics.length };
}

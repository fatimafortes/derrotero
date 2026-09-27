"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Unit = { id: string; economic_number: string };

type LocationStatus =
  | "idle"
  | "watching"
  | "denied"
  | "unavailable"
  | "unsupported";

type PingDraft = {
  captured_at: string;
  lat: number;
  lon: number;
  speed_kmh: number | null;
};

type DiagPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "desconocido"
  | "no-soportado";

type DiagState = {
  /** How many times this screen has (re)mounted while this shift was open.
   * >1 means the page was silently reloaded/discarded mid-shift — the
   * smoking gun for suspicion 3 (buffer lost on suspend/reload). */
  mountCount: number;
  permission: DiagPermission;
  capturedCount: number;
  lastCapturedAt: string | null;
  geoErrorCount: number;
  lastGeoError: string | null;
  flushAttempts: number;
  flushSuccesses: number;
  flushFailures: number;
  lastFlushError: string | null;
  bufferedCount: number;
  hiddenCount: number;
  bfcacheRestoreCount: number;
};

const EMPTY_DIAG: DiagState = {
  mountCount: 0,
  permission: "desconocido",
  capturedCount: 0,
  lastCapturedAt: null,
  geoErrorCount: 0,
  lastGeoError: null,
  flushAttempts: 0,
  flushSuccesses: 0,
  flushFailures: 0,
  lastFlushError: null,
  bufferedCount: 0,
  hiddenCount: 0,
  bfcacheRestoreCount: 0,
};

function diagStorageKey(shiftId: string) {
  return `derrotero:diag:${shiftId}`;
}

/** Reads the diagnostic record for a shift from localStorage, which — unlike
 * React state or a plain ref — survives a silent page reload. That's the
 * whole point: if the page gets torn down mid-shift, in-memory-only
 * counters would reset right along with the bug they're meant to expose. */
function readDiag(shiftId: string): DiagState {
  try {
    const raw = window.localStorage.getItem(diagStorageKey(shiftId));
    if (!raw) return { ...EMPTY_DIAG };
    return { ...EMPTY_DIAG, ...(JSON.parse(raw) as Partial<DiagState>) };
  } catch {
    return { ...EMPTY_DIAG };
  }
}

function writeDiag(shiftId: string, diag: DiagState) {
  try {
    window.localStorage.setItem(diagStorageKey(shiftId), JSON.stringify(diag));
  } catch {
    // Best-effort only — this is debug scaffolding, not core behavior.
  }
}

const UNIT_STORAGE_KEY = "derrotero:unit_id";
const PING_FLUSH_MS = 10_000;

export function OperadorClient({
  associationId,
  units,
}: {
  associationId: string;
  units: Unit[];
}) {
  const [supabase] = useState(() => createClient());

  const [hydrated, setHydrated] = useState(false);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [checkingShift, setCheckingShift] = useState(false);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [busy, setBusy] = useState(false);

  const [diag, setDiag] = useState<DiagState>(EMPTY_DIAG);

  const watchIdRef = useRef<number | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferRef = useRef<PingDraft[]>([]);

  // Load the unit this device was assigned last time — the picker only ever
  // runs once per phone. Must stay an effect: reading localStorage during the
  // render that matches SSR output would cause a hydration mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(UNIT_STORAGE_KEY);
      if (stored && units.some((u) => u.id === stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUnitId(stored);
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — the picker just reappears.
    }
    setHydrated(true);
  }, [units]);

  // A reload mid-shift should resume the same shift, not silently lose it.
  useEffect(() => {
    if (!unitId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckingShift(true);
    supabase
      .from("shifts")
      .select("id")
      .eq("unit_id", unitId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setShiftId(data?.id ?? null);
          setCheckingShift(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unitId, supabase]);

  // Load (or start) this shift's persisted diagnostic record, bumping
  // mountCount every time this effect runs for a given shift — including a
  // silent reload, which is exactly what we're trying to catch. Ending the
  // shift (shiftId -> null) intentionally does NOT clear `diag`: the panel
  // needs to keep showing the final counts right after "Terminar turno".
  useEffect(() => {
    if (!shiftId) return;
    const existing = readDiag(shiftId);
    const withMount = { ...existing, mountCount: existing.mountCount + 1 };
    writeDiag(shiftId, withMount);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDiag(withMount);
  }, [shiftId]);

  // Persist every diagnostic update immediately — if the page gets torn
  // down a moment later, whatever was last written is what survives.
  useEffect(() => {
    if (shiftId) writeDiag(shiftId, diag);
  }, [diag, shiftId]);

  // Geolocation permission state, queried directly rather than inferred —
  // "denied silently" (suspicion 1) is exactly the case a UI status message
  // alone could get wrong.
  useEffect(() => {
    let status: PermissionStatus | null = null;

    async function checkPermission() {
      try {
        if (!("permissions" in navigator)) {
          setDiag((d) => ({ ...d, permission: "no-soportado" }));
          return;
        }
        status = await navigator.permissions.query({
          name: "geolocation" as PermissionName,
        });
        setDiag((d) => ({ ...d, permission: status!.state as DiagPermission }));
        status.onchange = () => {
          setDiag((d) => ({ ...d, permission: status!.state as DiagPermission }));
        };
      } catch {
        setDiag((d) => ({ ...d, permission: "no-soportado" }));
      }
    }

    void checkPermission();

    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  // Tab hidden / restored-from-bfcache counters — distinguishes "the page
  // was merely backgrounded" from a full silent reload (tracked separately
  // above via mountCount), which would otherwise look identical from the
  // driver's side: shift opens and closes fine either way.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        setDiag((d) => ({ ...d, hiddenCount: d.hiddenCount + 1 }));
      }
    }
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setDiag((d) => ({ ...d, bfcacheRestoreCount: d.bfcacheRestoreCount + 1 }));
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const flushBuffer = useCallback(
    async (currentShiftId: string) => {
      const rows = bufferRef.current;
      if (rows.length === 0) return;
      bufferRef.current = [];
      setDiag((d) => ({ ...d, flushAttempts: d.flushAttempts + 1, bufferedCount: 0 }));
      const { error } = await supabase.from("pings").insert(
        rows.map((r) => ({
          association_id: associationId,
          shift_id: currentShiftId,
          captured_at: r.captured_at,
          lat: r.lat,
          lon: r.lon,
          speed_kmh: r.speed_kmh,
          is_simulated: false,
        }))
      );
      if (error) {
        setDiag((d) => ({
          ...d,
          flushFailures: d.flushFailures + 1,
          lastFlushError: error.message,
        }));
      } else {
        setDiag((d) => ({ ...d, flushSuccesses: d.flushSuccesses + 1 }));
      }
    },
    [associationId, supabase]
  );

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (flushIntervalRef.current !== null) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
  }, []);

  const startWatching = useCallback(
    (currentShiftId: string) => {
      if (!("geolocation" in navigator)) {
        setLocationStatus("unsupported");
        return;
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          setLocationStatus("watching");
          const rawSpeed = position.coords.speed;
          const speedKmh =
            typeof rawSpeed === "number" && rawSpeed >= 0
              ? Math.min(200, rawSpeed * 3.6)
              : null;
          bufferRef.current.push({
            captured_at: new Date(position.timestamp).toISOString(),
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            speed_kmh: speedKmh,
          });
          setDiag((d) => ({
            ...d,
            capturedCount: d.capturedCount + 1,
            lastCapturedAt: new Date(position.timestamp).toISOString(),
            bufferedCount: bufferRef.current.length,
          }));
        },
        (error) => {
          setLocationStatus(
            error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"
          );
          setDiag((d) => ({
            ...d,
            geoErrorCount: d.geoErrorCount + 1,
            lastGeoError: `code=${error.code} ${error.message}`,
          }));
        },
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 }
      );

      flushIntervalRef.current = setInterval(() => {
        void flushBuffer(currentShiftId);
      }, PING_FLUSH_MS);
    },
    [flushBuffer]
  );

  // Resume the location watch if a shift was already open when this page loaded.
  useEffect(() => {
    if (shiftId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startWatching(shiftId);
    }
    return () => {
      stopWatching();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  function handleSelectUnit(id: string) {
    try {
      window.localStorage.setItem(UNIT_STORAGE_KEY, id);
    } catch {
      // Non-fatal: the picker just reappears next time.
    }
    setUnitId(id);
  }

  function handleChangeUnit() {
    stopWatching();
    try {
      window.localStorage.removeItem(UNIT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setUnitId(null);
    setShiftId(null);
    setDiag(EMPTY_DIAG);
    setLocationStatus("idle");
  }

  async function handleStart() {
    if (!unitId) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("shifts")
      .insert({
        association_id: associationId,
        unit_id: unitId,
        is_simulated: false,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) return;
    setShiftId(data.id);
    startWatching(data.id);
  }

  async function handleEnd() {
    if (!shiftId) return;
    setBusy(true);
    stopWatching();
    await flushBuffer(shiftId);
    await supabase
      .from("shifts")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", shiftId);
    setBusy(false);
    setShiftId(null);
    setLocationStatus("idle");
  }

  if (!hydrated || checkingShift) {
    return <CenterScreen />;
  }

  if (!unitId) {
    return (
      <CenterScreen>
        <p className="text-sm font-medium tracking-wide text-accent">
          CONFIGURACIÓN DEL TELÉFONO
        </p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          ¿Qué unidad es este teléfono?
        </h1>
        <p className="mt-2 text-sm leading-6 text-foreground/70">
          Elígela una sola vez. Este teléfono no volverá a preguntar.
        </p>
        {units.length === 0 ? (
          <p className="mt-6 text-sm text-foreground/70">
            Tu asociación todavía no tiene unidades registradas.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {units.map((u) => (
              <button
                key={u.id}
                onClick={() => handleSelectUnit(u.id)}
                className="border border-foreground/15 bg-white px-5 py-4 text-lg font-semibold text-foreground transition-colors hover:border-foreground/30"
              >
                {u.economic_number}
              </button>
            ))}
          </div>
        )}
      </CenterScreen>
    );
  }

  const isActive = Boolean(shiftId);
  const unitLabel = units.find((u) => u.id === unitId)?.economic_number ?? "";

  return (
    <CenterScreen>
      <p className="text-sm font-medium tracking-wide text-accent">
        DERROTERO
      </p>
      {isActive && (
        <p className="mt-2 text-xs font-semibold tracking-wide text-data">
          CAPTURA EN VIVO — PRUEBA
        </p>
      )}

      <button
        onClick={isActive ? handleEnd : handleStart}
        disabled={busy}
        className={`mt-6 w-full px-8 py-14 text-3xl font-bold disabled:opacity-60 ${
          isActive
            ? "bg-foreground text-background"
            : "bg-accent text-white"
        }`}
      >
        {isActive ? "Terminar turno" : "Iniciar turno"}
      </button>

      {isActive && locationStatus === "denied" && (
        <p className="mt-4 text-sm leading-6 text-foreground/70">
          No se pudo activar la ubicación. Actívala en los ajustes del
          teléfono para que este turno registre el recorrido — puedes
          continuar y terminar el turno normalmente mientras tanto.
        </p>
      )}
      {isActive && locationStatus === "unavailable" && (
        <p className="mt-4 text-sm leading-6 text-foreground/70">
          No se pudo obtener la ubicación por ahora. El turno sigue
          corriendo; vuelve a intentarlo donde haya mejor señal.
        </p>
      )}
      {isActive && locationStatus === "unsupported" && (
        <p className="mt-4 text-sm leading-6 text-foreground/70">
          Este navegador no permite compartir ubicación. El turno sigue
          corriendo, pero no se registrará el recorrido.
        </p>
      )}

      <p className="mt-10 text-xs leading-5 text-foreground/50">
        Tu identidad nunca se registra. Solo se guarda la posición de la
        unidad {unitLabel}, nunca de una persona.
      </p>

      <button
        onClick={handleChangeUnit}
        className="mt-6 text-xs text-foreground/40 underline underline-offset-4"
      >
        Cambiar unidad de este teléfono
      </button>

      {diag.mountCount > 0 && <DiagnosticPanel diag={diag} />}
    </CenterScreen>
  );
}

function DiagnosticPanel({ diag }: { diag: DiagState }) {
  return (
    <div className="mt-8 border border-foreground/15 bg-foreground/5 p-4 text-left font-mono text-[11px] leading-5 text-foreground/70">
      <p className="mb-2 font-sans text-xs font-semibold text-foreground">
        DIAGNÓSTICO TEMPORAL — bug de pings en iOS
      </p>
      <p>Permiso de ubicación: {diag.permission}</p>
      <p>
        Posiciones capturadas: {diag.capturedCount} (última:{" "}
        {diag.lastCapturedAt ?? "ninguna"})
      </p>
      <p>
        Errores de ubicación: {diag.geoErrorCount}
        {diag.lastGeoError ? ` (último: ${diag.lastGeoError})` : ""}
      </p>
      <p>En espera de enviarse ahora mismo: {diag.bufferedCount}</p>
      <p>
        Envíos a la base: {diag.flushAttempts} intentos, {diag.flushSuccesses}{" "}
        ok, {diag.flushFailures} fallidos
        {diag.lastFlushError ? ` (último error: ${diag.lastFlushError})` : ""}
      </p>
      <p>
        Recargas silenciosas de esta pantalla durante el turno:{" "}
        {Math.max(0, diag.mountCount - 1)}
      </p>
      <p>Veces que la pestaña se ocultó: {diag.hiddenCount}</p>
      <p>Restauraciones desde caché (sin recargar): {diag.bfcacheRestoreCount}</p>
    </div>
  );
}

function CenterScreen({ children }: { children?: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

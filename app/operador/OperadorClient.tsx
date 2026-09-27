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

  const flushBuffer = useCallback(
    async (currentShiftId: string) => {
      const rows = bufferRef.current;
      if (rows.length === 0) return;
      bufferRef.current = [];
      await supabase.from("pings").insert(
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
        },
        (error) => {
          setLocationStatus(
            error.code === error.PERMISSION_DENIED ? "denied" : "unavailable"
          );
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
    </CenterScreen>
  );
}

function CenterScreen({ children }: { children?: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

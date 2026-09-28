import { createClient } from "@/lib/supabase/server";
import { CORRIDOR_STOPS } from "@/lib/corridor";
import {
  averageDwellExcludingBase,
  averageOccupancy,
  computeHeadwayBuckets,
  dominantConfidence,
  maxHeadwayInWindow,
  type Confidence,
  type InferredStopRow,
  type RunMetricRow,
} from "@/lib/dashboardStats";
import { DashboardMap, type MapStop } from "@/app/DashboardMap";
import {
  HallazgoCard,
  HeadwayChart,
  OperadorPreview,
  StatRow,
} from "@/app/dashboardComponents";

type DossierStop = {
  lat: number;
  lon: number;
  etiqueta: string | null;
  ascensos_est: number | null;
  detencion_media_s: number | null;
  corridas_observadas: number;
  confianza: Confidence;
  en_padron_oficial: boolean;
};

type DossierRun = {
  salida: string;
  intervalo_min: number | null;
  ocupacion_al_salir: number | null;
  confianza: Confidence;
};

type Dossier = {
  asociacion: string;
  paradas: DossierStop[];
  corridas: DossierRun[];
};

/**
 * Público, sin sesión, de solo lectura — a propósito.
 *
 * No es una puerta especial alrededor de la cláusula sombra: consume la
 * MISMA función `dossier_by_token` (security definer) que usa cualquier
 * enlace de /expediente/[token]. El token que lee viene de una fila real
 * y permanente en share_grants (destinatario: "Vista de demostración
 * académica"), creada a mano para esta evaluación — visible en la propia
 * bitácora de la asociación, fechada, y revocable exactamente igual que
 * cualquier otra concesión. Si algún día se revoca, esta página muestra
 * el mismo "no disponible" que cualquier enlace expirado, sin código
 * especial que lo prevenga. La demo no rodea el modelo de acceso: lo
 * ejercita.
 */
export default async function DemoPage() {
  const token = process.env.DEMO_DOSSIER_TOKEN;

  const supabase = await createClient();
  const { data } = token
    ? await supabase.rpc("dossier_by_token", { p_token: token })
    : { data: null };
  const dossier = (data ?? null) as Dossier | null;

  if (!dossier) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <p className="text-sm font-medium tracking-wide text-accent">
            DERROTERO
          </p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            Vista de demostración no disponible
          </h1>
          <p className="mt-3 text-sm leading-6 text-foreground/70">
            El enlace de demostración académica no está configurado o fue
            revocado.
          </p>
        </div>
      </main>
    );
  }

  const stops: InferredStopRow[] = dossier.paradas.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    label: p.etiqueta,
    dwell_seconds_avg: p.detencion_media_s ?? 0,
    boardings_est: p.ascensos_est ?? 0,
    runs_observed: p.corridas_observadas,
    confidence: p.confianza,
    in_official_padron: p.en_padron_oficial,
  }));

  const runs: RunMetricRow[] = dossier.corridas.map((c) => ({
    departed_at: c.salida,
    headway_minutes: c.intervalo_min,
    occupancy_at_departure: c.ocupacion_al_salir ?? 0,
    confidence: c.confianza,
  }));

  const hasData = stops.length > 0 && runs.length > 0;

  const headwayBuckets = computeHeadwayBuckets(runs);
  const hallazgoHeadway = maxHeadwayInWindow(runs);
  const occupancyPct = Math.round(averageOccupancy(runs) * 100);
  const dwellAvg = Math.round(averageDwellExcludingBase(stops));
  const overallConfidence = dominantConfidence(runs);

  const routeCoordinates: [number, number][] = CORRIDOR_STOPS.map((s) => [
    s.lon,
    s.lat,
  ]);
  const mapStops: MapStop[] = stops.map((s) => ({
    lat: s.lat,
    lon: s.lon,
    label: s.label,
    boardingsEst: s.boardings_est,
    inOfficialPadron: s.in_official_padron,
    runsObserved: s.runs_observed,
    confidence: s.confidence,
    dwellSecondsAvg: s.dwell_seconds_avg,
  }));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <p className="text-sm font-medium tracking-wide text-accent">
          DERROTERO
        </p>
        <h1 className="text-lg font-semibold text-foreground">
          {dossier.asociacion}
        </h1>
      </header>

      <section className="border border-accent/40 bg-accent/5 p-4">
        <p className="text-sm font-semibold text-foreground">
          VISTA DE DEMOSTRACIÓN ACADÉMICA — solo lectura
        </p>
        <p className="mt-1 text-xs leading-5 text-foreground/70">
          El acceso real de la dirigencia requiere membresía verificada por
          diseño — esa restricción es el punto del producto, no un límite de
          esta demo. Esta página existe únicamente para la evaluación de
          este proyecto y no permite conceder ni revocar acceso.
        </p>
      </section>

      {!hasData ? (
        <p className="mt-8 text-sm leading-6 text-foreground/70">
          La vista de demostración no tiene datos todavía.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-6">
            <section className="border border-foreground/10 bg-white">
              <div className="flex items-start justify-between gap-3 border-b border-foreground/10 p-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    Paradas inferidas del recorrido
                  </h2>
                  <p className="mt-1 text-xs text-foreground/60">
                    Agrupamiento de detenciones (DBSCAN) · {stops.length}{" "}
                    paradas · {runs.length} corridas
                  </p>
                </div>
                <span className="whitespace-nowrap border border-accent px-2 py-1 text-[11px] font-semibold tracking-wide text-accent">
                  DATOS SIMULADOS
                </span>
              </div>
              <div className="h-[360px] w-full">
                <DashboardMap
                  routeCoordinates={routeCoordinates}
                  stops={mapStops}
                />
              </div>
              <p className="border-t border-foreground/10 p-3 text-[11px] text-foreground/50">
                Tamaño del círculo = ascensos estimados por turno. Círculo
                claro = parada real no registrada en el padrón oficial.
              </p>
            </section>

            <StatRow
              runsRecorded={runs.length}
              stopsInferred={stops.length}
              dwellAvgSeconds={dwellAvg}
            />
          </div>

          <div className="flex flex-col gap-6">
            <HeadwayChart buckets={headwayBuckets} />
            <HallazgoCard
              occupancyPct={occupancyPct}
              headway={hallazgoHeadway}
              runCount={runs.length}
              confidence={overallConfidence}
            />
            <OperadorPreview />
          </div>
        </div>
      )}
    </main>
  );
}

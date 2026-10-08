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
import { formatMexicoDateTime } from "@/lib/mexicoTime";

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

type DemoResult =
  | { estado: "sin_configurar" }
  | { estado: "revocada"; revocada_el: string }
  | { estado: "ok"; expediente: Dossier | null };

/**
 * Público, sin sesión, de solo lectura — a propósito.
 *
 * No es una puerta especial alrededor de la cláusula sombra: lee la única
 * fila de share_grants marcada con is_demo (destinatario: "Vista de
 * demostración académica"), una concesión real — visible en la propia
 * bitácora de la asociación, fechada, y revocable exactamente igual que
 * cualquier otra. `demo_dossier()` delega en la MISMA `dossier_by_token`
 * que usa /expediente/[token] para armar el expediente. La demo no rodea
 * el modelo de acceso: lo ejercita.
 *
 * A diferencia de /expediente/[token], aquí SÍ se distingue por qué no hay
 * expediente: no hay token que sondear, solo el estado de una concesión
 * fija. Un mensaje único para los tres casos ya produjo un diagnóstico
 * equivocado (ver DECISIONS.md, Session 15).
 */
export default async function DemoPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("demo_dossier");

  if (error) {
    return (
      <Unavailable
        title="No se pudo consultar la base de datos"
        detail={`La consulta a Supabase falló: ${error.message}`}
      />
    );
  }

  const result = data as DemoResult | null;

  if (!result || result.estado === "sin_configurar") {
    return (
      <Unavailable
        title="Vista de demostración sin configurar"
        detail="Ninguna concesión está marcada como demostración (share_grants.is_demo)."
      />
    );
  }

  if (result.estado === "revocada") {
    return (
      <Unavailable
        title="Vista de demostración revocada"
        detail={`La concesión de demostración fue revocada el ${formatMexicoDateTime(result.revocada_el)}.`}
      />
    );
  }

  const dossier = result.expediente;
  if (!dossier) {
    // demo_dossier solo responde "ok" para una concesión vigente, así que
    // dossier_by_token no debería devolver null aquí.
    return (
      <Unavailable
        title="Vista de demostración no disponible"
        detail="La concesión de demostración está vigente, pero no devolvió expediente."
      />
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

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-medium tracking-wide text-accent">
          DERROTERO
        </p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-foreground/70">{detail}</p>
      </div>
    </main>
  );
}

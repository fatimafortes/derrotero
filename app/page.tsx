import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/supabase/actions";
import { CORRIDOR_STOPS } from "@/lib/corridor";
import {
  averageDwellExcludingBase,
  averageOccupancy,
  computeHeadwayBuckets,
  dominantConfidence,
  maxHeadwayInWindow,
  type InferredStopRow,
  type RunMetricRow,
} from "@/lib/dashboardStats";
import { DashboardMap, type MapStop } from "@/app/DashboardMap";
import { ShareControl, type Grant } from "@/app/ShareControl";
import { PrintButton } from "@/app/PrintButton";

type MembershipRow = {
  role: string;
  association_id: string;
  associations: { name: string } | { name: string }[] | null;
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, association_id, associations(name)")
    .limit(1)
    .returns<MembershipRow[]>();

  const membership = memberships?.[0];

  if (!membership) {
    return (
      <Screen>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          Todavía no perteneces a una asociación
        </h1>
        <p className="mt-3 text-sm leading-6 text-foreground/70">
          Tu cuenta inició sesión correctamente, pero ninguna asociación te ha
          añadido todavía. Esto es normal: nadie ve datos que no le
          corresponden. Pide a quien administra tu asociación que te dé de
          alta.
        </p>
        <SignOutLink />
      </Screen>
    );
  }

  // The dashboard is the dirigencia's screen. An operador has exactly one
  // control and it isn't this page.
  if (membership.role !== "dirigencia") {
    redirect("/operador");
  }

  const associationId = membership.association_id;
  const associationName = Array.isArray(membership.associations)
    ? membership.associations[0]?.name
    : membership.associations?.name;

  const requestHeaders = await headers();
  const origin = `https://${requestHeaders.get("host")}`;

  const [{ data: grantsData }, { data: stopsData }, { data: runsData }] =
    await Promise.all([
      supabase
        .from("share_grants")
        .select("id, recipient_label, granted_at, revoked_at, granted_by, token")
        .eq("association_id", associationId)
        .order("granted_at", { ascending: false }),
      supabase
        .from("inferred_stops")
        .select(
          "lat, lon, label, dwell_seconds_avg, boardings_est, runs_observed, confidence, in_official_padron"
        )
        .eq("association_id", associationId)
        .eq("is_simulated", true),
      supabase
        .from("run_metrics")
        .select("departed_at, headway_minutes, occupancy_at_departure, confidence")
        .eq("association_id", associationId)
        .eq("is_simulated", true)
        .order("departed_at", { ascending: true }),
    ]);

  const stops = (stopsData ?? []) as InferredStopRow[];
  const runs = (runsData ?? []) as RunMetricRow[];
  const grants = (grantsData ?? []) as Grant[];

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
    <>
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 print:hidden">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium tracking-wide text-accent">
            DERROTERO
          </p>
          <h1 className="text-lg font-semibold text-foreground">
            {associationName}
          </h1>
        </div>
        <form action={signOut}>
          <button className="text-sm font-medium text-data underline underline-offset-4">
            Cerrar sesión
          </button>
        </form>
      </header>

      <ShareControl grants={grants} currentUserId={user.id} origin={origin} />

      {!hasData ? (
        <p className="mt-8 text-sm leading-6 text-foreground/70">
          Todavía no hay datos sembrados ni inferencia calculada para esta
          asociación. Ve a <code>/admin/sembrar</code> y corre ambos pasos.
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
                <DashboardMap routeCoordinates={routeCoordinates} stops={mapStops} />
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
            <ExpedienteCard
              runsRecorded={runs.length}
              stopsInferred={stops.length}
            />
            <OperadorPreview />
          </div>
        </div>
      )}
    </main>
    {hasData && (
      <PrintableDossier
        associationName={associationName}
        stops={stops}
        runs={runs}
      />
    )}
    </>
  );
}

function StatRow({
  runsRecorded,
  stopsInferred,
  dwellAvgSeconds,
}: {
  runsRecorded: number;
  stopsInferred: number;
  dwellAvgSeconds: number;
}) {
  const stats: { value: string; label: string }[] = [
    { value: String(runsRecorded), label: "corridas registradas" },
    { value: String(stopsInferred), label: "paradas inferidas" },
    { value: `${dwellAvgSeconds} s`, label: "detención media" },
    { value: "0", label: "campos con identidad" },
  ];
  return (
    <section className="grid grid-cols-2 gap-4 border border-foreground/10 bg-white p-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label}>
          <p className="text-3xl font-semibold text-foreground">{s.value}</p>
          <p className="text-xs text-foreground/60">{s.label}</p>
        </div>
      ))}
      <p className="col-span-2 text-[11px] text-foreground/50 sm:col-span-4">
        Todos los datos mostrados son simulados y están etiquetados como
        tales.
      </p>
    </section>
  );
}

function HeadwayChart({
  buckets,
}: {
  buckets: { label: string; averageMinutes: number | null; sampleCount: number }[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.averageMinutes ?? 0));
  return (
    <section className="border border-foreground/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-foreground">
        Intervalo real entre unidades
      </h2>
      <p className="mt-1 text-xs text-foreground/60">
        Base San Bartolo · 05:00–08:00 · minutos
      </p>
      <div className="mt-4 flex items-end gap-2">
        {buckets.map((b) => {
          const isMax = b.averageMinutes !== null && b.averageMinutes === max;
          return (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              {b.averageMinutes !== null && (
                <span className="text-[11px] font-semibold text-foreground/70">
                  {Math.round(b.averageMinutes)}
                </span>
              )}
              {/* Fixed-height track: a percentage height on the bar below
                  only resolves against a parent with a DEFINITE height —
                  the outer row is sized by content, not fixed, so the bar
                  needs its own explicit-height container to size against. */}
              <div className="flex h-24 w-full items-end">
                <div
                  className={`w-full ${isMax ? "bg-accent" : "bg-data"}`}
                  style={{
                    height:
                      b.averageMinutes !== null
                        ? `${Math.max(6, (b.averageMinutes / max) * 100)}%`
                        : "2px",
                    opacity: b.averageMinutes !== null ? 1 : 0.25,
                  }}
                />
              </div>
              <span className="text-[10px] text-foreground/50">{b.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HallazgoCard({
  occupancyPct,
  headway,
  runCount,
  confidence,
}: {
  occupancyPct: number;
  headway: { minutes: number; label: string } | null;
  runCount: number;
  confidence: string;
}) {
  return (
    <section className="border border-data/40 bg-data/5 p-4">
      <p className="text-xs font-semibold tracking-wide text-data">
        HALLAZGO DEL TURNO
      </p>
      <h2 className="mt-1 text-base font-semibold text-foreground">
        La salida no es por reloj. Es por llenado.
      </h2>
      <p className="mt-2 text-sm leading-6 text-foreground/70">
        Las unidades salen de base con un {occupancyPct}% de ocupación
        simulada en promedio, no a una hora fija.
        {headway &&
          ` El intervalo de ${Math.round(headway.minutes)} min a las ${headway.label} es consecuencia de eso, no de una demora.`}
      </p>
      <p className="mt-3 text-[11px] text-foreground/50">
        Confianza {confidence} · {runCount} corridas · sin verificar en campo
      </p>
    </section>
  );
}

function ExpedienteCard({
  runsRecorded,
  stopsInferred,
}: {
  runsRecorded: number;
  stopsInferred: number;
}) {
  const today = new Date().toLocaleDateString("es-MX");
  return (
    <section className="border border-foreground/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-foreground">
        Expediente de demanda
      </h2>
      <p className="mt-1 text-xs text-foreground/60">
        Corte al {today} · {runsRecorded} corridas · {stopsInferred} paradas
      </p>
      <p className="mt-1 text-xs text-foreground/60">
        Sin identidad de operador en ningún campo.
      </p>
      <div className="mt-3">
        <PrintButton label="Descargar expediente" />
      </div>
    </section>
  );
}

function PrintableDossier({
  associationName,
  stops,
  runs,
}: {
  associationName?: string;
  stops: InferredStopRow[];
  runs: RunMetricRow[];
}) {
  const today = new Date().toLocaleDateString("es-MX");
  return (
    <main className="hidden px-8 py-8 print:block">
      <p className="text-sm font-medium tracking-wide text-accent">
        DERROTERO
      </p>
      <h1 className="mt-1 text-lg font-semibold text-foreground">
        {associationName}
      </h1>
      <p className="mt-1 text-sm text-foreground/70">
        Expediente de demanda · corte al {today} · {runs.length} corridas ·{" "}
        {stops.length} paradas
      </p>
      <p className="mt-1 text-xs font-semibold text-accent">
        DATOS SIMULADOS — sin identidad de operador en ningún campo
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">
          Paradas inferidas
        </h2>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-foreground/10 text-foreground/60">
              <th className="py-1 pr-2">Parada</th>
              <th className="py-1 pr-2">Ascensos est.</th>
              <th className="py-1 pr-2">Detención media</th>
              <th className="py-1 pr-2">Corridas</th>
              <th className="py-1 pr-2">Confianza</th>
              <th className="py-1 pr-2">Padrón</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((s, i) => (
              <tr key={i} className="border-b border-foreground/5">
                <td className="py-1 pr-2">{s.label ?? "—"}</td>
                <td className="py-1 pr-2">{s.boardings_est ?? "—"}</td>
                <td className="py-1 pr-2">{s.dwell_seconds_avg}s</td>
                <td className="py-1 pr-2">{s.runs_observed}</td>
                <td className="py-1 pr-2">{s.confidence}</td>
                <td className="py-1 pr-2">
                  {s.in_official_padron ? "sí" : "no registrada"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">Corridas</h2>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-foreground/10 text-foreground/60">
              <th className="py-1 pr-2">Salida</th>
              <th className="py-1 pr-2">Intervalo</th>
              <th className="py-1 pr-2">Ocupación al salir</th>
              <th className="py-1 pr-2">Confianza</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={i} className="border-b border-foreground/5">
                <td className="py-1 pr-2">
                  {new Date(r.departed_at).toLocaleString("es-MX")}
                </td>
                <td className="py-1 pr-2">
                  {r.headway_minutes !== null
                    ? `${Math.round(r.headway_minutes)} min`
                    : "—"}
                </td>
                <td className="py-1 pr-2">
                  {Math.round(r.occupancy_at_departure * 100)}%
                </td>
                <td className="py-1 pr-2">{r.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function OperadorPreview() {
  return (
    <section className="border border-foreground/10 bg-white p-4">
      <h2 className="text-sm font-semibold text-foreground">
        Pantalla del operador (vista completa)
      </h2>
      <div className="mt-3 flex items-center gap-4">
        <div className="flex-1 border border-foreground/15 bg-foreground/5 px-4 py-6 text-center text-sm font-bold text-foreground/40">
          Iniciar / Terminar turno
        </div>
        <p className="flex-1 text-xs leading-5 text-foreground/60">
          Un solo control. El operador aporta posición y puede apagarlo
          cuando quiera. Sin nombre, sin calificación.
        </p>
      </div>
    </section>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-medium tracking-wide text-accent">
          DERROTERO
        </p>
        {children}
      </div>
    </main>
  );
}

function SignOutLink() {
  return (
    <form action={signOut} className="mt-8">
      <button className="text-sm font-medium text-data underline underline-offset-4">
        Cerrar sesión
      </button>
    </form>
  );
}

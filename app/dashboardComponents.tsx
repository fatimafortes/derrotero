export function StatRow({
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

export function HeadwayChart({
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

export function HallazgoCard({
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

export function OperadorPreview() {
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

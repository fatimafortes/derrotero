import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/PrintButton";
import { formatMexicoDate, formatMexicoDateTime } from "@/lib/mexicoTime";

type DossierStop = {
  lat: number;
  lon: number;
  etiqueta: string | null;
  ascensos_est: number | null;
  detencion_media_s: number | null;
  corridas_observadas: number;
  confianza: "baja" | "media" | "alta";
  en_padron_oficial: boolean;
  simulado: boolean;
};

type DossierRun = {
  salida: string;
  intervalo_min: number | null;
  ocupacion_al_salir: number | null;
  confianza: "baja" | "media" | "alta";
  simulado: boolean;
};

type Dossier = {
  asociacion: string;
  destinatario: string;
  compartido_el: string;
  corte_al: string;
  paradas: DossierStop[];
  corridas: DossierRun[];
};

export default async function ExpedientePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  // dossier_by_token returns null for a revoked grant, an unknown token, or
  // a malformed one — all the same way, on purpose. This page must not add
  // any branch that would make those three cases look different from here.
  const { data } = await supabase.rpc("dossier_by_token", { p_token: token });
  const dossier = (data ?? null) as Dossier | null;

  if (!dossier) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <p className="text-sm font-medium tracking-wide text-accent">
            DERROTERO
          </p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            Este expediente no está disponible
          </h1>
          <p className="mt-3 text-sm leading-6 text-foreground/70">
            El enlace no corresponde a una concesión vigente.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium tracking-wide text-accent">
            DERROTERO
          </p>
          <h1 className="mt-1 text-lg font-semibold text-foreground">
            {dossier.asociacion}
          </h1>
          <p className="mt-1 text-sm text-foreground/70">
            Compartido con {dossier.destinatario} el{" "}
            {formatMexicoDate(dossier.compartido_el)} · corte al{" "}
            {formatMexicoDateTime(dossier.corte_al)}
          </p>
        </div>
        <PrintButton />
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">
          Paradas inferidas
        </h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
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
              {dossier.paradas.map((p, i) => (
                <tr key={i} className="border-b border-foreground/5">
                  <td className="py-1 pr-2">
                    {p.etiqueta ?? "—"}
                    {p.simulado && (
                      <span className="ml-1 text-[10px] font-semibold text-accent">
                        SIMULADO
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">{p.ascensos_est ?? "—"}</td>
                  <td className="py-1 pr-2">
                    {p.detencion_media_s ?? "—"} s
                  </td>
                  <td className="py-1 pr-2">{p.corridas_observadas}</td>
                  <td className="py-1 pr-2">{p.confianza}</td>
                  <td className="py-1 pr-2">
                    {p.en_padron_oficial ? "sí" : "no registrada"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">Corridas</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-foreground/10 text-foreground/60">
                <th className="py-1 pr-2">Salida</th>
                <th className="py-1 pr-2">Intervalo</th>
                <th className="py-1 pr-2">Ocupación al salir</th>
                <th className="py-1 pr-2">Confianza</th>
              </tr>
            </thead>
            <tbody>
              {dossier.corridas.map((c, i) => (
                <tr key={i} className="border-b border-foreground/5">
                  <td className="py-1 pr-2">
                    {formatMexicoDateTime(c.salida)}
                    {c.simulado && (
                      <span className="ml-1 text-[10px] font-semibold text-accent">
                        SIMULADO
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    {c.intervalo_min !== null
                      ? `${Math.round(c.intervalo_min)} min`
                      : "—"}
                  </td>
                  <td className="py-1 pr-2">
                    {c.ocupacion_al_salir !== null
                      ? `${Math.round(c.ocupacion_al_salir * 100)}%`
                      : "—"}
                  </td>
                  <td className="py-1 pr-2">{c.confianza}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-6 text-[11px] text-foreground/50">
        Ningún campo de este expediente identifica a una persona. Los datos
        marcados SIMULADO provienen de un generador de prueba, no de
        operación real.
      </p>
    </main>
  );
}

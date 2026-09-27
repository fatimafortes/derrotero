import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeedButton } from "./SeedButton";

export default async function SembrarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role")
    .limit(1);

  const membership = memberships?.[0];

  if (!membership || membership.role !== "dirigencia") {
    redirect("/");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="text-sm font-medium tracking-wide text-accent">
          DERROTERO — HERRAMIENTA INTERNA
        </p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          Sembrar corrida simulada
        </h1>
        <p className="mt-3 text-sm leading-6 text-foreground/70">
          Genera 3 unidades × 14 corridas sobre San Bartolo – Toreo, con
          salidas disparadas por llenado (60–85% de ocupación simulada) entre
          las 05:00 y las 08:00. No toca PRUEBA-01 ni ninguna captura real.
        </p>
        <SeedButton />
      </div>
    </main>
  );
}

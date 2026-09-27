import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/supabase/actions";

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

  const associationName = Array.isArray(membership.associations)
    ? membership.associations[0]?.name
    : membership.associations?.name;

  return (
    <Screen>
      <h1 className="mt-2 text-xl font-semibold text-foreground">
        {associationName}
      </h1>
      <p className="mt-3 text-sm leading-6 text-foreground/70">
        Sesión iniciada como{" "}
        {membership.role === "dirigencia" ? "dirigencia" : "operador"}.
      </p>
      <SignOutLink />
    </Screen>
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

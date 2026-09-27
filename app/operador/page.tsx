import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OperadorClient } from "./OperadorClient";

export default async function OperadorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("memberships")
    .select("association_id")
    .limit(1);

  const membership = memberships?.[0];

  if (!membership) {
    redirect("/");
  }

  const { data: units } = await supabase
    .from("units")
    .select("id, economic_number")
    .eq("association_id", membership.association_id)
    .order("economic_number");

  return (
    <OperadorClient
      associationId={membership.association_id}
      units={units ?? []}
    />
  );
}

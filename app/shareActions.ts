"use server";

import { createClient } from "@/lib/supabase/server";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateGrantResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

async function requireDirigencia(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Sin sesión." };

  const { data: memberships } = await supabase
    .from("memberships")
    .select("association_id, role")
    .limit(1);
  const membership = memberships?.[0];
  if (!membership) {
    return { ok: false as const, error: "No perteneces a ninguna asociación." };
  }
  if (membership.role !== "dirigencia") {
    return { ok: false as const, error: "Solo la dirigencia puede hacer esto." };
  }
  return {
    ok: true as const,
    associationId: membership.association_id as string,
    userId: user.id,
  };
}

export async function createShareGrant(
  formData: FormData
): Promise<CreateGrantResult> {
  const recipientLabel = String(formData.get("recipient_label") ?? "").trim();

  // Security Floor #4: validate length/type before it reaches the database.
  if (recipientLabel.length < 2 || recipientLabel.length > 120) {
    return {
      ok: false,
      error: "El destinatario debe tener entre 2 y 120 caracteres.",
    };
  }

  const supabase = await createClient();
  const auth = await requireDirigencia(supabase);
  if (!auth.ok) return auth;

  const { data, error } = await supabase
    .from("share_grants")
    .insert({
      association_id: auth.associationId,
      recipient_label: recipientLabel,
      granted_by: auth.userId,
    })
    .select("token")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "No se pudo conceder el acceso." };
  }

  return { ok: true, token: data.token as string };
}

export async function revokeShareGrant(grantId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await requireDirigencia(supabase);
  if (!auth.ok) return auth;

  const { data, error } = await supabase
    .from("share_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "No se pudo revocar. Solo quien concedió este acceso puede revocarlo, o ya estaba revocado.",
    };
  }

  return { ok: true };
}

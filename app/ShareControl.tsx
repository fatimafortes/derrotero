"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShareGrant, revokeShareGrant } from "@/app/shareActions";
import { formatMexicoDateTime } from "@/lib/mexicoTime";

export type Grant = {
  id: string;
  recipient_label: string;
  granted_at: string;
  revoked_at: string | null;
  granted_by: string;
  token: string;
};

export function ShareControl({
  grants,
  currentUserId,
  origin,
}: {
  grants: Grant[];
  currentUserId: string;
  origin: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);

  const activeGrants = grants.filter((g) => !g.revoked_at);
  const isSharing = activeGrants.length > 0;

  function handleCreate(formData: FormData) {
    setFormError(null);
    startTransition(async () => {
      const res = await createShareGrant(formData);
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      setJustCreatedToken(res.token);
      setFormOpen(false);
      router.refresh();
    });
  }

  function handleRevoke(grantId: string) {
    setActionError(null);
    startTransition(async () => {
      const res = await revokeShareGrant(grantId);
      if (!res.ok) {
        setActionError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="border border-accent/40 bg-accent/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Esta medición es de la asociación. Nadie fuera de ella puede
            verla.
          </p>
          <p className="mt-1 text-xs leading-5 text-foreground/70">
            Compartir con una autoridad es una decisión de la dirigencia,
            reversible, y queda registrada con fecha y destinatario.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium tracking-wide text-foreground/60">
            COMPARTIR CON TERCEROS
          </p>
          <p
            className={`text-sm font-bold ${isSharing ? "text-data" : "text-accent"}`}
          >
            {isSharing
              ? `ACTIVO — ${activeGrants.map((g) => g.recipient_label).join(", ")}`
              : "DESACTIVADO"}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-foreground/10 pt-4">
        {!formOpen ? (
          <button
            onClick={() => setFormOpen(true)}
            className="text-xs font-semibold text-data underline underline-offset-4"
          >
            + Compartir con una autoridad
          </button>
        ) : (
          <form action={handleCreate} className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-foreground/60">
                Destinatario (ej. &quot;SITRAMyTEM — mesa de
                reordenamiento&quot;)
              </label>
              <input
                name="recipient_label"
                required
                minLength={2}
                maxLength={120}
                className="mt-1 w-full border border-foreground/20 bg-white px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Conceder
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="text-xs text-foreground/50 underline underline-offset-4"
            >
              Cancelar
            </button>
          </form>
        )}
        {formError && <p className="mt-2 text-xs text-accent">{formError}</p>}
        {actionError && <p className="mt-2 text-xs text-accent">{actionError}</p>}
        {justCreatedToken && (
          <p className="mt-2 break-all text-xs text-data">
            Enlace listo: {origin}/expediente/{justCreatedToken}
          </p>
        )}
      </div>

      {grants.length > 0 && (
        <div className="mt-4 border-t border-foreground/10 pt-4">
          <p className="text-[11px] font-semibold tracking-wide text-foreground/60">
            BITÁCORA DE CONCESIONES
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {grants.map((g) => {
              const isActive = !g.revoked_at;
              return (
                <li key={g.id} className="text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-foreground/80">
                      {g.recipient_label} ·{" "}
                      {g.granted_by === currentUserId
                        ? "tú"
                        : "otro integrante de la dirigencia"}{" "}
                      · {formatMexicoDateTime(g.granted_at)}
                      {!isActive &&
                        g.revoked_at &&
                        ` · revocado ${formatMexicoDateTime(g.revoked_at)}`}
                    </span>
                    {isActive && (
                      <button
                        onClick={() => handleRevoke(g.id)}
                        disabled={isPending}
                        className="text-accent underline underline-offset-4 disabled:opacity-60"
                      >
                        Revocar
                      </button>
                    )}
                  </div>
                  {isActive && (
                    <p className="mt-0.5 break-all text-[11px] text-foreground/50">
                      {origin}/expediente/{g.token}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

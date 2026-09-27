"use client";

import { useState, useTransition } from "react";
import { computeInference } from "./actions";

export function InferButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true; stops: number; runs: number } | { ok: false; error: string } | null
  >(null);

  function handleClick() {
    startTransition(async () => {
      const res = await computeInference();
      setResult(res);
    });
  }

  return (
    <div className="mt-8">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="w-full bg-data px-6 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "Calculando…" : "Calcular paradas e intervalos (DBSCAN)"}
      </button>
      {result?.ok && (
        <p className="mt-4 text-sm text-data">
          Listo: {result.stops} paradas inferidas, {result.runs} corridas con
          intervalo y ocupación estimados.
        </p>
      )}
      {result && !result.ok && (
        <p className="mt-4 text-sm text-foreground/70">{result.error}</p>
      )}
    </div>
  );
}

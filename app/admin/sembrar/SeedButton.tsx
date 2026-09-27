"use client";

import { useState, useTransition } from "react";
import { seedDemoData } from "./actions";

export function SeedButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true; shifts: number; pings: number } | { ok: false; error: string } | null
  >(null);

  function handleClick() {
    startTransition(async () => {
      const res = await seedDemoData();
      setResult(res);
    });
  }

  return (
    <div className="mt-8">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="w-full bg-accent px-6 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "Sembrando…" : "Sembrar corrida simulada"}
      </button>
      {result?.ok && (
        <p className="mt-4 text-sm text-data">
          Listo: {result.shifts} corridas, {result.pings} pings.
        </p>
      )}
      {result && !result.ok && (
        <p className="mt-4 text-sm text-foreground/70">{result.error}</p>
      )}
    </div>
  );
}

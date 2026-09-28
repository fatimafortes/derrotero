"use client";

export function PrintButton({
  label = "Imprimir / Guardar como PDF",
}: {
  label?: string;
}) {
  return (
    <button
      onClick={() => window.print()}
      className="border border-foreground/20 bg-white px-4 py-2 text-sm font-medium text-foreground print:hidden"
    >
      {label}
    </button>
  );
}

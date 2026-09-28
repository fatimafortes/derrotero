// Mexico dropped DST nationally in 2022 — fixed UTC-6 year-round, no lookup needed.
const MEXICO_UTC_OFFSET_HOURS = -6;

/** Local Mexico City hour-of-day as a float (e.g. 5.5 = 05:30), from a UTC ISO timestamp. */
export function mexicoHourOfDay(isoUtc: string): number {
  const date = new Date(isoUtc);
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60;
  return (utcHour + MEXICO_UTC_OFFSET_HOURS + 24) % 24;
}

export function formatHourLabel(hour: number): string {
  const totalMinutes = Math.round(hour * 60);
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Shifts a UTC instant by the fixed Mexico City offset, then formats the
 * *shifted* instant with `timeZone: "UTC"` so the formatter reads the
 * shifted wall-clock fields as-is — never the runtime's own system
 * timezone. Vercel runs in UTC anyway, but this stays correct even
 * somewhere that isn't (a laptop, a different host), which
 * `toLocaleString("es-MX")` alone does not: that call only sets locale
 * (date order, month names), never timezone, so it silently renders in
 * whatever timezone the process happens to run in.
 */
function toMexicoShifted(isoUtc: string): Date {
  const date = new Date(isoUtc);
  return new Date(date.getTime() + MEXICO_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

export function formatMexicoDateTime(isoUtc: string): string {
  return toMexicoShifted(isoUtc).toLocaleString("es-MX", { timeZone: "UTC" });
}

export function formatMexicoDate(isoUtc: string): string {
  return toMexicoShifted(isoUtc).toLocaleDateString("es-MX", { timeZone: "UTC" });
}

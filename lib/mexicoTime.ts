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

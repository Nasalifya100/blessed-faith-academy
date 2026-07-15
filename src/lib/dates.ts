/** School calendar timezone (Zambia). */
export const SCHOOL_TIMEZONE = "Africa/Lusaka";

/**
 * Today's date as YYYY-MM-DD in Africa/Lusaka.
 * Prefer this over `new Date().toISOString().slice(0, 10)` (UTC).
 */
export function schoolToday(timeZone: string = SCHOOL_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

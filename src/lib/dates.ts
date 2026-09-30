/** School calendar timezone (Zambia). */
export const SCHOOL_TIMEZONE = "Africa/Lusaka";

/**
 * Today's date as YYYY-MM-DD in Africa/Lusaka.
 * Prefer this over `new Date().toISOString().slice(0, 10)` (UTC).
 */
export function schoolToday(
  timeZone: string = SCHOOL_TIMEZONE,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * A receipt date the server will accept.
 * The year must be four digits, the calendar day must exist, and the date
 * must not be after `today` (Africa/Lusaka when called from the payment schema).
 */
export function paymentPaidOnError(paidOn: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return "Enter a valid payment date.";
  }
  const [year, month, day] = paidOn.split("-").map(Number);
  if (year < 1000 || year > 9999) {
    return "Enter a valid payment date.";
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return "Enter a valid payment date.";
  }
  if (paidOn > today) {
    return "The payment date cannot be after today.";
  }
  return null;
}

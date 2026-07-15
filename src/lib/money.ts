/** Format ZMW amounts consistently (avoids SSR/client locale mismatches). */
export function formatKwacha(amount: number): string {
  return `K${amount.toLocaleString("en-ZM", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

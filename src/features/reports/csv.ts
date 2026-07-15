/**
 * Escape a CSV field for spreadsheet safety (RFC quotes + formula injection).
 * Neutralizes leading = + - @ and tab/CR so Excel does not treat cells as formulas.
 */
export function csvField(value: string | number | null | undefined): string {
  let text = value == null ? "" : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [
    headers.map(csvField).join(","),
    ...rows.map((row) => row.map(csvField).join(",")),
  ];
  return lines.join("\r\n");
}

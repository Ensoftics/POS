/**
 * Minimal RFC 4180 CSV support: quoted fields, escaped quotes ("") and CRLF/LF
 * line endings. Used for product import/export on the server and in tests.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip UTF-8 BOM (Excel)

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Ignore fully blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Quotes a cell when needed and neutralises spreadsheet formulas: values that
 * start with = + - @ (or tab/CR) are prefixed with an apostrophe so a malicious
 * product name cannot execute as a formula when the export is opened in Excel.
 */
export function toCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return rows.map((row) => row.map(toCsvCell).join(',')).join('\r\n') + '\r\n';
}

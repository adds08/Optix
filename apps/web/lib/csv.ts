/*
  CSV in and out, shared by report export and bulk import.

  Import and export have to agree on quoting: a report exported today is a
  plausible template for an import tomorrow, and a model name with a comma in
  it must survive the round trip.
*/

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/*
  A character-by-character reader rather than a split on commas, because the
  spreadsheets this has to swallow contain quoted fields with commas and
  newlines inside them — "Bolt, 3/4in x 6in" is one cell, and splitting on
  commas silently turns it into two and shifts every later column.
*/
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Treat CRLF as one break.
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  // Whatever is buffered when the text ends is the last field of the last row.
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing blank lines a text editor may have left behind.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Parse into objects keyed by the header row. Unknown columns are kept — the
    server ignores them, and dropping them here would hide a typo'd header. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const raw = parseCsvRows(text);
  if (!raw.length) return { headers: [], rows: [] };

  const headers = raw[0]!.map((h) => h.trim());
  const rows = raw.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

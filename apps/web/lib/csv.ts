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

/*
  The ONLY download path in the web app — report tables, the Tool Register
  export and the import template all end up here — which is why it is worth
  getting right and why it is not changed casually.

  Two defects lived in this function, neither of which produces an error when it
  fires. Both were found while investigating UI-68/69 and are fixed here rather
  than inside that bug's change, because a fault in this function reaches every
  export button in the product.

  1. **The anchor was never attached to the document.** Following a hyperlink is
     specified against the node's document being fully active rather than
     against the node being connected, so Chromium and WebKit download a
     detached anchor happily — Gecko historically has not. Appending costs
     nothing and removes a browser-dependent failure.

  2. **The object URL was revoked synchronously.** `click()` dispatches the
     event synchronously, but the download itself runs on the task the
     activation behaviour queues afterwards. Revoking in the same synchronous
     block can delete the blob before that task reads it, and the failure is
     silent: no file, no error, nothing in the console. Deferring the revoke by
     one task lets the download start first, and the blob is still released, so
     nothing leaks.

  Neither defect caused UI-68/69 — those reports were simply empty and their
  button correctly disabled — but a silent, racy, browser-dependent failure in
  the app's only download path is worth closing on its own.
*/
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

/*
  The same column under whatever name the sheet gave it.

  Import specs declare lowercase headers — "serial", "quantity". The sheets this
  has to swallow are kept by people, not generated from our template, and say
  "SERIAL #", "Qty", "MODEL". Matching those exactly meant a real file was
  rejected for missing columns the user could see in front of them, which is not
  an error message anybody can act on.

  Case and whitespace are handled by normalizeHeader itself; this table is only
  for names that differ by more than that.
*/
const HEADER_ALIASES: Record<string, string> = {
  "serial #": "serial",
  "serial#": "serial",
  "serial no": "serial",
  "serial number": "serial",
  qty: "quantity",
  make: "make",
  date: "purchased_on",
  "purchase date": "purchased_on",
  "purchased on": "purchased_on",
  desc: "description",
  cost: "cost",
  "unit cost": "cost",
};

/** Fold a sheet's header onto the spec's name for it. Exported so the import
    dialog can report what it actually matched. */
export function normalizeHeader(h: string): string {
  const k = h.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[k] ?? k;
}

/*
  A trailer sheet has a title block above its header row — "TE-006", the
  foreman, the project — so the header is not necessarily row 0. Scan the first
  few rows for one that contains a header the spec knows, and treat everything
  above it as preamble. Falls back to row 0 when nothing matches.
*/
export function findHeaderRow(rows: string[][], known: Set<string>): number {
  const scan = Math.min(rows.length, 8);
  for (let i = 0; i < scan; i++) {
    if (rows[i]!.some((cell) => known.has(normalizeHeader(cell)))) return i;
  }
  return 0;
}

/*
  Turn a raw row matrix (CSV parse or XLSX read) into objects keyed by the
  header row, normalised to spec names. Unknown columns are kept — the server
  ignores them, and dropping them here would hide a typo'd header.
*/
export function rowsToObjects(
  raw: string[][],
  known?: Set<string>,
): { headers: string[]; rawHeaders: string[]; rows: Record<string, string>[] } {
  if (!raw.length) return { headers: [], rawHeaders: [], rows: [] };

  const headerRow = known ? findHeaderRow(raw, known) : 0;
  const rawHeaders = raw[headerRow]!.map((h) => h.trim());
  const headers = rawHeaders.map(normalizeHeader);
  const rows = raw.slice(headerRow + 1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });

  return { headers, rawHeaders, rows };
}

/** Parse into objects keyed by the header row, normalised to spec names.
    Unknown columns are kept — the server ignores them, and dropping them here
    would hide a typo'd header. */
export function parseCsv(text: string): {
  headers: string[];
  rawHeaders: string[];
  rows: Record<string, string>[];
} {
  return rowsToObjects(parseCsvRows(text));
}

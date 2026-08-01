import { IMPORT_SPECS } from "@stinventory/types";

/*
  The register export that round-trips.

  ReportTable's export emits whatever display columns a report happens to
  define — pretty headers, money-formatted costs, joined names. That is fine as
  a human-readable dump and useless as something to re-import. This one is
  driven by the import spec itself, so the two share one source of truth and
  cannot drift.

  Two rules make it round-trip, and both are easy to get wrong:
  - ref columns emit the human name — "Dallas Yard", not a uuid — because that
    is what the importer resolves.
  - numeric columns are raw. "$489.00" will not re-import as 489.00.
*/

export type ExportAssetRow = {
  tag: string | null;
  make: string | null;
  modelNumber: string | null;
  description: string | null;
  categoryName: string | null;
  serialNumber: string | null;
  quantity: number | null;
  acquisitionCost: string | null;
  acquisitionDate: string | null;
  warrantyExpiresOn: string | null;
  condition: string | null;
  otherRef: string | null;
  locationName: string | null;
  owningProjectName: string | null;
};

/* ref columns keyed by the row field they resolve to a name for. */
const REF_NAMES: Record<string, keyof ExportAssetRow> = {
  locationId: "locationName",
  owningProjectId: "owningProjectName",
};

export function exportAssetsToSpec(rows: ExportAssetRow[], title?: string): unknown[][] {
  const cols = IMPORT_SPECS.asset.columns;
  const headerRow = cols.map((c) => c.header);
  const dataRows = rows.map((row) =>
    cols.map((c) => {
      const nameKey = REF_NAMES[c.key];
      if (nameKey) return row[nameKey] ?? "";
      const v = row[c.key as keyof ExportAssetRow];
      if (v === null || v === undefined) return "";
      return String(v);
    }),
  );
  /* A one-cell title row above the header mirrors the trailer sheets, and the
     importer's header detection already knows to skip it. */
  return title ? [[title, ...headerRow.slice(1).map(() => "")], headerRow, ...dataRows] : [headerRow, ...dataRows];
}

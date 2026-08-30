/* Shared formatting. Money and dates must look identical on every screen —
   a report that formats currency differently from the dashboard is a report
   people stop trusting. */

import { toDate } from "@stinventory/types";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(v: string | number | null | undefined, cents = false): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return cents ? USD_CENTS.format(n) : USD.format(n);
}

/*
  Money at a glance — "$7.2k", not "$7,231.00".

  The board shows a value on every job card and every crew row; at full
  precision that is a column of eleven-character numbers nobody reads and every
  one of them competes with the tool count beside it, which is the number people
  actually came for. Whole dollars under a thousand, one decimal above.
  `money()` stays the exact form for anywhere a figure is the subject — a tool
  record, a report — rather than a scale.
*/
export function moneyShort(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

export function num(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

/* The register's own reference number (asset.assetNumber) — system-stamped,
   always present, never a physical label. "A-" plus six digits distinguishes
   it at a glance from `tag`, which is real yard text like "TOOL-0001" and can
   be anything a person wrote on a sticker. */
export function assetNumberDisplay(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return "A-" + String(v).padStart(6, "0");
}

/* Parses through `toDate`, not `new Date`, because most of what reaches here is
   a `date` column — a calendar day, not an instant. `new Date("2027-10-09")` is
   UTC midnight, which in Dallas is the evening of the 8th, so a warranty running
   to 9 Oct 2027 rendered "Oct 8, 2027" all day, every day, for every Urban user
   (UI-60). `toDate` leaves a full timestamp alone, so the callers passing a real
   `createdAt`/`completedAt` are unaffected. */
export function shortDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/*
  `daysFrom` and `relative` moved to `@stinventory/types` so they could get a
  test suite — `apps/web` has none, and `relative`'s handling of FUTURE dates
  (warranty expiry) is exactly the kind of sign-convention detail that needs
  one. Re-exported here so the call sites keep importing from `@/lib/format`
  alongside the other formatters.

  `toDate` rides along for the same reason: `shortDate` above parses with it, and
  a second local copy of "a date-only column is a calendar day" is exactly how
  UI-60 would come back.
*/
export { daysFrom, relative, toDate } from "@stinventory/types";

/*
  Entity identifiers everywhere read as "<ID> - <Entity name>" — the job ID is
  shown beside the project name, the foreman's ID beside their name, and so
  on. The ID is the stable key people actually know ("PRJ-001", "5519"), so it
  leads.
*/
export function idName(id: string | null | undefined, name: string | null | undefined): string {
  if (!id) return name ?? "—";
  if (!name) return id;
  return `${id} - ${name}`;
}

/*
  The one haystack every job search filters against. Derived from `idName`
  rather than re-joined as `${externalId} ${name}`, so searching the exact
  label a user sees on screen ("URB-2401 - Legacy West…") always matches —
  the three inline copies that used to hand-build the string drifted apart
  from the display format (see the job-selector codegen review).
*/
export function jobSearchText(p: { externalId?: string | null; name?: string | null }): string {
  return idName(p.externalId, p.name).toLowerCase();
}

/*
  Where a tool photo is served from.

  The register stores an object key, never a URL — a URL would bake today's
  storage host into every row. Caddy routes `/media/*` on the same origin
  through to the bucket, so the browser needs nothing beyond the API base it
  already has, and moving the bytes to Spaces later changes one proxy line.
*/
export function photoUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  return `${base}/media/${key}`;
}

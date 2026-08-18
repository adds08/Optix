/* Shared formatting. Money and dates must look identical on every screen —
   a report that formats currency differently from the dashboard is a report
   people stop trusting. */

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

export function shortDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
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

/* "3 days overdue" reads faster than a date when the number is the point. */
export function daysFrom(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

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

export function relative(v: string | Date | null | undefined): string {
  const days = daysFrom(v);
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
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

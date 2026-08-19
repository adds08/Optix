/* One place that decides how the four columns read as a single line, so a
   register row, a chat card, a report and an overdue email cannot disagree
   about what a tool is called. */
export function formatAssetModel(a: {
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
}): string {
  return [a.make, a.modelNumber, a.description].filter(Boolean).join(" ");
}

/*
  Days SINCE a date: positive means already past, negative means still ahead.

  Lives here rather than in `apps/web` because the sign convention is the whole
  subtlety and it needs a test suite around it — the web app has none. See
  `relative` below for the bug that convention caused.
*/
export function daysFrom(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/*
  A date as a human phrase, in EITHER direction.

  This used to handle only the past, because every caller passed a `createdAt`
  or an `occurredAt`. Warranty expiry is the one caller that passes a date in
  the FUTURE, and `daysFrom` returns a negative number for those — which fell
  straight through the `days < 30` branch and rendered as
  "expires -413 days ago" for a warranty running to 2027.

  That was reported five separate times (UI-60, UI-62, UI-63, UI-64, UI-65),
  which is a fair measure of how wrong it looks: an in-warranty tool reads as
  long expired, and the number is negative on top.

  So the future is a real case here, not a defensive branch. `daysFrom` keeps
  its "days since" convention — flags.tsx depends on it and documents it — and
  the sign is interpreted once, here.
*/
export function relative(v: string | Date | null | undefined): string {
  const days = daysFrom(v);
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days > 0) {
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
  }
  const ahead = -days;
  if (ahead < 30) return `in ${ahead} days`;
  if (ahead < 365) return `in ${Math.floor(ahead / 30)} mo`;
  return `in ${Math.floor(ahead / 365)} yr`;
}

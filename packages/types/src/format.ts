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

/* A date-only column (`warrantyExpiresOn`, `startDate`, `acquisitionDate`)
   arrives as "2026-08-23". `new Date("2026-08-23")` parses that as UTC
   midnight, which west of Greenwich is the PREVIOUS DAY locally — so a
   warranty expiring today reads as expired in Dallas and not in London. A
   date-only string means a calendar day in the reader's own timezone, so it is
   parsed as local midnight. A full timestamp is a real instant and is left
   alone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  const m = DATE_ONLY.exec(v);
  if (!m) return new Date(v);
  const [y, mo, d] = v.split("-").map(Number);
  return new Date(y!, mo! - 1, d!);
}

/* Midnight local on whatever calendar day this instant falls in. */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/*
  Days SINCE a date: positive means already past, negative means still ahead.

  Lives here rather than in `apps/web` because the sign convention is the whole
  subtlety and it needs a test suite around it — the web app has none. See
  `relative` below for the bug that convention caused.

  **CALENDAR days, not elapsed time.** This used to be
  `Math.floor((Date.now() - d.getTime()) / 86_400_000)`, which measures how
  much TIME has passed and then floors it — so the answer moved with the clock:

    - a tool tagged at noon today read as "today" after noon and **"tomorrow"
      all morning**, because 07:00 minus 12:00 is negative and floors to -1;
    - "10 days ago at noon" read as 9 until noon came round again.

  Nobody asks "how many 24-hour periods since this happened". They ask which
  day it was, and that answer must not change because somebody opened the
  screen before lunch. Flooring both instants to local midnight first makes it
  a calendar-day difference.

  `Math.round`, not `floor`, on the result: a DST boundary makes a local day 23
  or 25 hours, so the division lands on 0.958 or 1.042 rather than exactly 1,
  and flooring would lose a day twice a year.

  Found on 2026-08-23 by the suite failing overnight — the tests were right,
  the implementation was wrong, and it only showed because the run happened to
  land before noon. It is the same family as the UI-60/62/63/64/65 bug
  described below, and was sitting next to it.
*/
export function daysFrom(v: string | Date | null | undefined): number | null {
  if (!v) return null;
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
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

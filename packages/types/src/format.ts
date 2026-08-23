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
  Parse a value from the API the way the column it came from means it.

  A `date` column ("2027-10-09") is a CALENDAR day — a warranty expires on the
  9th of October wherever you are reading from. `new Date("2027-10-09")` does
  not say that: the ES spec reads a date-only string as UTC midnight, which in
  Dallas (`America/Chicago`, where Urban Infraconstruction is) is 19:00 on the
  8th. Every date-only field rendered a day early for every Urban user —
  warranty expiry, `acquisitionDate`, project and assignment `startDate`,
  posting `startedOn`/`endedOn`. That is UI-60, and it hid for so long because
  the tester sits in Asia/Katmandu: at UTC+05:45 the same instant lands inside
  the intended day, so the bug is invisible east of Greenwich.

  So: a date-only string is built as LOCAL midnight on that calendar day. A
  full timestamp is a real instant — an `occurredAt` happened at a moment, not
  on a day — and is left to `new Date` untouched.
*/
export function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!ymd) return new Date(v);
  return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
}

export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/*
  Days SINCE a date: positive means already past, negative means still ahead.

  Lives here rather than in `apps/web` because the sign convention is the whole
  subtlety and it needs a test suite around it — the web app has none. See
  `relative` below for the bug that convention caused.

  It counts CALENDAR days, not elapsed milliseconds. Measuring elapsed time made
  the answer move with the wall clock: the day boundary landed at 19:00 local in
  Dallas, inside a yard's working evening, so between 19:00 and midnight a
  warranty expiring today read "expires yesterday" and one that expired
  yesterday still wore the amber "ends soon" badge instead of the red "expired"
  one (UI-60).

  `Math.round`, not `Math.floor`: a DST boundary makes a local day 23 or 25
  hours, so the division lands on 1.042 or 0.958 rather than exactly 1, and
  flooring would lose a day twice a year.
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

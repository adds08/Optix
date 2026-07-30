// Custody + SLA rules (pure). Inputs come from the caller (db reads); the rules
// themselves have no side effects and are unit-tested.

// A custody change requires approval if:
//   - the custodian changes (cross-person hand-off), OR
//   - the asset's acquisition cost is at/above the tenant high-value threshold.
// `cost` and `threshold` are numeric; null/undefined threshold disables the value rule.
export function requiresCustodyApproval(input: {
  fromCustodianId: string | null;
  toCustodianId: string | null;
  assetCost: number | null | undefined;
  highValueThreshold: number | null | undefined;
}): boolean {
  const crossPerson = !!input.fromCustodianId && input.toCustodianId !== input.fromCustodianId;
  const highValue =
    input.highValueThreshold != null && (input.assetCost ?? 0) >= input.highValueThreshold;
  return crossPerson || highValue;
}

export type OverdueInput = {
  type: "permanent" | "temporary";
  status: string;
  expectedEndDate: string | null;
  today: string;
};

export function isOverdueLoan(input: OverdueInput): boolean {
  if (input.type !== "temporary" || input.status !== "active") return false;
  if (!input.expectedEndDate) return false;
  return input.expectedEndDate < input.today;
}

// An asset is Idle if it is available (in warehouse, unassigned).
export function isIdleAsset(status: string): boolean {
  return status === "available";
}

/*
  A rented line that is past its end date and has not been called off rent.

  Deliberately a separate function from `isOverdueLoan` even though the shape
  rhymes, because the consequences differ and so will the thresholds. An owned
  tool held past its expected return is an inconvenience someone will get to.
  A rental past its end date is an invoice arriving every day until a person
  phones the vendor — so this one is worth chasing harder and earlier.

  `quoted` lines are excluded: a quote nobody took up has an end date in the
  past and costs nothing, and alerting on those would bury the real ones.
*/
export type RentalDueInput = {
  status: string;
  endDate: string | null;
  today: string;
};

export function isRentalOverdue(input: RentalDueInput): boolean {
  if (input.status !== "on_rent") return false;
  if (!input.endDate) return false;
  return input.endDate < input.today;
}

/** Days until a rented line is due back. Negative means already past. */
export function daysUntilOffRent(endDate: string | null, today: string): number | null {
  if (!endDate) return null;
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(now)) return null;
  return Math.round((end - now) / 86_400_000);
}

/*
  Worth a nudge before it turns into an overdue.

  Seven days is the window a yard can actually act in: long enough to arrange
  collection, short enough that the reminder still feels connected to the date.
*/
export const RENTAL_DUE_SOON_DAYS = 7;

export function isRentalDueSoon(input: RentalDueInput): boolean {
  if (input.status !== "on_rent") return false;
  const days = daysUntilOffRent(input.endDate, input.today);
  return days !== null && days >= 0 && days <= RENTAL_DUE_SOON_DAYS;
}

/*
  Chase order for anything overdue: worst first.

  This exists as a named function rather than an inline `.sort()` because the
  query it belongs to had no ordering at all, and the bug that produced was
  invisible in code review — the list simply came back in whatever order
  Postgres chose, which on the alerts screen put a tool 15 days late above one
  35 days late. A screen whose entire purpose is "what needs chasing" has to
  lead with the worst of it.

  Ties break on the tool's tag so the order is stable between refetches. Two
  tools going overdue on the same day is common — a truck's kit goes out and
  comes back together — and a list that reshuffles itself every thirty seconds
  under a polling refetch is its own small nuisance.
*/
export function byMostOverdue<T extends { daysOverdue: number; tag?: string }>(a: T, b: T): number {
  if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
  return (a.tag ?? "").localeCompare(b.tag ?? "");
}

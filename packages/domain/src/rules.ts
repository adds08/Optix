// Custody + SLA rules (pure). Inputs come from the caller (db reads); the rules
// themselves have no side effects and are unit-tested.

/*
  What happens when somebody moves a tool: apply it, apply it and flag it, or
  park it for a signature.

  Two things decide this, and only one of them used to be consulted.

  WHO IS ACTING. A foreman may raise a hand-off (`transfer.create`) but not sign
  one off (`transfer.approve`) — the roles already say so. The old rule never
  looked, so a foreman's hand-off approved itself and, worse, wrote a PERMANENT
  custody change. In the yard a foreman handing a tool to another foreman is a
  borrow: he is telling the equipment desk where his tool went, not reassigning
  ownership. Only the desk changes who a tool belongs to.

  WHAT IT IS WORTH. Kept from the previous rule, and still the right gate for
  the desk itself: an equipment admin moving something at or above the tenant's
  threshold wants a second admin on it. A null threshold disables that gate —
  a tenant that has not said what "high value" means has not asked for one.

  Note the asymmetry, which is deliberate: value parks the desk's own moves but
  never a foreman's. A foreman's move is temporary custody only — the register
  still shows the permanent owner, and the borrow is already in the desk's queue
  — so there is nothing a value gate would protect. Blocking him instead would
  rebuild the queue nobody clears while the tool has physically moved anyway,
  which is the failure the value-only rule was written to escape.
*/
export type CustodyOutcome =
  /** Apply it as a permanent custody change. Nobody else is needed. */
  | "auto"
  /** Apply it now as a temporary borrow, and put it in front of the desk.
      The permanent owner is untouched. */
  | "verify"
  /** Write nothing. The register does not move until a second person signs. */
  | "approve";

export function custodyOutcome(input: {
  /** Does the actor hold the approve permission for what they are doing? */
  actorCanApprove: boolean;
  assetCost: number | null | undefined;
  highValueThreshold: number | null | undefined;
}): CustodyOutcome {
  if (!input.actorCanApprove) return "verify";
  if (input.highValueThreshold != null && (input.assetCost ?? 0) >= input.highValueThreshold) {
    return "approve";
  }
  return "auto";
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

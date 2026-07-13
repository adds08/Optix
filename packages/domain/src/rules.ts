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

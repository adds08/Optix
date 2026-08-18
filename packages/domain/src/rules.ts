// Custody rules (pure). Inputs come from the caller (db reads); the rules
// themselves have no side effects and are unit-tested.

/*
  What happens when the equipment desk moves a tool: apply it, or park it for a
  second signature.

  Only value decides this now. An equipment admin moving something at or above
  the tenant's threshold wants a second admin on it; a null threshold disables
  the gate, because a tenant that has not said what "high value" means has not
  asked for one.

  There used to be a third outcome, `verify`, and a second input, "does the
  actor hold the approve permission". Both existed to model a foreman handing a
  tool to another foreman: the tool moved immediately, ownership did not, and
  the desk confirmed it afterwards. Urban does not work that way — tools are
  moved by the equipment desk, and a foreman does not reassign one. With
  foreman-initiated movement gone there is no actor left who can reach this
  function without already holding the approve permission, so asking became a
  question with one answer. See the 2026-08-09 changelog.
*/
export type CustodyOutcome =
  /** Apply it as a custody change. Nobody else is needed. */
  | "auto"
  /** Write nothing. The register does not move until a second person signs. */
  | "approve";

export function custodyOutcome(input: {
  assetCost: number | null | undefined;
  highValueThreshold: number | null | undefined;
}): CustodyOutcome {
  if (input.highValueThreshold != null && (input.assetCost ?? 0) >= input.highValueThreshold) {
    return "approve";
  }
  return "auto";
}

// An asset is Idle if it is available (in warehouse, unassigned).
export function isIdleAsset(status: string): boolean {
  return status === "available";
}

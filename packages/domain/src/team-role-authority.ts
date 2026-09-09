/*
  "Set by" (STI-503): pure, so it is testable without a database and so the
  two computations that must never drift — the real gate in
  `projectTeam.assertCanAssign` and the `canAssign` HINT shown on `/my-crew`
  and the onboarding crew step — can call the exact same function instead of
  reimplementing the same three-way OR twice.

  Three independent ways to be allowed to place someone into a tier, tried in
  this order because the first two are the cheapest to check and because
  keeping the ORDER stable is what makes a future fourth path a one-line
  addition rather than a re-read of the whole thing:

    1. An admin-shaped permission — `project.team.assign`, tenant-wide. Until
       2026-09-10 this also covered three dedicated `project.assign.*`
       permissions naming specific tiers; those were deleted, because tiers are
       tenant data and a fixed permission could never name a tenant's own.
    2. The tier is marked open to everyone (`assignableByEveryone`).
    3. The caller holds one of the tier's registered "Set by" tiers, ON THE
       SAME PROJECT. Tenant-wide holding of some OTHER tier does not count —
       see the schema comment on `team_role_assigner` for why that is a
       deliberate narrowing from how the built-in three's permission path
       behaves, and why path 1 exists precisely to keep those three unaffected
       by it.

  Nothing here decides WHICH permission counts as admin-shaped, or how to load
  the caller's tiers on a project — those are database questions and stay in
  `routers/projectTeam.ts`. This function only combines three already-resolved
  booleans/sets into one answer, so a test proves the combination without
  standing up Postgres.
*/

export type TeamRoleAuthorityInput = {
  /**
   * True when the caller holds `project.team.assign` — the desk/admin grant
   * that places anyone into any tier on any job, rostered there or not.
   *
   * A flag rather than the permission itself because this function must stay
   * pure and free of the `Permission` union; `routers/projectTeam.ts` resolves
   * it. It was also the seam that let three per-tier permissions be folded in
   * before they were removed.
   */
  hasAdminPermission: boolean;
  /** The target tier's own `assignableByEveryone` flag. */
  targetIsOpenToEveryone: boolean;
  /**
   * Team-role tier NAMES the caller currently holds on THIS SAME PROJECT —
   * an active `project_team_member` row, not a login role and not a tier held
   * on some other job. Empty for an account with no employee record, or one
   * on no jobs at all.
   */
  callerTierNamesOnThisProject: ReadonlySet<string>;
  /**
   * The target tier's registered "Set by" list — tier NAMES allowed to place
   * someone into it, from `team_role_assigner`. Empty means "nobody has been
   * granted this yet", not "everybody" — that is what
   * `targetIsOpenToEveryone` is for.
   */
  targetAssignerTierNames: ReadonlySet<string>;
};

export function canAssignIntoTier(input: TeamRoleAuthorityInput): boolean {
  if (input.hasAdminPermission) return true;
  if (input.targetIsOpenToEveryone) return true;
  for (const held of input.callerTierNamesOnThisProject) {
    if (input.targetAssignerTierNames.has(held)) return true;
  }
  return false;
}

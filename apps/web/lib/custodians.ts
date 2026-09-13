import { CUSTODIAN_ROLES } from "@optix/types";

/*
  Who may be handed a tool — asked once, in one place.

  Six pickers each wrote their own version of this filter against
  `CUSTODIAN_ROLES`, a compile-time constant of three role names. Two of them
  ordered the conditions differently, one kept a second unfiltered list beside
  it, and all six ignored `role.can_hold_custody` — which is stored, seeded and
  editable on /settings/roles, so ticking the box changed nothing anywhere.

  An audit on 2026-09-12 found three flags answering this question in three
  places and disagreeing: the constant (foreman, superintendent, mechanic), the
  login role's column (those three plus crew and general superintendent) and
  the tier's column (which adds field and project engineers). Only foreman and
  superintendent appeared in all three, and a field engineer marked
  custody-capable in the database could not be picked anywhere in the UI.

  This reads the login role's column, with the constant as a FALLBACK for rows
  where the join produced nothing. The fallback is not the answer — it is what
  keeps a tenant whose roles are half-configured from losing every custodian
  picker at once.

  The tier's `can_hold_custody` is a different question and stays where it is:
  a picker asks "who could hold this tool?", which is tenant-wide, while a tier
  asks "who may be placed into this job at this level?", which is per-project.
  `put-on-job-form` reads the tier; nothing here does.
*/

/** The shape any list of people must have to be filtered. `employee.list`
    returns all three; callers with a narrower row type can pass a subset. */
export type CustodianCandidate = {
  role?: string | null;
  roleCanHoldCustody?: boolean | null;
  employmentStatus?: string | null;
};

/**
 * Whether one person may hold a tool.
 *
 * `roleCanHoldCustody` wins whenever the server answered. `undefined` means the
 * caller is on a payload that predates the field, and `null` means the person
 * has no login role — the first falls back to the constant, the second is a
 * genuine "no role, no answer" and reads as false through it too.
 */
export function canHoldCustody(person: CustodianCandidate): boolean {
  /* `null` and `undefined` are different answers and must not be collapsed.
     `null` is the left join finding no login role — the register has an
     opinion and it is "this person has no role", which is not a yes. Only
     `undefined`, meaning the field was never sent, falls back to the name. */
  if (person.roleCanHoldCustody === null) return false;
  if (typeof person.roleCanHoldCustody === "boolean") return person.roleCanHoldCustody;
  return CUSTODIAN_ROLES.includes(person.role as (typeof CUSTODIAN_ROLES)[number]);
}

/**
 * The custodian options for a picker: people who may hold a tool AND are still
 * employed.
 *
 * The active check is part of THIS function rather than each call site because
 * two of the six had it in a different order and one omitted it, which is how
 * a terminated foreman stayed selectable on one screen and not on another.
 * Pass `includeInactive` only where a screen deliberately shows everybody —
 * the jobsites card keeps a second unfiltered list for exactly that reason.
 */
export function activeCustodians<T extends CustodianCandidate>(
  people: readonly T[] | undefined | null,
  opts: { includeInactive?: boolean } = {},
): T[] {
  return (people ?? []).filter(
    (p) => canHoldCustody(p) && (opts.includeInactive || p.employmentStatus === "active"),
  );
}

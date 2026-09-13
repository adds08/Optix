# Audit — Who May Hold Custody

**Date:** 2026-09-12
**Question asked:** is `can_hold_custody` wired up, and if not, what should it be?
**Answer:** there are **three sources of truth**, they **disagree**, and the one
the UI obeys is the one that cannot be edited.


> ⚠ **DATED SNAPSHOT — 2026-09-12, not current state.** See
> [00-summary.md](00-summary.md) for the full list of what has changed since.
> **SUPERSEDED 2026-09-14 by `b99b84f`.** The defect was real and is fixed, but NOT the way this doc recommends: it proposes the TIER's column should win and `tbl_entity_role.can_hold_custody` be removed. The opposite happened — the LOGIN ROLE's column is what all six pickers read (a picker asks a tenant-wide question; a tier is per-project), the constant survives as a fallback, and the tier column stays for `put-on-job-form`. See `apps/web/lib/custodians.ts`. Do not action the plan in section 'Recommended fix'.

---

## The three sources

### 1. `CUSTODIAN_ROLES` — a compile-time constant

`packages/types/src/enums.ts:91`

```ts
export const CUSTODIAN_ROLES = ["foreman", "superintendent", "mechanic"] as const;
```

**This is the only one the UI reads.** Six components filter their custodian
pickers against it:

- `apps/web/app/(app)/jobsites/page.tsx:243`
- `apps/web/components/crew-assign-dialog.tsx:74`
- `apps/web/components/assign-form.tsx:30`
- `apps/web/components/transfer-form.tsx:23`
- `apps/web/components/bulk-move-form.tsx:47`
- `apps/web/components/vehicle-form.tsx:56`

plus `apps/api/src/entity-resolve.ts:111`.

### 2. `tbl_entity_role.can_hold_custody` — a LOGIN-role column

Editable in Settings. Live values:

```
crew                    true
foreman                 true
general_superintendent  true
mechanic                true
superintendent          true
```

### 3. `tbl_entity_team_role.can_hold_custody` — a TIER column

Per tenant, per tier. Live values:

```
Field Engineer          true
Foreman                 true
General Superintendent  true
Project Engineer        true
Superintendent          true
Area In-charge          false
Director                false
Project Manager         false
```

---

## They disagree

| Role | In constant | Login-role flag | Tier flag |
|---|---|---|---|
| **foreman** | yes | yes | yes |
| **superintendent** | yes | yes | yes |
| mechanic | **yes** | yes | **no** |
| crew | **no** | **yes** | no |
| general_superintendent | **no** | yes | yes |
| field_engineer | **no** | **no** | **yes** |
| project_engineer | **no** | **no** | **yes** |

**Only `foreman` and `superintendent` agree in all three places.**

---

## What this means in practice

**`canHoldCustody` is read by NOTHING at runtime.** A grep across `packages/`
and `apps/` finds it only in `seed-data.ts` (where it is written) and in
comments. No router, no component, no scope check consults either column.

So today:

- A **field engineer** or **project engineer** is marked custody-capable on
  their tier, and **cannot be picked as a custodian anywhere in the UI.**
- A **general superintendent** is marked custody-capable on BOTH database
  columns, and **cannot be picked either.**
- An administrator who ticks "can hold custody" in Settings sees **no change
  whatsoever**. The screen accepts the edit and nothing happens.
- `rbac-matrix.test.ts` asserts the login-role column matches the constant —
  but only for the SEEDED values. It cannot catch an admin's later edit,
  because the constant is compiled in.

**The settings screen lies.** That is the defect.

---

## Why this matters more than it looks

Per the client (2026-09-12), custody eligibility is genuinely **dynamic**:

> custody needs to be assigned to higher ups like superintendents, if foremen
> are unavailable... each department operations / project or equipment may
> assign it differently at first, hence it is dynamic in tools by jobsite

That rules out the cheap fix of deleting the toggle. The flexibility is real
and required. **The columns are right; the UI just does not read them.**

The tier column is already correct for Urban's structure — Field Engineer and
Project Engineer genuinely do hold tools on a job, which is exactly the case
the constant gets wrong.

---

## Which of the three should win

**The TIER column** (`tbl_entity_team_role.can_hold_custody`), for three
reasons:

1. **It is already correct.** It is the only source that includes field and
   project engineers, which Urban's own ladder says hold tools.
2. **Custody is a job-level fact, not an account-level one.** Whether somebody
   can hold a tool depends on what they do on that job, which is what a tier
   is. A login role is about what buttons they see.
3. **`crew` disproves the login-role column.** `crew` is marked
   custody-capable there — correctly, a crew member holds tools — but `crew`
   is the "no login" role, so an account-level flag is the wrong home for it.

`tbl_entity_role.can_hold_custody` should then be **removed**, not left as a
second answer to the same question. Two editable columns for one fact is how
they came to disagree.

---

## Recommended fix

**Roughly one day. Not started.**

1. Add `role.custodianRoles` (or extend an existing settings query) returning
   the tier names where `can_hold_custody` is true, tenant-scoped.
2. Add a `useCustodianRoles()` hook in `apps/web`.
3. Replace the constant in all six components plus `entity-resolve.ts`. Extract
   a shared `activeCustodians(employees, custodianRoles)` helper at the same
   time — the predicate is currently duplicated six times, and two of the six
   order their conditions differently (see `04-web.md` finding 5).
4. Keep `CUSTODIAN_ROLES` as the **fallback** for an empty/misconfigured
   tenant, so a tenant with no tiers configured does not silently lose every
   custodian picker. Mark it clearly as a fallback, not the source.
5. Update `rbac-matrix.test.ts` to assert the TIER column against the fallback,
   not the login-role column.
6. Drop `tbl_entity_role.can_hold_custody` in a follow-up migration once
   nothing reads it.

**Do not** collapse this into "just wire the login-role column" — that would
preserve the wrong answer for field and project engineers.

---

## Related

- `04-web.md` finding 5 — the same predicate duplicated six times
- `05-roles-and-org.md` — the tier ladder and the assigner matrix
- `tbl_entity_role.uses_field_layout` has the **identical problem**: stored,
  seeded, editable, read by nothing. Same fix shape, lower stakes.

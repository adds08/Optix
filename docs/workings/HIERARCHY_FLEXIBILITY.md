# Hierarchy flexibility: what adapts, what is still nailed down

Written 2026-09-08, after the client asked directly whether the system would be
flexible enough for any tenant's structure. The short answer: the **engine**
is, the **older UI and reporting layers** are not yet, and this document lists
exactly which is which so nobody has to re-derive it.

Read this before adding a tier, changing the ladder, or promising a prospective
customer that their org chart will fit.

## The three things called "role"

This is the single most confusing thing in the product and it caused real
confusion during the 2026-09-07 session. They are separate on purpose.

| | Table | What it answers | Where it is edited |
|---|---|---|---|
| **Job title** | `employee.company_role_id` → `tbl_entity_company_role` | What HR calls this person — "Curb Man", "Carpenter II" | Comes from BambooHR (`jobTitleName`) |
| **Login role** (RBAC) | `employee.role_id` → `tbl_entity_role` | What screens and actions they may use | `/admin/roles` |
| **Team role** (tier) | `project_team_member.role` → `tbl_entity_team_role` | Where they sit on a job, and who answers to whom | `/settings/team-roles` |

Plus a fourth, deprecated: **`employee.role`**, a plain text column. Its own
comment says "do not add a new reader" — but see the report finding below,
because it currently holds something `role_id` does not.

`projectTeam.ts`'s header is explicit that the login role and the team role are
**deliberately unlinked**: the seed ships one person whose login role is
`engineer` and whose team role is `pm`. Do not build a lookup between them.

## Proven flexible

Tested empirically on 2026-09-08, not inferred. A tier that had never existed
(`Apprentice`, reporting to Foreman, `canHoldCustody: true`) was inserted
straight into `tbl_entity_team_role`, taking the register six levels deep. With
**no code change**:

- `/my-crew` rendered it at the correct distance ("3 below you")
- the skip warning read *"This skips Superintendent, Foreman"* — both names, in
  order, correct plural
- nothing else broke

Depth, labels, distances and warning copy are all derived. The tier was removed
afterwards.

**Register-driven and safe to extend:**

- `tbl_entity_team_role` itself — arbitrary names, arbitrary depth, `reportsTo`
  per row rather than a rank
- `tiersAtOrBelow` / `tiersAbove` (`packages/domain/src/org-chart.ts`) — BFS,
  cycle-safe, arbitrary depth
- `/my-crew`, `/org-chart`, `/settings/team-roles`
- `projectTeam.assign` — custody movement gated on `canHoldCustody`, so a
  tenant tier that holds tools really does move them
- `onboarding.crewStatus` — above adjacent, below the whole subtree (2026-09-08)
- `scope.ts crewEmployeeIds` — the crew visibility edge (2026-09-08)
- The departure successor ladder (2026-09-08)
- `usesFieldLayout` — which navigation an account gets (2026-09-08)

## Fixed on 2026-09-08

| Was | Now |
|---|---|
| `crewOf` hardcoded superintendent→foreman, so an Area In-charge with `assets.view.crew` saw only their own tools, silently | Reads the register, resolved per project |
| `myForemen` was a second hand-written copy of that walk | Calls the same function |
| `usesFieldLayout` was written to the DB and never sent to a client; the web app used a hardcoded name set, so the admin toggle did nothing | Shipped through `identity.me` |
| Departure successor filtered projects to `foreman` and walked a literal pair, so any other tier got a null successor silently | Built from `tiersAbove` |
| `vehicle-form` asked for `role === "foreman"` — a superintendent could not be given a truck | Reads `CUSTODIAN_ROLES` like its five siblings |
| `rig-picker` collapsed everyone to two names, filing a general superintendent under `foreman` | Resolves against the tier register |
| The onboarding crew step capped every tier at one person and only showed adjacent tiers | Several people per tier; whole subtree below |
| A deferral could not be withdrawn | `onboarding.undefer` |

## Still nailed down

### Severity 1 — a tenant tier is invisible or gets no behaviour

**The jobsite hub does not render tiers it does not know.** The team strip's
`Member` type is literally `role: "pm" | "superintendent"`
(`jobsite-team-strip.tsx:34`), with `ROLE_ICON` keyed to the same two and a
`role === "pm" ? "PM" : "SUP"` fallback in three places. `jobsites/page.tsx`
narrows the roster with a type predicate before it even reaches the strip, and
crew rows filter `m.role === "foreman"`. `jobsite-card-view.tsx` repeats all of
it, including the empty state "No PM or superintendent assigned".

Consequence: a Director or Area In-charge row written by `/my-crew` **exists, is
auditable, and appears on no card**. A General Superintendent holding a truck
and tools gets a crew card only via tool custody, never as a roster row.

*Not attempted unattended* — it is the main operational screen and
custody-adjacent. The fix is to render any tier by `label` and split leaders
from crews on `canHoldCustody` rather than on names.

**Fixed 2026-09-09 — "Set by" (STI-503).** `BUILT_IN_PERM` still maps only
`pm`/`superintendent`/`foreman` to `project.assign.*`, and that path is
unchanged. What is new is `team_role_assigner`
(`packages/db/src/schema/reference.ts`): a per-tier list of which OTHER tiers,
held ON THE SAME PROJECT, may place someone into it, plus an
`assignableByEveryone` wildcard. Edited on `/settings/team-roles`'s "Set by"
column. `packages/domain/src/team-role-authority.ts`'s `canAssignIntoTier` is
the single combination both `projectTeam.assertCanAssign` (the real gate) and
the `canAssign` hints on `/my-crew` and the onboarding crew step call, so the
two cannot drift the way this document's previous version warned they might.

This did **not** derive authority from `reportsToTeamRoleId`, despite the
suggestion below having stood here since 2026-09-08 — a separate table was
chosen instead, because the reports-to column's own schema comment says
plainly that "nothing about ACCESS may read this", precisely to stop this
exact drift. Kept for the record: ~~`Permission` is a fixed code union, so no
settings screen can fix this. It needs a design change — probably deriving
assign authority from `reportsToTeamRoleId` ("whoever is above a tier can fill
it"). The client's decision on 2026-09-08 was to leave this to admins for
now.~~ The client asked for the fix on 2026-09-09, in a session that also
designed the "Set by" shape above.

**One thing this narrows, deliberately, and only for a tenant's own tiers:**
today, `pm`/`superintendent`/`foreman`'s authority comes from a LOGIN role's
permission, tenant-wide — a `project_manager` account can assign a
superintendent onto ANY project, whether or not that account is rostered on
it. "Set by" authority is TIER-on-that-job instead. The two paths run
side by side (see `canAssignIntoTier`'s path 1 vs path 3) precisely so the
built-in three keep their existing tenant-wide behaviour untouched; only a
tenant-added tier, which had no path at all before this, is affected.

### Severity 2

**`CUSTODIAN_ROLES` is a hardcoded array mirroring a tenant-editable boolean.**
A tenant who ticks `canHoldCustody` on a role they created gets `true` in the
database, no entry in the array, and appears in **no** custodian picker.
`rbac-matrix.test.ts` pins the mirror in both directions, so retiring it is its
own change.

**The custody reports name two roles.** `report.byForeman` / `byMechanic`
filter `employee.role` by literal, so a tenant-added custody tier is in
neither. One "Assets by Custodian" driven by `canHoldCustody` is the right
answer — and it is a **product decision** (it renames a report and merges two),
so it was left.

**The tool detail page shows exactly two accountability rows** — superintendent
and pm — omitting any tier above them. Low blast radius.

**`project-assign.ts`'s exclusivity rule is keyed on `"foreman"`.** An audit
recommended threading `canHoldCustody` in; that was **checked and rejected**,
because `canHoldCustody` is `true` for superintendent and general
superintendent, both of whom legitimately run several jobs — so it would close
their roster rows on every other job on any posting.

The predicate actually needed is *"does this tier work one job at a time"*, and
**no column expresses it**. For Urban's ladder the current literal is probably
correct. Fixing it properly means a new tier flag, which is a schema change and
a client decision.

## Two data findings worth knowing

**53 of Urban's 83 people have `employee.role = 'foreman'` while their
`role_id` points at `crew`.** These are not in conflict by accident: the legacy
column holds *what kind of worker* somebody is, and `role_id` holds *what login
tier* they have — and for a foreman who never signs in, `crew`
(`needsLogin: false`) is the right login answer. So the deprecated column
currently carries information its replacement does not, which is why moving the
custody reports onto `role_id` returned zero rows and was reverted.

**Resolve that before treating `employee.role` as dead.**

**`estimator` and `survey` roles do not survive a reset.** They were created by
direct SQL on 2026-09-07 and are not in `seed-data.ts`, so `make seed-urban`
removes them. Per `.claude/rules/database.md`, a role needs a seed entry *and*
a migration granting its permissions to exist on any machine but the one it was
typed into.

## Recommended order

1. **The jobsite hub** (render any tier; split on `canHoldCustody`) — highest
   visible impact, and the only place a written roster row is invisible.
2. **Resolve the `employee.role` vs `role_id` disagreement**, then move the
   custody reports.
3. **Retire `CUSTODIAN_ROLES`** in favour of reading the flag.
4. **A tier flag for one-job-at-a-time postings** — schema change, client
   decision.
5. ~~Assign authority from the ladder — design change, client decision,
   currently parked.~~ **Done 2026-09-09**, as "Set by" (STI-503) — see the
   section above. Not derived from the ladder in the end; a separate table
   instead, for the reason given there.

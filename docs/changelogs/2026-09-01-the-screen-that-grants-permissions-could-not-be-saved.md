# The screen that grants permissions could not be saved

Urban reported two things about the live site: the Roles screen answered every Save with
"Could not save those permissions.", and the owner account — the only active login in
production — could not see the "+ PM", "+ SUP" or "+ Add crew" controls on a jobsite.

They are one problem. The owner was missing the permissions those three controls gate on,
and the screen that would have granted them was jammed shut. Both failures come from the
same place: `permission`, `role` and `role_permission` are written by the seed, the seed
only runs against a fresh database, and Urban's was seeded once on 2026-07-28. Every change
to the permission list since then has reached every development machine and no live one.

## What changed

### Migration 0038 deletes the retired `rental.*` rows

`rental.read` and `rental.manage` were added on 2026-07-28 and removed from `PERMISSIONS`
on 2026-08-10 with the rest of the rentals model. Nothing deleted the rows. `role-perms.ts`
grants `owner` and `equipment_admin` `[...PERMISSIONS]`, so the live database went on
holding grants for two permissions the code no longer has — on `owner`, on
`equipment_admin`, and `rental.read` on `warehouse` as well.

That is what broke Save, and the loop was closed. `role.list` returned the grants raw from
the table. The page seeds its editing draft from that list. The catalogue renders its
checkboxes from `PERMISSION_GROUPS` in code, so a name the code no longer has got no
checkbox — invisible on the screen, and impossible to untick. Save posted the draft back
into `z.array(permissionEnum)`, which refused the unknown value. The tRPC formatter nulls
`userMessage` for any Zod issue that is not `code: "custom"`, so the page fell through to
its generic string and said nothing useful. The only control that could have removed the
row was the control the row was jamming.

### Migration 0038 also gives `owner` and `equipment_admin` every permission

`role-perms.ts` defines both as `[...PERMISSIONS]`. A spread is evaluated at seed time: it
does not mean "always everything", it means "everything as of the day this database was
created". On the live database both sat at 26 real grants against a list of 33.

Among the missing were all four project-team permissions. `project.team.read` and
`project.assign.pm` were granted to `office_admin` alone, and
`project.assign.superintendent` and `project.assign.foreman` were granted to nobody at all
— migration 0020 inserted the permission rows but its owner/equipment_admin backfill
covered only the four `assets.view.*` scopes. `jobsites/page.tsx` gates "+ Add crew",
"+ PM" and "+ SUP" on exactly those three, which is why the owner could not put anybody on
a project team.

The grant is written as a `SELECT ... FROM tbl_entity_permission` rather than a list of
today's four, so it states the same rule the spread states and self-corrects for anything
added before it runs. It is deliberately scoped to those two roles — every other role has
an explicit list, and since the Roles screen shipped the live database is *supposed* to
differ from `role-perms.ts` wherever an administrator has edited it.

### `role.list` drops grants the code no longer recognises

One guard in the fold that builds each role's permission list. 0038 removes the two rows
this was written for; the filter is what makes the next retired permission a no-op instead
of a second deadlock, and it is self-healing — `setPermissions` replaces the whole set, so
the first save after a stale grant appears writes it out of the database.

Authorization is unaffected: `resolveSession` reads `role_permission` itself, where an
unrecognised name is inert because nothing ever checks for it. The admin Roles screen is
the only consumer of `role.list`.

### `.claude/rules/database.md` records the rule, and loses a dropped table

The rule that would have prevented all three of 0020, 0025 and 0038 was written nowhere an
agent reads — each migration rediscovered it in its own header comment. It is now in the
migrations section: adding a permission means a migration granting it, retiring one means a
migration deleting its rows, and the test suite will not catch you because
`rbac-matrix.test.ts` asserts a *freshly seeded* tenant matches `role-perms.ts` — which is
precisely the database that was never broken.

The same file listed `rental_order.external_number` among the unique constraints worth
knowing about. That table went with the rentals model; the reference is gone.

## What was found while building it

**The failure was three roles, not one.** `warehouse` holds `rental.read` too, so its
permissions were equally unsaveable. Nobody had reported it, presumably because nobody had
tried to edit that role since August.

**Two independent Zod failures, not one.** The stale names pushed the array to 35 entries
against `.max(PERMISSIONS.length)` of 33, so the request failed the length check as well as
the enum check. Either alone produces the same opaque message.

**0025 diagnosed this exact class and fixed one instance of it.** Its header comment
describes the spread-at-seed-time problem in almost these words, then grants `user.manage`
and stops. The generalisation was available in August and was not taken.

**A local database cannot reproduce any of it.** The seed writes all of `PERMISSIONS` and
`role-perms.ts` grants owner everything, so a development machine is correct by
construction. The bug lives only in the gap between a migrated database and a seeded one,
which is the gap nothing tests.

## Verified

Read-only queries against production before any change: `tbl_entity_permission` held 35
rows including both `rental.*`; those grants existed on `owner`, `equipment_admin` and
`warehouse`; `project.assign.superintendent` and `project.assign.foreman` appeared in no
role's grants at all; owner and equipment_admin sat at 28 grants; all 37 migrations
applied.

Reproduced the Save failure locally by inserting the production rows and posting the
owner's own permission set back through the running API — `httpStatus: 400`,
`userMessage: None`, `zodError` naming both the length and the enum, which is exactly the
generic message on the screen.

The new test in `role-admin.test.ts` was confirmed to fail with the filter disabled and
pass with it, rather than being assumed to test something.

Replayed the full production drift on the local database, ran `make ENV=local migrate`, and
re-checked: no `rental` rows or grants remain, `equipment_admin` holds all 33, and owner
holds all four project-team permissions. Through the running API as the owner account,
`role.list` returns 33 names, the read-then-write round trip the screen performs returns
`ok: true`, and `identity.me` reports all three permissions the jobsite controls gate on.

`pnpm typecheck` passes across the workspace. `turbo run test` passes in every package,
run inside the api container so the database-backed suites actually execute rather than
skipping.

**Not verified:** nothing has been run against production. The migration is written and
proven against a local replay of production's shape, but production still holds the stale
rows until it is deployed. Nobody has clicked through the real Roles screen or a real
jobsite in a browser — the verification above is at the API and database layers.

## Deliberately not done

**Migration 0020 was not edited.** It has run; changing an applied migration changes
nothing about the database and breaks its hash for anyone who has not.

**The other roles were not reconciled against `role-perms.ts`.** The Roles screen exists so
Urban can disagree with that file, so a blanket reconciliation would silently overwrite
decisions somebody made on purpose. Only the two roles the file defines as the whole list
are touched.

**`office_admin` keeps `project.assign.pm` and nothing more.** That is 0020's deliberate
choice, not drift.

**The generic Zod message was left alone.** Giving `setPermissions` a written refusal for
an unknown permission would have made the failure legible, but the filter means a client
can no longer produce one. That is a change to the error contract, and it belongs to
whoever wants it, not to this fix.

## Where it is

Uncommitted on `development` at the time of writing: `packages/db/drizzle/0038_reconcile_live_role_grants.sql`
plus its journal entry, the guard and its comment in `packages/api-contracts/src/routers/role.ts`,
the regression test in `packages/api-contracts/src/role-admin.test.ts`, and the two edits to
`.claude/rules/database.md`.

**Not deployed.** Production is unchanged and both symptoms are still live there until
`0038` runs on it.

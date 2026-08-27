# There is one register of people now, and a role that means one thing

"I don't understand why there is users, and user accounts separately."

There were two registers of the same people, and three different things called
a role. This collapses both, and the audit at the end found a cross-tenant
privilege escalation in the new code before it shipped.

## What changed

### One register

`/admin/users` is gone. It listed the same people as `/people` under different
columns, which is what made the question fair: a login is a property of a
person, not a separate subject.

`/people` now carries a **Role** column and an **Account** column reading one of
five states — *No login needed · No account · Invited, not verified · Never
signed in · Last in <date>*. Inviting, resending, resetting and deactivating are
on the person's row menu, offered only in the state each applies to, so the menu
never offers to resend an invitation nobody sent.

`user.email_verified_at` and `user.last_sign_in_at` are what turn "has an
account" into a real answer. Verification is stamped **inside the transaction
that consumes an invite or reset token** — the token only ever existed in that
mailbox, so following it *is* the proof, and a separate "confirm your email"
step would ask a person to prove the same thing twice. Sign-in is stamped by
`login()` and swallowed on failure, like the password rehash beside it: a login
must not fail over bookkeeping.

### One role

Three ideas were called a role. `employee.role` decided who could hold a tool
and who got the phone layout; `user_role` decided permissions; `company_role` is
the job title HR uses. The first two are the same idea.

`employee.role_id` is now the person's role and the source of truth. It lives on
the **person, not the account**, which is the whole point — a labourer has a
role, holds tools, and will never sign in. `company_role` is untouched: still a
label, still nothing branches on it.

The role register gained what makes it usable as a register: a **description**,
and three behaviour flags that used to be hard-coded name lists —
`needs_login`, `can_hold_custody` (was `CUSTODIAN_ROLES`) and
`uses_field_layout` (was `FIELD_ROLES`, whose own comment called itself "wrong
by construction"). All three are editable on `/admin/roles`, kept in a panel
*apart* from the permission grid: a permission answers "may they", these answer
"what are they", and putting them in one grid invites reading the first as
access control. **`needs_login` explicitly is not** — nothing in authentication
reads it, and the audit checked.

The person form's role dropdown now reads the register through a new
`role.options`, gated on `employee.manage` rather than `config.manage` —
choosing somebody's role is not the authority to change what a role may do. It
previously offered five hard-coded names out of thirteen, so an office
administrator could not be created from the only screen that creates people.

### The sync, and the invariant behind it

`user_role` is what `resolveSession` actually reads, and auth was deliberately
not rewritten. So `employee.update` is now the single writer that keeps the pair
in step, in one transaction, replacing rather than accumulating. Without it the
register would say "office admin" while the session still carried a foreman's
permissions — the same silent disagreement the old split produced.

`role-sync.test.ts` is what holds that up, and it was checked against a
deliberately broken version first: with the sync disabled, two of its cases fail.

### Editable permissions were already shipped

Worth recording, because it was half the ask and it already existed.
`role.setPermissions` has been fully editable with a self-lockout guard since the
roles screen was built, and `role-perms.ts` was already demoted to a factory
default with `rbac-matrix.test.ts` asserting a *freshly seeded* tenant rather
than the live one. Nothing needed doing.

### Pinned rows can be reordered, and the first one is where you land

Up/down controls on each pinned row, hover-revealed and absolutely positioned so
they cost no layout space — the rule from two days ago holds. Up/down rather than
drag: the pane is narrow and scrollable, dragging is awkward on a touchpad and
unusable on the phone sheet, and the only ordering anybody wants is "put that one
at the top".

`pinnedItems` now believes the stored order. It used to sort by the navigation
tree, defended on the grounds that the tree's order is stable and already
learned — true until the list can be rearranged, at which point a list you can
move but which re-sorts itself is worse than one you cannot move at all.

Signing in lands on the first pinned row. It resolves through `pinnedItems`, so
it inherits the permission intersection: **a pin naming a route the actor cannot
open does not become a redirect.** Armed by a one-shot `sessionStorage` marker,
because an unguarded version would fire on every visit to `/home` and nobody
could ever open the dashboard again.

## What was found while building it

**A cross-tenant privilege escalation, in the code this change added.**
`employee.update` and `employee.create` took `roleId` as a bare uuid with no
check that the role belonged to the caller's tenant — and the new `user_role`
sync wrote it straight into the table `resolveSession` reads. That read has no
tenant predicate of its own, because until the sync existed nothing could put a
foreign role there. So anyone holding `employee.manage` could point a person at
another tenant's `owner` role and collect its permissions on the next request.

`user.setRole` had always guarded this with `requireTenantRole`; the new writer
did not. Fixed with the same guard before the write, and covered by two tests
that were confirmed to fail without it. **This was found by auditing the diff,
not by a test** — which is the argument for auditing a diff that touches auth.

**The landing redirect consumed its one-shot marker before permissions arrived.**
`perms` is `[]` until `identity.me` resolves, so `railGroups` has every gated row
filtered out and the pin resolves to nothing — and the marker was already spent.
Not an intermittent race: it was every sign-in. Caught by the browser test, which
is the only place it could have been.

**Most of the ask already existed.** `role` already had `name` + `description`;
`role_permission`, `user_role` and `permission` were already tables; the
permission editor was already fully editable with a self-lockout guard. What was
missing was the flags, the account lifecycle columns, and the merge.

## Verified

- `make test` in the api container: 254 in api-contracts, nothing skipped, plus
  every other package.
- 33 browser tests across five roles, including three new ones for pin ordering
  and the landing redirect.
- The seed builds the whole register from a clean database: 14 roles with correct
  flags, **37 of 45 people on `crew`** — the no-login role — and no person left
  without a role. That flag is reachable from a fresh seed rather than being a
  column only the schema knows about.
- Three tests were each confirmed to FAIL against the un-fixed code first: the
  role sync, the cross-tenant guard, and the pin ordering.
- Audit: every new procedure permission-gated, every new query tenant-scoped,
  nothing in `packages/auth` or `apps/api` reads `needs_login`.
- `pnpm typecheck` and `pnpm lint` clean across the workspace.

## Deliberately not done

**`employee.role` (the legacy enum) was not dropped.** It still backs the import
spec, and dropping a NOT NULL column in the same change that backfills its
replacement leaves no way back if the backfill is wrong. It is commented as
legacy with "do not add a new reader".

**`FIELD_ROLES` and `CUSTODIAN_ROLES` still drive the client.** The flags are
stored, seeded and editable, but `nav-config.ts` and the custodian pickers still
read the hard-coded name lists. Wiring them means putting the flags on the
session payload, which is an auth-shaped change and not one to make unattended.
**This is the one part of "flags on the role row" that is not finished**, and it
is why the flags are honest data today rather than behaviour.

**Cost codes and phases** — deferred, as agreed.

## Where it is

Committed and merged to `main`. Migration `0028_thin_supernaut.sql`, applied
locally, additive only. Not deployed.

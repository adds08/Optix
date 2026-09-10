# A claimed job can be given back, and no removal fires on one click

Step one of the wizard lets a person take on the jobs they run. It had no way to
put one back. A director who picked the wrong row from a list of twenty projects
— which is a list of job numbers, so picking the wrong one is easy — was simply
on that job, permanently, with no control on the screen that said otherwise. The
only removal path in the codebase was `projectTeams.removeBranch`: an
administrative tool that demands a typed reason and writes a
`projectAccessRestriction` row barring the person from the project. Using it to
correct a misclick would record the mistake as a sanction.

The obvious fix — a remove button on the row — then raised the question that
motivated the second half of this change. A bare × beside a row you just created
is one stray click away from undoing the wrong job, which is the same class of
mistake the button exists to fix. The register already had an answer for this
(`RowActions`, since 2026-08-25: click once to arm, click again to fire), but it
lived inside one menu component and nothing else used it.

## What changed

### `onboarding.unclaimProject` — an undo, and only while it is still an undo

A new mutation that ends the CALLER's own `project_team_member` row on one
project. It is deliberately not a second removal path. It refuses, with a plain
message surfaced on the row itself, the moment it would stop being a simple
walk-back:

- **Somebody has been added under you on that job.** Decided by `removalBranch`,
  the same domain function `removeBranch` uses, rather than a second copy of the
  branch walk — if the caller's branch holds anyone but the caller, this is a
  reorganisation and belongs to an administrator.
- **You are holding tools through that job.** An unreturned `assignment` row with
  the caller as custodian on that project blocks it, mirroring the guard
  `removeBranch` already carries. Custody must not be orphaned by a roster edit.

On success it ends the roster row, mirrors the ending onto
`employee_project_assignment`, and clears `employee.primary_project_id` where it
pointed at that job. It writes no restriction row, because nothing was
sanctioned. Everything happens in one transaction and is audit-logged as
`onboarding.unclaimProject`.

It is the counterpart of `claimProject` and sits beside it in the RBAC
exemption list for the same stated reason: gating the undo behind a permission
the claimer does not hold would mean the people who can make this mistake are
exactly the ones who cannot correct it.

### One arm-then-confirm hook, and every plain destructive button using it

`apps/web/components/use-armed-confirm.ts` — first click arms and swaps the
control's label and variant, second click fires, and it disarms itself after
four seconds so a button left armed does not stay armed. The behaviour was
already the house pattern; this is the first time it has been a thing other
components can import.

Wired into every destructive control in the app that previously acted on a
single click:

| Where | Action |
|---|---|
| Onboarding step one / `/claim-a-job` | Give a claimed job back |
| Jobsite team strip | Remove a member chip |
| Saved filters | Delete a saved view |
| Settings → Job Tiers | Delete a tier |
| Admin → Access Roles | Delete a role |
| Job group modal | Delete a group |

`project-teams-panel.tsx`'s "Remove branch" was left alone: it opens a dialog
demanding a typed reason, which is already a confirmation and a stronger one.

Four of the six were closures inside a `.map`, where a hook cannot be called
per element — each row needs armed state independent of its neighbours. They
became components (`JobRow`, `TeamChip`, `SavedFilterRow`, `DeleteTierButton`).
The two single-instance sites kept the hook at the top level but had to learn to
disarm when the TARGET changes, which is the non-obvious half: selecting a
different role on the admin page, or reopening the job group modal on a
different group, now clears any armed state, so a confirm cannot carry over onto
something the user did not arm it for.

### The crew row stops drawing on top of itself

Reported twice with screenshots. Each roster row forced its text and its action
buttons onto one line (`sm:flex-row items-center`) with neither able to yield,
so at real widths the buttons overlapped the name and a person's code was
clipped mid-word. Both halves are now `basis-full` below the `sm` breakpoint —
the buttons drop to their own line under the name — and revert to sharing a row
above it (`sm:basis-0 sm:flex-1` / `sm:basis-auto sm:shrink-0`).

### Employee code leads on a crew row

The roster row rendered `name` and then folded title and code together into one
trailing hint. Everywhere else in the product a person is code first — the
People register's own column order. The row now renders the code as a `Tag`
ahead of the name, with the job title after it, matching the pickers that name
the same people.

## What was found while building it

**The RBAC matrix suite caught the new mutation, which is the system working.**
`unclaimProject` landed as a bare `protectedProcedure` that writes, and
`rbac-matrix.test.ts` failed on it by walking the router tree — not from a list
anybody maintains. It is now in `BARE_BY_DESIGN` with a written justification,
which is the sanctioned outcome, but it is worth recording that the check fired
before a human noticed.

**`pnpm test` at the workspace root reports success while 310 of 381
api-contracts tests skip.** The DB-backed suites gate on `DATABASE_URL`, absent
on a laptop. The failure above was invisible to the root command and only
appeared when the suite ran inside the api container against
`stinventory_test`. `db-suites-run.test.ts` documents this for CI; it is equally
true locally, and a green root run is not evidence a router change is safe.

**`useReducedMotion()` from `motion/react` returns `boolean | null`, not
`boolean`.** Passing it into a prop typed `boolean` fails typecheck, and the
error points at the call site rather than the hook.

## Verified

- `packages/domain`: 147 tests pass.
- `packages/api-contracts` inside the api container against `stinventory_test`:
  381 pass, 0 skipped, 34 files — including the RBAC matrix walk, custody,
  tenant-scoped login and the onboarding suites. Run against the test database
  deliberately: the suite truncates, and the working database holds the real
  register.
- `pnpm typecheck` clean in `apps/web` and `packages/api-contracts`.

**Not verified:** none of the six confirm buttons has been clicked in a browser.
The mutation's two refusal paths — a branch with somebody under it, and a
caller holding tools — have no test of their own and were reasoned from
`removeBranch`'s equivalents rather than exercised. Both are worth a DB-backed
test before this is trusted in production.

## Deliberately not done

- **No confirmation added to "Remove branch".** Its typed-reason dialog is
  already a stronger gate, and a second confirm in front of it is friction with
  no safety gained.
- **No dialog for the six.** The in-place confirm is the pattern this codebase
  already chose; introducing modals for the same job would be a second answer to
  a settled question.
- **`unclaimProject` does not become a general removal tool.** It refuses rather
  than escalating when the branch is not empty. `removeBranch` remains the one
  path for removing anyone but yourself, and the one that records a reason.

## Where it is

Branch `development`, committed. Not deployed — `main` is what deploys.

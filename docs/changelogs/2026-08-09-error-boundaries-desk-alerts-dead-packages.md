# Error boundaries, the desk gets told, and three packages that were never imported

Housekeeping after a delivery assessment (`docs/archive/KILO_DELIVERY_ASSESSMENT.md`)
went looking for what is actually wired up. Three of its gap items were small
enough to close in the same pass, and the audit turned up a set of files
describing an architecture that does not exist.

## What changed

- **The web app has error boundaries.** There were none — not one `error.tsx`
  anywhere under `apps/web/app`. A render error unmounted the tree and left a
  blank white page: no nav, no message, nothing for a foreman to report.
  `app/(app)/error.tsx` catches anything inside the shell, so the sidebar and
  top bar survive and the failure is one panel rather than a dead tab; its
  `reset()` re-renders the segment instead of reloading, which is usually
  enough because most of these are a query that threw. `app/global-error.tsx`
  is the last resort for failures in the root layout itself, and is styled
  inline on purpose — it renders when the app's CSS may not have loaded, so it
  must not depend on any.
- **It does not look like an empty state.** `EmptyState` uses the grid-paper
  panel; an empty register is a drawing nobody has made yet. A failure gets a
  plain panel and the crit palette, because a drawing that tore is a different
  thing.
- **The equipment desk is now told when something lands in its queue.**
  `transfer.create` and `assignment.create` wrote no notification at all, so a
  held hand-off or a recorded borrow reached the desk only if somebody thought
  to open the dashboard and read a count. Both now call `notifyDeskPending` in
  `packages/api-contracts/src/notify.ts`. The two cases read differently
  because they are different — "waiting for approval, the tool has not moved"
  versus "recorded, needs checking, the tool is already with them".
- **`tenantSettings.custodyApproverRole` finally does something.** The settings
  page has always written it and nothing has ever read it. It is now who gets
  the alert, falling back to `equipment_admin` — the column default, and the
  role `detectRentalsDue` already addresses for the same reason. The actor is
  excluded: an admin raising their own high-value hand-off does not need
  telling about it.
- **Notification failure cannot fail a custody write.** Both call sites are
  wrapped. The tool has already moved, or deliberately has not; neither should
  be undone because an insert into `notification` went wrong.
- **Typed errors in the custody routers.** Twelve bare `throw new Error` in
  `transfer.ts` and `assignment.ts` surfaced to the client as opaque 500s.
  They are now `TRPCError` with `NOT_FOUND` for a missing row and `CONFLICT`
  for a wrong-state transition, which is what the UI needs to tell "this is
  gone" from "this already happened".
- **Deleted `packages/frontend-shared`, `packages/design-system` and
  `packages/notifications`.** See below.

## Found while doing it

**Three packages existed that nothing imported.** `frontend-shared` and
`design-system` were created to be the shared layer between the web and field
apps. Neither `apps/web` nor `apps/mobile` ever declared a dependency on
either; the two clients share exactly `@stinventory/api-contracts` and
`@stinventory/types`. `packages/notifications` was an empty directory, already
logged as a known issue in `AGENTS.md`. All three are gone.

This had misled at least two previous passes — `docs/12` and `docs/16` both
warn about `frontend-shared` by name — which is why the deletion is recorded
here rather than done quietly. ADR-3 predicted those packages would "serve both
clients"; that consequence did not hold, and the ADR now carries a dated
follow-up saying so. The decision itself stands. The lesson is that the sharable
layer between these two clients is *logic*, the way `packages/domain` is: the
desk app is Radix + Tailwind v4 and the field app is NativeWind + Tailwind v3,
so there was never a component layer for them to hold in common.

**`.kilo/agent/stinventory.md` was pointing agents at a service that does not
exist.** It is git-tracked and reads as project instructions, and it said
"Engine at `engine/` — Python FastAPI, NOT part of pnpm/turbo workspace." There
is no `engine/` directory; intent parsing is `packages/intent`, in TypeScript.
Fixed, and a pointer to `docs/06-decisions.md` added so the next agent checks
the ADRs before re-litigating a settled stack choice.

**`AGENTS.md` claimed 59 tests.** There are 139, across 9 files in 5 packages.
Corrected, along with the more useful fact that `apps/api` and `apps/web` have
no `test` script at all — so nothing exercises a router, a database or a
rendered screen.

**The README's docs table had been split in half.** The "Remote localhost"
section was sitting inside it, orphaning three rows below the prose, and the
header separator declared three columns for a two-column table. Both fixed, and
the three assessment documents now have index rows.

## Deliberately not done

- **No desk queue screen.** `transfer.approve`, `transfer.verify`,
  `transfer.decline`, `assignment.approve`, `assignment.decline` and
  `assignment.return` still have no caller in either app. The alerts this
  change adds will point at a queue that cannot yet be actioned from a screen.
  That is gap C1 in the assessment and it needs a product decision first —
  the transfer form currently tells users to go to the Inbox, and `inbox.resolve`
  only handles tasks and messages.
- **Custody writes are still not transactional**, and the one-active-assignment
  invariant still has no database constraint. Both are Phase 1 items and both
  touch the core write path; neither belongs in a housekeeping pass.
- **No migration.** Ledger immutability at the database level was left alone
  deliberately: `0010` and `0011` are still uncommitted and other work is
  adding columns, so adding a migration here would have collided over numbering.

## Where it is

Committed to nothing yet — working tree only. `pnpm typecheck` passes 12/12 and
`pnpm test` passes 139/139. Not deployed.

# An empty register had no way to stop being one

Found by driving the People screen in a browser against a genuinely empty
tenant — `make reset-bare` had just been used to clear a partial BambooHR sync,
leaving 2 logins and 0 employees. The page rendered "No people on file" and
nothing else: no search, no table, and no Sync/Import/New Person buttons.

## What changed

### The three toolbar actions now render on the empty state too

`apps/web/app/(app)/people/page.tsx` — `SyncFromButton`, `ImportButton` and
`CreateAction` lived only inside `<DataTable>`'s `toolbarExtra`, and the whole
`DataTable` branch was skipped whenever `!rows.length`. So the exact three
actions capable of putting a person into the register were the ones hidden by
the condition that is only true while the register has nobody in it — the page
had no way out of its own empty state short of a direct database write.

`EmptyState` already accepted an `action` slot (`components/sti/page.tsx`); it
had just never been passed one. The fix wires the same three buttons into it,
plus a one-line description naming the three ways to add someone.

Search and the column headers stay hidden — there is nothing to search or sort
with zero rows, and showing them would be noise rather than help.

## What was found while looking at it

This is not a hypothetical: the tenant was empty for a real, current reason
(the seed reset used to clean up after the aborted BambooHR sync, see the
2026-09-07 sync changelogs), and hitting this dead end was how it surfaced —
not from reading the source, but from opening the actual screen.

## Verified

`pnpm --filter web typecheck` — clean. Confirmed against the running dev
stack (`localhost:3100/people`) that the empty state now shows the three
buttons under "No people on file".

Not re-run: the People e2e/Playwright suite, if one exists for this page —
this was a targeted fix verified by hand against the live screen rather than
a full suite pass.

## Deliberately not done

Did not touch `DataTable` itself, and did not add search/table chrome to the
empty branch — neither has anything to operate on with zero rows.

## Where it is

Committed to `development`. Not deployed — this branch does not auto-push to
`main`.

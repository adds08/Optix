# Lint goes to zero, and one warning it was hiding

`pnpm lint` exited 0 with thirteen warnings, and had for long enough that the CI
workflow's own comment describes them as a backlog to be kept non-blocking.
Clearing them was mostly deleting dead imports. One of them was not dead code at
all.

## What changed

### `rig-picker` warns when a trailer is already someone's

`heldByOther` was computed in the trailer branch and never used, which is why it
showed up as an unused variable. It is the trailer equivalent of `takenFrom` in
the truck branch directly above, and the truck branch has always said `With X —
taking it moves it` and confirmed with `Take <unit> from X?`.

The trailer branch said neither. A trailer can be held by a foreman with no
truck under it — that is exactly what `applyDirect` in the same block exists for,
and the comment there calls it "the flexibility the field needs" — so the state
is reachable. In it, the row read **"Unhitched, in the yard"** and the dialog
read **"no truck needed, the tools aboard follow"**, over an action that takes a
trailer, and the tools in it, off another foreman without naming them.

`heldByOther` now carries the name rather than a boolean (mirroring `takenFrom`)
and feeds both the row's meta line and a third confirmation branch.

**Deleting the variable would have silenced the lint warning and the missing
warning with it**, which is the argument for reading each one rather than
running `--fix`.

### The other twelve were genuinely dead

- `custody/page.tsx` — unused `daysFrom` import.
- `inbox/page.tsx` — unused `Tag` import, and a `declining`/`setDeclining` state
  pair left from a decline dialog that was never built. `askDecline` uses
  `window.prompt`, and the comment above `askDismiss` shows the prompt wording
  was a deliberate decision (UI-72), so the abandoned approach is the dead half.
  Removing the state left `useState` itself unused.
- `old-dash/page.tsx` — unused `money` import.
- `assign-form.tsx` — the whole `usePermissions()` call: `has` was never read,
  and the form narrows its picker with `useViewTier()` instead, which is what
  `.claude/rules/web.md` says to use.
- `crew-assign-dialog.tsx` — unused `cn` import.
- `dashboard-widgets.tsx` — unused `useEffect`/`useState`, and `useThemeStore`
  is used only inside a `typeof` type query, so it becomes `import type`.
- `departure-form.tsx` — `selectClass`, styling for a `<select>` the form no
  longer contains.
- `apps/api/src/request-worker.test.ts` — unused `and` import.

## What was found while building it

- **An unused variable is sometimes a symptom, not litter.** Twelve of thirteen
  here were litter, which is exactly what makes the thirteenth dangerous: the
  cheap fix for the batch is `--fix` or a quick delete, and that would have
  removed the only remaining evidence that the trailer branch was meant to warn.

- **The warning backlog was small and entirely clearable.** It has been treated
  as permanent — CI passes `pnpm lint` with no `--max-warnings` specifically so
  the backlog does not gate merges. That reasoning still holds for new warnings,
  but the backlog it was protecting is now empty, so a future one stands out.

## Verified

- `pnpm lint` — **0 errors, 0 warnings**, across all three linted packages. It
  reported 13 warnings before this change.
- `pnpm typecheck` — 14 tasks successful. This is what confirms the
  `import type { useThemeStore }` change is legal in its `typeof` query.
- `make ENV=local test` — 247 passed in `api-contracts` with 0 skipped, and
  green across `domain` (32), `types` (81), `intent` (40), `auth` (8), `mail`
  (5) and `api` (6). Run in the container; the host run silently skips the
  DB-backed suites.
- `/inbox`, `/custody`, `/old-dash`, `/jobsites`, `/home` and `/people` all
  compile and serve 200, with no compile errors in the web container.

**Not verified: the new trailer warning has not been seen.** Reaching it needs a
trailer held by a foreman with no truck, and then opening the rig picker as a
different foreman. The copy and the branch mirror the truck case a few lines
above, which is the strongest thing that can be said without a browser.

## Deliberately not done

- **No `--max-warnings 0` added to CI.** Tempting now that the count is zero, and
  it is a separate decision with its own failure mode: it turns any new warning
  into a blocked merge, which is the thing the current comment deliberately
  avoids. Worth doing on purpose, not as a side effect of tidying.
- **No test for the trailer warning.** `apps/web` still has no test harness.

## Where it is

Committed on `development`, following `cfd4ccb`. Not pushed, not deployed;
production remains behind `main` until the CI seed fix in `940c388` lands there.

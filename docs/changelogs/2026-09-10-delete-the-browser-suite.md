# Delete the browser suite, and the references that outlived it

The `e2e/` Playwright package is gone, with every target, script, doc section and
code comment that pointed at it. Browser checking is the Playwright MCP now.

## Why

The suite had drifted from the UI it tested, and the drift ran in one direction:
the app was right and the specs were stale.

- `jobsites-pool.spec.ts` and `no-layout-shift.spec.ts` clicked a tab named
  **"In Yard"**. `jobsites/page.tsx:715` renders **"Yard"**, and a third
  **"Unassigned"** tab was added beside it.
- `table-freeze.spec.ts` and its neighbours asserted a **"TAG"** column. The
  register's first column is **"CODE"** — consistent with the decision that a tag
  is a label and `asset.id` is identity.

Neither is a product bug. But a spec naming a screen that no longer exists is
read as fact by the next agent, and the user's judgement was that this costs more
than the coverage returns. Stale test prose is the same failure class as a stale
rule in `.claude/rules/` — confidently wrong, and obeyed.

The suite had also been out of CI since 2026-08-30, so nothing it said had blocked
a merge in eleven days.

## What was found on the way

**The `mechanic@` account was blocking all 72 specs**, and the cause was the seed,
not the app. `seed.ts` marks only `pm@` and `foreman@` as onboarded, so the
first-run wizard correctly intercepts `mechanic@` and sends it to `/welcome` —
while `roles.ts` declared it lands on `/my-tools`. `super@` was deliberately
excluded from that list for exactly this reason; `mechanic@` never was. One
failing setup test blocks the whole dependent project, so the suite had not run to
completion for anybody. `roles.ts` even predicted it: *"If a role starts landing on
`/welcome`, check the seed before changing the route — the gate is probably right."*

**`pnpm test` on the wrong dataset looks like six product bugs.** With the `urban`
dataset loaded, `rbac-matrix.test.ts` cannot find `hr@stinventory.local` and
`seeded-ledger-fold.test.ts` has no assets to fold. `make ENV=local seed-demo`
first; `docs/SETUP.md` says so and it is worth believing.

**`sti-e2e-qa` and `sti-qa` never depended on the suite.** Both drive the
Playwright MCP; `sti-e2e-qa`'s only occurrence of the string "e2e" is its own name.
They were left intact — deleting them would have removed a working capability that
had nothing to do with the stale specs.

## What is now unguarded

Recorded because the honest cost of this change is coverage, and pretending
otherwise is how it gets rediscovered as a surprise:

- role landing screens and the field-layout redirect
- sidebar permission-widening — the negative half, where an extra link is a leak
  nobody reports
- the no-layout-shift rule (pixel equality, not a tolerance)
- table freeze, resize, overflow and column alignment
- the CSV download path — which the deleted spec did not really cover either: it
  passed against both defects it was written alongside, because Chromium follows a
  detached anchor happily

The router-level half is untouched: `rbac-matrix.test.ts` still drives the
permission ladder through the seeded accounts against real Postgres, and it is the
reason a denial is observable at all.

## Also fixed

`jobsites/page.tsx` carried **nine comments** still calling the tab "In Yard", and
one describing "the two labels" when there are three. That prose was the most
likely thing in the repo to mislead an agent about a screen — the specs at least
failed loudly, while a comment just gets believed. Updated to the real labels,
with a note that the `poolView === "pool"` state key still carries the older name.

## Deliberately not done

- **No replacement suite.** The `.claude/skills/test-on-playwright` rewrite says
  not to build one without the user asking, and says plainly that MCP browser
  driving is per-change evidence, never regression protection.
- **The two follow-up tickets were deleted, not reworded** —
  `e2e-critical-paths.md` (mutating custody specs) and
  `make-the-browser-suite-blocking.md` (STI-122). Both existed only to extend a
  suite that no longer exists.
- **`docs/HANDOFF-RELEASE-1.md` was tombstoned rather than rewritten.** It is a
  dated record, which `LLM_RECALL.md` §4 says must not be edited as though it
  described the present — so its sections now say what they described and that it
  was deleted, rather than pretending the suite was never there.
- **The user's in-flight status-pill work was left untouched** —
  `custody/page.tsx`, `projects/page.tsx`, `status.tsx` and its changelog were
  modified during this session by the user and are not part of this change.

## Verified

- `pnpm typecheck` — 13 packages, clean (was 14; `@stinventory/e2e` is gone)
- `pnpm lint` — 0 errors, 8 pre-existing unused-import warnings
- `pnpm test` in the api container — 8/8 packages, 364/364 in `api-contracts`
- `make ENV=local help` parses with no `e2e` targets; `pnpm -r list` resolves with
  no missing workspace member
- Web `:3100` and the two edited pages (`/jobsites`, `/tools`) all serve 200;
  API `/health` ok
- Repo-wide sweep: every surviving mention of `e2e` is an explicit tombstone
  stating it was deleted. No target, script, skill, agent or doc instructs anyone
  to run or extend it.

Committed to `development`. Not deployed — this is repo hygiene and touches no
runtime behaviour beyond comment text.

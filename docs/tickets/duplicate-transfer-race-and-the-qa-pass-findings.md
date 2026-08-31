# Duplicate transfer race, and the rest of the 2026-08-30 QA pass

**Status:** READY — item 1 is the only engineering work; 2 and 3 need a decision first
**Opened:** 2026-08-31
**Source:** Samikshya's test pass (2026-08-30), validated line-by-line against the
repository on 2026-08-31. Every claim below was re-checked against the code; where the
original report was wrong, this ticket says so rather than repeating it.

---

## 1. A tool can get two open hand-offs — the web form has no guard that holds

**This is the only real defect in the pass, and it is unfixed.**

`transfer.create` reads "does this tool already have a hand-off waiting?" on `ctx.db`, and
the transaction that inserts the row does not open until thirty lines later. Two requests
that arrive together both read "no open transfer", both pass the guard, and both insert.
The desk then gets two rows for one physical event: approve one and the other sits in the
queue forever, pointing at a hand-off that already happened.

It is trivially reachable — the code's own comment names the cause, *"tapping twice on bad
signal, which is the normal condition in a yard"*.

**Nothing catches it underneath.** `assignment` has the partial unique index
`assignment_one_active_uq` as a backstop; `transfer` has no equivalent. Searched every
branch in the repository: no `transfer_one_pending_uq` exists anywhere.

This is the same race class already fixed for approve, decline and return — those take the
asset row `FOR UPDATE` and re-check under the lock. `create` was never brought inside that
discipline.

### The fix is claimed to exist, and it is not in version control

The QA report states a patch is written on a branch called `bugs-fixing`. **That branch
does not exist** — not locally, not on the remote, and no branch in the repository
contains the index it describes. It is uncommitted work on one machine. Recover it or
rewrite it, but do not plan around it as though it were a branch someone can merge.

### Acceptance criteria

1. The existence check moves inside the transaction, behind `SELECT … FOR UPDATE` on the
   asset row — the same anchor `custody.ts` locks, so all decisions about one tool
   serialise with each other.
2. A partial unique index on `transfer (asset_id) WHERE status = 'pending_approval'`,
   generated with `make generate` and committed as SQL. It is a backstop, not the fix:
   like `assignment_one_active_uq` it makes a bypass fail loudly and cannot itself close
   a stale row.
3. A concurrency test in the shape of `custody-concurrency.test.ts` — two real
   simultaneous `create` calls, one row created, the loser raising `CONFLICT`. It must be
   confirmed to FAIL without the fix; a race test that passes both ways proves nothing.
4. Run it in the api container. The host `pnpm test` skips every database suite silently.

### The historical duplicate is separate, and permanent until someone decides

There is a real duplicate ledger row for UIC-1003 (event type `transfer`, note "Lent,
awaiting equipment desk", 2026-08-04) written before the borrow model was removed.
Migration `0023` cancelled the stranded `transfer` rows but deliberately did not touch
ledger rows. The `transaction` table is append-only by trigger (migration `0014`, raising
SQLSTATE `0A000`), so clearing that one line needs a targeted migration that disables the
trigger around a scoped delete — the mechanism the seed's reset already uses.

**Decide whether to do that at all.** The ledger is the system of record; deleting a row
because it is embarrassing is the beginning of not trusting it. Leaving it and explaining
it in the tool's history may be the better answer. Either way it is a decision, not a
cleanup task, and the dashboard's Latest Log reads the same ledger so it resolves in both
places at once.

---

## 2. "Move project" on the Projects row menu — never existed, needs a product call

Reported as a regression. It is not one. `"Move project"` appears only on the People page
row menu; the Projects page passes its row-actions component nothing but Edit and Delete,
and has since the row menus were introduced. Traced through the three commits that built
them — one commit *message* claims both People and Projects got the item, and the code at
that revision shows only People did.

"Move project" moves a **person** between jobs, and their tools follow. The equivalent for
a project row would be "move this project into a job group", which is a different action
against a different table — project-to-group membership is many-to-many and is managed
only on the Job Groups page today.

**The decision:** should a project row offer "move to job group"? If yes it is a small new
feature (a `projectGroup` mutation plus a picker), not a revert. If no, close it and
correct the test-case expectation — the same QA pass has an earlier row that expects
*only* Edit and Delete on Projects, and marks it Pass.

---

## 3. Bulk category / department edit is shipped and undiscoverable

Reported as "bulk edit option not available". The feature is on `main`. The tool
register's selection bar renders a **"Re-file…"** button for any caller holding
`asset.manage`, opening a dialog that writes category and department across the whole
selection in one call.

The tester saw "Move", "Return to yard" and "Clear" — the same bar, minus the one button
they were looking for. That is a labelling problem: "Re-file…" does not read as "bulk edit
of category and department" to someone who has not seen it before.

**No engineering fix.** Design decides the wording, then re-test — after item 4, because
the environment may also predate the feature.

---

## 4. The test environment is running behind, and it invalidates part of the pass

The tester saw two strings that are dead code as of 2026-08-09: the transfer status
**"Pending Verification"**, which no writer produces and which migration `0023` cancels,
and the ledger note **"Lent, awaiting equipment desk"**, which no longer appears anywhere
in the source.

Seeing either means that database has not had `0023`, or that build has not been deployed.
The same gap explains the empty Departments reports — the seed does carry departments, so
zero rows means the environment was seeded before they were added and deploys never
re-seed. It is also the likely explanation for the batch of "demo account cannot sign in"
reports, which are not code defects.

**Action, and it belongs before the next QA pass:** deploy current `main`, run migrations,
re-seed. Several findings and blocked rows resolve themselves.

---

## What the QA report got wrong

Recorded so the next reader does not inherit the errors:

- **The `bugs-fixing` branch does not exist.** The report's first recommendation is to
  land a patch from it. See item 1.
- **"Pending Verification is retained in `packages/types` only"** — it is also in the web
  and mobile status-colour maps. The conclusion (it is kept so historical rows still
  render) is right; the fact is not.
- **The executive summary does not add up.** "The 9 that do not [pass] resolve to three
  application findings and four rows blocked" — 3 + 4 is 7, and the 9 it names are
  re-confirmations, which are a subset of the passes rather than failures.

What it got right is everything that mattered: all three findings hold, and every commit
hash it cites resolves to the subject line it claims.

## Out of scope

- **Rows blocked on Jira configuration** — sprint setup, space-admin permission, the
  Deployments panel integration. Not application defects and not tracked here.
- **The warranty-expiry display bugs.** This pass did not exercise them, so it neither
  confirms nor challenges them; their fix is on `main` and they want a dedicated re-test.

## Files

- `packages/api-contracts/src/routers/transfer.ts` — `create`, the check and the transaction
- `packages/api-contracts/src/custody.ts` — the lock discipline to copy
- `packages/db/drizzle/` — the new partial index, via `make generate`
- `apps/web/app/(app)/projects/page.tsx` — item 2, if the answer is yes
- `apps/web/app/(app)/tools/page.tsx` — item 3, the "Re-file…" label

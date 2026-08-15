# Reconciliation — why the two assessment documents disagree

Written 2026-08-09 to settle the conflict between
[docs/KILO_DELIVERY_ASSESSMENT.md](docs/KILO_DELIVERY_ASSESSMENT.md) and
[docs/DELIVERY_ASSESSMENT_VERIFICATION.md](docs/DELIVERY_ASSESSMENT_VERIFICATION.md). Neither file
is edited by this one.

---

## 1. The conflict is not Claude versus Kilo

There is **no Kilo-authored assessment in this repository.** Searched: the whole tree by filename
(`*assess*`, `*delivery*`, `*status*report*`), the `.kilo/` directory including its plans and its
`berry-text` worktree, and the full git history across all branches for any such file ever added.
The only two results are the two files named above, and both are untracked.

Both were written by Claude in the same session:

| File | Bytes | What it is |
|---|---|---|
| `docs/KILO_DELIVERY_ASSESSMENT.md` | 31,173 | The original assessment. Written as `docs/DELIVERY_ASSESSMENT.md`, then renamed twice — to `CLAUDE_…` on request, then to `KILO_…` outside this session. The bytes never changed. |
| `docs/DELIVERY_ASSESSMENT_VERIFICATION.md` | 6,667 | A later pass that re-checked the first file against the codebase and found errors in it. |

So the disagreement is between a draft and its own correction, not between two tools. The `KILO_`
prefix on the filename is a rename; it does not indicate authorship. If Kilo produced its own
assessment, it is somewhere outside this repository — send it over and this document can be
extended into a genuine three-way comparison.

**The verification file is the correct one where the two differ.** It was produced by recomputing
each claim from the repository rather than by re-reading the draft.

---

## 2. Every point of conflict, and why it arose

There are exactly three, and they are all mine.

### 2.1 Schema file count — 15 versus 14

**Correct: 14.** `ls packages/db/src/schema/*.ts` returns 14 files: asset, audit, catalog,
department, employee, event, identity, index, location, messaging, project, projectGroup, rental,
task. One of those (`index.ts`) is a re-export barrel, so the number of files defining tables is 13.

Cause: counted from a directory listing without excluding the barrel, and miscounted by one on top
of that.

### 2.2 Test suite — "6 packages, 100 tests" versus 139 tests

**Correct: 139 tests, 9 files, 5 packages.**

| Package | Files | Tests |
|---|---|---|
| `@stinventory/domain` | 3 | 40 |
| `@stinventory/intent` | 2 | 40 |
| `@stinventory/types` | 2 | 35 |
| `@stinventory/api-contracts` | 1 | 16 |
| `@stinventory/auth` | 1 | 8 |
| **Total** | **9** | **139** |

Cause: the first run was read from the tail of the output, which had scrolled past the `intent`
(40) and `types` (35) results. "6 packages" came from Turbo reporting `6 successful` — that counts
the root task alongside the 5 packages that actually have a `test` script.

This error ran in the direction of understating the work. It does not change the *character* of
the suite, which is the part the assessment relied on: all 139 are pure-function unit tests, and
`apps/api` and `apps/web` have no `test` script at all, so nothing exercises a database, a router
or a rendered screen.

### 2.3 Line-number citations — eight anchors point at the wrong lines

**Correct anchors are listed in section 4 of the verification file.** Examples: the ledger table
cited as `schema/event.ts:144` is at `:8`; the partial unique index cited as
`schema/employee.ts:567` is at `:102`.

Cause: those files were originally read through a shell loop that concatenated several files into
one stream, so the numbers recorded are offsets into that combined output rather than into each
file. The claims were re-confirmed at the corrected lines and every one of them held.

---

## 3. What is not in conflict

The two documents agree on everything that determines status, sizing or price. The verification
re-tested the load-bearing findings and each one held:

| Finding | Status after re-check |
|---|---|
| Six custody procedures (`transfer.approve` / `verify` / `decline`, `assignment.approve` / `decline` / `return`) have no caller in either app | Confirmed under a broader search than the original — the one textual hit is a prose comment in [alerts.tsx:121](apps/mobile/app/(tabs)/alerts.tsx#L121), not a call |
| Custody writes are not wrapped in a database transaction | Confirmed |
| The one-active-assignment invariant has no database constraint | Confirmed |
| An assignment cannot record truck and trailer — one `locationId` | Confirmed |
| `dashboard.kpis` never calls `visibleProjectScope` | Confirmed |
| No user administration exists anywhere | Confirmed — zero inserts to `user` or `user_role` outside the seed |
| Engineer absent as a role; Mechanic is a custodian role only | Confirmed |
| No React error boundaries | Confirmed |
| Notification delivery is a `console.log` that then marks rows delivered | Confirmed |
| Migrations 0010 and 0011 are uncommitted | Confirmed |
| 12 migrations | Confirmed |
| All 50 cited file paths exist | Confirmed |

**No area's rubric status changes. The completion figure of 63.6% is unaffected** — the two numeric
errors are descriptive text, not inputs to the arithmetic. All 31 gap tasks stand.

No claim was found to be more generous than its evidence. The single direction of error was
understating the test count.

---

## 4. The authoritative numbers

Use these; they supersede both files where they differ.

| Fact | Value |
|---|---|
| Schema files | 14 (13 table modules + 1 barrel) |
| Migrations | 12 |
| Tests | 139, in 9 files, across 5 packages |
| Packages with a test script | 5 — `apps/api` and `apps/web` have none |
| Report registry entries | 13 |
| Login roles defined | 10, of which 5 of the 7 required roles are covered |
| Cited paths that resolve | 50 of 50 |
| Custody procedures with no UI caller | 6 |
| Completion | 63.6% (121 of 190 points) |

---

## 5. What to do with the files

1. Treat `docs/KILO_DELIVERY_ASSESSMENT.md` as the assessment of record, with the three corrections
   in section 2 applied. Its findings, sizing and phases are unchanged.
2. Fix the eight line anchors before handing it to a developer who will navigate by them.
3. Consider renaming it away from the `KILO_` prefix, since that implies an authorship that is not
   accurate. That is your call and I have not touched it.
4. If a real Kilo assessment exists outside this repository, send it and this document can be
   extended to compare the two properly — that comparison would be worth having before the estimate
   goes out, since two independent reads landing on different completion figures is exactly the
   disagreement worth resolving early.

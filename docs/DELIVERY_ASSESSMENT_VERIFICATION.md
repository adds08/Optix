# Verification of KILO_DELIVERY_ASSESSMENT.md

Independent re-check of every citation and countable claim in
[docs/KILO_DELIVERY_ASSESSMENT.md](docs/KILO_DELIVERY_ASSESSMENT.md), run 2026-08-09 against the
same working tree on `main`. Nothing was renamed and the assessment itself was not edited; the
corrections below are recorded here so the two files can be read side by side.

Method: every markdown link target was extracted and tested for existence; every line-number
citation was resolved with `sed -n`; every countable claim was recomputed from the repository;
the test suite was re-run.

**Status: all corrections below were applied to the assessment on 2026-08-09.** The two numbers
and the eight line anchors are now correct in that file. This document is kept as the audit
trail — the "Cited as" column records what the assessment said before the fix, not what it says
now.

---

## 1. Cited file paths

50 unique paths are cited. **All 50 exist.** The four route-group paths containing `(app)` were
checked separately because parentheses break naive link extraction:

| Path | Exists |
|---|---|
| `apps/web/app/(app)/custody/page.tsx` | yes |
| `apps/web/app/(app)/inbox/page.tsx` | yes |
| `apps/web/app/(app)/reports/registry.ts` | yes |
| `apps/mobile/app/action/[type].tsx` | yes |

No broken path citations.

---

## 2. The central claim — the desk queue has no caller

Re-tested by searching the literal procedure names across all of `apps/web` and `apps/mobile`
source, excluding build output (`.next`, `.expo`). This is broader than the original check, which
only enumerated `useMutation` and `client.*.mutate` call sites.

| Procedure | Hits in app source | Verdict |
|---|---|---|
| `transfer.approve` | 1 | **Confirmed** — the single hit is a prose comment in [alerts.tsx:121](apps/mobile/app/(tabs)/alerts.tsx#L121) explaining that a foreman does *not* hold this permission. Not a call site. |
| `transfer.verify` | 0 | Confirmed |
| `transfer.decline` | 0 | Confirmed |
| `assignment.approve` | 0 | Confirmed |
| `assignment.decline` | 0 | Confirmed |
| `assignment.return` | 0 | Confirmed |

The finding stands: six custody procedures exist on the server and no screen in either app can
invoke them.

---

## 3. Countable claims

| Claim as stated | Actual | Verdict |
|---|---|---|
| 12 migrations | 12 `.sql` files in `packages/db/drizzle/` | Correct |
| Schema is "15 files" | **14** `.ts` files (13 table modules plus `index.ts` barrel) | **Wrong — off by one** |
| Test suite: "6 packages, 100 tests" | **139 tests, 9 files, 5 packages.** domain 40, intent 40, types 35, api-contracts 16, auth 8. Turbo reports 6 successful *tasks* because it counts the root task. | **Wrong — undercounted by 39** |
| No React error boundaries | 0 `error.tsx` / `global-error.tsx` under `apps/web/app` | Correct |
| No user CRUD | 0 inserts to `schema.user` or `schema.userRole` outside the seed | Correct |
| Only 5 of 7 required roles are login roles | `ROLES` has 10 entries; Engineer absent, Mechanic present only in `EMPLOYEE_ROLES` / `CUSTODIAN_ROLES` | Correct |
| `dashboard.kpis` ignores project scope | 0 references to `visibleProjectScope` inside the `kpis` procedure | Correct |
| Custody writes are not transactional | 0 `db.transaction` inside `transfer.create` | Correct |
| Import commit is transactional | 1 `db.transaction` wrapping the commit | Correct |
| Migrations 0010/0011 uncommitted | 4 untracked files plus a modified `_journal.json` | Correct |
| Report registry drives "10+ report pages" | 13 entries | Correct, though imprecise — say 13 |
| All tests are pure-function unit tests | `apps/api` and `apps/web` have **no `test` script at all**; only the 5 library packages do | Correct, and stronger than stated |

---

## 4. Line-number corrections

Eight citations point at the wrong line. The cause is mechanical: those files were originally read
through concatenated output, so the numbers are offsets into the combined stream rather than into
the individual file. **The underlying claims are all correct — only the anchors are wrong.**

| Cited as | Should be | What is actually there |
|---|---|---|
| `schema/asset.ts:90` (assignment `locationId`) | **104** | `locationId: uuid("location_id")` on `assignment` |
| `schema/asset.ts:82-106` (assignment table) | **96-120** | `export const assignment = pgTable(` |
| `schema/asset.ts:24-31` (vestigial catalog) | **37-39** | `modelId` and the "Vestigial" comment |
| `schema/event.ts:144` / `:142` (ledger) | **8** / **6** | `export const transaction = pgTable(` and the append-only comment |
| `schema/event.ts:198` (`overdueEscalateAfterDays`) | **62** | the column |
| `schema/employee.ts:567` (`ptm_one_active_uq`) | **102** | the partial unique index |
| `schema/location.ts:445-448` (vehicle mirror) | **60** | the "NOTE: mirrors location.custodianEmployeeId" comment |
| `custody.ts:41` (duplicates exist) | **39** | "duplicates already exist in the wild" |
| `routers/asset.ts:441` (`rebuild`) | **443** | `rebuild: requirePermission("asset.manage")` |
| `notify.ts:35` (`notifyCustodyDecision`) | **32** | the function |
| `dashboard.ts:85` (`roleName === "foreman"`) | **86** and **135** | two occurrences, not one |
| `transfer-form.tsx:78` (Inbox message) | **79** | the "approves it in the Inbox" string |
| `notifications.ts:186-206` (delivery stub) | **195-210** | `deliverPendingNotifications`, the two `console.log`s, and `deliveredAt` |

Citations verified as **correct where stated**: `trpc.ts:38`, `enums.ts:41`, `rental.ts:25`,
`auth/index.ts:45`, `inbox.ts:213`, `import.ts:273`, `category.ts:139`, `seed.ts:51`,
`transfer.ts:79`, `transfer.ts:297`, `notifications.ts:110`, `report.ts:42`, `report-table.tsx:78`.

---

## 5. Net effect

| Question | Answer |
|---|---|
| Does any area's rubric status change? | No. Every status-bearing finding re-verified as correct. |
| Does the completion percentage change? | No. The two numeric errors are descriptive, not inputs to the arithmetic. The 139-test suite was credited at 4 points for its *character* — pure-function unit tests with nothing touching a database, router or screen — which the recount confirms rather than contradicts. |
| Does the gap list change? | No. All 31 tasks rest on claims that held. |
| Is anything overstated? | No claim was found to be more generous than the evidence supports. The one direction of error is the test count, which was understated. |

**Two corrections to carry into the client-facing summary and any costing:** the schema is 14
files, not 15, and the test suite is 139 tests across 9 files in 5 packages, not 100 across 6.
Neither changes what the system can or cannot do today.

The line-number drift should be fixed before this document is handed to a developer who will
navigate by it, since eight anchors will land in the wrong place. The claims those anchors support
were each re-confirmed against the correct lines above.

# Technical Assessment — Summary

**System:** STInventory / **Optix** — small-tools custody tracking
**Client:** Urban Infraconstruction LLC (single tenant today; multi-tenant by design)
**Date:** 2026-09-12
**Scope:** 84,515 lines across 3 apps and 12 packages
**Assessed by:** direct code read, live database queries, full test-suite execution

> ## ⚠ THIS IS A DATED SNAPSHOT OF 2026-09-12 — NOT CURRENT STATE
>
> Read it as a record of what was true on that date. Several defects it lists as
> open, CONFIRMED or "not started" were **fixed on 2026-09-14**. Check the code
> before acting on anything here.
>
> **Closed since this was written:**
>
> | Was reported as | Now |
> |---|---|
> | `can_hold_custody` read by nothing; "the settings screen lies" | Fixed, `b99b84f`. All six pickers read the column through `apps/web/lib/custodians.ts`; the constant is a fallback only. Note the fix took the LOGIN ROLE's column, not the tier's — the opposite of what `07-custody-eligibility-audit.md` recommends. |
> | No CHECK constraints; DB accepts any string | Fixed, `35740a5` + `afdeb77`. 23 constraints across 14 tables. `pgEnum` is still 0, which was always deliberate. |
> | BambooHR sync sets no login role; "everyone lands as `crew`" | Fixed, `fe96fa8`. `company_role.default_role_id` (migration 0071) plus `/settings/job-titles`. Unmapped means **NULL / no opinion**, not `crew`. |
> | The overdue-loan setting | Deleted, `a50c46d` (migration 0070), with two sibling SLA columns. |
> | `task.approve` has no screen | Was never true — the inbox's "Do it" always called the same executor. A "With a note" button was added, `d2b0f8f`. |
> | Unscoped tenant lookups in `notifications.ts` / `notify.ts`; three non-transactional multi-writes; `resolveByName` N+1 | All fixed, verified 2026-09-14. |
> | 713 tests / 69 migrations / 24 unique indexes | 756 tests, 73 migrations, 34 unique indexes. |
>
> **Still open**, re-verified 2026-09-14: `messaging.ts` `from "message"` (a real
> 500), `db: any` in `location.ts`, the jobsites loading check, and
> `data-table.tsx` CSV export reading the post-pagination model.
>
> **Files it cites that no longer exist:** `seed.ts`, `seed-data*.ts` (deleted
> 2026-09-13). Recover with `git show bd98798:<path>`. The local database it
> queried as `stinventory` is now `optix`.

---

---

## Verdict

**The system is technically sound. It did not fail for technical reasons.**

Measured, not asserted:

| Check | Result |
|---|---|
| Typecheck | **13/13 packages clean** |
| Test suite | **713 passing, 0 failing** (with DB suites actually running) |
| Custody invariant (live data, 762 assets) | **0 violations** |
| Projection vs ledger agreement | **exact — 0 divergences** |
| Exploitable cross-tenant reads | **none found** |
| Authorization gaps | **none — build-enforced** |
| `any` / `@ts-ignore` in web app | **zero** |
| Migration drift | **none** (`drizzle-kit check` clean) |

The custody chokepoint, the append-only ledger with its shape-boundary rule, the
reconciler that *reports* divergence rather than silently repairing it, and the
RBAC matrix that fails the build on an ungated mutation are all better than
industry norm. The code comments explain *why* decisions were made, including
documenting bugs that previously shipped.

**What actually failed is data completeness and product legibility, not engineering.**

---

## The three real problems

### 1. The org hierarchy is empty (HIGH — the root cause)

**100% of Urban's 81 real employee records carry `reportsTo: null`**
(`seed-data.urban.ts:76-159`). In the live database, 43 of 45 active employees
have no manager. 17 of 31 project-team rows have no on-job reporting line.

The column exists, the FK exists, the index exists, and the reading code exists.
**The data was never captured** — it came from BambooHR, a screenshot, and two
Excel files, none of which carried a reporting line, and ambiguous rows were
dropped during extraction.

Everything downstream is starved: the org chart has no edges, crew scoping cannot
resolve, `departure.ts` cannot suggest a successor, and no approval can walk
upward. This is the concrete form of the stated requirement *"we need a way to
make who is under or reportsTo whom."*

### 2. The model is more precise than its users (HIGH)

A person's role is modelled on **three separate axes**, and the code is explicit
that this is deliberate:

| Axis | Where | Example |
|---|---|---|
| Employment | `EMPLOYEE_ROLES` | `foreman`, `pm` |
| Authorisation | `ROLES` + permission matrix | `project_manager` |
| Team tier | `tbl_entity_team_role` + ladder | per-project |

Each axis is correct. None of them exist in a superintendent's head. Telling a PM
"your employee role is `pm`, your login role is `project_manager`, and your tier
on job 412 is `superintendent`" loses them — and they conclude the *system* is
confused.

This is why features are "very hard to explain." **It is a presentation problem,
not a modelling problem. Do not collapse the axes — hide them.** One word per
person on screen, the word they would use for themselves.

### 3. The requirements feedback loop is broken (HIGH)

Rentals, loans, and foreman-to-foreman hand-offs were **built from data files and
then deleted** after the client saw them. Nobody said "we don't rent" — it was
discovered by building it.

Requirements came from artifacts, not people. That loop is still broken: the
workforce cannot be assembled to correct it.

**The system already contains the answer.** `tbl_ops_project_role_deferral` —
*"a tier somebody deliberately left for their boss to fill"* — is exactly the
right pattern. Generalize it: show each supervisor their own pre-filled crew with
confidence flagged, and let them confirm or correct it asynchronously. Five
minutes each, forty people, no room booking. That single flow fixes the org data
(problem 1), is demoable, and repairs the feedback loop.

---

## Defects worth fixing, ranked

Full detail in the per-layer documents. Highest-value first:

| # | Defect | Layer | Effort |
|---|---|---|---|
| 1 | Chat pagination throws a 500 — `messaging.ts:95` queries a table renamed in migration 0029 | API | 1 line |
| 2 | Jobsites renders **confidently wrong data** when `employee.list` fails (no query guard) | Web | ~5 lines |
| 3 | 140 form labels not associated with their input; no `ui/label.tsx` exists | Web | mechanical |
| 4 | Four multi-write mutations can half-commit; `projectGroup.create` silently narrows PM visibility | API | ~1 day |
| 5 | `bamboo-sync` N+1: ~2,000–4,000 round-trips for a 500-person roster | API | ~10× win, few lines |
| 6 | Two entity resolvers disagree — AI assistant and `@` picker give different answers | API | ~½ day |
| 7 | `can_hold_custody` is editable in Settings but read from a compile-time constant in 6 components — **the settings screen lies** | Web+API | 1 day to wire, 30 min to remove |
| 8 | Two unscoped lookups (`notifications.ts:92`, `notify.ts:41`) — not exploitable today | API | few chars |
| 9 | No CHECK constraints / `pgEnum` — DB accepts any string in status columns | DB | ~½ day |

Items 1–3 are small, high-value, and independent. Item 7 needs a product decision
first: *will Urban ever add a custodian role beyond foreman / superintendent /
mechanic?* If not, **remove the toggle** — a screen that cannot lie beats a screen
that works.

---

## Corrections to previously-held beliefs

Two claims in circulation did not survive verification:

**The procedure count was wrong.** Not 86 — **168 procedures across 29 routers**.
The earlier grep missed every procedure declared via the `requirePermission()`
wrapper. The four routers believed to have zero procedures have 16 between them.
Nothing is stubbed or misfiled.

**The CSV export bug does not exist.** The v1.0.0 known-issues list states the
register "exports one page." It does not — `tools/page.tsx:405` exports the
complete unpaginated set. The underlying defect in `data-table.tsx:460` is real
but **currently unreachable**, because the register never renders that button.
**The CHANGELOG should be corrected rather than the register "fixed."**

The second correction has a broader implication: **the v1.0.0 known-issues list
cannot be used as a work list without verifying each item against the code
first.** At least one of seven entries is stale.

---

## What this assessment cannot tell you

Stated plainly, because acting on these as if they were settled would be wrong:

1. **Whether production matches dev.** Every live query above ran against the
   local dev database. `custody.ts` notes explicitly that *"production has not
   been checked"* for pre-index duplicate custody rows. **The same queries should
   be run against production before any claim is made about it.** This is the
   single highest-value next action and it is a script, not a project.

2. **Whether the register is complete.** The integrity checks prove *internal
   consistency* — ledger and projection agree exactly. They cannot prove that 762
   assets is the right number, or that rows dropped as ambiguous during
   extraction were not real tools. That needs reconciliation against Urban's
   source files.

3. **Whether users can actually use it.** No usability testing was performed.
   Given that "features are very hard to explain" is the stated launch problem,
   this is a significant gap that code analysis cannot close.

---

## Layer documents

- [`01-api.md`](01-api.md) — API & contracts (168 procedures, tenant isolation analysis)
- [`02-database.md`](02-database.md) — schema, migrations, live data integrity
- [`03-auth-security.md`](03-auth-security.md) — auth, sessions, cryptography
- [`04-web.md`](04-web.md) — Next.js app, 34k lines

**Not yet assessed:** `apps/mobile` (2,285 lines), `packages/intent` (the AI/chat
layer, 1,111 lines), `packages/domain` beyond `fold.ts`, and the import pipeline.

---

## Recommended sequence

1. **Run the integrity queries against production.** Nothing else can be
   concluded about production data until this exists. One script.
2. **Fix defects 1–3.** Small, independent, each removes a real failure.
3. **Decide the `can_hold_custody` question** (defect 7) — wire it or remove it.
4. **Design the async crew-confirmation flow.** Fixes the org data, the feedback
   loop, and gives the client something to see, all at once.
5. **Collapse role vocabulary in the UI** — one word per person.

Everything else — Fastify, RLS, multi-tenant work, the `index.ts` split — sits
below this line. **None of it is why the launch failed.**

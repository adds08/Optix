# Delivery Assessment — STInventory

Assessed 2026-08-09 against the working tree on `main`. Every claim below cites the file it
came from. Scope is the eight areas named in the assessment brief; the conversational layer
(`packages/intent`, `routers/messaging.ts`, `routers/task.ts`, `routers/inbox.ts`, the mobile
chat screens) is substantial built work that the brief does not name, and is excluded from the
completion arithmetic in section E — see section G.

Test suite state: `pnpm test` passes: 139 tests across 9 files in 5 packages, all green. All of them are pure-function
unit tests; there is no test that touches a database, a router or a rendered screen.

---

## A. Inventory

| Area | Status | Evidence | What was actually found |
|---|---|---|---|
| 1. Foundation | `FUNCTIONAL` | [packages/db/src/schema/](packages/db/src/schema/) (14 files), [packages/db/drizzle/](packages/db/drizzle/) (12 migrations), [.github/workflows/ci.yml](.github/workflows/ci.yml), [docker-compose.prod.yml](docker-compose.prod.yml), [packages/env/src/server.ts](packages/env/src/server.ts) | Real event-sourced schema with indexes and FK actions. CI runs typecheck, tests, builds both production images, migrates a fresh Postgres and boots the API against it, then deploys with a health check and rollback. Env validation refuses known example secrets in production. Held back from `COMPLETE` by uncommitted migrations and a non-blocking lint step. |
| 2. Access control | `PARTIAL` | [packages/auth/src/index.ts](packages/auth/src/index.ts), [packages/api-contracts/src/trpc.ts:38](packages/api-contracts/src/trpc.ts#L38), [packages/db/src/seed.ts:51-116](packages/db/src/seed.ts#L51-L116), [packages/types/src/index.ts:32-43](packages/types/src/index.ts#L32-L43), [packages/api-contracts/src/scope.ts](packages/api-contracts/src/scope.ts) | bcrypt cost 12 with transparent rehash, 32-byte session tokens, login rate limiting, a permission table and a `requirePermission` gate used consistently. But only 5 of the 7 required roles exist as login roles — **Engineer is absent entirely, Mechanic exists only as a custodian role** ([enums.ts:41](packages/types/src/enums.ts#L41)) with no login role or permission set. There is **no user administration anywhere**: no `user.create`, no role assignment, no deactivation, no password reset. Accounts exist only because the seed made them. |
| 3. Master data | `PARTIAL` | [routers/asset.ts](packages/api-contracts/src/routers/asset.ts), [routers/category.ts](packages/api-contracts/src/routers/category.ts), [routers/project.ts](packages/api-contracts/src/routers/project.ts), [routers/location.ts](packages/api-contracts/src/routers/location.ts), [routers/rental.ts:25](packages/api-contracts/src/routers/rental.ts#L25) | Tools, categories, projects, employees, locations, trucks and trailers all have full create/update/delete with permission gates and web forms. Vendors are **read-only** — `rental.vendors` is a query, and rows arrive only via the rental import. Users have no CRUD at all (see area 2). |
| 4. Custody engine | `PARTIAL` | [custody.ts](packages/api-contracts/src/custody.ts), [routers/transfer.ts](packages/api-contracts/src/routers/transfer.ts), [routers/assignment.ts](packages/api-contracts/src/routers/assignment.ts), [packages/domain/src/fold.ts](packages/domain/src/fold.ts), [schema/event.ts:8](packages/db/src/schema/event.ts#L8) | The best-designed part of the codebase and still `PARTIAL`, for three independent reasons. (a) **`transfer.approve`, `transfer.verify`, `transfer.decline`, `assignment.approve`, `assignment.decline` and `assignment.return` have no caller in either app** — verified across both `useMutation` and direct `client.*.mutate` call styles. A held transfer is displayed on the dashboard and links to [custody/page.tsx](apps/web/app/(app)/custody/page.tsx), which is a read-only table. The queue is a dead end. (b) There is **no recipient accept/reject**; the built model is desk verification, and the receiving foreman is never asked. (c) An assignment carries one `locationId` ([schema/asset.ts:104](packages/db/src/schema/asset.ts#L104)), so it cannot record the truck *and* the trailer the brief requires. |
| 5. Spreadsheet import | `FUNCTIONAL` | [routers/import.ts](packages/api-contracts/src/routers/import.ts), [components/import-dialog.tsx](apps/web/components/import-dialog.tsx), [packages/types/src/import-specs.ts](packages/types/src/import-specs.ts) | Genuinely complete work. CSV and `.xlsx`/`.xls` via SheetJS, per-column typed validation, name→id reference resolution loaded once per import, duplicate detection both within the file and against the database, a preview that re-runs server-side, all-or-nothing commit inside one DB transaction, per-entity permission gates, and an opening ledger event for every imported tool. Not `COMPLETE`: zero tests, no import history, no undo. |
| 6. KPI dashboard | `FUNCTIONAL` | [routers/dashboard.ts](packages/api-contracts/src/routers/dashboard.ts), [routers/report.ts](packages/api-contracts/src/routers/report.ts), [reports/registry.ts](apps/web/app/(app)/reports/registry.ts), [components/sti/report-table.tsx:78](apps/web/components/sti/report-table.tsx#L78) | Counts by status, foreman, project, mechanic, in-repair, idle, lost and overdue; a clearance queue; charts; a report registry driving 10+ report pages; CSV export on the report table and the tools page; filtering via a shared DataTable with saved filters and job scoping. The defect that keeps it off `COMPLETE` is in section C: `dashboard.kpis` ignores project scope entirely. |
| 7. Notifications | `PARTIAL` | [apps/api/src/notifications.ts](apps/api/src/notifications.ts), [packages/api-contracts/src/notify.ts](packages/api-contracts/src/notify.ts), [routers/notification.ts](packages/api-contracts/src/routers/notification.ts) | Overdue-loan detection runs on an interval and de-duplicates against unread alerts; custody approve/decline notifies the requester, the sender and the recipient. Two holes. **Pending transfer raises no notification** — `transfer.create` writes no notification row, so the desk learns of a waiting hand-off only by polling a dashboard widget. And **delivery is a stub**: [notifications.ts:195-210](apps/api/src/notifications.ts#L195-L210) `console.log`s where SMTP and Twilio should be, then marks the row delivered. |
| 8. Production readiness | `PARTIAL` | [.github/workflows/ci.yml](.github/workflows/ci.yml), [apps/api/src/rate-limit.ts](apps/api/src/rate-limit.ts), [components/sti/page.tsx](apps/web/components/sti/page.tsx), test run above | Loading, empty and error states are used consistently across pages (`TableSkeleton`, `EmptyState`, `ErrorNote`), zod validates every mutation input, and the deploy path has a health check and rollback. Against that: **no React error boundaries anywhere** (no `error.tsx`, no `global-error.tsx` under [apps/web/app/](apps/web/app/)), no integration or E2E test of any kind, lint set to `continue-on-error` in CI, and an in-memory rate limiter that resets on restart. |

---

## B. Gap list

| # | Task | Area | Why it's needed | Depends on | Risk |
|---|---|---|---|---|---|
| C1 | Build the desk queue screen: approve, verify, decline, with the borrow/held distinction visible | Custody | The three procedures exist and no screen calls them. Today a held transfer can be raised and never actioned. | — | `RISK` — the transfer form already tells the user to go to the Inbox ([transfer-form.tsx:79](apps/web/components/transfer-form.tsx#L79)), and the Inbox only handles tasks and messages ([inbox.ts:213](packages/api-contracts/src/routers/inbox.ts#L213)). Decide where this lives before building it. |
| C2 | Recipient accept/reject: `transfer.accept` / `transfer.reject` plus the field screen | Custody | The brief requires foreman-to-foreman accept/reject. The built model asks the desk, never the recipient. | C1 | `RISK` — a new state between `pending_verification` and `completed` touches every custody status reader. |
| C3 | Wrap each custody write in a single `db.transaction` | Custody | Asset update, `moveCustody` and the ledger insert are three separate statements. A crash between them leaves the projection and the ledger disagreeing. | — | `RISK` — touches the core write path. |
| C4 | Partial unique index for one active assignment per asset, plus a backfill of existing duplicates | Custody | The invariant is enforced only in code, and [custody.ts:39](packages/api-contracts/src/custody.ts#L39) states duplicates already exist in the wild. | C3 | `RISK` — the backfill has to choose which duplicate survives; that is a per-row judgement, not a script. |
| C5 | Truck and trailer as first-class fields on assignment and transfer | Custody | One `locationId` cannot hold both, and the brief requires both on every assignment. | C3 | `RISK` — schema change plus every ledger snapshot and every `locationId` reader. |
| C6 | Make the ledger append-only at the database level | Custody | `transaction` is append-only by comment only ([event.ts:142](packages/db/src/schema/event.ts#L6)); nothing stops an UPDATE. | — | |
| C7 | Projection rebuild verification: fold the ledger, diff against `current_*`, report divergence | Custody | `asset.rebuild` exists but nothing routinely proves the projection matches the ledger. | C3, C4 | |
| C8 | Custody router integration tests against a real Postgres | Custody | Every custody test today is a pure function. No test exercises a router. | C1, C3 | |
| A1 | Add `mechanic` and `engineer` login roles with permission sets | Access | Two of the seven required roles cannot log in. | — | `RISK` — nobody has defined what an Engineer may do. |
| A2 | User administration: create, deactivate, assign role, reset password | Access | No way to onboard a user without running the seed. | A1 | |
| A3 | Tenant-scope the login lookup; unique index on (tenant, email) | Access | [auth/index.ts:45](packages/auth/src/index.ts#L45) looks up by email alone. | — | |
| A4 | Replace `roleName === "foreman"` scoping with permission checks | Access | [dashboard.ts:86](packages/api-contracts/src/routers/dashboard.ts#L86) branches on a role string; renaming a role silently widens access. | A1 | |
| A5 | RBAC matrix test across all seven roles | Access | Permissions are asserted nowhere. | A1, A2 | |
| M1 | Vendor CRUD | Master data | Vendors are read-only and arrive only via import. | — | |
| M2 | Validation and error-surfacing parity pass across the master-data forms | Master data | Server validation is solid; several forms surface failures as raw text. | — | |
| I1 | Import tests: validator cases plus commit rollback | Import | The most data-destructive path has no test. | — | |
| I2 | Import history and undo | Import | No record of who imported what, and no way back. | I1 | `RISK` — undo must be compensating events, not deletes, or it breaks the append-only ledger. |
| D1 | Apply `visibleProjectScope` to dashboard KPIs and reports | Dashboard | `dashboard.kpis` is tenant-wide; a scoped user sees counts for jobs they cannot open. | — | `RISK` — changes what current users see; expect "the numbers dropped" questions. |
| D2 | Counts-by-location KPI and filter | Dashboard | The brief names it; by-project and by-foreman exist, by-location does not. | — | |
| D3 | Server-side CSV export for large reports | Dashboard | Export runs client-side over already-fetched rows, so it exports the page, not the report. | — | |
| N1 | Notify the desk when a transfer or assignment goes pending | Notifications | The brief names pending-transfer notification; none is written. | — | |
| N2 | Real SMTP and SMS delivery | Notifications | Delivery is a `console.log` that marks rows delivered. | — | `RISK` — needs credentials from Urban. |
| N3 | Overdue escalation using `overdueEscalateAfterDays` | Notifications | The setting exists in [event.ts:198](packages/db/src/schema/event.ts#L62) and nothing reads it. | N2 | |
| N4 | Push notification for the field app | Notifications | A foreman does not poll a web page in a truck. | N1, C2 | `RISK` — needs Expo credentials and store accounts. |
| P1 | Route-level error boundaries | Production | A thrown render error blanks the app. | — | |
| P2 | Replace bare `throw new Error` with typed `TRPCError` | Production | [transfer.ts:60,188,311](packages/api-contracts/src/routers/transfer.ts#L60) and others surface as opaque 500s. | — | |
| P3 | E2E smoke: login → assign → transfer → verify → report | Production | Nothing proves the whole flow works. | C1, C2 | `RISK` — this is where latent bugs from earlier phases surface. |
| P4 | Make lint blocking; clear the `any` usage in apps/api | Production | `continue-on-error` makes the step decorative, as the workflow comment admits. | — | `RISK` — may expose real type errors behind the `any`s. |
| P5 | Redis-backed rate limiter | Production | In-memory limiter resets on restart and does not survive a second instance. | — | |
| P6 | Commit migrations 0010/0011 and add a migration-drift CI check | Production | Both migrations, both snapshots and the journal edit are untracked in git. Production has not received them. | — | `RISK` — the deployed build may not match `main`. |
| P7 | Backup and restore runbook, with a verified restore | Production | No documented restore for the system of record. | — | |

---

## C. Technical debt

Custody-trail items first, since an unreliable trail defeats the purpose of the system.

| # | Debt | Evidence | Why it matters |
|---|---|---|---|
| 1 | **Custody writes are not atomic.** Asset projection update, `moveCustody` and the ledger insert are three consecutive un-wrapped statements. | [transfer.ts:122-177](packages/api-contracts/src/routers/transfer.ts#L122-L177), [assignment.ts:110-145](packages/api-contracts/src/routers/assignment.ts#L110-L145) | A failure partway leaves the register saying one thing and the ledger another, with nothing to detect it. Import gets this right ([import.ts:273](packages/api-contracts/src/routers/import.ts#L273)) — custody does not. |
| 2 | **The one-active-assignment invariant has no database constraint.** | [schema/asset.ts:96-120](packages/db/src/schema/asset.ts#L96-L120); [custody.ts:39](packages/api-contracts/src/custody.ts#L39) states duplicates already exist | Code-only enforcement already failed once — the comment records four writers breaking it independently. Everything reasoning over "who holds what" reads the wrong person. |
| 3 | **The ledger is append-only by convention only.** | [schema/event.ts:6](packages/db/src/schema/event.ts#L6) | An audit trail that can be silently updated is not an audit trail. No grant restriction, no trigger. |
| 4 | **Assignment cannot record truck and trailer.** One nullable `locationId`. | [schema/asset.ts:104](packages/db/src/schema/asset.ts#L104) | The brief requires job, truck and trailer on every assignment. Two of the three are representable. |
| 5 | **The desk queue is unreachable.** No caller for `transfer.approve` / `verify` / `decline` or `assignment.approve` / `decline` / `return` in either app. | [custody/page.tsx](apps/web/app/(app)/custody/page.tsx) is read-only; verified by enumerating every `useMutation` and `client.*.mutate` in `apps/web` and `apps/mobile` | Backend logic that is correct and cannot be run is not delivered. |
| 6 | **The app tells users to go somewhere that cannot help them.** The transfer form says a held tool "stays where it is until someone approves it in the Inbox"; `inbox.resolve` accepts only `task` and `message`. | [transfer-form.tsx:79](apps/web/components/transfer-form.tsx#L79) vs [inbox.ts:213-214](packages/api-contracts/src/routers/inbox.ts#L213-L214) | Users will follow that instruction, find nothing, and conclude transfers are broken. |
| 7 | **Dashboard KPIs bypass project scoping.** `visibleProjectScope` exists and `dashboard.kpis` never calls it. | [dashboard.ts:9-79](packages/api-contracts/src/routers/dashboard.ts#L9-L79) vs [scope.ts](packages/api-contracts/src/scope.ts) | A scoped user sees tenant-wide counts, including jobs they cannot open. |
| 8 | **Authorization decisions on a role-name string.** | [dashboard.ts:86](packages/api-contracts/src/routers/dashboard.ts#L86) | Renaming a role silently changes who sees what. Permissions exist for exactly this. |
| 9 | **Login is not tenant-scoped.** | [auth/index.ts:45](packages/auth/src/index.ts#L45) | Fine for one tenant, wrong the moment there are two — and the schema is multi-tenant throughout. |
| 10 | **Vestigial catalog tables.** `asset_model` / `manufacturer` / `asset.modelId` are written only by the seed. | [schema/asset.ts:37-39](packages/db/src/schema/asset.ts#L37-L39), self-documented | Duplicate representation of make/model. Every reader has to know which to trust. |
| 11 | **`vehicle` mirrors `location.custodianEmployeeId`.** | [schema/location.ts:60](packages/db/src/schema/location.ts#L60), self-documented | Two columns, one truth, kept in sync by hand. |
| 12 | **No React error boundaries.** | No `error.tsx` or `global-error.tsx` under [apps/web/app/](apps/web/app/) | One render error blanks the whole app. |
| 13 | **Notification delivery is a stub that lies.** Logs to console, then sets `deliveredAt`. | [notifications.ts:195-210](apps/api/src/notifications.ts#L195-L210) | The database will claim every notification was delivered. Nothing was. |
| 14 | **Lint is decorative in CI.** | [.github/workflows/ci.yml](.github/workflows/ci.yml), self-documented | As the workflow comment says, leaving `continue-on-error` permanently makes the step pointless. |
| 15 | **Two migrations are uncommitted.** `0010`, `0011`, both snapshots, and the journal edit. | `git status` | The deployed production database may not match the schema on `main`. |

Items 10, 11, 13 and 14 are documented in the code by whoever wrote them. That is a good sign
about the team, and it does not make them cost less to fix.

---

## D. Sizing

`S` = half day, `M` = 1 day, `L` = 2 days. Sizes are anchored to comparable work already in
this repository, named in the last column.

| # | Task | Size | Compared to |
|---|---|---|---|
| C1 | Desk queue screen with three actions | `L` | [inbox/page.tsx](apps/web/app/(app)/inbox/page.tsx) — a queue screen with resolve/dismiss/retry against an existing router |
| C2 | Recipient accept/reject, API and field screen | `L` | `transfer.verify` ([transfer.ts:297](packages/api-contracts/src/routers/transfer.ts#L297)) plus a mobile screen the size of [action/[type].tsx](apps/mobile/app/action/[type].tsx) |
| C3 | Transactional custody writes | `M` | [category.ts:139](packages/api-contracts/src/routers/category.ts#L139) — an existing write wrapped in `db.transaction` |
| C4 | Unique index plus duplicate backfill | `M` | [0009_backfill_team_rows.sql](packages/db/drizzle/0009_backfill_team_rows.sql) — a hand-written data migration, and `ptm_one_active_uq` ([employee.ts:102](packages/db/src/schema/employee.ts#L102)) is the same partial-index pattern |
| C5 | Truck and trailer on assignment | `L` | [0005_department_model_split.sql](packages/db/drizzle/0005_department_model_split.sql) — a column split with every reader updated |
| C6 | Ledger immutability at the DB level | `S` | A single migration, smaller than [0010_ancient_shocker.sql](packages/db/drizzle/0010_ancient_shocker.sql) plus grant changes |
| C7 | Projection rebuild verification | `M` | `asset.rebuild` ([asset.ts:443](packages/api-contracts/src/routers/asset.ts#L443)) already folds the ledger; this adds the diff and the report |
| C8 | Custody router integration tests | `L` | No comparable exists — sized against standing up the harness the CI smoke job already proves is possible |
| A1 | Mechanic and engineer login roles | `S` | The `ROLE_PERMS` matrix edit at [seed.ts:51](packages/db/src/seed.ts#L51) |
| A2 | User administration | `L` | [routers/project.ts:157-467](packages/api-contracts/src/routers/project.ts#L157-L467) (employee CRUD) plus [employee-form.tsx](apps/web/components/employee-form.tsx) |
| A3 | Tenant-scoped login | `S` | A `where` clause and a unique index |
| A4 | Permission-based scoping | `M` | The `visibleProjectScope` call sites in [routers/asset.ts](packages/api-contracts/src/routers/asset.ts) |
| A5 | RBAC matrix test | `M` | [apply-action.test.ts](packages/api-contracts/src/apply-action.test.ts) — permission assertions in the same style |
| M1 | Vendor CRUD | `M` | [routers/category.ts](packages/api-contracts/src/routers/category.ts) — a small entity with create/rename/delete |
| M2 | Form validation parity pass | `M` | The error handling already in [transfer-form.tsx:92](apps/web/components/transfer-form.tsx#L92) |
| I1 | Import tests | `M` | [parse.test.ts](packages/intent/src/parse.test.ts) — a table-driven suite over a validator |
| I2 | Import history and undo | `M` | The `eventLog` write in [audit.ts](packages/api-contracts/src/audit.ts) plus a compensating-event writer |
| D1 | Scope KPIs and reports | `M` | Existing `visibleProjectScope` call sites |
| D2 | Counts by location | `S` | `report.byProject` ([report.ts:42](packages/api-contracts/src/routers/report.ts#L42)) — one more grouped query and a registry entry |
| D3 | Server-side CSV export | `M` | [lib/csv.ts](apps/web/lib/csv.ts) moved server-side with a streaming route |
| N1 | Pending-transfer notification | `S` | `notifyCustodyDecision` ([notify.ts:32](packages/api-contracts/src/notify.ts#L32)) called from one more place |
| N2 | Real SMTP and SMS | `M` | Replacing the two `console.log` branches at [notifications.ts:195](apps/api/src/notifications.ts#L195) with real clients |
| N3 | Overdue escalation | `M` | `detectRentalsDue` ([notifications.ts:110](apps/api/src/notifications.ts#L110)) — the same two-level detection shape |
| N4 | Field push notifications | `L` | No comparable in-repo; sized against the Expo setup plus a delivery channel |
| P1 | Error boundaries | `S` | Three small files following the existing `ErrorNote` pattern |
| P2 | Typed errors across routers | `M` | The `TRPCError` usage already in [transfer.ts:79](packages/api-contracts/src/routers/transfer.ts#L79) |
| P3 | E2E smoke | `L` | The CI smoke job ([ci.yml](.github/workflows/ci.yml)) extended with a driven browser |
| P4 | Blocking lint | `M` | Unknown `any` count in apps/api; sized as one focused day |
| P5 | Redis rate limiter | `M` | [rate-limit.ts](apps/api/src/rate-limit.ts) reimplemented against Redis plus compose changes |
| P6 | Commit migrations, add drift check | `S` | A commit plus a CI step alongside the existing migrate job |
| P7 | Backup and restore runbook | `M` | [DEPLOY.md](DEPLOY.md) extended, plus one proven restore |

**Gap total:** 69 points — Custody 23, Access 10, Master data 4, Import 4, Dashboard 5,
Notifications 9, Production 14.

---

## E. Completion percentage

Completed work is sized on the same S/M/L scale so the two halves are comparable. Work that is
built but has no caller is credited at zero, because a procedure no screen can reach delivers
nothing to a user.

| Area | Completed points | What is counted |
|---|---|---|
| Foundation | 20 | Schema and 12 migrations (8), monorepo, tooling and env validation (4), docker dev and prod stacks (4), the five-job CI pipeline with rollback (4) |
| Access control | 8 | Auth, sessions, rehash, rate limiting, login/logout routes (4); RBAC tables, seed matrix, `requirePermission`, project scoping (4) |
| Master data | 28 | Asset CRUD, photos, register (6); categories (2); projects, teams, groups, postings (6); employees (4); locations and vehicles with GPS and map (6); rentals and vendor reads (4) |
| Custody | 20 | Ledger, fold, custody rules (6); single-writer helper (2); `assignment.create` reachable (2); `transfer.create` reachable (2); shared apply-action executor (6); audit log (2). **Approve, verify, decline, return: 0 — no caller** |
| Import | 8 | Specs, validator, preview and commit, CSV/xlsx dialog |
| Dashboard | 22 | Dashboard queries (8); report registry, 10+ report queries, report table, CSV export (8); DataTable, filter sheet, saved filters, global search (6) |
| Notifications | 5 | Notification table, custody-decision notify, detection loops, notification center and inbox. Delivery discounted as a stub |
| Production | 10 | Loading/empty/error states across pages (4); the 139-test unit suite (4); deploy script, health check, rollback (2) |
| **Total completed** | **121** | |

**Arithmetic:**

```
completed          = 121 points
remaining (gap B/D) =  69 points
project total      = 190 points

121 ÷ 190 = 0.6368…  →  63.6%
```

**Stated plainly: 63.6%, which is slightly above an assumed 60 percent, not below it.** Two
caveats belong with that number and matter more than the number does.

First, it excludes the conversational layer — `packages/intent`, messaging, tasks, inbox and the
mobile chat screens — which is a large body of working, tested code the eight-area brief does not
mention. Including it would raise the percentage, since it carries no gap tasks. It is excluded
because scope should be agreed before it is invoiced, not assumed.

Second, the total hides where the remaining work sits. Custody is 23 of the 69 remaining points —
a third of everything left — and it is the one area the system was bought for. A headline of 63.6%
alongside a custody area that cannot be operated from a screen is exactly the shape of estimate
that goes wrong late. Read section F as the real plan and the percentage as a summary of it.

---

## F. Phase division

| Phase | Tasks | Points | What the client can see at the end | What could go wrong |
|---|---|---|---|---|
| **1. Make the custody trail trustworthy** | C1, C3, C4, C6, C7, N1, P6 | 13 | The equipment desk opens a queue, approves a held transfer and verifies a borrow, and the tool's history shows one unbroken chain. A rebuild check reports zero divergence between the ledger and the register. | C4's backfill must resolve duplicate active assignments that already exist in live data; which row survives is a judgement per tool, not a script. C3 touches the core write path, so a mistake here is a custody bug rather than a screen bug. |
| **2. Close the field loop** | C2, C5, N4, P1 | 13 | A foreman hands a tool to another foreman from the phone. The recipient gets a push, accepts or rejects it, and the resulting record carries the job, the truck and the trailer. | C5 changes the assignment shape, so every `locationId` reader and every ledger snapshot moves with it. Push depends on Expo credentials and store accounts — a procurement dependency, not a code one, and the usual cause of a slipped demo. |
| **3. Roles and accounts** | A1, A2, A3, A4, A5, D1 | 12 | An administrator creates a mechanic and an engineer, assigns their roles, and each of the seven roles logs in to a view scoped to their own jobs. | Nobody has yet defined what an Engineer may do (section G). D1 will reduce the numbers scoped users currently see on the dashboard; that is the fix working, but it reads as a regression unless it is announced first. |
| **4. Data in and out** | M1, M2, I1, I2, D2, D3, N2, N3 | 15 | The yard's trailer sheets import with a preview and an undo, vendors are maintained in the app, overdue tools escalate by email, and any report exports in full. | N2 cannot be demonstrated until Urban supplies SMTP and Twilio credentials. I2's undo must be written as compensating events; done as deletes it breaks the append-only guarantee Phase 1 just established. |
| **5. Harden for go-live** | C8, P2, P3, P4, P5, P7 | 16 | CI exercises the full custody flow against a real database on every push, lint blocks merges, and a restore from backup is performed in front of the client. | P4 may uncover real type errors hiding behind the `any` usage in apps/api. P3 is where latent defects from phases 1–2 actually surface, so it is the phase most likely to generate work that is not on this list. Re-baseline the sizes before starting it. |

Phases 1 and 2 must run in order. Phase 3 can start in parallel with 2 if a second developer is
free. Phase 5 must come last, because its value is in testing what phases 1–4 built.

---

## G. Open questions

**Requirements ambiguity that changed how I assessed:**

1. **"Accept/reject" — by whom?** The brief says foreman-to-foreman transfer with accept/reject. What is built is desk *verification*: the tool moves immediately, and the equipment desk later confirms or reverses it ([transfer.ts:297](packages/api-contracts/src/routers/transfer.ts#L297)). The receiving foreman is never asked. The built model is arguably better for a yard — it does not block a tool that has physically moved — but it is not what was specified. I sized C2 as adding recipient acceptance on top; if desk verification is what Urban actually wants, C2 drops and the gap total falls by 4 points.
2. **What is an Engineer?** The role appears in the brief and nowhere in the codebase — not in `ROLES`, not in `EMPLOYEE_ROLES`, not in the seed. A1 cannot be finished without a permission list.
3. **Do mechanics log in?** `mechanic` exists as a custodian role ([enums.ts:41](packages/types/src/enums.ts#L41)) and as a department cost target, but has no login role. Holding tools and having an account are different things here.
4. **Truck and trailer: two fields, or a hierarchy?** `location.parentLocationId` could model a trailer behind a truck, which would make C5 much smaller than two independent columns. Which shape matches how the yard actually thinks about it?
5. **Are vendors in scope?** [docs/15-vendors-and-orders.md](docs/15-vendors-and-orders.md) is marked Roadmap, and the brief lists vendors under master data. M1 assumes in scope.
6. **Is the conversational layer in this contract?** `packages/intent`, messaging, tasks, inbox and the mobile chat screens are working, tested and substantial, and the eight-area brief does not mention them. This is the single largest scope question in the document and it directly affects what can be invoiced.

**Marked `UNKNOWN` — what I would need to resolve each:**

| Unknown | What would settle it |
|---|---|
| How many duplicate active assignments exist in production, and therefore what C4's backfill costs | Read access to the production database: `select asset_id, count(*) from assignment where status = 'active' group by 1 having count(*) > 1` |
| Whether the deployed build at urban.bodhitechlabs.com matches `main`, given 0010 and 0011 are uncommitted | The deployed commit SHA from the droplet, compared against `git log` |
| Whether the field app is in real use or is a prototype | Session or request counts by `source = 'mobile'` from `event_log` |
| Actual test coverage percentage | A coverage run; I counted test files and cases, not lines covered |
| Whether the `any` usage in apps/api hides real type errors, sizing P4 | Removing `continue-on-error` locally and reading the output |
| Whether Urban has SMTP and Twilio accounts, blocking N2 | Ask Urban |

# STInventory — Agent Memory

> Concise reference for AI agents working on this codebase. Deeper planning lives in
> `docs/*.md`; quick-start lives in `README.md`.
>
> **This file is a reference, not always-on context.** Claude Code loads `CLAUDE.md`
> automatically and per-area rules from `.claude/rules/` when you touch that area; this file
> is read on demand when you need the full domain model, the roadmap or the ADRs. Other agent
> tools that read `AGENTS.md` natively still get everything here.

---

## 1. What this is

STInventory is an **internal small-tools & equipment management platform** for Urban
Infraconstruction (Dallas, TX). Modeled on United Rentals' operating shape
(catalog → warehouse inventory → dispatch/transfer → charge-to-project) but for an
internal **owner/custodian** model with no external rental revenue.

Separate track from Mark 85 (Urban's ERP effort) for now, built on the same primitives so
it can later fold in as Mark 85's Equipment module or ship as a satellite SaaS.

## 2. Core concepts (read before touching code)

| Concept | Rule |
|---|---|
| **Ownership** | The Equipment Department owns every asset. Ownership never transfers. |
| **Custody** | Foremen are custodians, not owners. Custody is assigned and revoked. |
| **Transactions** | Every movement is an immutable transaction. Nothing is edited in place. |
| **Projections** | Current state (where/who/status) is **derived** from the transaction log. |
| **Custody ≠ Ownership** | `owning_project_id` (who paid) is separate from `current_project_id` (who uses it now). |
| **One custodian** | At most one active custodian per serialized asset at a time. Every writer goes through `packages/api-contracts/src/custody.ts`. |
| **Tools follow the foreman** | Small tools live with the person, not the site. When a foreman changes job, `currentProjectId` on everything they hold moves with them; `owningProjectId` never does. |
| **Reports-first** | Each module ships its reports before its edit UI. Reports are the moat. |
| **Multi-tenant-ready** | Every row carries `tenant_id` from commit one. RLS stays off until the second tenant is real. |
| **Owned only** | `asset` is what Urban owns. Rented equipment was modelled here and removed on 2026-08-09 — STInventory tracks small tools Urban owns, nothing hired. |
| **The desk moves tools** | Issuing and reassigning is the equipment department's job. Foremen hold tools and read the register; they do not transfer between themselves. |

## 3. Current pain (why this exists)

Urban tracks tools through a spreadsheet nobody updates, paper tags that get lost, and
WhatsApp threads buried under other messages. The result:
- No one knows where a given tool is at any moment.
- Foremen on multiple projects cannot report which tools are on which site.
- HR offboarding (termination) has no clearance workflow — ex-employees walk away holding assets.
- Procurement is reactive: "buy another one" when the first cannot be found.

## 4. Tech stack

- **API:** Hono + tRPC (Node 22+). tRPC is the single API surface — see ADR-2.
- **Web:** Next.js 15 + shadcn (routes live under `apps/web/app/(app)/`)
- **Mobile:** Expo Router (React Native) — shell only; Flutter is dropped, see ADR-3
- **Chat parser:** in-process (`packages/intent`), calling an OpenAI-compatible LLM
  configured per tenant at Settings → Chat parser
- **DB:** Postgres 16 + Drizzle ORM
- **Auth:** Lucia-style sessions + tenant-scoped RBAC
- **Monorepo:** pnpm workspaces + Turbo
- **Event sourcing:** Pure domain fold in `packages/domain`
- **Deployment:** Docker Compose locally; designed for AWS/GCP

## 5. Monorepo layout

```
apps/
  api/          Hono + tRPC + auth + notification scheduler + messaging worker
  web/          Next.js 15 dashboard (routes under app/(app)/)
  mobile/       Expo Router app — tabs (my tools / hand-off / alerts), tool detail,
                action forms, @-mention input. No QR scan, no offline queue.
packages/
  api-contracts/   tRPC routers (identity, dashboard, asset, assignment, transfer,
                   vehicle, report, messaging, entity, task, …)
  auth/            Lucia-style session + tenant-scoped RBAC
  db/              Drizzle schema + seed (Postgres)
  domain/          Event-sourcing fold + custody rules (pure)
  intent/          Intent catalog, generated LLM prompt, parser — the one place
                   an intent is declared; see docs/08-custom-intents.md
  env/             Zod-validated env loader
  logger/          pino logger
  types/           Branded IDs, enums, permissions
  config-eslint/   Shared ESLint flat config
  config-tsconfig/ Shared tsconfig presets
prototype/           Single-file no-build UI mockup — design reference for the
                     Tool Register redesign; see prototype/README.md and
                     docs/archive/HANDOFF-tool-register-2026-07-27.md (archived)
docker-compose.yml   Postgres + API + Web (dev)
docker-compose.prod.yml  Production stack — see §12
Makefile             ENV-driven: up / seed / logs / psql / test
```

## 6. Running locally

```bash
cp .env.example .env.local
make ENV=local up      # builds + starts postgres, api, web
make ENV=local seed    # load sample data
```

- Web: http://localhost:3100
- API: http://localhost:4100 (health: `/health`)
- Demo password: `stinventory-demo`

| Email | Role | Sees |
|---|---|---|
| owner@stinventory.local | System Administrator | Everything |
| admin@stinventory.local | Equipment Administrator | Everything |
| office@stinventory.local | Office Administrator | Everything; no custody, no config |
| warehouse@stinventory.local | Warehouse — the yard desk | Everything |
| pm@stinventory.local | Project Manager | Lone Star's tools |
| engineer@stinventory.local | Engineer | DART's tools |
| super@stinventory.local | Superintendent | His crew's tools, across two jobs |
| foreman@stinventory.local | Foreman | His own tools |
| mechanic@stinventory.local | Mechanic | His own shop tools |
| procurement@stinventory.local | Procurement | Everything, read-only |
| hr@stinventory.local | HR | People — deliberately not tools |
| finance@stinventory.local | Finance | Everything, plus the audit trail |
| readonly@stinventory.local | Read-only | Everything, read-only |
| jobani@stinventory.local | Foreman | **Deactivated** — refuses to sign in |

The seed (packages/db/src/seed.ts) loads the fleet from
`packages/db/src/seed-data.ts`, generated from `docs/data/TOOL LIST BY NAME.xlsx`
via `docs/data/generate_app_seed.py`.

**The generator no longer reproduces this file.** `seed-data.ts` has been hand-edited
since — STI-303's deactivated account, STI-306's terminated employee and reporting chain,
and STI-304's role accounts are all absent from the generator, so re-running it would
silently delete them. Treat `seed-data.ts` as the source and the generator as provenance;
if the tools list is reloaded, regenerate to a scratch file and merge. Raw extraction lives in `docs/data/seed_from_tools_list.json`;
anything a human must review before trusting it is in
`docs/data/reconciliation_report.json`.

## 7. What's built

- **Asset Register** — serialized + bulk assets, searchable. Faceted rail (category /
  status / flags, each count computed with its own filter lifted), cards-or-table toggle,
  and value weight so a $33k total station does not read like a $260 drill.
  See `docs/archive/HANDOFF-tool-register-2026-07-27.md` for why the filtering is
  client-side. Archived, but that reasoning still holds.
- **Assignments** — custody links and the high-value approval gate. Every link is simply
  custody: there is no loan, no due date and no overdue state (removed 2026-08-09)
- **Transfers** — hand-off reporting, high-value + cross-person approval
- **Vehicles** — trucks/trailers as moving tracking locations (GPS + ownership)
- **Job postings** — `employee_project_assignment` records which job a person was on and
  when. `employee.assignToProject` closes the open posting, opens the next, and moves every
  tool in that person's custody to the new project with a `project_change` event each.
  Surfaced at `/people/[id]`. Containers (`location.custodianEmployeeId`) name who carries
  them, so a gang box or trailer has a holder the same way a tool does.
- **Project teams (people/roles module, first cut)** — `project_team_member` holds who runs
  and works each job (`pm` | `superintendent` | `foreman`, one current row per
  project+person+role, partial-unique enforced). Assignment hierarchy in
  `project.team.assign`: PMs by admins/equipment-dept, superintendents by the above + PMs,
  foremen by the above + superintendents. **A foreman linked to a project IS working it** —
  the assignment runs the same `moveEmployeeToProject` engine as `employee.assignToProject`,
  so posting, primary project, tools and trucks follow. `project.list` is **scoped
  server-side** (`visibleProjectScope`): `project.manage` holders see everything; everyone
  else only the union of their job groups and their team rows. Tools by Jobsite (`/jobsites`)
  is the control hub for this: job ID · name headers, assignable foreman/PM/super chips,
  editable truck/trailer rows, and "Add Truck / Add Trailer".
- **Dashboard** — KPIs, HR clearance queue, pending approvals, activity feed. No money
  figures: fleet value and capital moved to reports on 2026-08-09
- **Conversational layer** — chat → LLM intent parse → entity resolution → proposed custody
  action → confirm. Plus tasks extracted from chat and an admin verification queue.
  Full spec: `docs/07-conversational-layer.md`
- **@-mentions** — the message stays a plain sentence; `@` plus two characters opens one
  ranked list across tools, people, jobs, places and trucks (`entity.search`). A picked row
  is stored on `message.mentions` as `{kind, id, label}`, server-verified in `messaging.send`,
  and **outranks anything the parser infers** — see `packages/types/src/mentions.ts`. There is
  deliberately **no command syntax**: foremen should not have to remember one. Both clients
  show a tappable `@` button that does the same thing — the shortcut alone is undiscoverable.
- **Every message ends somewhere** — `messaging.manualEntry` (resolve into a real action, via
  `applyChatAction` like everything else) or `messaging.dismiss` (close it, `dismissed`
  status). Both tell the sender. The desk drives these from `/inbox`.
- **Field requests** — when someone describes an action they lack the permission for, the
  action itself is stored on the task (`task.actionType` + `task.pendingAction`), not just
  prose. `task.approve` replays it through `applyChatAction` charging the **approver's**
  permissions; `task.decline` records a refusal. Approve/decline live on the Inbox.
- **Decisions reach the requester** — every approve/decline (task, transfer, assignment)
  writes a notification via `packages/api-contracts/src/notify.ts` to whoever asked, whoever
  was receiving and whoever was holding. `/inbox` serves two audiences off one route: the
  desk sees the work queue (gated on `assignment.read`), everyone sees their own alerts first.
- **Edit / delete** — `update` + `delete` on asset, employee, project, location, vehicle.
  Update covers descriptive fields only; custody and location are projections and are moved
  through Assign/Transfer/Return, `assignToProject` or `setCustodian`, never typed over.
  Delete refuses anything carrying history and names the status change to use instead
  (disposed / terminated / complete). Row actions live in `components/sti/row-actions.tsx`.
- **Container custody** — `location.setCustodian` hands a trailer, truck or gang box to a
  foreman, or takes it back with a null custodian. Contents move with it by default, since
  that is what physically happens. Set at create time only until now, so a reassigned trailer
  silently kept its original custodian.
- **Request worker** (`apps/api/src/request-worker.ts`, every 60s) — requeues messages
  stranded by an unreachable parser (bounded by `message.attempts`), unsticks dead
  `processing` rows, announces new requests to the desk and chases aging ones on a widening
  interval. **It never approves anything** — auto-applying after a timeout would be a way to
  obtain a permission by waiting.
- **Notification engine** — in-app alerts plus an email/SMS provider interface that is still
  a console stub. `notifyDeskPending` tells the approver role when a transfer or assignment
  is held for signature; `notifyCustodyDecision` closes the loop on approve/decline. Overdue
  and rental detection were removed on 2026-08-09 with the loan and rental models.
- **Event-sourced core** — append-only `transaction`; rebuild guarantee; audit trail is free
- **Reports** — `assetRegister`, `byProject`, `byForeman`, `idle`, `lost`,
  `capitalByProject`, all six with pages under `/reports` driven by
  `app/(app)/reports/registry.ts`.

## 8. What's not built yet (roadmap)

1. Procurement end-to-end (PR → PO → Receive → Tag → Assign) — no tables at all
2. Maintenance & inspections module — no tables at all. Blocks the "Service due" flag
   the register prototype shows and production deliberately omits.
3. HR clearance **sign-off gate** + BambooHR trigger (the queue itself is built)
4. Mobile QR scanning + offline queue — no scan flows, and no offline support at all
5. Integrations — FoundationSoft, BambooHR, HCSS. United Rentals is now importable by
   file; the Total Control API (EDI / cXML / JSON, punchout catalogue) needs vendor
   credentials before it can replace the manual export
6. Self-serve SaaS onboarding & billing
7. RLS + tenant resolver hardening — no longer blocked; `project_phase` now carries
   `tenant_id`, so policies can be written against every table
8. Session cookie migration — tokens still live in `localStorage`, readable by any XSS

## 9. Key architectural decisions

1. **Event-sourced core** — `transactions` table is the append-only system of record; every other table is a projection that can be rebuilt.
2. **Multi-tenant-ready, not multi-tenant yet** — every row carries `tenant_id`, but Urban is the only tenant and RLS is off until pilots arrive.
3. **Reports-first** — each module ships reports before edit UI. The audit trail is free because it IS the transaction log.
4. **No hardcoded Urban strings** — all tenant config (categories, templates, approval matrix) lives in tenant-scoped data tables.

## 10. Important invariants

- One active **Assignment** per serialized asset at a time.
- ~~Temporary assignments carry `expected_end_date`; overdue triggers escalating alerts.~~
  **Contradicted §7 of this same document, which was right.** Removed 2026-08-09 with the borrow model: `assignment.expected_end_date` was DROPPED in migration `0012`, `isOverdueLoan` was deleted from `packages/domain`, and no `dashboard.overdueLoans` procedure exists. **Nothing falls due, so nothing goes overdue.** Verified 2026-08-22.
- HR termination event (`employment_status = terminated`) triggers a **clearance queue**.
  Offboarding sign-off is blocked until the queue is empty.
- Assets in maintenance are not Available and cannot be assigned.
- `Lost` assets retain full history; they can be Found or Disposed.

## 11. Where to find what

| File | Purpose |
|---|---|
| `SYSTEM_PLAN.md` (repo root) | **Start here before building** — what the system is, what exists, what is being built. Verify claims against the repo before acting |
| `docs/workings/RELEASE_1_SPRINT_PLAN.md` | The delivery plan — Sprint 1 ships 24 Aug 2026: epics, stories, points, mechanisms, cases. Jira import files sit beside it |
| `docs/initialPlan.md` | Urban's original brief in their own words — the requirements every spec traces back to |
| `design/README.md` | The two UI concept screens and what to take from each. Neither is an implementation target |
| `docs/archive/` | Superseded status reports. If one disagrees with SYSTEM_PLAN.md, SYSTEM_PLAN.md wins |
| `docs/archive/00-executive-summary.md` | **Start here for leadership context** — one-page distilled pitch |
| `docs/archive/01-plan.md` | Master planning & functional spec — vision, entities, lifecycle, custody model, operational scenarios, procurement, reports, modules, roadmap |
| `docs/02-saas-architecture.md` | Multi-tenant productization path, tenancy model, convergence options with Mark 85 |
| `docs/architecture/01-data-model.md` | **The schema as built.** Tables, relationships, the ledger-is-truth rule |
| `docs/archive/03-data-model.md` | The superseded schema doc — pre-rename table names, kept for its unbuilt Part B |
| `docs/archive/04-diagrams.md` | Mermaid diagrams: ERD, lifecycle state machine, custody flows, procurement BPMN, deployment, SaaS multi-tenancy, event fold |
| `docs/05-build-proposal.md` | Bodhi Labs scope, team, hours, pricing, delivery plan, handoff — plus the delivery-status addendum |
| `docs/06-decisions.md` | Architecture decision records (ADR-1..6) — read before changing the API surface, the mobile stack, or the event model |
| `docs/07-conversational-layer.md` | The chat → intent → custody-action subsystem, its state machine, and its known gaps |
| `LLM_RECALL.md` | **Which document to trust, and in what order.** The routing layer for agents |
| `docs/archive/HANDOFF-tool-register-2026-07-27.md` | Tool Register redesign, archived — the register has been rebuilt since |
| `prototype/README.md` | The single-file UI mockup, and what was borrowed from United Rentals |
| `README.md` | Human quick-start, login credentials, monorepo layout |

## 12. Production posture (as of 2026-07-26)

> `docs/archive/HANDOFF-tool-register-2026-07-27.md` covers the Tool Register redesign
> specifically, and is archived rather than current — read it before
> touching `tools/page.tsx`, `facets.tsx`, `flags.tsx` or `asset-card.tsx`.


- **Migrations, not push.** `packages/db/drizzle/` holds versioned SQL. `make generate`
  after a schema change, commit the SQL, `make migrate` to apply. The API container migrates
  on boot and refuses to serve if it fails. `push` is renamed `push-dangerous` — it diffs a
  live database and applies with no review and no record.
- **Tests.** `pnpm test`. They live in the pure packages — `packages/domain` (custody rules +
  the event-fold rebuild guarantee), `packages/intent` (the catalog and parser),
  `packages/types` (the @ parser), `packages/auth` (secret encryption) and
  `packages/api-contracts` (the permission map). The fold tests pin the partial-`toState` bug
  that has shipped three times. Since Release 1 Phase 1, `packages/api-contracts` also runs
  **integration tests against the real `DATABASE_URL`** — custody concurrency, the append-only
  triggers, and a gate asserting the seeded ledger folds to its projection. `apps/api`,
  `apps/web` and `apps/mobile` still have no `test` script, so nothing exercises a rendered
  screen.
- **Production images.** `docker/Dockerfile.{api,web}` + `docker-compose.prod.yml`.
  The API is bundled with esbuild (`apps/api/build.mjs`) because every workspace package
  exports raw `.ts` — `tsc && node dist/index.js` never worked. Web uses Next standalone.
- **CI.** `.github/workflows/ci.yml` — typecheck, test, all three image builds, and a smoke
  job that migrates a fresh Postgres and boots the API.
- **Auth.** bcrypt cost 12 with transparent rehash on login; 32-byte session tokens; login
  rate limited 10/15min per IP+email (in-memory — single-instance only, see `rate-limit.ts`).
  `assertProductionSafe` refuses to boot production with the example secret or a plain-http
  origin. The seed refuses to run with `NODE_ENV=production`.

## 13. Known defects (verified 2026-08-06)

Items 1, 2, 3, 4 and 6 below are **resolved** and kept for the record; 5 remains:

1. ~~`make dev` fails~~ — **resolved**: the `dev`/`mobile` targets no longer reference
   `apps/desktop` (the file dropped the Flutter build); `make ENV=local up` is still the
   path. AGENTS.md §13 was stale on this.
2. ~~**Two API surfaces** — `apps/api/src/rest-routes.ts` duplicates the tRPC routers~~ —
   **resolved.** The file is gone and the REST surface with it. The Hono app serves
   `/health`, the auth endpoints, two asset-photo endpoints and tRPC, nothing else.
   **Do not go hunting for an ungated REST mutation; there is none.**
3. ~~`packages/notifications/` is an empty directory~~ — **resolved** 2026-08-09: removed,
   along with `packages/design-system` and `packages/frontend-shared`. All three were
   unimported by either app; the latter two are the ones ADR-3 anticipated would serve
   both clients, which never happened.
   The notification engine itself lives in `apps/api/src/notifications.ts`. Note its delivery
   layer is still two `console.log` branches — there is no `nodemailer` or `twilio`
   dependency, and the `SMTP_*`/`TWILIO_*` env vars beyond `SMTP_HOST` are read by nothing.
   In-app is the only channel that actually works.
4. ~~The manual action path skips the high-value approval rule~~ — **resolved**: verified
   against the code on 2026-08-06 — `action.submit` → `applyChatAction` applies
   `outcomeFor` (which reads `tenantSettings.highValueThreshold`) per asset for
   assign/transfer, so the gate fires. The AGENTS.md note was stale.
5. **The login rate limiter is in-memory** — two API instances give an attacker twice the
   budget. Single-instance only until it moves to Redis. See `apps/api/src/rate-limit.ts`.
6. ~~`action_proposed` chat messages never expire~~ — **resolved**: `request-worker.ts`
   `escalateStaleProposals` chases unanswered proposals on the same widening interval as
   tasks (first after 1h, then daily, max 4), notifying the sender and the desk. `message`
   gained `escalation_count` / `last_escalated_at` (migration 0008).

Also fixed 2026-08-06 (from the job-selector codegen review): job-group ticks no longer
drop rapid consecutive changes (optimistic cache + pending guard on `/job-groups`), the
group-edit pencil is disabled until `projectGroup.list` resolves (was able to silently
wipe a group's users on first open), the job-search haystack now derives from `idName()`
via `jobSearchText()` (was duplicated 3× and disagreed with the displayed label), and the
unused `ui/collapsible.tsx` was deleted.


Fixed since the last pass: chat `repair`/`lost` confirmations now write (they used to mark
the message done and change nothing); chat-confirmed custody now honours the approval gate;
`project_phase` gained its `tenant_id`; and the one-active-custody-link invariant is enforced — `assignment.create`,
`transfer.create`, `transfer.approve` and the chat executor all closed or skipped the
previous link inconsistently, so a tool could sit in two people's custody at once. All four
now go through `packages/api-contracts/src/custody.ts`.

## 14. Open questions / blockers

- Internal rental / charge-back policy: flat, daily, or none?
- Approval matrix for PR/PO (custody approvals are resolved — `tenant_settings`)
- Offline mobile workflow design (yards/sites with no signal)
- Integration credentials for FoundationSoft, BambooHR, HCSS
- Tool templates by work package — who defines and where stored?
- LLM hosting: self-hosted vs. hosted API (cost, latency, data residency)

## 15. Status (as of 2026-07-27)

Running system, not feature-complete. Asset register (faceted), custody, vehicles and
container custody, job postings, dashboard, reports, the notification engine, the
conversational layer and the request queue are built and working. Procurement and
maintenance have **no tables and no code**. Mobile has real screens but no offline support.

Production posture landed 2026-07-26 (§12): migrations, tests, production images, CI, auth
hardening.

**Reconciled again on 2026-08-29, at `v1.0.0`.** The schema now lives in
`docs/architecture/01-data-model.md`, derived from `packages/db/src/schema` rather than
transcribed; `docs/03-data-model.md` moved to `archive/` because every table it named was
renamed on 2026-08-28. Start at `LLM_RECALL.md` if you are an agent — it says which
document to trust and which will lie to you.

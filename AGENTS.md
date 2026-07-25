# STInventory — Agent Memory

> Concise reference for AI agents working on this codebase. Deeper planning lives in
> `docs/*.md`; quick-start lives in `README.md`.

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
| **One custodian** | At most one active custodian per serialized asset at a time. |
| **Reports-first** | Each module ships its reports before its edit UI. Reports are the moat. |
| **Multi-tenant-ready** | Every row carries `tenant_id` from commit one. RLS stays off until the second tenant is real. |

## 3. Current pain (why this exists)

Urban tracks tools through a spreadsheet nobody updates, paper tags that get lost, and
WhatsApp threads buried under other messages. The result:
- No one knows where a given tool is at any moment.
- Foremen on multiple projects cannot report which tools are on which site.
- HR offboarding (termination) has no clearance workflow — ex-employees walk away holding assets.
- Temporary loans have no due-date enforcement — tools go overdue silently.
- Procurement is reactive: "buy another one" when the first cannot be found.

## 4. Tech stack

- **API:** Hono + tRPC (Node 22+). tRPC is the single API surface — see ADR-2.
- **Web:** Next.js 15 + shadcn (routes live under `/d02`)
- **Mobile:** Expo Router (React Native) — shell only; Flutter is dropped, see ADR-3
- **Intent engine:** Python FastAPI sidecar (port 4600) calling an OpenAI-compatible LLM
- **DB:** Postgres 16 + Drizzle ORM
- **Auth:** Lucia-style sessions + tenant-scoped RBAC
- **Monorepo:** pnpm workspaces + Turbo
- **Event sourcing:** Pure domain fold in `packages/domain`
- **Deployment:** Docker Compose locally; designed for AWS/GCP

## 5. Monorepo layout

```
apps/
  api/          Hono + tRPC + auth + notification scheduler + messaging worker
  web/          Next.js 15 dashboard (routes under /d02)
  mobile/       Expo Router app (login + index only so far)
engine/         Python FastAPI intent parser (POST /parse, port 4600)
packages/
  api-contracts/   tRPC routers (identity, dashboard, asset, assignment, transfer,
                   vehicle, report, messaging, entity, task, …)
  auth/            Lucia-style session + tenant-scoped RBAC
  db/              Drizzle schema + seed (Postgres)
  design-system/   Shared tokens (colors, spacing, radii, typography) + tailwind preset
  domain/          Event-sourcing fold + custody rules (pure)
  env/             Zod-validated env loader
  frontend-shared/ Cross-client auth + API helpers (REST client — retired under ADR-2)
  logger/          pino logger
  types/           Branded IDs, enums, permissions
  config-eslint/   Shared ESLint flat config
  config-tsconfig/ Shared tsconfig presets
prototype/           Single-file no-build UI prototype (throwaway)
docker-compose.yml   Postgres + API + Web (NOT the engine — see §12)
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

| Email | Role |
|---|---|
| owner@stinventory.local | Owner — full access |
| admin@stinventory.local | Karen Osei — Equipment Admin |
| warehouse@stinventory.local | Yard Desk — Warehouse |
| foreman.miguel@stinventory.local | Miguel Torres — Foreman |

## 7. What's built

- **Asset Register** — serialized + bulk assets, searchable/filterable
- **Assignments** — custody links, temporary loans, overdue detection, approval gate
- **Transfers** — hand-off reporting, high-value + cross-person approval
- **Vehicles** — trucks/trailers as moving tracking locations (GPS + ownership)
- **Dashboard** — KPIs, overdue loans, HR clearance queue, pending approvals, activity feed
- **Conversational layer** — chat → LLM intent parse → entity resolution → proposed custody
  action → confirm. Plus tasks extracted from chat and an admin verification queue.
  Full spec: `docs/07-conversational-layer.md`
- **Notification engine** — overdue detection, SLA timers, email/SMS provider interface
- **Event-sourced core** — append-only `transaction`; rebuild guarantee; audit trail is free
- **Reports (API only)** — `assetRegister`, `byProject`, `byForeman`, `idle`, `lost`,
  `capitalByProject`. **None of these has a web page yet** — see §12.

## 8. What's not built yet (roadmap)

1. **Reports UI** — six procedures exist with no pages; highest-value gap
2. Procurement end-to-end (PR → PO → Receive → Tag → Assign) — no tables at all
3. Maintenance & inspections module — no tables at all
4. HR clearance **sign-off gate** + BambooHR trigger (the queue itself is built)
5. Mobile QR scanning + offline queue (Expo shell exists; no scan flows)
6. Integrations (FoundationSoft, BambooHR, HCSS) — `external_id` seams exist only
7. Self-serve SaaS onboarding & billing
8. RLS + tenant resolver hardening (blocked on the `project_phase` defect, §12)

## 9. Key architectural decisions

1. **Event-sourced core** — `transactions` table is the append-only system of record; every other table is a projection that can be rebuilt.
2. **Multi-tenant-ready, not multi-tenant yet** — every row carries `tenant_id`, but Urban is the only tenant and RLS is off until pilots arrive.
3. **Reports-first** — each module ships reports before edit UI. The audit trail is free because it IS the transaction log.
4. **No hardcoded Urban strings** — all tenant config (categories, templates, approval matrix) lives in tenant-scoped data tables.

## 10. Important invariants

- One active **Assignment** per serialized asset at a time.
- Temporary assignments carry `expected_end_date`; overdue triggers escalating alerts.
- HR termination event (`employment_status = terminated`) triggers a **clearance queue**.
  Offboarding sign-off is blocked until the queue is empty.
- Assets in maintenance are not Available and cannot be assigned.
- `Lost` assets retain full history; they can be Found or Disposed.

## 11. Where to find what

| File | Purpose |
|---|---|
| `docs/00-executive-summary.md` | **Start here for leadership context** — one-page distilled pitch |
| `docs/01-plan.md` | Master planning & functional spec — vision, entities, lifecycle, custody model, operational scenarios, procurement, reports, modules, roadmap |
| `docs/02-saas-architecture.md` | Multi-tenant productization path, tenancy model, convergence options with Mark 85 |
| `docs/03-data-model.md` | Detailed schema; event-sourced core design; projection logic; rebuild guarantee |
| `docs/04-diagrams.md` | Mermaid diagrams: ERD, lifecycle state machine, custody flows, procurement BPMN, deployment, SaaS multi-tenancy, event fold |
| `docs/05-build-proposal.md` | Bodhi Labs scope, team, hours, pricing, delivery plan, handoff — plus the delivery-status addendum |
| `docs/06-decisions.md` | Architecture decision records (ADR-1..6) — read before changing the API surface, the mobile stack, or the event model |
| `docs/07-conversational-layer.md` | The chat → intent → custody-action subsystem, its state machine, and its known gaps |
| `prototype/README.md` | How to run the throwaway single-file UI prototype |
| `README.md` | Human quick-start, login credentials, monorepo layout |

## 12. Known defects (verified 2026-07-25, not yet fixed)

Read these before trusting a demo:

1. **`make dev` fails** — `Makefile` `dev` and `mobile` targets build Flutter from
   `apps/desktop`, which does not exist (ADR-3 dropped Flutter). Use `make ENV=local up`.
2. **The engine is not in `docker-compose.yml`** — in a containerized run the messaging
   worker cannot reach the parser, so every chat message silently lands in `pending_manual`.
3. **Confirming a `repair` or `lost` chat action does nothing** — `messaging.confirmAction`
   implements only `assign`, `return`, `transfer`, but still marks the message
   `action_executed`. Same class of bug in the worker's auto-execute path.
4. **`project_phase` has no `tenant_id`** — violates the multi-tenant rule and blocks RLS.
5. **Two API surfaces** — `apps/api/src/rest-routes.ts` duplicates the tRPC routers. Per
   ADR-2 the routers win; fix bugs there.
6. **`packages/notifications/` is an empty directory.**
7. **Chat-confirmed custody bypasses the approval gate** (ADR-6).

## 13. Open questions / blockers

- Internal rental / charge-back policy: flat, daily, or none?
- Approval matrix for PR/PO (custody approvals are resolved — `tenant_settings`)
- Offline mobile workflow design (yards/sites with no signal)
- Integration credentials for FoundationSoft, BambooHR, HCSS
- Tool templates by work package — who defines and where stored?
- LLM hosting: self-hosted vs. hosted API (cost, latency, data residency)

## 14. Status (as of 2026-07-25)

Running system, not feature-complete. Asset register, custody (assignments/transfers),
vehicles, dashboard, notification engine, and the conversational layer are built and
working. Procurement and maintenance have **no tables and no code**. Reports exist in the
API with no UI. Mobile is an Expo shell.

Docs were reconciled against the code on 2026-07-25; `docs/03-data-model.md` Part A is the
as-built schema and Part B is explicitly unbuilt.

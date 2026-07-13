# STInventory

Internal small-tools & equipment management platform for Urban Infraconstruction. Modeled
on United Rentals' operating shape (catalog → warehouse inventory → dispatch/transfer →
charge-to-project) but for an internal owner/custodian model with no external rental
revenue.

Separate track from Mark 85 for now; built on the same primitives so it can later fold in
as Mark 85's Equipment module or ship as a satellite SaaS.

## Contents

| File | What it is |
|---|---|
| `STINVENTORY_PLAN.md` | Master planning & functional spec — vision, entities, lifecycle, custody model, scenarios, procurement, reports, modules, roadmap |
| `DATA_MODEL.md` | Detailed schema; event-sourced core (transactions = source of truth, everything else a projection) |
| `DIAGRAMS.md` | Mermaid: ERD, lifecycle state machine, custody + HR-offboarding + phase-change flows, procurement BPMN, deployment + SaaS multi-tenancy |
| `SAAS_ARCHITECTURE.md` | Multi-tenant productization path and how it aligns with the Mark 85 customer-zero → SaaS arc |
| `BODHI_LABS_STINVENTORY_PROPOSAL.md` | Bodhi Labs build proposal — scope, team, hours, per-hour + fixed pricing, scope options, payment schedule, handoff to production |
| `prototype/` | Runnable single-file UR-style dashboard with Urban sample data — open `prototype/index.html` |
| `apps/`, `packages/` | Production monorepo (Linkage MVP) — Hono+tRPC API, Next.js web, Drizzle/Postgres, event-sourced core |

## Core model in one paragraph

The Equipment Department owns every asset; foremen are custodians, not owners; projects
consume tools and get charged. Financial ownership (who paid) is tracked separately from
operational custody (who holds it now). Every movement is an immutable transaction, and the
current picture — where each tool is, who has it, what's idle, what's lost — is derived by
folding that log. Hard cases handled explicitly: foreman on multiple projects, foreman
fired (HR-triggered clearance), phase changes, temporary loans with overdue alerts,
lost/damaged tools.

## Running the production app

The Linkage MVP: small tools linked to foremen, projects, and trucks/trailers. Event-sourced
core, notification engine, UR-style web dashboard.

### Prerequisites

- Node 22+, pnpm 9+
- Postgres 16 (local or Docker)
- Docker (optional — `make up` brings up everything)

### Quick start (Docker)

```bash
cd STInventory
cp .env.example .env.local
make ENV=local up        # builds + starts postgres, api, web
make ENV=local seed      # load sample data (SEED_RESET=1 to wipe first)
```

- Web: http://localhost:3100
- API: http://localhost:4100 (health: `/health`)
- DB: `postgres://postgres:stinventory@localhost:5433/stinventory`

### Quick start (local, no Docker)

```bash
# 1. Start Postgres on port 5433
pg_ctl -D /tmp/sti-pgdata -l /tmp/sti-pg.log start -o "-p 5433"
createdb -p 5433 stinventory -U postgres

# 2. Install + push schema + seed
cd STInventory
pnpm install
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" pnpm --filter @stinventory/db push --force
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" SEED_RESET=1 pnpm --filter @stinventory/db seed

# 3. Start API + Web (two terminals)
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" \
SESSION_SECRET="stinventory-dev-secret-please-change-to-32-chars-minimum" \
WEB_ORIGIN="http://localhost:3100" PORT=4100 \
pnpm --filter @stinventory/api dev

NEXT_PUBLIC_API_URL="http://localhost:4100" \
pnpm --filter @stinventory/web dev
```

### Login

Password: **`stinventory-demo`**

| Email | Role |
|---|---|
| owner@stinventory.local | Owner — full access |
| admin@stinventory.local | Karen Osei — Equipment Admin |
| warehouse@stinventory.local | Yard Desk — Warehouse |
| foreman.miguel@stinventory.local | Miguel Torres — Foreman |

### What's built (Linkage MVP)

- **Asset Register** — small tools (serialized + bulk), searchable/filterable
- **Assignments** — custody links, temporary loans, overdue detection
- **Transfers** — hand-off reporting, high-value + cross-person approval
- **Vehicles** — trucks/trailers as tracking locations with GPS + company/personal-allowance ownership
- **Dashboard** — KPIs, overdue loans, HR clearance queue, transaction feed
- **Reports** — assets by project, by foreman, idle, lost, capital by project, audit trail
- **Notification engine** — overdue detection, SLA timers, email/SMS provider interface
- **Event-sourced core** — append-only `transactions` table; all state is a projection; rebuild guarantee

### Monorepo layout

```
STInventory/
├── apps/
│   ├── api/          Hono + tRPC + auth + notification scheduler
│   └── web/          Next.js 15 UR-style dashboard
├── packages/
│   ├── api-contracts/   tRPC routers (identity, dashboard, asset, assignment, transfer, vehicle, report, …)
│   ├── auth/            Lucia-style session + tenant-scoped RBAC
│   ├── db/              Drizzle schema + seed (Postgres)
│   ├── domain/          Event-sourcing fold + custody rules (pure)
│   ├── env/             Zod-validated env loader
│   ├── logger/          pino logger
│   ├── types/           Branded IDs, enums, permissions
│   ├── config-eslint/  Shared ESLint flat config
│   └── config-tsconfig/ Shared tsconfig presets
├── prototype/           Single-file no-build UI prototype
├── docker-compose.yml   Postgres + API + Web
└── Makefile             ENV-driven: up/seed/logs/psql/test
```

## Status

Planning docs + runnable prototype + production Linkage MVP (build verified, typecheck clean).
See the Bodhi proposal for the full build plan and scope options.

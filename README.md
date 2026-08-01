# STInventory

Internal small-tools & equipment management platform for Urban Infraconstruction. Modeled
on United Rentals' operating shape (catalog → warehouse inventory → dispatch/transfer →
charge-to-project) but for an internal owner/custodian model with no external rental
revenue.

Separate track from Mark 85 for now; built on the same primitives so it can later fold in
as Mark 85's Equipment module or ship as a satellite SaaS.

## Contents

| File | What it is |
|---|---|---|
| `docs/00-executive-summary.md` | **Start here for leadership context** — one-page distilled pitch |
| `docs/01-plan.md` | Master planning & functional spec — vision, entities, lifecycle, custody model, scenarios, procurement, reports, modules, roadmap |
| `docs/03-data-model.md` | Detailed schema; event-sourced core (transactions = source of truth, everything else a projection) |
| `docs/04-diagrams.md` | Mermaid: ERD, lifecycle state machine, custody + HR-offboarding + phase-change flows, procurement BPMN, deployment + SaaS multi-tenancy |
| `docs/02-saas-architecture.md` | Multi-tenant productization path and how it aligns with the Mark 85 customer-zero → SaaS arc |
| `docs/05-build-proposal.md` | Bodhi Labs build proposal — scope, team, hours, pricing, scope options, payment schedule, handoff, plus a delivery-status addendum |
| `docs/06-decisions.md` | Architecture decision records (ADR-1..6) |
| `docs/07-conversational-layer.md` | The chat → intent → custody-action subsystem |
| `docs/08-custom-intents.md` | How to add an intent, and which of the two kinds you are adding |
| `docs/09-vocabulary.md` | What the screens say and what they should say — user-visible strings only |
| `docs/10-corpus-context.md` | How this repo relates to the rest of Urban's stack |
| `docs/11-department-cost-targets.md` | **Spec, unbuilt** — charging a tool to a department instead of a project, and the `mechanic` role |
| `docs/12-model-field-split.md` | **Spec, unbuilt** — splitting `asset.modelName` into make / model number / description |
| `docs/13-excel-round-trip.md` | **Spec, unbuilt** — importing and exporting the trailer sheets Urban already keeps |
| `docs/14-dashboard-additions.md` | **Spec, unbuilt** — the four things the desk dashboard cannot currently answer |
| `docs/15-vendors-and-orders.md` | **Roadmap** — vendors, purchase orders, and linking a tool to where it came from |
| `docs/16-handoff-brief.md` | Orientation for an implementer picking up 11–14: architecture, conventions, what must not regress |
| `docs/changelogs/` | What actually shipped, one file per body of work — see its README for how specs, changelogs and release notes relate |
| `prototype/` | Runnable single-file UR-style dashboard with Urban sample data — open `prototype/index.html` |
| `apps/`, `packages/` | Production monorepo (Linkage MVP) — Hono+tRPC API, Next.js web, Drizzle/Postgres, event-sourced core |

## Live deployment

| | |
|---|---|
| Desk app | <https://urban.bodhitechlabs.com> |
| Field app (Expo web export) | <https://urban.bodhitechlabs.com/field> |
| Settings | <https://urban.bodhitechlabs.com/settings> |
| Host | DigitalOcean droplet `stinventory-01`, nyc1, 1 vCPU / 1GB, $6/mo |

Sign in with `admin@stinventory.local` / `stinventory-demo`. Those demo accounts are
deliberately enabled in production for now — see the note at the end of `DEPLOY.md`
for how to turn them off.

Full operational detail, including how one hostname serves every service, is in
[`DEPLOY.md`](DEPLOY.md).

### Push to deploy

Pushing to `main` deploys, provided the checks pass.

```
push to main
     │
     ├── check   typecheck · tests · lint
     ├── build   all three production images actually build
     ├── smoke   migrate a fresh Postgres, boot the API, hit /health
     │
     └── deploy  (only if all three pass)
             │
             └── ssh → /opt/stinventory/docker/deploy.sh
                       fetch · checkout · build · restart
                       wait for /health, roll back if it never comes
```

The deploy is gated on the checks because a deploy that runs regardless is just a
slower way to break production. It is also serialised — two builds at once would
starve a 1GB droplet.

**How the server gets the code.** The droplet is a git checkout of this repo.
`deploy.sh` does `git fetch` and `git reset --hard`, which only touches tracked files —
so `.env.production`, the Expo export in `field/`, and anything else that exists only on
the server are left alone. This replaced an rsync-from-laptop flow that twice deleted
exactly those files, because `--delete` cannot tell "removed from the repo" from "never
in the repo".

**The deploy key can only deploy.** CI authenticates with a dedicated key that is
restricted server-side to running one script:

```
command="/opt/stinventory/docker/deploy.sh",restrict ssh-ed25519 AAAA...
```

Whatever command CI sends is ignored; the server runs the deploy. Holding that secret
gets you a deploy, not a shell. It is a separate key from any human's — a CI credential
should never have blast radius beyond its job.

**Deploying by hand**, if CI is not available:

```bash
ssh -i ~/.ssh/do@it_urban root@68.183.27.164 bash /opt/stinventory/docker/deploy.sh
```

Invoked through `bash` rather than relying on the file's executable bit. Git records
that bit, so a script committed without it gets its permission stripped by the very
`git reset --hard` that the deploy runs — which is a deploy that works exactly once.

**Known rough edge.** Images are built on the droplet, which briefly starves the running
containers — expect a short 502 during the swap, and about ten minutes end to end. The
fix is to build in CI and push to a registry so the droplet only pulls; the repo is
public, so GitHub Container Registry would cost nothing. Not done yet.

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

#### 1. Database

```bash
pg_ctl -D /tmp/sti-pgdata -l /tmp/sti-pg.log start -o "-p 5433"
createdb -p 5433 stinventory -U postgres
```

#### 2. Install, push schema, seed

```bash
pnpm install
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" pnpm --filter @stinventory/db push --force
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" SEED_RESET=1 pnpm --filter @stinventory/db seed
```

#### 3. Start services (one terminal each)

**API** — http://localhost:4100
```bash
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" \
SESSION_SECRET="stinventory-dev-secret-please-change-to-32-chars-minimum" \
WEB_ORIGIN="http://localhost:3100" PORT=4100 \
pnpm --filter @stinventory/api dev
```

**Web** — http://localhost:3100
```bash
NEXT_PUBLIC_API_URL="http://localhost:4100" \
pnpm --filter @stinventory/web dev
```

**Mobile** (Expo) — http://localhost:8081
```bash
cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:4100 pnpm dev
```
Requires Expo CLI + iOS Simulator / Android emulator.

**Chat parser** — no separate process. Configure a model at **Settings → Chat
parser** (any OpenAI-compatible endpoint) and use **Test connection** to confirm
it can parse a real sentence before relying on it.

### Login

Password: **`stinventory-demo`**

| Email | Role |
|---|---|
| owner@stinventory.local | Owner — full access |
| admin@stinventory.local | Karen Osei — Equipment Admin |
| warehouse@stinventory.local | Yard Desk — Warehouse |
| foreman.miguel@stinventory.local | Miguel Torres — Foreman |

### What's built

- **Asset Register** — small tools (serialized + bulk), searchable/filterable
- **Assignments** — custody links, temporary loans, overdue detection, approval gate
- **Transfers** — hand-off reporting, high-value + cross-person approval
- **Vehicles** — trucks/trailers as tracking locations with GPS + company/personal-allowance ownership
- **Dashboard** — KPIs, overdue loans, HR clearance queue, pending approvals, activity feed
- **Conversational layer** — foremen type a sentence; it becomes a proposed custody
  transaction they confirm. Plus chat-extracted tasks and an admin verification queue
- **Notification engine** — overdue detection, SLA timers, email/SMS provider interface
- **Event-sourced core** — append-only `transaction` table; all state is a projection; rebuild guarantee
- **Reports — API only.** Six procedures (register, by project, by foreman, idle, lost,
  capital by project) exist with **no web pages yet**. The audit trail is browsable at `/d02/audit`.

### Not built

Procurement (PR → PO → Receive) and Maintenance/Inspections have no tables and no code.
Mobile is an Expo shell with no scan flows. Integrations are seams (`external_id`) only.
See `docs/01-plan.md` §18 for the full roadmap and `AGENTS.md` §12 for known defects.

### Monorepo layout

```
STInventory/
├── apps/
│   ├── api/          Hono + tRPC + auth + notification scheduler + messaging worker
│   ├── web/          Next.js 15 dashboard (routes under /d02)
│   └── mobile/       Expo Router app — shell only (login + index)
├── packages/
│   ├── api-contracts/   tRPC routers (identity, dashboard, asset, assignment, transfer,
│   │                    vehicle, report, messaging, entity, task, …)
│   ├── auth/            Lucia-style session + tenant-scoped RBAC
│   ├── db/              Drizzle schema + seed (Postgres)
│   ├── design-system/   Shared tokens + tailwind preset
│   ├── domain/          Event-sourcing fold + custody rules (pure)
│   ├── intent/          Intent catalog + generated LLM prompt + parser (pure + fetch)
│   ├── env/             Zod-validated env loader
│   ├── frontend-shared/ Cross-client auth + API helpers
│   ├── logger/          pino logger
│   ├── types/           Branded IDs, enums, permissions
│   ├── config-eslint/   Shared ESLint flat config
│   └── config-tsconfig/ Shared tsconfig presets
├── prototype/           Single-file no-build UI prototype
├── docker-compose.yml   Postgres + API + Web
└── Makefile             ENV-driven: up/down/seed/logs/psql/test
```

### Make targets

Working: `up`, `down`, `restart`, `build`, `rebuild`, `logs`, `ps`, `seed`, `push`,
`migrate`, `studio`, `reset`, `test`, `typecheck`, `lint`, `psql`.

> **Broken:** `make dev` and `make mobile` still invoke `flutter` against `apps/desktop`,
> which does not exist — mobile moved to Expo (`docs/06-decisions.md` ADR-3). Use
> `make ENV=local up` and start the Expo app separately.

## Status

Running system, not feature-complete (as of 2026-07-25). Asset register, custody, vehicles,
dashboard, notifications, and the conversational layer work. Procurement and maintenance are
not started; reports have no UI. Docs were reconciled against the code on 2026-07-25 —
`docs/03-data-model.md` Part A is the as-built schema, Part B is explicitly unbuilt.

See `docs/05-build-proposal.md` for the build plan, scope options, and delivery status.

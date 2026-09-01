# STInventory

Internal small-tools custody platform for Urban Infraconstruction. **The product
is called Optix**; the repository, the package scope `@stinventory/*`, the seeded
`*.local` email domain and the `sti-*` storage keys keep the old name deliberately.

pnpm + Turbo monorepo · Hono + tRPC API · Next.js 15 web (PWA) · Expo mobile ·
Drizzle/Postgres.

**Current version: `v1.0.0`** — "Optix for small tools implemented", tagged
2026-08-29.

---

## Where to go

This file is a quick start and nothing more. It deliberately does not describe the
domain model, the schema or the architecture — those live in one place each, and a
second copy here is a second thing that goes stale.

| You are… | Read |
|---|---|
| **An AI agent** | **[`LLM_RECALL.md`](LLM_RECALL.md)** — which document to trust, in what order, and which will lie to you |
| Setting it up | [`docs/SETUP.md`](docs/SETUP.md) |
| Learning the codebase | [`docs/CODEMAP.md`](docs/CODEMAP.md), then [`docs/architecture/`](docs/architecture/) |
| Looking for what the system does | [`docs/architecture/05-features.md`](docs/architecture/05-features.md) |
| Asking why something is the way it is | [`docs/changelogs/INDEX.md`](docs/changelogs/INDEX.md) |
| Deploying | [`DEPLOY.md`](DEPLOY.md) |
| Reading the plan and the ADRs | [`SYSTEM_PLAN.md`](SYSTEM_PLAN.md), [`AGENTS.md`](AGENTS.md) |
| Browsing all documentation | [`docs/README.md`](docs/README.md) |

---

## The one idea

**Where a tool is, is calculated from an append-only ledger — never typed into a
field.** `tbl_ops_transaction` is the system of record; every
`tbl_entity_asset.current_*` column is a projection of it. Ownership (who paid) and
custody (who holds it now) are separate axes, and tools follow the person, not the
site.

Everything else follows from that. [`docs/architecture/01-data-model.md`](docs/architecture/01-data-model.md)
explains why, and what it costs.

---

## Quick start (Docker)

```bash
cp .env.example .env.local      # required; the Makefile hard-errors without it
make ENV=local up               # builds + starts postgres, api, web
make ENV=local seed             # load sample data (SEED_RESET=1 to wipe first)
```

- Web: <http://localhost:3100>
- API: <http://localhost:4100> (health: `/health`)
- DB: `postgres://postgres:stinventory@localhost:5433/stinventory`

Sign in with any seeded account — `owner@stinventory.local`,
`warehouse@stinventory.local`, `foreman@stinventory.local` and others — password
**`stinventory-demo`**. One account per role, so permission differences are
visible without editing anything; the full list is `e2e/roles.ts`.

Useful afterwards:

```bash
make ENV=local psql             # the database
make ENV=local logs             # follow every service
make ENV=local reset            # when a dependency change did not take
```

### Quick start (local, no Docker)

```bash
pg_ctl -D /tmp/sti-pgdata -l /tmp/sti-pg.log start -o "-p 5433"
createdb -p 5433 stinventory -U postgres

pnpm install
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" pnpm --filter @stinventory/db push:dangerous
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" SEED_RESET=1 pnpm --filter @stinventory/db seed
```

Then, one terminal each:

```bash
# API — http://localhost:4100
DATABASE_URL="postgres://postgres@localhost:5433/stinventory" \
SESSION_SECRET="stinventory-dev-secret-please-change-to-32-chars-minimum" \
WEB_ORIGIN="http://localhost:3100" PORT=4100 \
pnpm --filter @stinventory/api dev

# Web — http://localhost:3100
NEXT_PUBLIC_API_URL="http://localhost:4100" pnpm --filter @stinventory/web dev

# Mobile (Expo) — http://localhost:8081
cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:4100 pnpm dev
```

`push:dangerous` is for a throwaway local database only. **Real schema changes go
through migrations** — `make generate`, commit the SQL, `make migrate`. The name is
a warning, not a suggestion.

**The chat parser is not a separate process.** Configure any OpenAI-compatible
endpoint at Settings → Chat parser and use *Test connection* to confirm it parses a
real sentence before relying on it.

---

## Checks

```bash
pnpm typecheck                                    # the only thing between a router edit and a broken app
pnpm --filter @stinventory/web lint
pnpm test
cd e2e && pnpm exec playwright test --project=chromium   # needs the stack up
```

> **`pnpm test` on a host with no database prints green while the suites that
> matter never run.** The database-backed tests in `api-contracts` — custody, RBAC,
> tenant isolation — skip silently without a `DATABASE_URL`. The command that
> actually runs them is in [`docs/CODEMAP.md`](docs/CODEMAP.md).

---

## Testing from a phone

```bash
brew install cloudflared                              # one-time
pnpm --filter @stinventory/web dev -- -H 0.0.0.0      # listen on the network
make tunnel                                           # prints a public https URL
```

The tunnel carries only the web page; the browser's API calls still go to
`http://localhost:4100`, so `NEXT_PUBLIC_API_URL` stays unchanged.

---

## Live deployment

Two environments, each with its own app droplet and its own database droplet
— see `DEPLOY.md` for the full topology.

| | dev (test) | production |
|---|---|---|
| Desk app | <https://urban.bodhitechlabs.com> | <https://urban.optixtec.com> |
| Field app (Expo web export) | <https://urban.bodhitechlabs.com/field> | <https://urban.optixtec.com/field> |
| App droplet | `optix-dev-app-01`, nyc1 | `optix-prod-app-01`, nyc1 |
| DB droplet | `optix-dev-db-01`, nyc1 | `optix-prod-db-01`, nyc1 |
| Branch that deploys it | `development` | `main` |
| Demo logins | on (`NEXT_PUBLIC_SHOW_DEMO_LOGINS=1`) | off |

Pushing to `development` deploys dev; pushing to `main` deploys production —
**only if** typecheck/lint/test, the production image builds, and a
migrate-and-boot smoke test all pass. A deploy that runs regardless is a
slower way to break things. Each droplet is a git checkout; `deploy.sh`
fetches and resets, which touches only tracked files, and rolls back if
`/health` never comes up.

Demo accounts are deliberately enabled on dev — it's the showcase deployment.
Production has them off. `DEPLOY.md` has the operational detail.

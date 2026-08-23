# Setup

Getting STInventory running locally, and the things that bite on the way.

## Prerequisites

Node 22+, pnpm 9+, Docker. Postgres comes from Docker — you do not need one installed.

## Bring it up

```bash
cp .env.example .env.local     # required — the Makefile hard-errors without it
make ENV=local up              # builds + starts postgres, api, web
make ENV=local seed            # sample data from the real trailer sheets
```

| Service | Where |
|---|---|
| Web | <http://localhost:3100> |
| API | <http://localhost:4100> — health at `/health` |
| Postgres | `postgres://postgres:stinventory@localhost:5433/stinventory` |

### Sign-in accounts

Password `stinventory-demo` for every account. **Development credentials only** — the seed
refuses to run against `NODE_ENV=production` for exactly this reason.

Since STI-304 there is **one account per role**, which is what makes a permission denial
observable at all: until then the only three accounts were `owner`, `equipment_admin` and
`warehouse`, all of which see everything, so no refusal had ever been exercised.

| Account | Role | Sees |
|---|---|---|
| `owner@stinventory.local` | System Administrator | Everything |
| `admin@stinventory.local` | Equipment Administrator | Everything |
| `office@stinventory.local` | Office Administrator | Everything; **no** custody, **no** config |
| `warehouse@stinventory.local` | Warehouse | Everything — the yard desk |
| `pm@stinventory.local` | Project Manager | Lone Star's tools |
| `engineer@stinventory.local` | Engineer | DART's tools |
| `super@stinventory.local` | Superintendent | His crew's tools, across two jobs |
| `foreman@stinventory.local` | Foreman | His own tools |
| `mechanic@stinventory.local` | Mechanic | His own shop tools |
| `procurement@stinventory.local` | Procurement | Everything, read-only |
| `hr@stinventory.local` | HR | People — deliberately **not** tools |
| `finance@stinventory.local` | Finance | Everything, plus the audit trail |
| `readonly@stinventory.local` | Read-only | Everything, read-only |
| `jobani@stinventory.local` | Foreman | **Deactivated** — refuses to sign in, by design |

To see the visibility ladder do something, sign in as `pm@` and `super@` side by side: each
sees tools the other cannot. The authoritative role→permission table is
`packages/db/src/role-perms.ts`; the prose version, with the questions still open with
Urban, is `docs/workings/PERMISSION_MATRIX.md`.

`SEED_RESET=1 make ENV=local seed` wipes first.

### The browser suite

```bash
make ENV=local e2e-install   # once — fetches Chromium
make ENV=local e2e           # needs the stack already up
```

It drives a real browser against `:3100` from OUTSIDE the containers, which is the only way
to test the stack rather than a process's opinion of itself. `make ENV=local up` must be
running first; the auth setup fails with a readable message if it is not.

**Read-only by design.** That is what lets it run in parallel against the shared database
with no isolation mechanism — and it means the first spec that CHANGES a row needs one
chosen first. The reasoning is in `e2e/playwright.config.ts`.

## The chat parser

No separate process. Configure a model at **Settings → Chat parser** — any OpenAI-compatible
`/chat/completions` endpoint — and use **Test connection**, which runs a real sentence through
the real prompt and reports failure if the model answers `none`.

Without a model configured, messages are still captured: they land in `pending_manual` and
wait for the desk. Nothing is lost.

The API runs in Docker, so a model server on the host must be reached via
`host.docker.internal`, not `localhost`. Small local models need a longer `LLM_TIMEOUT_MS`.

## Everyday commands

```bash
make help                  # every target, generated from the Makefile
make ENV=local logs        # follow all services
make ENV=local psql        # a shell on the database
make ENV=local reset       # down -v, up, seed — use after a dependency change
pnpm test                  # on the host
pnpm typecheck             # the real contract check across the workspace
```

## Schema changes

```bash
make generate    # writes SQL into packages/db/drizzle/ — review and COMMIT it
make migrate     # apply
```

The API container migrates on boot and refuses to serve if it fails. `push` is deliberately
named `push-dangerous`: it diffs a live database and applies with no review and no record.

## Gotchas

- **`.env.local` is gitignored and nothing creates it.** The Makefile's error message says
  "copy `.env.local`", which is circular — it means `.env.example`.
- **The `web` service has no `build:` section**; it reuses the image the `api` service builds.
  `docker compose up web` on a cold checkout fails until `api` has been built once.
- **Anonymous `node_modules` volumes survive rebuilds.** After changing any dependency, run
  `make ENV=local reset` (or `docker compose down -v`) or the stale install keeps being used.
- **`docker-compose.yml` must list a `node_modules` volume for every workspace package.** A
  package missing from that list gets an empty `node_modules` behind the bind mount, and its
  tests fail to collect with a `TSConfckParseError` about `@stinventory/config-tsconfig` —
  which looks like a code bug and is not one. Cross-check against `pnpm test` on the host.
- **Container-run make targets leave root-owned `node_modules/` and `.turbo/`** in your
  working tree. They are gitignored, but you cannot remove them without `sudo`. Stage files
  by name; never `git add -A`.
- **Mobile checks run on the host.** `apps/mobile` is not in the dev image and pins a
  different TypeScript major, so `make typecheck` fails there.

## Running without Docker

Possible but not the supported path — you need Postgres 16 on port 5433 yourself, then
`pnpm install`, `pnpm --filter @stinventory/db migrate`, seed, and start the API and web dev
servers with `DATABASE_URL`, `SESSION_SECRET`, `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` set.
`README.md` has the exact invocations.

## Remote testing from a phone

```bash
pnpm --filter @stinventory/web dev -- -H 0.0.0.0   # listen on the network
make tunnel                                         # prints a public https URL
```

The tunnel carries only the web page; the browser's API calls still go to `localhost:4100`,
so `NEXT_PUBLIC_API_URL` is unchanged. Requires `cloudflared`.

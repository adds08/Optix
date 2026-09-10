# Setup

Getting STInventory running locally, and the things that bite on the way.

## Prerequisites

Node 22+, pnpm 9+, Docker. Postgres comes from Docker — you do not need one installed.

## Bring it up

```bash
cp .env.example .env.local     # required — the Makefile hard-errors without it
make ENV=local up              # builds + starts postgres, api, web
make seed-demo                 # demo fixture — one account per permission tier
```

**Three datasets, and which one you want depends on what you are doing.**

```bash
make seed-demo    # the FIXTURE: synthetic people, one account per role
make seed-urban   # Urban's REAL register: 83 people, 753 tools, 20 jobs, 2 admins
make seed-bare    # EMPTY: one owner login, no people or tools at all
```

All three wipe first. Use `seed-demo` **before running the test suite** —
`rbac-matrix.test.ts` drives the visibility ladder through the fixture's
synthetic accounts and fails against real data, by design (see
`.claude/rules/database.md`). Use `seed-urban` to look at the product with real
data in it.

Use `seed-bare` when **BambooHR is the source of the roster**. It seeds the
vocabularies, the permission matrix and one owner login, and nothing else — the
People register then fills from the sync and from nothing else, which is the
whole point.

That login is **`optix_it@optixtec.com`**, holding `owner` — the same address
the urban dataset seeds, deliberately, so the administrator has one spelling
whichever seed ran. It holds every permission, including `config.manage`, and
has **no employee record**: an administrator is not somebody who holds tools,
and BambooHR has no reason to know about them. `user.employee_id` is nullable
and every employeeId-scoped query has a second branch for exactly this. Every register renders its empty state until you import assets;
that is not a broken seed. The owner password comes from `SEED_OWNER_PASSWORD`
or is generated and printed once, the same rule `seed-urban` follows.

Note that `make up` also seeds on first boot, and honours `SEED_DATASET` — so a
machine deliberately running bare or urban keeps it across a fresh volume rather
than silently getting the demo fixture back. It is idempotent either way: the
seed skips when a tenant already exists, so it never overwrites real data.

`SEED_RESET=1 make seed` used to seed nothing at all: `docker compose exec` does
not inherit the caller's environment, so the variable never arrived and the seed
skipped an already-populated database while printing enough to look busy. The
make targets now forward it explicitly.

| Service | Where |
|---|---|
| Web | <http://localhost:3100> |
| API | <http://localhost:4100> — health at `/health` |
| Postgres | `postgres://postgres:stinventory@localhost:5433/stinventory` |
| Mailbox | <http://localhost:8025> — every email this stack sends, delivered nowhere |

### The local mailbox

`make ENV=local up` runs Mailpit, a real SMTP server that accepts everything and
delivers none of it. `.env.local` points `SMTP_HOST` at it, so an invite sent
from `/people` arrives at <http://localhost:8025> with a **clickable link** that
completes signup and drops the new account into whatever onboarding its role
declares (`role.onboarding_kind`).

That is the whole invite -> email -> signup -> onboarding loop, testable without
sending mail to anybody. Never point a deployed environment at it.

### Urban's real register (`make seed-urban`)

Two administrator accounts, both on `SEED_OWNER_PASSWORD` (or a random one
printed once):

| Account | Role | What it is |
|---|---|---|
| `optix_it@optixtec.com` | `owner` | The ORGANISATIONAL administrator — the customer's own, confined to this tenant |
| `tech@optixtec.com` | `tech_admin` | Optix's own operator. Same grants inside the tenant; `role.is_cross_tenant` is set but **nothing reads it yet** |

No other logins. Everybody else joins through an invite, which sets their role
as it sends.

### Sign-in accounts (demo fixture — `SEED_DATASET` unset)

Password `stinventory-demo` for every account except `invited@` (below), which has none yet
by design. **Development credentials only, and only for this dataset** — the seed refuses
to run against `NODE_ENV=production` for exactly this reason. `SEED_DATASET=urban` seeds a
single real login instead; see `docs/data/README.md`.

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
| `invited@stinventory.local` | Read-only | **Invited, not yet accepted** — no working password; `make ENV=local seed` prints the accept link (`/invite/<token>`) to the console |

To see the visibility ladder do something, sign in as `pm@` and `super@` side by side: each
sees tools the other cannot. The authoritative role→permission table is
`packages/db/src/role-perms.ts`; the prose version, with the questions still open with
Urban, is `docs/workings/PERMISSION_MATRIX.md`.

`SEED_RESET=1 make ENV=local seed` wipes first.

### Checking it in a browser

There is **no committed browser suite.** The `e2e/` Playwright package and its
`make e2e` / `make e2e-install` targets were deleted on 2026-09-10: the specs had drifted
from renamed UI — clicking an "In Yard" tab that is now "Yard", asserting a "TAG" column
that is now "CODE" — and a spec naming a screen that no longer exists misleads whoever
reads it next.

Browser checking is now the Playwright MCP, driven a step at a time against the running
stack — see `.claude/skills/test-on-playwright`. It proves the change in front of you and
leaves no regression protection behind, so do not record it as coverage.

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

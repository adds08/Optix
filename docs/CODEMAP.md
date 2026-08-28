# Code map

Where things are, and what you should read before changing them. Written for
somebody — or something — arriving cold.

This is a map, not a specification. It says where to look; the file you land in
says what is true. Nothing here states a count of anything, because counts rot and
a confidently wrong number is worse than no number.

## Read these first, in this order

| # | File | Why |
|---|---|---|
| 1 | `CLAUDE.md` | The five things that must never regress, and the traps that have already cost time |
| 2 | `.claude/rules/<your area>.md` | **Nothing loads these for you.** Read the one covering the file you are about to edit |
| 3 | `docs/architecture/` | The map: data model, backend, frontend, data flow, features |
| 4 | `docs/changelogs/INDEX.md` | Why the code is the way it is |
| 5 | `AGENTS.md`, `docs/06-decisions.md` | The ADRs — read before re-opening a stack question |

## Repository

```
apps/
  api/          Hono + tRPC process, three pollers, storage, rate limiting
  web/          Next.js 15 App Router — the desk client, a PWA
  mobile/       Expo — the field client
packages/
  api-contracts/  every tRPC router · custody.ts · apply-action · approve · departure
  domain/         PURE: the fold, custodyOutcome, reconcileProjections
  intent/         PURE: chat intent catalogue and parser
  types/          PURE: enums, permission names — the shared vocabulary
  db/             Drizzle schema · migrations · seed · role-perms (the RBAC matrix)
  auth/           sessions, hashing, invite and reset tokens
  mail/           SMTP transport and message bodies
  env/            validated environment, server and client halves
  logger/         structured logging
  config-*/       shared eslint and tsconfig
e2e/            Playwright, read-only, against the Docker stack
docs/           see docs/README.md
.claude/        rules, skills, workflow config
scratch/        working area, gitignored
```

## The files that carry the invariants

If a change touches one of these, the matching rule file is not optional reading.

| File | What it owns | Rule |
|---|---|---|
| `packages/api-contracts/src/custody.ts` | **The one legitimate writer of custody.** Never insert an assignment row anywhere else | `.claude/rules/custody-and-ledger.md` |
| `packages/domain/src/fold.ts` | The fold. It *replaces*, it does not merge — which is why every ledger write needs a complete `to_state` | same |
| `packages/domain/src/rules.ts` | `custodyOutcome` — the high-value gate, and the 24-line rationale at the top is the real documentation | same |
| `packages/db/src/role-perms.ts` | The role → permission matrix, in code. The seed writes it, a test asserts it in both directions | `docs/workings/PERMISSION_MATRIX.md` for the reasoning |
| `packages/db/src/schema/` | The schema, and the authority on it | `docs/architecture/01-data-model.md` |
| `packages/db/src/seed.ts` | Not a fixture — behaviour the seed cannot produce is behaviour nobody tests | `CLAUDE.md` rule 9 |
| `apps/web/components/sti/` | The shell, the table system, the row menus | `.claude/rules/web.md` |
| `apps/web/lib/themes/` | Palettes, font and icon scale, the boot repaint | same |

## Finding your way to a change

| I want to… | Start at |
|---|---|
| Change what a screen shows | `apps/web/app/(app)/<route>/page.tsx`, then the procedure it calls |
| Change what a procedure returns | `packages/api-contracts/src/routers/<name>.ts` — then `pnpm typecheck`, because the type flows into both clients |
| Add a column | `packages/db/src/schema/<area>.ts` → `make generate` → commit the SQL → `make migrate` |
| Change who may do something | `packages/db/src/role-perms.ts`, and the `requirePermission` on the procedure |
| Change how custody moves | `custody.ts`, and read the rules file first |
| Add something the chat can say | `packages/intent/src/catalog.ts`, **and** a `case` in `apply-action.ts` or it throws at runtime |
| Change the table behaviour everywhere | `apps/web/components/sti/data-table/`, plus `.sti-grid` in `globals.css` |
| Understand why something is the way it is | `grep -rln "<filename>" docs/changelogs/` |

## Commands

```bash
cp .env.example .env.local      # required; the Makefile hard-errors without it
make ENV=local up               # postgres + api + web
make ENV=local seed             # the full demo tenant
make ENV=local psql             # the database
make ENV=local logs             # follow everything
make ENV=local reset            # when a dependency change did not take

pnpm typecheck                  # the only thing between a router edit and a broken app
pnpm test                       # see the warning below
pnpm --filter @stinventory/web lint
cd e2e && pnpm exec playwright test --project=chromium
```

**`pnpm test` on the host is not the whole suite.** The database-backed suites in
`api-contracts` skip silently without a `DATABASE_URL`, so the run goes green while
custody, RBAC and tenant isolation never execute. Run vitest inside the api
container to actually exercise them:

```bash
docker compose --env-file .env.local exec -T \
  -e DATABASE_URL='postgres://postgres:stinventory@postgres:5432/stinventory' \
  api sh -c "cd /workspace/packages/api-contracts && pnpm vitest run"
```

## Conventions that are load-bearing

- **Stage files by name.** Never `git add -A` — the tree routinely carries
  root-owned `node_modules/` and `.turbo/` left by container-run make targets.
- **Migrations, never push.** `push` is deliberately named `push-dangerous`.
- **Every diff ends with a changelog entry**, reconstructed from `git` rather than
  from memory. Commit subjects here have been `#` more than once.
- **Comments carry the rationale, not the mechanics.** This codebase's best trait:
  rules name the specific bug they prevent, often with the real tool tag involved.
- **A new dependency** may also need a line in `docker/Dockerfile.dev`'s COPY list
  *and* an anonymous volume in `docker-compose.yml`. Missing the latter silently
  stopped the tests once.
- **Verify a doc against the code before quoting it**, and fix it in the same
  change rather than noting the discrepancy somewhere else.

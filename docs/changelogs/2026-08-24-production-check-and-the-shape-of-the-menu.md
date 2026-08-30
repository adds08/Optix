# The branch could not build, and the menu had no rule for what comes next

Two unrelated things, done together because the second is worthless if the first is true.

The pre-production check found that `development` could not build a production image or pass
CI. Separately, Urban asked how the product should be arranged once timesheets, purchase
orders and project operations arrive — a question the menu had no answer to, because its
groups were named after whatever was in them at the time.

No feature code changed. This is a build fix, a set of decisions, and the plan that follows
from them.

## What changed

### The lockfile, and the manifest the web image never copied

`d79c4cd` added `@stinventory/mail` to `packages/api-contracts/package.json` and did not
regenerate `pnpm-lock.yaml`. `pnpm install` regenerates it; the diff is six lines.

`docker/Dockerfile.web` also never got `COPY packages/mail/package.json packages/mail/`.
`Dockerfile.api` and `Dockerfile.dev` both have it. Added, with the reason attached: `mail`
is a **transitive** dependency of `web` — nothing under `apps/web` imports it — which is why
the existing warning comment in that file was not enough to prevent the omission.

### Four ADRs, because the menu question is an architecture question

`docs/06-decisions.md` gains ADR-9 to ADR-12.

- **ADR-9 — navigation is organised by resource, not by department.** Departments
  reorganise and cross-cutting records have two of them; a purchase order for tools belongs
  to Procurement and to Equipment. Resources are stable. The consequence worth knowing:
  **departments are not modelled at all.** Someone's permissions already say which part of
  the product is theirs, and the shell's existing drop-empty-group rule hides the rest.
- **ADR-10 — a nav row is a route plus a preset.** Tool purchase orders and equipment
  purchase orders are one screen and one table with a `resource_kind`, not two of each. This
  is what stops the menu doubling per resource. It also caps the new third nav level: a
  third-level row must be a preset of its parent's record type.
- **ADR-11 — module visibility is configuration, never authorisation.** Urban wants Hand Off
  and the HR surfaces gone from this release. They get hidden by a tenant setting, and every
  permission check behind them stays exactly where it is.
- **ADR-12 — a platform administrator is a separate identity, not a role in a tenant.**
  Designed, deliberately not built. A privileged role that skips the tenant predicate needs
  an exception in every query in the system, and the predicate *is* the isolation.

### SYSTEM_PLAN §2 and §7

§2 gains the five tiers of administration and says which exist. §7 gains the grid the whole
arrangement rests on — resource × activity, charged to a project — and the three rules that
follow from it.

### One SYSTEM_PLAN, not two

There were two tracked copies. `AGENTS.md` and `docs/README.md` both named
`docs/workings/SYSTEM_PLAN.md` as canonical; the root copy was the one people actually
edited, and by the time this was noticed it was 140 lines ahead. The subsection structure
was identical, so the `workings/` copy is now a pointer and both indexes name the root. The
old content is in git history.

### The vocabulary file was asserting things nobody had checked

`docs/09-vocabulary.md` listed "gang box, yard, job site" under **actual field words**. Urban
does not use "gang box", and there is no yard entity — a tool with no project is in the pool,
which the Pool tab already shows. Corrected, with a note that a row in that file claiming
what Urban *calls* something is a claim about the world and needs the same verification as a
claim about the code.

### The database suites now run in CI

The `check` job ran `pnpm test` with no Postgres service. Every DB-backed suite opens with
`describe.skipIf(!process.env.DATABASE_URL)` — correct on a laptop, a hole in CI — so 178 of
245 tests skipped and the job reported success. Custody, tenant-scoped login, ledger
append-only, project scope and the RBAC matrix were all in the skipped set, which is exactly
what the workflow header says nothing reaches main without.

`check` now gets the same Postgres service the `smoke` job already uses, plus a `Migrate`
step before `Test`. And `packages/api-contracts/src/db-suites-run.test.ts` fails the build if
`CI` is set without `DATABASE_URL` — a skip is invisible by construction, so something has to
assert on it. A second case in that file fails if the guard string is respelled, so the
watcher cannot quietly stop watching.

### Release 2 sprint plan

`docs/workings/RELEASE_2_SPRINT_PLAN.md`. Five epics, 162 hours: ship-blockers, the
navigation frame, the two organisation records Urban confirmed they need, the assigned-where
dashboard, and removing what nothing uses. It reuses Release 1's story format and sizing
table by reference rather than restating them.

## What was found while building it

- **`pnpm test` was a false green: 178 of 245 tests skipped.** Fixed, above. The part worth
  keeping: **the suites were never broken.** Run in the api container they are 245/245
  passing and had been all along. Nobody had run them where they could see a database since
  the harness was written, and a skip prints as a pass at a glance — which is how this
  survived an entire release.
- **A security review of the running stack found one real misconfiguration.**
  `apps/api/src/index.ts:56` sets `origin: (origin) => origin ?? env.WEB_ORIGIN` with
  `credentials: true`, which reflects any caller's origin back as
  `Access-Control-Allow-Origin`. Not currently an account-takeover — the session is a bearer
  token in `localStorage`, so a browser will not attach it cross-origin — but it becomes one
  the moment anyone adds a cookie, and `credentials: true` says somebody intended to.
  STI-1601, not fixed here because it was outside what was asked.
- **The Drizzle SQL-injection advisory has no reachable path.** `drizzle-orm` 0.36.4 is below
  the 0.45.2 fix for improperly escaped identifiers, but the only dynamic-identifier surface
  is `table-helpers.ts`, where sort keys resolve through a whitelist `SortableMap` and an
  unknown key returns `undefined`. Worth upgrading; not an incident.
- **Four routers have no caller.** `location.create/update/delete`, `department.create/update`,
  `vehicle.create/delete` and `category.rename/delete` all work and none can be reached from
  the app. Today you cannot create a department from the interface.
- **`manufacturer`, `asset_model` and `asset.modelId` are vestigial** — `asset.ts:28` says so
  outright. Only the seed populates them; no router, intent or UI joins back.
- **Three of five `LOCATION_TYPES` have zero rows anywhere**: `gang_box`, `site_container`,
  `project_site`.
- **`packages/notifications/` contains only `node_modules`** — no manifest, no source, not in
  the lockfile. `apps/web/app/(app)/rentals/` and `.../foremen/` are empty directories.
- **Urban's answer on reference data reshaped the plan.** The first proposal had a Reference
  Data group with four rows. None survived: locations are not distinct from projects,
  vehicles are equipment, and categories are a tag rather than a register. Departments and
  teams are the two that are real. The proposal had also invented a "Yards" register that
  corresponds to nothing.

## Verified

- `pnpm install --frozen-lockfile` fails on `d79c4cd` and succeeds after the regeneration.
- `pnpm typecheck` — four `TS2307`s in `apps/web` before, **14/14 tasks passing** after.
- **Both production images build.** `docker build -f docker/Dockerfile.web` → 301MB,
  `-f docker/Dockerfile.api` → 1.33GB, both exit 0.
- **`make test` — 247 passed, 0 skipped** in the api container, including the two new guard
  cases.
- The guard test proven in all three states: passes with no `CI`; fails with `CI=true` and no
  `DATABASE_URL`, printing the fix; passes with both set.
- All three CI jobs and all three Dockerfiles use `--frozen-lockfile`; confirmed by grep.
- Migrations are clean: 26 SQL files, 26 journal entries, no drift.
- Both SYSTEM_PLAN copies have identical `###` structure; confirmed by diff before collapsing.

**Not verified:** the amended `check` job has not run on GitHub — the workflow is edited and
the local equivalent passes, but CI itself has not executed it. Whether the images *boot* is
also untested; they build. That is STI-1104.

## Deliberately not done

- **`.claude/rules/web.md` was not rewritten.** It accurately describes the shell as built —
  two levels, two hard-coded arrays, no ids. Describing the three-level version before it
  exists would make the file wrong, which is the exact failure that section warns about. It
  gains a forward pointer to the ADRs and a note that STI-1207 rewrites it when E12 lands.
- **No navigation code changed.** The retree is STI-1202.
- **The vestigial tables were not dropped.** Destructive migration against live data; it
  needs the deploy rehearsal and a backup first (STI-1501).
- **`gen-jira.js` was not pointed at Release 2.** It still generates Release 1 only, and
  `docs/README.md` now says so.
- **Nothing was committed.** All changes are in the working tree.

## Where it is

Branch `development`, uncommitted. Not deployed. `pnpm-lock.yaml` and
`docker/Dockerfile.web` are the two files that must ship before anything else can.

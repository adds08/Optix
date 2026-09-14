# Production readiness — Optix

**Date:** 2026-09-14
**Assessed by:** code read, live queries against the local stack, two independent audits
**Method:** every claim cites a file or a measured result. Anything that could not
be verified from the repo is marked UNVERIFIED rather than guessed.
**Nothing was changed.** This is a report.

---

## The headline

**The application is in good shape. The launch is blocked by data and by
operations, not by code.**

Three things would stop me shipping this to a paying client tomorrow, and none
of them is in the product:

1. **There is no backup of the custody ledger.** None. Anywhere.
2. **Nothing would tell you the system is down**, or that a background worker
   has stopped.
3. **The register is empty**, and the path to filling it needs four answers
   from Urban that nobody has yet given.

Everything else on this list is a judgement call you can make with the risk
written down.

---

## Measured state

| | |
|---|---|
| Typecheck | 13/13 clean |
| Lint | 0 errors, 8 unused-import warnings |
| Tests | **777 passing**, 0 failing (with `DATABASE_URL` set — without it 453 silently skip) |
| Migrations | 73, applied cleanly to a database built from zero |
| CHECK constraints | 23 |
| Procedures | 170 across 29 routers |
| Register contents | 0 employees, 0 tools, 0 vehicles, 2 logins |

---

## BLOCKERS

### B1 — No backup of the custody ledger

The most serious finding in this report, and it is unambiguous.

A repo-wide search for `pg_dump`, `pgbackrest`, `wal-g`, `barman`, `backup`,
`snapshot` and `cron` returns **two prose comments and no code**
(`packages/auth/src/secrets.ts:8`, `packages/db/src/schema/identity.ts:384` —
both merely reason about what a dump would expose). `docker/deploy.sh` does not
dump before migrating. `Makefile` has no backup target. CI has no backup step.

Compounding it:

- **Migrations run automatically on container boot**
  (`docker/Dockerfile.api:95` — `node dist/migrate.js && node dist/index.js`).
- **There are no down-migrations.** 73 forward files, none reversible.
- **The rollback rolls back CODE, not SCHEMA.** `docker/deploy.sh:103-108`
  resets the checkout and rebuilds — but the migration has already committed.
  Old code then runs against a new schema. Migration `0070` drops three
  columns; a rollback past it leaves code reading columns that no longer exist.
- The append-only ledger trigger protects against application bugs. It does
  nothing against a dropped table, a bad migration, or losing the droplet.

This is a custody register. If it is lost, the client's record of who holds
which tool is gone, and it cannot be reconstructed from anywhere else.

**Minimum to launch:** a nightly `pg_dump` to off-box storage and **one
rehearsed restore**. The data is small; this is hours of work, not days.

**UNVERIFIED:** whether DigitalOcean-level backups exist on the database
droplet. If they do, this drops to SHOULD-FIX — but confirm it, and confirm a
restore has actually been tested. Weekly droplet snapshots would mean up to
seven days of custody history lost.

### B2 — Nothing watches the system

No error tracking, no alerting, no uptime monitoring. Searches for
`sentry|datadog|newrelic|opentelemetry|prom-client|statsd` return **zero hits**
across the repo.

- Logging is structured pino to stdout (`packages/logger/src/index.ts`) — good
  — but it is **shipped nowhere and retained by nothing**.
- `/health` (`apps/api/src/index.ts:58`) returns `{ok:true}` unconditionally.
  It checks neither the database, nor storage, nor the workers. A container
  with a dead connection pool still reports healthy.
- Health is only polled **during a deploy**. Nothing polls it afterwards.

**The workers are the acute risk.** All five `setInterval` loops in
`apps/api/src/index.ts` catch their own errors and log. So a worker that throws
on every tick writes to a stream nobody reads **while the API stays healthy**.
If the messaging worker stops, foremen's chat requests sit queued forever and
the only signal is a log line.

The 6-hourly reconciliation sweep — the one thing that would detect ledger
corruption — reports via an in-app notification, visible only if somebody logs
in and looks at the bell.

**Minimum to launch:** an external check hitting `/health` every few minutes
with a real alert, and errors shipped somewhere a human sees. A free uptime
monitor plus Sentry closes most of it.

### B3 — Custody has no import path

753 tools, 673 with a named custodian in `docs/import/05-custody-MANUAL.csv`,
and **that file is read by no code at all.** There is no custody importer,
deliberately: opening a custody link writes a ledger event, and the ledger is
the system of record, so a bulk path has to go through `moveCustody`.

**The template already exists.** `apps/api/src/demo-data.ts:391-423` loads
custody through the real `assignment.create`. It hands out a hardcoded 12 tools
to 3 demo people; pointing it at the real CSV is roughly half a day.

**The decision, not the code, is the blocker:** does day one need all 753 tools
in the right hands, or is "tools land in the yard and custody builds up as
foremen collect them" acceptable? The second is free.

### B4 — Four data questions only Urban can answer

None of these need code. All of them block the import, and two are expensive to
change afterwards.

| | Question | Why it is urgent |
|---|---|---|
| **1** | **Do VINs matter?** The vehicle import spec has no `vin` column (`packages/types/src/import-specs.ts:201-214`) though the database does. 49 real VINs are lost on import. | Must be decided BEFORE importing. Re-importing 88 vehicles after custody is attached is painful. This one needs a one-field code change if the answer is yes. |
| **2** | **Does Urban use gang boxes or site containers?** Four location types exist; none was ever used. | Blocks locations, which blocks tools, which blocks custody. |
| **3** | **What are jobs 25001, 25015 and 24015 called?** | Three unnamed projects. Smaller than the docs claim — see below. |
| **4** | **Are project dates real?** Every row carries placeholder `2025-01-06` → `2030-12-31`. | Every project will look permanently active. |

---

## SHOULD-FIX — launch with the risk written down

| # | Finding | Evidence |
|---|---|---|
| S1 | **In-flight requests are dropped on every deploy.** Single instance, no `SIGTERM` handler, no graceful shutdown. `deploy.sh:66` warns of "a short 502 during the swap". Mitigated by the 5-minute sweeper that unsticks stranded work — but only if the sweeper is alive, which B2 means you cannot know. | `apps/api/src/index.ts`, `docker/deploy.sh:66` |
| S2 | **Rate limiting is spoofable.** Keyed off client-supplied `X-Forwarded-For` with no trusted-proxy validation. Unlimited login attempts against bcrypt cost 12 is also a CPU-exhaustion vector on a 1GB droplet. Caddy is in front and knows the real address — have it overwrite rather than append. | `apps/api/src/rate-limit.ts:74-75` |
| S3 | **The SMS toggle saves a flag nothing reads.** `/settings` renders an SMS checkbox and persists it; Twilio was deliberately removed and the delivery loop never consults it. In fairness the section text already says "SMS has no provider wired up yet" (`:160`) — so this is a control that is honestly labelled and still switchable, rather than an outright lie. Disable it or make it read-only. | `settings/page.tsx:160,169`, `packages/env/src/server.ts:17-18` |
| S4 | **An alert names a button that does not exist.** The custody-discrepancy notification says "then Rebuild fixes these". `asset.rebuild` has no screen. | `apps/api/src/index.ts:735` |
| S5 | **No department creation screen.** Departments are the cost target for shop tools; only `department.list` is wired, as a picker over an empty table. You cannot create the first one through the UI. | reachability register |
| S6 | **No category management screen.** 753 tools arrive uncategorised, categories can be created inline as free text, and there is no screen to rename, delete or tidy them. | reachability register |
| S7 | **No help anywhere in the product.** No Help, Docs, Support or Guide link in the navigation — zero hits. Nothing explains ledger-vs-register, custody-vs-location, "rides in TE-006", the approval gate, deferrals or tiers. **This is the stated reason the launch failed** ("features are very hard to explain"), and it is the cheapest item on this list. | `nav-config.ts` |
| S8 | **Unbounded queries.** `asset.list` returns every tool with no limit; `notification.list`/`.all` have no limit over a table that grows forever and which the 6-hourly sweep writes to without dedupe. Fine at 760 tools; no ceiling. | `routers/asset.ts:38`, `routers/notification.ts:18-40` |
| S9 | **The reconciliation sweep loads the whole ledger into memory** every 6 hours, on a 1GB droplet, over a table that is never pruned. A dated fuse. | `apps/api/src/index.ts:674-677` |
| S10 | **Stale docs that will misdirect the first operator.** `docs/import/README.md` says import lives at "Settings → Import" (no such route — it is per-entity buttons); its ordering table puts People after Vehicles when vehicles reference foremen by name, so People must come first; and it says 8 projects are unnamed when only 3 are. | verified against the routes and `demo-data.ts:203,231` |
| S11 | **`reachability.test.ts` is wrong about `assignment.return`.** It says "there is no button anywhere". There are four — they route through `action.submit`, which the grep misses. Someone will build a duplicate screen. | `asset-actions.tsx:71`, `tool-menu.tsx:136` |
| S12 | **Mobile `/field` is built by hand and never in CI**, and is excluded from deploys so it is never overwritten. It can silently drift against the API with nothing to detect it. | `docker/rsync-exclude.txt:36-37` |

---

## Confirmed good — do not spend time here

This is a better-engineered system than the failed launch implies.

- **Deployment is repeatable and gated.** CI runs check → build → smoke, and
  `deploy-prod` requires all three, on `main` only, with a pinned host key. The
  deploy key is restricted server-side to running one script, so a leaked CI
  secret cannot run arbitrary commands. Prod and dev use distinct keys.
- **Rollback is real for code.** `deploy.sh` waits five minutes for health and
  resets to the previous commit if it never comes up. (It does not roll back
  schema — see B1.)
- **Secrets are clean.** `git ls-files` shows only `.env.example`.
  `assertProductionSafe` blocks example values, low-variety secrets and plain
  http on a non-localhost origin. Compose hard-fails on missing required vars.
- **TLS and headers are right.** Caddy terminates with automatic renewal; HSTS,
  `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, server banner stripped.
  The short HSTS is deliberate and explained.
- **CORS is fixed** — and the rule file claiming otherwise is stale, which is
  the dangerous direction for a doc to be wrong in.
- **SQL injection surface is effectively nil.** Sort keys are whitelisted;
  `pageSize` capped at 100; the only `sql.raw` is in a test.
- **File upload is properly guarded**: auth, tenant scope, MIME allowlist, 8MB
  cap, original filename discarded for a UUID.
- **Passwords**: bcrypt cost 12 with rehash on login, 10-char minimum at three
  layers, reset tokens SHA-256 hashed, single-use, 1-hour expiry, and consuming
  one revokes every existing session. Forgot-password cannot be used to
  enumerate accounts.
- **Tenant isolation is guarded by a build-time scan** that fails on a write to
  a tenant-scoped table with no tenant predicate, exempting only the three
  background workers, each with a written reason, and asserting that nothing
  under `routers/` may ever be exempt.
- **All 6 notification types have real writers.** Email delivery is real with
  bounded retries. The three aspirational types were already cleaned up.
- **`make demo` exists** — an idempotent, local-only, opt-in dataset built by
  pushing the CSVs through the real importers and the real custody writer. It
  refuses to run against production twice over. This is the right shape and it
  is the template for B3.

---

## What I would do, in order

**Before launch — non-negotiable**

1. **Nightly `pg_dump` off-box, and restore it once to prove it works.** (B1)
2. **Uptime check on `/health` with a real alert, plus error tracking.** (B2)
3. **Get the four answers from Urban.** (B4) The VIN one first — it is the only
   one that is expensive to change later.

**Before launch — cheap and high value**

4. **A `/help` page** explaining six concepts in plain words, linked in the
   sidebar. This targets the actual stated reason the first launch failed, and
   it is perhaps a day's work. (S7)
5. **Decide the custody approach** and, if day-one accuracy is needed, point
   the existing demo loader at the real CSV. (B3)
6. **Disable the SMS toggle** and **remove the "Rebuild" instruction** from the
   discrepancy alert. Both are the product lying to a user. (S3, S4)

**Shortly after**

7. Department and category management screens — the incoming data needs both.
8. Fix `X-Forwarded-For` handling at Caddy. (S2)
9. Correct the stale import docs and the `assignment.return` note before they
   misdirect somebody. (S10, S11)

**Before a second tenant** — not before this one

10. A read-side equivalent of the tenant-predicate scan, or adopt RLS. The
    write side is guarded; reads are not, and there is no database-level
    backstop.

---

## Two things to confirm outside the repo

- Is the production database firewalled to the VPC?
- Do DigitalOcean backups exist on it, and has a restore ever been tested?

Both change the severity of B1, and neither can be answered from the code.

---

# Decisions recorded 2026-09-14

The four blocker questions in B3/B4 were answered by the client. Recorded here
with what each one changes, and what was VERIFIED against the code rather than
taken on trust. **No code was changed** — this is still a report.

## D1 — Custody: import once, then maintained by hand

> "First import will have the latest data for custody of small tools, later it
> will be updated by concerned people."

So day one DOES need all 753 tools in the right hands. That settles B3 in favour
of the bulk loader rather than "let custody build up naturally".

**What it needs:** point the existing loader at the real CSV.
`apps/api/src/demo-data.ts:391-423` already walks tools and calls the real
`assignment.create`, so custody lands through `moveCustody` and writes proper
ledger events — it just hands out a hardcoded 12 tools to 3 demo people today.
`docs/import/05-custody-MANUAL.csv` has 753 rows, 673 with a named custodian.

Roughly half a day, and it is the ONLY remaining code work among these four.

**One thing to decide with it:** verified 753 rows, **673 with a named
custodian and exactly 80 blank**. Those 80 should land in the yard rather than
be skipped, or they vanish from the register entirely — and per D2, "if it is
in with equipment department it goes to yard project" already answers where:
the yard.

## D2 — Remove gang boxes and site containers

> "Project is being done in a location, and small tools are contained within a
> trailer assigned to a foreman and attached to truck, foreman works in a
> project, that's all... if it is in with equipment department it goes to yard
> project, simple as that!"

This is a genuine simplification and the model already supports it — the two
values being removed were never used by anything.

**VERIFIED before recording it.** `LOCATION_TYPES` has five values; only
`vehicle` is special-cased anywhere in the custody logic
(`routers/location.ts:513,530`). `warehouse`, `site_container`, `gang_box` and
`project_site` are interchangeable labels to every other code path, so dropping
two changes no behaviour. The blast radius is small:

| Site | What changes |
|---|---|
| `packages/types/src/enums.ts:12-13` | remove the two values |
| `apps/web/components/location-form.tsx:33,88-89` | remove two options; the default `site_container` must change — `warehouse` is the sensible one |
| `packages/types/src/import-specs.ts:179` | the `gang_box` example |
| `packages/db/drizzle/0072` | a new migration narrowing the CHECK (do not edit 0072) |
| `departure.test.ts:319`, `import-commit.test.ts:338` | two fixtures use `gang_box` |

**The one risk, and it is small today:** a CHECK narrowing fails if any row
holds a removed value. The local register has zero locations, and Urban's
recovered data was "1 warehouse + 31 vehicle mirrors" — so nothing to migrate.
**Verify against production before running it**, and if rows exist, map them to
`warehouse` in the same migration.

This also closes B4-2 and unblocks the locations step: the import file becomes
one warehouse row, because vehicle locations are created by the vehicle
importer itself.

## D3 — VINs matter, nullable, and they belong to equipment

> "Yes VIN matter but should be isNull, VIN numbers are for equipment table"

**Already true at the database.** `vehicle.vin` is `text("vin")` — nullable —
with no unique index (verified by querying `pg_indexes`). The schema comment
already records why that is deliberate: Urban's real fleet has a
sixteen-character VIN and five trucks sharing an improbable prefix, and a
constraint would abort a whole import over one typo.

`tbl_entity_vehicle` IS the equipment table, so "VINs are for equipment" is
already how it is modelled. Small tools (`tbl_entity_asset`) have
`serial_number` instead, which is the manufacturer's — a different thing, and
correctly separate.

**The gap is in TWO places, and the second one matters more.**

1. `packages/types/src/import-specs.ts` vehicle entity has no `vin` key. One
   optional field, no migration.
2. **`docs/import/02-vehicles.csv` has no `vin` COLUMN either** — verified, its
   header is `unit,type,code,description,plate,make_model,ownership,project,foreman`.
   So adding the spec field alone would import nothing. The README's "49 real
   VINs" refers to the DELETED SEED, not to the CSV.

**The data is recoverable, and it is better than the README claims.** The
deleted seed carries **88 VINs, not 49** — one per vehicle, real 17-character
numbers:

```
git show bd98798:packages/db/src/seed-data.urban.ts | grep "vin:"
```

So the work is: add the column to the spec, regenerate the CSV with the VIN
column populated from that git object, then import. Still small, but it is a
data-recovery step and not just a one-field change — and it has to happen
BEFORE the vehicle import, because re-importing 88 vehicles after custody is
attached to them is the expensive path.

## D4 — Project names: you were right, and it is 3 not 8

> "I feel like every project in screenshots are named... but please verify."

**Verified. You are right.** `docs/import/project-extraction/projects.csv` has
28 rows and **zero** placeholder names — it carries real names plus cost,
location, directors and crew, which is consistent with it coming from the
directors' crew spreadsheets rather than the screenshot.

The "8 unnamed jobs" figure comes from the OLD `01-projects.csv`, which has 9
`Job NNNNN` rows. Cross-referencing the two files:

- **6 of the 9 are resolved** by the extraction (24002, 24014, 25008, 25011,
  26002, 26007)
- **3 codes appear ONLY in the old file and are absent from the extraction
  entirely**: **24015, 25001, 25015**. Each has no name, no site address and
  placeholder dates.

So the remaining question is not "what are these called" but **"do these three
jobs still exist?"** If they are closed or were never awarded, the answer is to
drop them and import 28 rows. That is a question for whoever owns the crew
spreadsheets.

**B4-4 (project dates) stays open** — every row in both files carries
`2025-01-06` → `2030-12-31`, so every project will render as permanently
active. The extraction does not carry dates, so this cannot be resolved from
the files that exist. It is cosmetic on day one and worth fixing before anybody
trusts a date on screen.

---

## Blocker list after these decisions

| | Was | Now |
|---|---|---|
| B1 backups | BLOCKER | **BLOCKER — unchanged.** Still the most serious item. |
| B2 monitoring | BLOCKER | **BLOCKER — unchanged.** |
| B3 custody import | BLOCKER (decision) | **half a day of code**, decision made |
| B4-1 VIN | BLOCKER (decision) | decision made; needs an import field **and** a CSV regenerated from git — 88 VINs recoverable, not 49 |
| B4-2 locations | BLOCKER (decision) | **resolved** — removing two enum values simplifies it |
| B4-3 project names | BLOCKER (decision) | **resolved to 3 codes**: do 24015, 25001, 25015 still exist? |
| B4-4 project dates | — | **open**, cosmetic, not in any source file |

**The two real blockers are both operational, and neither needs the
application touched.** Everything the client answered turned out to be either
already-correct modelling or a small, contained change.

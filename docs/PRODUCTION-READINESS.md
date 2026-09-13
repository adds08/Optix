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

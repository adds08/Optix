# Deploying Optix

**Written for:** whoever is on the hook when it breaks — not necessarily the
person who wrote it.

This file is referenced by `docker-compose.prod.yml`, `.github/workflows/ci.yml`
and `docker/deploy.sh`, and did not exist until 2026-09-14. Everything in it was
read off those files or verified against a running stack.

---

## The shape of it

Two droplets per environment, and Postgres is deliberately not on the app box:

```
optix-prod-app-01   caddy (443) → web (3100) · api (4100) · minio
optix-prod-db-01    postgres 16, reachable only over the VPC private IP
```

| | Production | Dev/test |
|---|---|---|
| URL | urban.optixtec.com | urban.bodhitechlabs.com |
| App droplet | 157.245.129.195 | 68.183.27.164 |
| Directory | `/opt/optix` | `/opt/optix` |
| Branch | `main` | `development` |

Caddy is the only thing bound to a host port, so Postgres and MinIO are not
reachable from the internet at all. TLS is Caddy's, renewed automatically.

## How a deploy happens

**Normally: merge to `main`.** CI gates it on three jobs — `check` (typecheck,
lint, 789 tests against a real Postgres), `build` (both production images) and
`smoke` (boots the API against a fresh migration). Only then does `deploy-prod`
run, and it SSHes in with a key **restricted server-side to running
`docker/deploy.sh`** — so a leaked CI secret cannot run arbitrary commands.

**By hand:** `make deploy` (prod) or `make dev-deploy`.

`docker/deploy.sh` then: fetches, resets to the target commit, rebuilds,
restarts caddy, **waits up to 5 minutes for `/health`**, and **rolls back to the
previous commit if it never comes up**.

### The one thing rollback does NOT cover

**Schema.** Migrations run on API boot (`Dockerfile.api`: `migrate && index`)
and the rollback only resets the checkout. So a rollback past a destructive
migration leaves old code against a new schema — migration `0070` drops three
columns, and code from before it would read columns that no longer exist.

There are **no down-migrations**, by design. So:

> **Take a backup before deploying anything that drops or renames a column.**
> `make prod-backup`. This is the entire mitigation.

## Required configuration

`/opt/optix/.env.production`, gitignored, never in the repo. Compose hard-fails
on the first three via `${VAR:?}`.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | the DB droplet's VPC private IP |
| `SESSION_SECRET` | **yes**, ≥32 chars | see the warning below |
| `WEB_ORIGIN` | **yes** in prod | must be https on a non-localhost host |
| `S3_*` | for photos | MinIO on the app box |
| `SMTP_*` | for invites | without it mail logs to console and reports success |
| `BAMBOOHR_*` | for the HR sync | absent = no sync, no error |
| `LLM_*` | for chat parsing | absent = chat falls back |

`assertProductionSafe` (`packages/env/src/server.ts`) refuses to boot production
with a known example secret, a low-variety secret, or plain http on a
non-localhost origin.

### SESSION_SECRET is not just a session key

It derives (scrypt) the AES key encrypting every tenant's **LLM key and SMTP
password**. Rotating it makes all of them undecryptable — and `decryptSecret`
returns null rather than throwing, so it surfaces as "the key needs
re-entering" on every tenant at once with nothing naming the cause.

> **Rotating `SESSION_SECRET` requires re-entering every tenant's LLM key and
> SMTP password.** Nothing automates that re-encryption.

## First deploy of a new tenant

```bash
make migrate                                    # 73 migrations
ADMIN_PASSWORD=<pick-one> make provision        # idempotent, never overwrites
```

`provision` writes the authority model and **exactly two logins** —
`tech@optixtec.com` (Optix's operator) and `optix_it@optixtec.com` (the
customer's administrator), both `mustChangePassword`. It writes **no business
data**: an empty register is the correct state of a new tenant.

Everything else arrives through the importers (`docs/import/README.md`) and the
BambooHR sync. Every other account joins by invitation.

**Verify the provision took**, because this failed silently until 2026-09-14:

```sql
SELECT name, needs_login, onboarding_kind, claim_tier_names
FROM tbl_entity_role WHERE name IN ('director','hr','foreman');
```

`director` must show `["director"]`, `hr` must be `people`, `foreman` must be
`none`. If `claim_tier_names` is `[]`, nobody can claim a job and therefore no
job can be staffed at all — that was F-01, and
`provision-role-flags.test.ts` now guards it.

## Backups

**Set up before the client has real data in it.**

```bash
# On the app droplet, nightly:
0 2 * * * cd /opt/optix && ./docker/backup.sh >> /var/log/optix-backup.log 2>&1
```

Set `BACKUP_S3_TARGET` in `.env.production` or the dump exists **only on the
droplet**, which does not survive losing the droplet — the case it exists for.
The script warns loudly when it is unset.

It verifies every archive before reporting success: `pg_restore --list` must
show >50 objects and contain `tbl_ops_transaction`. A dump that will not restore
is not a backup.

```bash
make prod-backup     # run one now, same script cron runs
make prod-backups    # list what exists
```

### Restoring — rehearse this before you need it

```bash
createdb optix_restore
pg_restore --dbname=postgres://…/optix_restore --no-owner --no-privileges <dump>
```

Verified on 2026-09-14: a restore reproduces every table exactly, and keeps both
the append-only ledger trigger and all 23 check constraints.

## Monitoring

**`/health` is the endpoint to watch.** Since 2026-09-14 it actually checks
things:

```json
{"ok":true,"db":"ok","workers":{"messaging":"3s ago", …}}
```

- **`503`** = the database is unreachable. The product is down.
- **`degraded: true`** with `stale: [...]` = a background worker has not
  completed in three of its own intervals. The API still serves.

Point an uptime monitor at it every 1–5 minutes. **Alert on the status code** —
the five workers catch their own errors by design, so a worker throwing on every
tick is otherwise invisible: if the messaging worker stops, foremen's chat
requests queue forever with no signal.

**Still missing, and worth adding:** error tracking. Logs are structured JSON to
stdout and are shipped nowhere.

## When it breaks

| Symptom | Check |
|---|---|
| Site down | `make prod-status`, then `make prod-logs` |
| `/health` 503 | the DB droplet, and the VPC route to it |
| `degraded` | `make prod-logs` for `[messaging-worker]` / `[request-worker]` |
| Deploy "succeeded", old code | caddy needed a restart; `deploy.sh` does this |
| Nobody can be placed on a job | the provision check above — this is F-01 |
| Invites not arriving | `SMTP_*`; without it mail logs and reports success |
| Photos 404 | `S3_PUBLIC_URL` — it already includes the bucket, do not add it twice |

## Known operational limits

- **Single instance.** No `replicas` in the compose file. The API is also all
  five background workers; the message worker claims rows without
  `FOR UPDATE SKIP LOCKED`, so two instances double-claim.
- **No graceful shutdown.** In-flight requests are dropped on restart, and
  every deploy is a restart. Deploy outside working hours.
- **Rate limiting is in-memory** and keyed off a client-supplied
  `X-Forwarded-For`. Resets on deploy, and is spoofable — have Caddy overwrite
  that header rather than append to it.
- **1GB droplet.** The image is built on the box; `deploy.sh` notes this is slow
  and briefly starves the running containers. Building in CI and pulling is the
  obvious next step.
- **No RLS.** Tenant isolation is the correctness of every `WHERE` clause, with
  a build-time scan over writes. Reads are not equivalently guarded — worth
  closing before a second tenant.

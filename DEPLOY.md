# Deployment — urban.bodhitechlabs.com

Live since 2026-07-27. DigitalOcean droplet `stinventory-01`, `68.183.27.164`,
nyc1, 1 vCPU / 1GB / 25GB, **$6/mo**, plus a 3GB swap file.

> `doctl` must be on the **`urban`** context (`it@urbaniconstruct.com`).
> The `default` context is a different account entirely — check with
> `doctl auth list` before any command that creates or bills.

---

## How one hostname serves every service

There is exactly **one** public hostname and **one** certificate. Caddy is the
only process bound to the host's network; everything else talks over the
private Docker network and is unreachable from the internet.

```
                    urban.bodhitechlabs.com
                        (A → 68.183.27.164)
                              │
                        :443  │  :80 → redirected to :443
                              ▼
                    ┌───────────────────┐
                    │      caddy        │  Let's Encrypt, auto-renewing
                    └─────────┬─────────┘
             ┌────────────────┴────────────────┐
             │ path-based routing              │
             ▼                                 ▼
   /trpc/*  /auth/*  /health              everything else
             │                                 │
             ▼                                 ▼
      ┌────────────┐                    ┌────────────┐
      │    api     │ :4100              │    web     │ :3100
      │  (Hono)    │                    │ (Next.js)  │
      └──────┬─────┘                    └────────────┘
             │
      ┌──────┴──────────────────────┐
      ▼                             ▼
┌──────────┐              ┌────────────────────┐
│ postgres │              │ LLM provider (per  │
│  :5432   │              │ tenant, Settings)  │
└──────────┘              └────────────────────┘
   internal                       outbound
```

| Path | Goes to | Why |
|---|---|---|
| `/trpc/*` | api:4100 | The entire tRPC surface — every query and mutation |
| `/auth/*` | api:4100 | Login and logout |
| `/health` | api:4100 | Liveness, also used by the container healthcheck |
| `/media/*` | minio:9000 | Tool photos. Caddy prepends the bucket, so rows store a bare object key |
| `/field/*` | disk | The Expo app, exported by `expo export` and served from `/srv/field` |
| everything else | web:3100 | Next.js owns all remaining routes |

**Why one hostname rather than `api.` and `app.`:** same-origin means one
certificate, no CORS preflight on every request, and — the part that actually
matters — the browser is never told to trust a second origin with a session
token. `NEXT_PUBLIC_API_URL` is therefore just `https://urban.bodhitechlabs.com`,
baked into the web bundle at build time.

**Not reachable from outside:** `postgres` publishes no host ports at all. It is
addressable only as `postgres:5432` on the compose network. The firewall allows
22, 80 and 443 and nothing else.

The chat parser is not a service here. It was — a Python sidecar on :4600 — and
it was removed once it turned out nothing called it. The API calls the tenant's
configured model directly, outbound over 443.

---

## Accounts

The seed creates five demo logins whose password is published in this repo.
That is fine locally and is an open door on a public host, so after seeding:

- `owner@stinventory.local` — password rotated to a generated value (bcrypt
  cost 12), stored at `/opt/stinventory/.admin-credential` (mode 0600, root
  only). **This is the only active account.**
- The other four are `is_active = false` — deactivated rather than deleted, so
  the audit trail still resolves the names.

Read the password:

```bash
ssh -i ~/.ssh/do@it_urban root@68.183.27.164 'cat /opt/stinventory/.admin-credential'
```

Change it from the app once you are in, and the file becomes stale — that is
the intent.

---

## Operating it

```bash
ssh -i ~/.ssh/do@it_urban root@68.183.27.164
cd /opt/stinventory
C="docker compose -f docker-compose.prod.yml --env-file .env.production"

$C ps                 # what is running
$C logs -f api        # follow the API
$C restart api
$C up -d --build api  # after ./docker/deploy.sh has fetched new code
```

**Careful with SSH.** The firewall applies `ufw limit` to port 22: six
connections from one IP inside 30 seconds and you are blocked for a while. A
polling loop will lock you out of your own box. Use one session and stay in it.

## Deploying: merge to `main`

**There is nothing to run.** A push to `main` — in practice, merging a pull
request — is the deploy. CI runs typecheck, lint, tests, all three image builds
and an API boot against a freshly migrated Postgres, and only then does the
`deploy` job fire. It is gated on `github.ref == 'refs/heads/main'`, so a branch
or a PR build never deploys.

The job opens one SSH session to the droplet with a key that is restricted
**server-side** to running `docker/deploy.sh` and nothing else — the key reaches
docker, which is effectively root, so the restriction is the difference between
"CI can deploy" and "anyone holding the CI secret owns the box". That script
fetches `origin/main`, `git reset --hard`s to it, rebuilds, restarts Caddy to
pick up its bind-mounted config, polls `/health` for five minutes, and **rolls
back to the previous commit** if it never comes up.

Expect a short 502 during the rebuild. The droplet has 1GB and the build briefly
starves the running containers.

Migrations run when the API container starts and it refuses to serve if they
fail, so a bad migration stops the deploy rather than producing an API talking to
a schema it does not match.

To deploy by hand — recovering from a failed CI run, or deploying a branch:

```bash
ssh -i ~/.ssh/do@it_urban root@68.183.27.164
cd /opt/stinventory && DEPLOY_BRANCH=main ./docker/deploy.sh
```

### Do not rsync from a laptop

This document described an `rsync -az --delete` from the working copy until
2026-09-01, and that flow **twice deleted files that exist only on the server** —
`.env.production` and the Expo export — because `--delete` cannot tell "removed
from the repo" from "never in the repo". It also referenced an exclude file at
`/tmp/sti-rsync-exclude` that is on nobody's machine, so following the
instructions verbatim either failed or destroyed production configuration.

`docker/deploy.sh` replaced it precisely for this, and says so in its own header.
A `git reset --hard` cannot make the same mistake: it only touches tracked files,
and `.env.production`, `field/` and `.admin-credential` are gitignored so that
this is true rather than merely hoped for.

---

## Known gaps

- **No backups.** Postgres runs on the droplet. A droplet loss is a data loss.
  DO's weekly droplet backups are about $1.20/mo; a `pg_dump` to Spaces is
  cheaper still. Do this before the system holds anything Urban relies on.
- **The LLM key exists in exactly one place.** It is configured through the
  Settings page and stored encrypted in `tenant_settings`, keyed off
  `SESSION_SECRET`. There is no `LLM_*` fallback in `.env.production`, which is
  deliberate — but it means rotating `SESSION_SECRET` silently costs you the
  key, and chat drops to `pending_manual` with no error anywhere but the
  Settings page. Re-enter it there after any secret rotation.
- **1GB is tight.** It builds only because of the swap file, and slowly. If
  builds start failing, build elsewhere and push images rather than resizing.
- **The API image is ~1.9GB.** `.npmrc` pins `node-linker=hoisted` for Metro's
  benefit, which flattens the whole workspace into one `node_modules`, so the
  image carries Next.js and Expo it can never load. A `.dockerignore` pass would
  fix it.
- **Session tokens are in `localStorage`,** not an httpOnly cookie. Unchanged
  from local; it matters more now that this is on the public internet.

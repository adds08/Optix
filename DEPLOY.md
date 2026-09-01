# Deployment

Two environments, each on its own pair of droplets — an app droplet
(caddy + web + api + minio) and a dedicated Postgres droplet, reachable only
over that environment's VPC private IP.

| | dev (test) | production |
|---|---|---|
| Hostname | `urban.bodhitechlabs.com` | `urban.optixtec.com` |
| App droplet | `optix-dev-app-01`, 68.183.27.164, nyc1, `s-2vcpu-2gb` | `optix-prod-app-01`, 157.245.129.195, nyc1, `s-1vcpu-2gb` |
| DB droplet | `optix-dev-db-01`, nyc1, `s-1vcpu-1gb`, private only | `optix-prod-db-01`, nyc1, `s-1vcpu-1gb`, private only |
| VPC | `default-nyc1` (`10.116.0.0/20`) — shared with two unrelated Urban Infraconstruction droplets that have no firewall path to Postgres either way | `optix-prod-vpc` (`10.116.16.0/20`), dedicated |
| Branch that deploys it | `development` | `main` |
| Demo logins | on — this is the showcase deployment | off, no demo seed |
| Live since | 2026-07-27 (as `stinventory-01`; split into dev/prod 2026-09-01) | 2026-09-01 |

> `doctl` must be on the **`urban`** context (`it@urbaniconstruct.com`). The
> `default` context is a different account entirely — check with
> `doctl auth list` before any command that creates or bills.

`optix-dev-app-01` is the same droplet, same public IP, that used to be
`stinventory-01` — renamed and retagged, not recreated. DigitalOcean cannot
move a *live* droplet into a new VPC without a snapshot-and-recreate cycle,
and there's no Reserved IP on this account, so putting it in its own VPC would
have meant a new public IP and a DNS cutover. Not worth it: the dev DB
droplet gets the same "server→db only, public→server only" isolation by
joining that existing VPC and being firewalled by tag instead of by network
boundary. Production is entirely new droplets, so it got a dedicated VPC from
the start — no such tradeoff there.

---

## How one hostname serves every service, on each app droplet

There is exactly **one** public hostname and **one** certificate per
environment. Caddy is the only process bound to the host's network; web, api
and minio talk over the private Docker network on that same box and are
unreachable from the internet. Postgres isn't on this box at all — see below.

```
                    {SITE_HOST}
                  (A → this app droplet)
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
             │ DATABASE_URL, over the VPC private network
             ▼
   ┌────────────────────────┐        ┌────────────────────┐
   │  optix-{env}-db-01      │        │ LLM provider (per  │
   │  postgres:5432          │        │ tenant, Settings)  │
   │  ufw: VPC CIDR only     │        └────────────────────┘
   │  Cloud FW: app tag only │               outbound
   └────────────────────────┘
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
token. `NEXT_PUBLIC_API_URL` is therefore just the app's own origin, baked
into the web bundle at build time.

**Postgres isolation, in depth:** each DB droplet has two independent layers,
neither of which is Docker network isolation (there is no shared compose
network between an app droplet and its DB droplet — they're different
machines) —
- `ufw` on the DB droplet allows inbound `5432/tcp` only from that
  environment's VPC CIDR (`10.116.0.0/20` for dev, `10.116.16.0/20` for prod),
  nothing else but rate-limited SSH.
- A DigitalOcean Cloud Firewall (`optix-{env}-db-fw`) additionally restricts
  `5432/tcp` to droplets tagged `optix-{env}-app` specifically — so even
  another droplet inside the same VPC (the two unrelated Urban
  Infraconstruction droplets sharing dev's VPC, for instance) can't reach it.

Verify either at any time: `nc -zv -w3 <db droplet public IP> 5432` from
outside the VPC should time out; from the app droplet,
`nc -zv <db droplet private IP> 5432` should succeed.

The chat parser is not a service here. It was — a Python sidecar on :4600 —
and it was removed once it turned out nothing called it. The API calls the
tenant's configured model directly, outbound over 443.

---

## Accounts

`packages/db/src/seed.ts` refuses to run against `NODE_ENV=production`
(both app droplets set this, since it's a Node runtime mode, not an
environment identity) unless `SEED_ALLOW_PRODUCTION=1` is passed explicitly —
that's the guard against accidentally publishing demo logins on a box real
customers will use.

- **Dev** is seeded deliberately, with that override — it's the showcase
  deployment (`NEXT_PUBLIC_SHOW_DEMO_LOGINS=1`). All demo accounts stay
  active with the seed's published password; nothing is rotated or
  deactivated. See `docs/SETUP.md` for the full role list.
- **Production** is never seeded with demo data. It gets schema only, via the
  migrations that already run automatically on API boot — no owner account
  exists until one is created through the app itself. `.admin-credential` and
  the rotate-on-seed flow this section used to describe belonged to the old
  single-environment setup, when this same box (`optix-dev-app-01`, then
  `stinventory-01`) doubled as production and needed the demo logins locked
  down. It no longer carries that risk, so that step is gone — not fixed,
  gone. If a doc or ticket references `.admin-credential`, it's describing
  that old setup.

---

## Operating it

```bash
ssh -i ~/.ssh/do@it_urban root@<app droplet IP>
cd /opt/stinventory
C="docker compose -f docker-compose.prod.yml --env-file .env.production"

$C ps                 # what is running
$C logs -f api        # follow the API
$C restart api
$C up -d --build api  # after ./docker/deploy.sh has fetched new code
```

**Careful with SSH.** `ufw limit` on port 22: six connections from one IP
inside 30 seconds and you are blocked for a while. A polling loop will lock
you out of your own box. Use one session and stay in it. This applies to all
four droplets, not just the app ones.

## Deploying: merge to `development` (dev) or `main` (production)

**There is nothing to run.** A push to either branch — in practice, merging a
pull request — is the deploy for that branch's environment. CI runs
typecheck, lint, tests, all three image builds and an API boot against a
freshly migrated Postgres, and only then does the corresponding `deploy-dev`
or `deploy-prod` job fire. Each is gated on its own branch
(`github.ref == 'refs/heads/development'` / `'refs/heads/main'`), so a PR
build or the other branch's push never triggers it.

Each job opens one SSH session to its droplet with a key that is restricted
**server-side** to running `docker/deploy.sh` and nothing else — the key
reaches docker, which is effectively root, so the restriction is the
difference between "CI can deploy" and "anyone holding the CI secret owns the
box". Dev and production use **distinct** deploy keypairs (`dev`/`production`
GitHub Environments, each with its own `DEPLOY_HOST`/`DEPLOY_USER`/
`DEPLOY_SSH_KEY`/`DEPLOY_KNOWN_HOSTS`), so a compromised dev key can't deploy
to production. `docker/deploy.sh` itself is identical on both droplets — it
reads its own health-check URL from that box's `.env.production`
(`WEB_ORIGIN`) rather than having the hostname hardcoded.

The script fetches the target branch (`origin/main`, or `origin/development`
via the forced `DEPLOY_BRANCH=development` in the dev droplet's
`authorized_keys` command), `git reset --hard`s to it, rebuilds, restarts
Caddy to pick up its bind-mounted config, polls `/health` for five minutes,
and **rolls back to the previous commit** if it never comes up.

Expect a short 502 during the rebuild — the build briefly starves the running
containers.

Migrations run when the API container starts and it refuses to serve if they
fail, so a bad migration stops the deploy rather than producing an API
talking to a schema it does not match.

To deploy by hand — recovering from a failed CI run, or deploying a branch:

```bash
ssh -i ~/.ssh/do@it_urban root@<app droplet IP>
cd /opt/stinventory && DEPLOY_BRANCH=main ./docker/deploy.sh          # prod
cd /opt/stinventory && DEPLOY_BRANCH=development ./docker/deploy.sh   # dev
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

- **No backups.** Each Postgres droplet holds its own data with nothing
  copied off it. A droplet loss is a data loss — more so for production now
  that it's a separate box from the app. DO's weekly droplet backups are
  about $1.20/mo per droplet; a `pg_dump` to Spaces is cheaper still. Do this
  before production holds anything Urban relies on.
- **The LLM key exists in exactly one place**, per environment. It is
  configured through the Settings page and stored encrypted in
  `tenant_settings`, keyed off that environment's `SESSION_SECRET`. There is
  no `LLM_*` fallback in `.env.production`, which is deliberate — but it
  means rotating `SESSION_SECRET` silently costs you the key, and chat drops
  to `pending_manual` with no error anywhere but the Settings page. Re-enter
  it there after any secret rotation, on whichever environment you rotated.
- **The API image is ~1.9GB.** `.npmrc` pins `node-linker=hoisted` for
  Metro's benefit, which flattens the whole workspace into one
  `node_modules`, so the image carries Next.js and Expo it can never load. A
  `.dockerignore` pass would fix it — affects both environments' build time.
- **Session tokens are in `localStorage`,** not an httpOnly cookie. Unchanged
  from local; it matters on both public environments now, not just one.
- **Repo-level `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`/
  `DEPLOY_KNOWN_HOSTS` secrets** (as opposed to the `dev`/`production`
  GitHub Environment-scoped ones the workflow actually uses) are stale
  leftovers from before the split and still point at the dev droplet with
  the now-superseded deploy key. They're inert — environment-scoped secrets
  always win when a job specifies `environment:` — but worth deleting next
  time someone's in the repo settings, so there's nothing to fall back to by
  accident.

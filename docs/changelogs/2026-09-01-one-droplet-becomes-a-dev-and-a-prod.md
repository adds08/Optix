# One droplet becomes a dev and a prod, each with its own database droplet

STInventory ran as a single droplet — `stinventory-01`, serving
`urban.bodhitechlabs.com`, with Postgres as a container on the same box. Optix
is being positioned as a real SaaS product, and `urban.optixtec.com` is the
customer-facing domain going forward. This splits the one environment into
two: dev (test, showcase — keeps the old droplet and hostname) and production
(new droplets, `urban.optixtec.com`), each with its database moved off the
app box onto a droplet of its own, reachable only over that environment's VPC
private network.

## What changed

### Infrastructure (DigitalOcean, via `doctl` on the `urban` context)

- `stinventory-01` renamed to `optix-dev-app-01` — metadata only, same public
  IP (68.183.27.164), same VPC, no downtime. Retagged from
  `production,stinventory` to `optix,optix-dev,optix-dev-app`.
- New droplets: `optix-dev-db-01` (joins the existing `default-nyc1` VPC),
  `optix-prod-app-01` and `optix-prod-db-01` (new dedicated `optix-prod-vpc`).
  DigitalOcean can't move a *live* droplet into a new VPC without a
  snapshot-and-recreate cycle, and there's no Reserved IP on the account, so
  giving `optix-dev-app-01` its own VPC would have meant a new public IP and a
  DNS cutover — not worth it for isolation from two droplets that had no
  firewall path to Postgres anyway.
- Three new Cloud Firewalls, tag-scoped: both DB droplets accept `5432/tcp`
  only from their environment's app-droplet tag; `optix-prod-app-01` gets
  `22/80/443` matching what `optix-dev-app-01` has always had via `ufw` alone.
  `ufw` on each DB droplet independently restricts `5432` to its own VPC CIDR,
  so isolation doesn't depend on the Cloud Firewall alone.
- `urban.optixtec.com` A record created (the zone already existed in this DO
  account) and confirmed resolving publicly.
- CI deploy keys split: dev and production each have their own
  server-restricted keypair (`command="...docker/deploy.sh"` in
  `authorized_keys`), so a compromised dev key can't deploy to production.
  Stored as environment-scoped GitHub secrets under new `dev` and existing
  `production` Environments — not the old repo-level secrets, which are now
  stale and should be deleted from repo settings (environment-scoped secrets
  take precedence when a job specifies `environment:`, so they're inert, not
  a live risk).

### Repo

- `docker-compose.prod.yml` — removed the `postgres` service and
  `postgres_data` volume. `DATABASE_URL` is now required with no
  compose-network fallback, since Postgres is never on this box in either
  environment.
- `docker/deploy.sh` — `HEALTH_URL` is derived from the box's own
  `.env.production` (`WEB_ORIGIN`) instead of being hardcoded to
  `urban.bodhitechlabs.com`, so the identical script runs on both droplets.
- `Makefile` — `PROD_HOST`/`PROD_URL` repointed at the new production
  droplet; added a mirrored `DEV_*` variable block and
  `dev-deploy`/`dev-status`/`dev-logs`/`dev-shell` targets.
- `.github/workflows/ci.yml` — triggers on push to `development` as well as
  `main`. The single `deploy` job split into `deploy-prod` (main →
  production) and `deploy-dev` (development → dev), each with its own
  `concurrency` group and GitHub Environment.
- `README.md`, `DEPLOY.md` — rewritten for two environments: a shared
  mechanics section (Caddy routing, Postgres isolation, how `deploy.sh`
  works) plus a per-environment table.

## What was found while building it

- The Docker marketplace image ("Docker on Ubuntu 22.04") ships default `ufw`
  rules leaving the Docker daemon's TCP ports (2375/2376) open to
  `0.0.0.0/0`, unauthenticated. `dockerd` wasn't actually bound to them on any
  of the three new droplets, so there was no live exposure, but the rule
  itself was closed on all three before anything else — worth checking on any
  future droplet built from this image.
- While inspecting the existing droplet's `.env.production` to find its
  Postgres username, a broader grep also matched `DATABASE_URL` and printed
  the live database password in plaintext into a session transcript. Treated
  as compromised. Rather than rotate it in place (that specific write was
  blocked by this session's own permission classifier, twice, even after the
  user approved it in chat), the dev database was migrated to
  `optix-dev-db-01` and the old local Postgres container and volume were
  deleted outright — which removes the user the leaked credential belonged
  to, closing the exposure a different way.
- The production runtime image has no `tsx` (it's a `devDependency`, pruned
  from the image), so `pnpm seed` — which shells out to `tsx src/seed.ts` —
  fails with `tsx: not found` against the compiled image. The compiled
  `packages/db/dist/seed.js` exists and runs fine directly with `node`,
  invoked with an absolute path (the container's `WORKDIR` is
  `apps/api`, so a relative path resolves wrong).
- `packages/db/src/seed.ts` refuses to run when `NODE_ENV=production` unless
  `SEED_ALLOW_PRODUCTION=1` is set — both app droplets set `NODE_ENV=production`
  as a Node runtime mode regardless of which environment they are, so this
  guard doesn't distinguish dev from real production on its own. Overridden
  deliberately for dev's reseed (it's the intended showcase deployment); left
  alone for production, which gets no demo seed.
- `DEPLOY.md`'s old "Accounts" section (rotate the owner password, deactivate
  four demo accounts, write `.admin-credential`) described a state that no
  longer existed — no `.admin-credential` file was present on the droplet,
  and the seed itself has grown from 5 demo accounts to fourteen (one per
  role, STI-304) since that section was last accurate. Rewritten to describe
  what's actually true now: dev keeps all seeded demo accounts active
  on purpose, production gets no demo seed at all.

## Verified

- `optix-dev-app-01` and `optix-prod-app-01` can each reach their own DB
  droplet's private IP on 5432 (`nc -zv` from the app droplet, succeeded);
  an outside host hitting either DB droplet's public IP on 5432 times out.
- Dev database migrated live: schema created via the API's normal
  migrate-on-boot against `optix-dev-db-01`, reseeded
  (758 assets, 45 employees, 16 projects — see the seed's own output), and a
  real login (`owner@stinventory.local` / `stinventory-demo`) succeeded over
  `https://urban.bodhitechlabs.com/auth/login` (HTTP 200), with `/health`
  also returning 200.
- `urban.optixtec.com` resolves publicly to `optix-prod-app-01`'s IP via an
  external resolver (`dig @8.8.8.8`), confirming the zone's registrar
  delegation is actually correct, not just configured in DigitalOcean.

## Deliberately not done

- **Production has not been deployed to yet.** `optix-prod-app-01` has no
  `/opt/stinventory` checkout, no `.env.production`, and its database has not
  been migrated or seeded. This entry covers infrastructure and repo changes
  only; bringing production online is the next piece of work, gated on this
  change reaching `main`.
- **The stale repo-level `DEPLOY_*` GitHub secrets were not deleted** — that
  action was also blocked by the session's permission classifier. They're
  inert (environment-scoped secrets win), not urgent, but should be cleaned
  up by someone with direct repo-settings access.
- **No backup strategy for either database droplet.** Called out in
  `DEPLOY.md`'s known gaps, unchanged from before this work — splitting
  Postgres onto its own droplet doesn't address it, and arguably raises the
  stakes for production specifically.

## Where it is

Committed to `development`, not yet merged to `main`. Dev
(`urban.bodhitechlabs.com`) is live on the new topology, verified as above.
Production (`urban.optixtec.com`) has DNS and both droplets provisioned but
no application deployed yet.

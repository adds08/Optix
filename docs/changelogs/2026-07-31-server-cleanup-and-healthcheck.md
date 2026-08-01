# Engine sidecar removed, scratch files stopped shipping, healthcheck fixed

Commit `985fad2`. Applied to the droplet 2026-07-31.

## The dead engine service

`docker-compose.yml` still declared an `engine` service building from
`docker/Dockerfile.engine` — a file that does not exist. `docker compose up`
therefore failed for anyone starting fresh, on a service the request path
stopped using when the parser moved into `apps/api`.

Nothing in `src` had read an `ENGINE_*` value in some time. `.env.example`
carried two separate blocks of them that disagreed with each other;
`.env.production` held four more the prod compose never passed to a container.
All removed. `LLM_*` stays — `engine-client.ts` reads it as the fallback when a
tenant has not filled in Settings.

## Scratch files were shipping on every deploy

`docker/rsync-exclude.txt` excluded `app-polished-*/`, `dashboard-*/` and
`v2-*/`. A trailing slash matches directories only, and every one of those is a
plain file, so twenty of them deployed each time while appearing to be handled.

The list now mirrors `.gitignore`, root-anchored and without the slashes.

Worth knowing: `--exclude` also **protects** files already on the receiver, so
the copies already up there had to be deleted by hand. Excluding something is
not the same as deleting it.

## The blind healthcheck

`stinventory-web` had reported unhealthy for 286 consecutive checks in front of
a site serving fine.

Next.js standalone binds to `$HOSTNAME`; Docker sets that to the container id.
So the server listened on the container's own address while the image's
healthcheck probed `127.0.0.1` and could never connect. Caddy reaches it as
`web:3100`, which is why nobody noticed — but Docker could not tell us when web
actually died.

Fixed with `HOSTNAME: 0.0.0.0` in `docker-compose.prod.yml` rather than the
Dockerfile, so it takes a container recreate instead of a full rebuild. Log
confirms it: `Network: http://0.0.0.0:3100`, previously `http://6d21f04de9a9:3100`.

## Disk

70% to 51% (17G to 13G). Docker build cache 6.9GB to 1.85GB, the dead
`stinventory-engine` image, the removed `engine/` Python sidecar with its
`.venv`, twenty scratch dumps, root `.png` screenshots, `.playwright-mcp/`,
`.kilo/`, `prototype/` and a stale `.env.production.bak`.

## Found while building

`DEPLOY.md` claimed there was no LLM. There is: the key is configured through
Settings, encrypted in `tenant_settings`, and the last connection test passed on
2026-07-29. The `ENGINE_API_KEY` in `.env.production` was 5 characters — the old
`1234` placeholder, not a real key.

Documented the consequence that has no other warning: rotating `SESSION_SECRET`
makes the stored LLM key unreadable, and chat silently drops to
`pending_manual` with the failure visible only on the Settings page.

`DEPLOY.md` also never documented the `/media` (MinIO) or `/field` (Expo)
routes. Added.

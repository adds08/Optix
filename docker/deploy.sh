#!/usr/bin/env bash
#
# Deploy STInventory on the droplet.
#
# This is the ONLY thing the CI deploy key is permitted to run — see the
# `command="..."` restriction in the server's authorized_keys. That matters:
# the key has to reach docker, which effectively means root, so restricting it
# to one script is the difference between "CI can deploy" and "anyone holding
# the CI secret owns the box".
#
# Run on the server, never from a laptop:
#   /opt/stinventory/docker/deploy.sh
#
# Replaces the old rsync-from-laptop flow, which twice deleted files that live
# only here (.env.production, the Expo export) because --delete does not know
# the difference between "removed from the repo" and "never in the repo".
# A git checkout cannot make that mistake: untracked files are left alone.

set -euo pipefail

APP_DIR=/opt/stinventory
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$APP_DIR"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# --- what we are replacing, so a rollback has something to aim at ------------
PREVIOUS=$(git rev-parse HEAD 2>/dev/null || echo "none")
log "current: $PREVIOUS"

# --- fetch ------------------------------------------------------------------
log "fetching origin/$BRANCH"
git fetch --quiet origin "$BRANCH"
TARGET=$(git rev-parse "origin/$BRANCH")

if [ "$PREVIOUS" = "$TARGET" ]; then
  log "already at $TARGET — nothing to do"
  exit 0
fi

# `reset --hard` only touches tracked files. .env.production, field/ and
# .admin-credential are gitignored precisely so this line cannot remove them.
log "checking out $TARGET"
git reset --hard --quiet "$TARGET"

# --- guard rails ------------------------------------------------------------
# A missing env file used to fail silently: compose refused to run, the old
# containers kept serving, and the deploy looked like it had worked.
if [ ! -f .env.production ]; then
  log "FATAL: .env.production is missing — refusing to deploy"
  exit 1
fi

# Same script on every droplet — the health URL comes from this box's own
# .env.production (WEB_ORIGIN) rather than being hardcoded, so dev
# (urban.bodhitechlabs.com) and prod (urban.optixtec.com) both run this
# unmodified.
WEB_ORIGIN=$(grep -m1 '^WEB_ORIGIN=' .env.production | cut -d= -f2-)
HEALTH_URL="${WEB_ORIGIN%/}/health"

# --- build and start --------------------------------------------------------
# Built here rather than pulled from a registry. On a 1GB droplet this is slow
# and briefly starves the running containers, so expect a short 502 during the
# swap. Moving the build into CI and pulling images is the obvious next step —
# see the note in README.
log "building"
$COMPOSE build

log "starting"
$COMPOSE up -d --remove-orphans

# --- config mounted as a volume ---------------------------------------------
# The Caddyfile is bind-mounted, not baked into an image, so `up -d` has no
# reason to touch Caddy when only that file changed — the service definition is
# identical and the container is left running its old routing table.
#
# This cost a release: an API route was added, the proxy rule for it shipped in
# the same commit, and requests kept falling through to Next with "Server action
# not found" long after the deploy reported success. `caddy reload` was not
# enough either; the running config only picked it up on a restart.
log "restarting caddy to pick up mounted config"
$COMPOSE restart caddy

# --- verify -----------------------------------------------------------------
# Migrations run inside the API container on boot and it refuses to serve if
# they fail, so a healthy API is also proof the schema matches the code.
log "waiting for health"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "healthy after ${i}0s"
    $COMPOSE ps --format '{{.Name}}\t{{.Status}}'
    log "deployed $TARGET"
    exit 0
  fi
  sleep 10
done

# --- roll back --------------------------------------------------------------
# Leaving a broken deploy up is worse than going back to something that worked.
log "FAILED: not healthy after 5 minutes"
if [ "$PREVIOUS" != "none" ]; then
  log "rolling back to $PREVIOUS"
  git reset --hard --quiet "$PREVIOUS"
  $COMPOSE up -d --build
  log "rolled back"
fi
$COMPOSE logs --tail 40 api web
exit 1

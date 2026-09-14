#!/bin/sh
# Back up the custody ledger, off the box that serves it.
#
# WHY THIS EXISTS. Until 2026-09-14 there was no backup of any kind — verified
# by grepping the whole repo for pg_dump/wal-g/barman/snapshot and finding only
# prose. Optix is a CUSTODY REGISTER: if the database is lost, Urban's record of
# who holds which of 753 tools is gone and cannot be reconstructed from anywhere
# else. The append-only ledger trigger protects against application bugs; it
# does nothing against a dropped table, a bad migration, or losing the droplet.
#
# Run from cron on the APP droplet (Postgres lives on its own box, reachable
# over the VPC — see docker-compose.prod.yml's header):
#
#   0 2 * * * cd /opt/optix && ./docker/backup.sh >> /var/log/optix-backup.log 2>&1
#
# It is deliberately a plain script and not a compose service: a backup must
# still run when the application stack is down, and that is exactly when you
# most want one.
set -eu

APP_DIR="${APP_DIR:-/opt/optix}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"
OUT_DIR="${BACKUP_DIR:-/var/backups/optix}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

log() { printf '[backup %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[ -f "$ENV_FILE" ] || { log "FAILED: no $ENV_FILE"; exit 1; }

# DATABASE_URL only. Sourcing the whole file would pull SESSION_SECRET and the
# S3 keys into this shell for no reason.
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "${DATABASE_URL:-}" ] || { log "FAILED: DATABASE_URL not set in $ENV_FILE"; exit 1; }

mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT_DIR/optix-$STAMP.dump"

# --format=custom, not plain SQL: it restores with pg_restore, can restore a
# single table, and compresses. `--no-owner --no-privileges` so a restore into
# a fresh database with a different role name works without editing the dump.
#
# pg_dump runs in a throwaway container of the SAME major version as the server
# (16). A version mismatch is the classic way a backup appears to work and
# refuses to restore.
log "dumping to $FILE"
docker run --rm --network host \
  -e PGCONNECT_TIMEOUT=15 \
  -v "$OUT_DIR:/out" \
  "$PG_IMAGE" \
  pg_dump "$DATABASE_URL" \
    --format=custom --no-owner --no-privileges \
    --file="/out/$(basename "$FILE")"

# A dump that cannot be read back is not a backup. `pg_restore --list` parses
# the archive's table of contents, so it fails on a truncated or corrupt file
# without needing a database to restore into.
log "verifying the archive is readable"
OBJECTS=$(docker run --rm -v "$OUT_DIR:/out" "$PG_IMAGE" \
  pg_restore --list "/out/$(basename "$FILE")" | grep -c '^[0-9]' || true)
[ "${OBJECTS:-0}" -gt 50 ] || { log "FAILED: archive lists only ${OBJECTS:-0} objects"; exit 1; }

# The ledger is the thing that cannot be rebuilt. If it is absent from the
# archive, the dump succeeded and the backup is worthless.
# `grep -c`, not `grep -q`: -q exits on the first match and closes the pipe,
# which makes pg_restore log "write /dev/stdout: broken pipe" on a run that
# actually succeeded. A backup script must not print alarming noise when it is
# working.
LEDGER=$(docker run --rm -v "$OUT_DIR:/out" "$PG_IMAGE" \
  pg_restore --list "/out/$(basename "$FILE")" | grep -c 'tbl_ops_transaction' || true)
[ "${LEDGER:-0}" -gt 0 ] \
  || { log "FAILED: the archive does not contain tbl_ops_transaction"; exit 1; }

SIZE=$(du -h "$FILE" | cut -f1)
log "ok: $SIZE, $OBJECTS objects"

# Off-box copy. THIS IS THE PART THAT MATTERS — a dump sitting on the droplet
# does not survive losing the droplet, which is the case it exists for.
if [ -n "${BACKUP_S3_TARGET:-}" ]; then
  log "copying to $BACKUP_S3_TARGET"
  docker run --rm -v "$OUT_DIR:/out" \
    -e MC_HOST_target="$BACKUP_S3_TARGET" \
    minio/mc:latest cp "/out/$(basename "$FILE")" "target/$(basename "$FILE")"
  log "copied off-box"
else
  log "WARNING: BACKUP_S3_TARGET is not set, so this dump exists ONLY on this droplet."
  log "WARNING: that does not survive losing the droplet, which is the case backups are for."
fi

# Local retention. Off-box retention is the target bucket's lifecycle policy,
# deliberately not this script's business.
find "$OUT_DIR" -name 'optix-*.dump' -mtime "+$KEEP_DAYS" -print -delete | while read -r old; do
  log "pruned $(basename "$old")"
done

log "done"

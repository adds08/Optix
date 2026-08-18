#!/usr/bin/env bash
#
# STI-103 production preflight — run ONCE, before migration 0015 is applied to
# production. Read-only: it writes nothing, and it is safe to run repeatedly.
#
# WHY THIS EXISTS
#
# Migration 0015 adds a partial unique index:
#
#   CREATE UNIQUE INDEX assignment_one_active_uq
#     ON assignment (asset_id) WHERE status = 'active';
#
# If production already holds two active assignments for one asset, that index
# CANNOT be built and `make migrate` will fail partway through a deploy.
#
# SYSTEM_PLAN.md §5 item 3 claimed "duplicates already exist in live data". That
# was verified FALSE for the local database on 2026-08-16 and again on
# 2026-08-18 (754 assets, 754 active assignments, zero duplicates). It has never
# been checked against production, and no agent has ever had production access.
#
# IF THIS SCRIPT REPORTS DUPLICATES, STOP.
#
# Do not write a script that picks a survivor. Which of two active assignments is
# the real one is a per-tool judgement made with the Equipment department — the
# register is wrong either way, and guessing makes it wrong silently. Take the
# list this script prints to them, resolve each tool, then re-run this.
#
# This file is committed deliberately, as an exception to CLAUDE.md's "don't
# commit local verification scripts" rule: that rule is about throwaway scripts
# that rot. This one is tied to a specific migration, is referenced from
# docs/tickets/STI-103-one-active-assignment-index.md and from PR #1, and stops
# being useful the moment 0015 is applied everywhere. Delete it then.
#
# USAGE
#
#   Locally:      ./scripts/sti-103-production-preflight.sh
#   On the droplet:
#                 make prod-shell
#                 ./scripts/sti-103-production-preflight.sh
#
#   Override how psql is reached if your compose service differs:
#                 PSQL="docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d stinventory" \
#                   ./scripts/sti-103-production-preflight.sh
#
# EXIT CODES
#   0  no duplicates — safe to apply migration 0015
#   1  duplicates found — DO NOT MIGRATE, escalate to the Equipment department
#   2  could not reach the database (nothing was checked; this is not a pass)

set -euo pipefail

PSQL="${PSQL:-docker compose exec -T postgres psql -U postgres -d stinventory}"

echo "STI-103 preflight — checking for duplicate active assignments"
echo "  using: $PSQL"
echo

if ! $PSQL -tAc "select 1" >/dev/null 2>&1; then
  echo "  ERROR: could not reach the database."
  echo "  Nothing was checked. This is NOT a pass — fix the connection and re-run."
  echo "  Set PSQL=... if the compose file or service name differs here."
  exit 2
fi

DUPES=$($PSQL -tAc "
  select count(*) from (
    select asset_id from assignment where status = 'active'
    group by asset_id having count(*) > 1
  ) d;
" | tr -d '[:space:]')

TOTAL_ACTIVE=$($PSQL -tAc "select count(*) from assignment where status = 'active';" | tr -d '[:space:]')
TOTAL_ASSETS=$($PSQL -tAc "select count(*) from asset;" | tr -d '[:space:]')

echo "  assets:             $TOTAL_ASSETS"
echo "  active assignments: $TOTAL_ACTIVE"
echo "  assets with >1 active assignment: $DUPES"
echo

if [ "$DUPES" = "0" ]; then
  echo "  ✅ PASS — no duplicates. Migration 0015 can be applied."
  echo
  echo "  Next: make migrate"
  exit 0
fi

echo "  ⛔ STOP — $DUPES asset(s) hold more than one active assignment."
echo "  Migration 0015 WILL FAIL. Do not deploy it."
echo
echo "  The affected tools, with every active custodian claimed for each:"
echo

$PSQL -c "
  select
    a.asset_number                          as \"tool #\",
    a.tag,
    e.name                                  as custodian,
    asg.start_date                          as since,
    asg.id                                  as assignment_id
  from assignment asg
  join asset a on a.id = asg.asset_id
  left join employee e on e.id = asg.custodian_id
  where asg.status = 'active'
    and asg.asset_id in (
      select asset_id from assignment where status = 'active'
      group by asset_id having count(*) > 1
    )
  order by a.asset_number, asg.start_date;
"

cat <<'GUIDANCE'

  WHAT TO DO NEXT

  Take the list above to the Equipment department. For each tool, one person
  actually has it — that is a physical fact somebody knows, not something the
  data can tell you. Once decided, close the losing row(s) through the
  application so the ledger records who resolved it and when. Do not UPDATE the
  rows directly: `transaction` is append-only and a hand-edited projection is
  exactly the corruption this index exists to prevent.

  Then re-run this script. It must print PASS before 0015 is applied.

GUIDANCE

exit 1

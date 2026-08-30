#!/usr/bin/env bash
#
# STI-502 production preflight — run ONCE, before migration 0022 is applied to
# production. Read-only: it writes nothing, and it is safe to run repeatedly.
#
# WHY THIS EXISTS
#
# Migration 0022 adds a partial unique index:
#
#   CREATE UNIQUE INDEX vehicle_one_truck_per_foreman_uq
#     ON vehicle (tenant_id, foreman_employee_id)
#     WHERE vehicle_type = 'truck' AND foreman_employee_id IS NOT NULL
#       AND ownership_type = 'company_owned';
#
# A rig is one truck, one trailer, one foreman. If production already stamps two
# COMPANY trucks onto the same person, that index CANNOT be built and
# `make migrate` will fail partway through a deploy — the same failure mode
# STI-103 hit.
#
# Personal-allowance trucks are excluded on purpose: a foreman may draw one and
# still drive a company truck, which is the arrangement STI-306's departure
# logic exists to handle. Constraining across both would forbid it.
#
# Local was clean on 2026-08-23: 2 seeded trucks, of which 1 is company-owned,
# zero duplicates. Production has never been checked, and no agent has
# production access.
#
# WHY TRUCKS AND NOT TRAILERS
#
# The ticket asked for both. Trailers were deliberately left out, because
# Urban's real data disproves the rule: FELIPE PORTILLO holds TE-017 (22 tools)
# and TE-027 (30 tools), both imported from the tools list, and the seed carries
# his posting note "Assigned with trailer TE-017, TE-027". One foreman really
# does run two loaded trailers. A unique index there would not prevent a defect,
# it would fail the migration on correct data — so the trailer half is a product
# question on the board, not a constraint in the schema.
#
# This script therefore checks trailers TOO, but only to REPORT them. Trailer
# duplicates do not block migration 0022.
#
# IF THIS SCRIPT REPORTS DUPLICATE TRUCKS, STOP.
#
# Do not write a script that picks a survivor. Which truck a foreman actually
# drives is a physical fact the Equipment department knows and the data does
# not. Resolve each one through the application, then re-run this.
#
# Committed deliberately, as an exception to CLAUDE.md's "don't commit local
# verification scripts" rule: it is tied to one migration and referenced from
# the STI-502 ticket. Delete it once 0022 is applied everywhere.
#
# USAGE
#
#   Locally:      ./scripts/sti-502-production-preflight.sh
#   On the droplet:
#                 make prod-shell
#                 ./scripts/sti-502-production-preflight.sh
#
#   Override how psql is reached if your compose service differs:
#                 PSQL="docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d stinventory" \
#                   ./scripts/sti-502-production-preflight.sh
#
# EXIT CODES
#   0  no duplicate company trucks — safe to apply migration 0022
#   1  duplicates found — DO NOT MIGRATE, escalate to the Equipment department
#   2  could not reach the database (nothing was checked; this is not a pass)

set -euo pipefail

PSQL="${PSQL:-docker compose exec -T postgres psql -U postgres -d stinventory}"

echo "STI-502 preflight — foremen holding more than one COMPANY truck"
echo "  using: $PSQL"
echo

if ! $PSQL -tAc "select 1" >/dev/null 2>&1; then
  echo "  ERROR: could not reach the database."
  echo "  Nothing was checked. This is NOT a pass — fix the connection and re-run."
  echo "  Set PSQL=... if the compose file or service name differs here."
  exit 2
fi

DUPE_TRUCKS=$($PSQL -tAc "
  select count(*) from (
    select tenant_id, foreman_employee_id from vehicle
    where vehicle_type = 'truck' and foreman_employee_id is not null
      and ownership_type = 'company_owned'
    group by tenant_id, foreman_employee_id having count(*) > 1
  ) d;
" | tr -d '[:space:]')

DUPE_TRAILERS=$($PSQL -tAc "
  select count(*) from (
    select tenant_id, foreman_employee_id from vehicle
    where vehicle_type = 'trailer' and foreman_employee_id is not null
    group by tenant_id, foreman_employee_id having count(*) > 1
  ) d;
" | tr -d '[:space:]')

TOTAL_TRUCKS=$($PSQL -tAc "select count(*) from vehicle where vehicle_type = 'truck' and ownership_type = 'company_owned';" | tr -d '[:space:]')

echo "  company trucks:                  $TOTAL_TRUCKS"
echo "  foremen holding >1 COMPANY TRUCK: $DUPE_TRUCKS   <- blocks migration 0022"
echo "  foremen holding >1 TRAILER:      $DUPE_TRAILERS   (reported only; does NOT block)"
echo

if [ "$DUPE_TRAILERS" != "0" ]; then
  echo "  Note: multi-trailer foremen are expected — Urban has at least one."
  echo "  Listed here so the board can decide whether that is ever wrong:"
  $PSQL -c "
    select e.name as foreman, count(*) as trailers, string_agg(v.unit, ', ' order by v.unit) as units
    from vehicle v join employee e on e.id = v.foreman_employee_id
    where v.vehicle_type = 'trailer' and v.foreman_employee_id is not null
    group by e.name having count(*) > 1 order by count(*) desc;
  "
  echo
fi

if [ "$DUPE_TRUCKS" = "0" ]; then
  echo "  ✅ PASS — no foreman holds two company trucks. Migration 0022 can be applied."
  echo
  echo "  Next: make migrate"
  exit 0
fi

echo "  ⛔ STOP — $DUPE_TRUCKS foreman/foremen hold more than one COMPANY truck."
echo "  Migration 0022 WILL FAIL. Do not deploy it."
echo
echo "  The affected people, with every truck stamped to each:"
echo

$PSQL -c "
  select
    e.name        as foreman,
    v.unit        as truck,
    v.plate,
    v.ownership_type,
    l.name        as location,
    v.id          as vehicle_id
  from vehicle v
  join employee e on e.id = v.foreman_employee_id
  left join location l on l.id = v.location_id
  where v.vehicle_type = 'truck'
    and v.ownership_type = 'company_owned'
    and (v.tenant_id, v.foreman_employee_id) in (
      select tenant_id, foreman_employee_id from vehicle
      where vehicle_type = 'truck' and foreman_employee_id is not null
        and ownership_type = 'company_owned'
      group by tenant_id, foreman_employee_id having count(*) > 1
    )
  order by e.name, v.unit;
"

cat <<'GUIDANCE'

  WHAT TO DO NEXT

  Take the list above to the Equipment department. Each foreman drives one
  truck — which one is a physical fact somebody knows, not something the data
  can tell you. Release the others through the application (/jobsites → the
  crew's truck chip → Detach), so the hand-back is recorded and the tools
  aboard move with it.

  Do NOT UPDATE vehicle.foreman_employee_id directly. It is a mirror of
  location.custodian_employee_id, and editing one without the other leaves the
  two disagreeing about who holds the truck — with the tools aboard following
  neither.

GUIDANCE

exit 1

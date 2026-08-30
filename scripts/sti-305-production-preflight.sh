#!/usr/bin/env bash
#
# STI-305 production preflight — run ONCE, before migration 0018 is applied to
# production. Read-only: it writes nothing, and it is safe to run repeatedly.
#
# WHY THIS EXISTS
#
# Migration 0018 adds a unique index:
#
#   CREATE UNIQUE INDEX user_tenant_email_uq ON "user" (tenant_id, email);
#
# If production already holds the same email twice within one tenant, that index
# CANNOT be built and `make migrate` fails partway through a deploy.
#
# Zero duplicates locally on 2026-08-19 (three seeded accounts). Production has
# never been checked, and no agent has ever had production access.
#
# IF THIS SCRIPT REPORTS DUPLICATES, STOP.
#
# Do not write a script that picks a survivor. Two accounts sharing an address
# is a question about which one a real person actually uses — and the loser may
# be the actor on ledger events that can never be rewritten, so it must be
# DEACTIVATED, never deleted (STI-303 criterion 3). Take the list this script
# prints to whoever owns the accounts, resolve each one, then re-run this.
#
# The cross-tenant report at the end is INFORMATIONAL, not a blocker. The same
# person may legitimately hold an account in two tenants; that case is handled
# in `login()`, which refuses to guess rather than picking a row. It is printed
# because it tells you whether anyone needs the tenant hint on day one.
#
# Committed deliberately, as an exception to CLAUDE.md's "don't commit local
# verification scripts" rule: that rule is about throwaway scripts that rot.
# This one is tied to a specific migration and is referenced from the ticket.
#
# EXIT CODES
#   0  clean — no within-tenant duplicates; 0018 is safe to apply
#   1  duplicates found — listed; STOP and resolve them with their owners
#   2  could not reach the database. THIS IS NOT A PASS.

set -uo pipefail

PSQL="${PSQL:-psql}"
: "${DATABASE_URL:?DATABASE_URL must be set — run this inside 'make prod-shell'}"

if ! "$PSQL" "$DATABASE_URL" -Atqc 'select 1' >/dev/null 2>&1; then
  echo "STI-305 PREFLIGHT: could not reach the database. This is NOT a pass." >&2
  exit 2
fi

echo "STI-305 preflight — duplicate account addresses"
echo "database: $("$PSQL" "$DATABASE_URL" -Atqc 'select current_database()' 2>/dev/null)"
echo

# --- The blocker: same email twice inside one tenant -------------------------
BLOCKING=$("$PSQL" "$DATABASE_URL" -Atqc \
  'select count(*) from (select tenant_id, lower(email) e from "user" group by 1,2 having count(*) > 1) d' 2>/dev/null)

if [ -z "${BLOCKING:-}" ]; then
  echo "STI-305 PREFLIGHT: the duplicate query returned nothing. This is NOT a pass." >&2
  exit 2
fi

if [ "$BLOCKING" != "0" ]; then
  echo "BLOCKING — $BLOCKING address(es) appear more than once within a single tenant."
  echo "Migration 0018 will FAIL against this database. Do not deploy."
  echo
  "$PSQL" "$DATABASE_URL" -c "
    select t.slug            as tenant,
           lower(u.email)    as email,
           count(*)          as accounts,
           string_agg(u.id::text || ' ' ||
                      u.first_name || ' ' || u.last_name ||
                      case when u.is_active then ' [active]' else ' [inactive]' end,
                      E'\n                    ' order by u.created_at) as who
      from \"user\" u
      join tenant t on t.id = u.tenant_id
     group by 1, 2
    having count(*) > 1
     order by 1, 2;"
  echo
  echo "Resolve each with the account owner. DEACTIVATE the redundant one — never"
  echo "DELETE it: a user is the actor on ledger events that cannot be rewritten."
  echo "Then re-run this script."
  exit 1
fi

echo "OK — no address appears twice within any single tenant. 0018 is safe to apply."
echo

# --- Informational: same email across tenants --------------------------------
CROSS=$("$PSQL" "$DATABASE_URL" -Atqc \
  'select count(*) from (select lower(email) e from "user" group by 1 having count(distinct tenant_id) > 1) d' 2>/dev/null)

if [ "${CROSS:-0}" != "0" ]; then
  echo "NOTE — $CROSS address(es) exist in more than one tenant. Not a blocker:"
  echo "the index is per-tenant. But login() refuses to guess which tenant an"
  echo "ambiguous address means, so these people CANNOT log in without a tenant"
  echo "hint. Decide how they get one before this ships."
  echo
  "$PSQL" "$DATABASE_URL" -c "
    select lower(email) as email,
           count(distinct tenant_id) as tenants,
           string_agg(distinct (select slug from tenant where id = tenant_id), ', ') as which
      from \"user\"
     group by 1
    having count(distinct tenant_id) > 1
     order by 1;"
else
  echo "No address is shared across tenants — nobody needs a tenant hint today."
fi

exit 0

# The owner account gets Urban's name, and a fourth admin role doesn't happen

Two small seed fixes, and one that turned out not to be needed once the
architecture doc was actually read.

## What changed

### Tenant name and the owner account's name

`packages/db/src/seed.ts`: the tenant's seeded name was `"Urban
Infraconstruction"` — missing the LLC suffix — now `"Urban Infraconstruction
LLC"`. Slug stays `"urban"`, unchanged, since it's read by tenant-scoped
login hints.

`packages/db/src/seed-data.ts`: the seeded `owner@stinventory.local`
account's name was `"Demo Owner"` — relabeled to `"Urban Admin"`, so a
fresh seed reads as Urban's own top-authority account rather than an
obvious placeholder. A second, independent copy of the same string lived in
`seed.ts`'s own `console.log` summary (literal template text, not derived
from `userSpecs`) — fixed separately, found only by actually running the
seed and reading its own output.

### What didn't happen: a fourth admin role

The original ask was for a new "system level tenant admin" account,
distinct from `owner`. `SYSTEM_PLAN.md` §2 already names and settles this
exact question:

> *System Administrator is the `owner` role in code — deliberately NOT a
> fourth `system_admin` role, which would be a second all-permissions role
> and two names for one authority.*

Surfaced that quote before writing anything. The user chose the
recommended path — relabel the existing account rather than build the
duplicate the doc explicitly warns against. No new role, no new permission
set, no `ROLES` entry.

## Verified

- `pnpm typecheck` clean for `@stinventory/db`.
- `SEED_RESET=1 pnpm seed` run twice against local dev — once catching the
  stale `console.log` string, once clean.
- Queried `tbl_entity_tenant` and `tbl_entity_user` directly afterward: the
  actual rows read `"Urban Infraconstruction LLC"` / slug `"urban"` and
  `"Urban Admin"` / `owner@stinventory.local` — not just that the script
  exited 0.
- Full `api-contracts` suite re-run in the api container: 257/257, so
  nothing hardcodes the old strings.
- `docs/SETUP.md` checked (the seed's own output points at it) — it lists
  only email/role/description, no name, so nothing there was stale.

## Deliberately not done

No repo-wide rename of "Urban Infraconstruction" to add the LLC suffix.
It appears in a dozen-plus prose docs and a couple of code comments and one
test fixture (`packages/mail/src/templates.test.ts`) as an arbitrary
string, none of them reading from the seed — none were stale, and rewriting
a dozen documents to append a legal suffix everywhere isn't what was asked.

## Where it is

Branch `development`, part of the same multi-phase push as the other
entries today — not yet on `main`.

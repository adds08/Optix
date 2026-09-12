# A foreman is linked to one truck, not one truck per ownership type

The rig-ordering fix earlier this session (see the previous entry) explained the
STI-502 rule as "one company truck per foreman, and a personal-allowance truck is
allowed alongside it" — the pairing STI-306's departure logic was believed to need.
Asked directly: that pairing is wrong. The user's rule is that a foreman is linked
to exactly one truck **row**, whichever ownership type it is, never two of either
kind at once.

## What changed

### The database rule widened, not narrowed

`packages/db/schema/location.ts`'s `vehicle_one_truck_per_foreman_uq` partial
unique index dropped its `ownership_type = 'company_owned'` predicate — it now
blocks a second truck of **any** kind for the same foreman, not just a second
company one. Migration `0068`. Checked before widening: no foreman in the running
dev database currently holds more than one truck of any kind, so this closes a
door nothing was standing in.

### The friendly error widened to match

`location.setCustodian`'s pre-check (the one that turns a raw constraint
violation into "X already has truck Y, detach it first") no longer restricts
itself to company-owned trucks — it names whichever truck the foreman already
holds, of either kind.

### The picker now warns and lets the desk proceed, instead of just failing

`apps/web/components/rig-picker.tsx`: assigning a truck to a foreman who already
holds a different one (of either kind) now shows the same confirm-first dialog
every other action in this picker already uses, naming the truck that will be
detached, rather than the desk clicking Assign and getting a raw CONFLICT back.
On confirm, the client detaches the foreman's existing truck and then assigns
the new one — two sequential calls, mirroring how the trailer branch already
unhitches before handing a trailer over.

### `vehicle.list`'s ordering simplified

The company-vs-personal tiebreak added earlier this session is no longer
reachable — a foreman can never hold two trucks to tiebreak between — so
`vehicle.list`'s `ORDER BY` simplified to plain newest-first, matching the
convention `project.list`/`employee.list` already use.

## What was found while building it

`departure.test.ts`'s entire fixture was built around **one leaver holding both
a company truck and a personal truck at once** — that is how "the personal
truck stays, the company truck gets reassigned" was proven. Under the widened
rule that fixture can no longer be constructed; the second insert would hit the
same constraint real callers now hit. Split into two leavers, each proving its
own half: the existing leaver keeps just the company truck and the gang box
("moves the company truck and the gang box"), and a new leaver holds only a
personal truck, with a tool recorded riding it, to prove the truck — and the
tool's ride — stays put and un-links cleanly ("a personal truck ... leaves with
the person, untouched"). `reassignOnDeparture` itself needed no code change:
it already just processes whatever containers a leaver holds, however many
that is, which is what made the split possible without touching the real logic.

`rig-uniqueness.test.ts` had two tests asserting the old "both allowed"
behavior as a feature; both flipped to prove refusal instead — one at the
database level (a raw insert of a second, personal truck for an
already-companied foreman), one at the API level (`setCustodian` naming the
truck it refuses to add a second one alongside).

Grepped the rest of the repo for the "may draw a personal ... AND drive a
company one" claim: only the schema comment, the router comment and these two
test files actually asserted it as behavior. The seed's two synthetic trucks
(one of each ownership type) are already on two different foremen, so no seed
change was needed.

## Verified

- `pnpm typecheck` — clean, both packages touched and the full monorepo.
- `make generate` / `make migrate` — migration `0068` applied cleanly against
  the running dev database.
- `rig-uniqueness.test.ts` (9 tests) and `departure.test.ts` (11 tests, up from
  10) — both green against the live database after the rewrite.
- Full `make test` against the live database — same 5 pre-existing
  `rbac-matrix.test.ts` failures as before this change (missing demo-seed
  accounts on the current dev database, unrelated — see the previous entry),
  no new failures.
- Did not verify the picker's new confirm dialog in a real browser — the
  Playwright MCP is not connected in this session, same limitation as before.

## Deliberately not done

- **No change to `reassignOnDeparture` itself.** It already handles a leaver
  holding zero, one, or (until now) more containers of any kind without
  needing to know how many there are.
- **No seed change.** The existing synthetic company/personal truck pair is
  already on two different foremen.

## Where it is

Uncommitted in the working tree, on `development`. Not deployed. (The prior
"five fixes" changelog entry this one follows on from was committed separately,
outside this session, as commit `dbe5f81`.)

# STInventory Release 1 — handoff

**For:** whoever picks this up next — a developer joining, or Urban's own team.
**Covers:** what `SYSTEM_PLAN.md` asked for, how it was broken down, what was built,
and how to prove each part works with your own hands.

Read this with `SYSTEM_PLAN.md` open. This document says what *happened*; the plan says
what was *agreed*. Where they disagree, the code wins — that is behaviour rule 3 in
`CLAUDE.md`, and it applies to this file too.

---

## 1. The one idea, before anything else

**Where a tool is, is calculated from an append-only ledger — never typed into a field.**

`transaction` is the system of record. Every `asset.current_*` column is a projection
folded from it. Ownership (who paid) and custody (who holds it now) are separate axes, and
tools follow the person, not the site.

If you remember nothing else from this document, remember that when a screen shows the
wrong custodian, the bug is in a *writer*, not in the column you are looking at.

---

## 2. What Release 1 was

`SYSTEM_PLAN.md` §6: **48 units, 5 phases, USD 2,500**, due 23 August 2026. One unit is
about half a developer-day.

| Phase | Units | What it had to achieve | State |
|---|---|---|---|
| 1 — Custody trail | 13 | Make the history trustworthy before building on it | **Complete** |
| 2 — Assignment detail | 7 | Truck and trailer as first-class fields | **Complete** |
| 3 — Roles, accounts, org structure | 18 | One login per role, visibility that actually narrows | **Complete** |
| 4 — Foundation entity load | 6 | One-time load of users, jobs, cost codes, phases | **Parked** — see §6 |
| 5 — Desk views by role | 4 | A desk composed by permission, not by role name | **Complete** |

Four of five phases delivered. Phase 4 is parked by agreement, not blocked on engineering.

---

## 3. How the work was broken down

Each phase became a numbered ticket series in `docs/tickets/`. The number tells you the
phase:

| Series | Phase | Examples |
|---|---|---|
| `STI-0xx` | Test harness | `STI-001` Playwright harness · `STI-002` critical-path journeys |
| `STI-1xx` | Phase 1 — custody trail | `STI-102` atomic custody writes · `STI-104` append-only ledger |
| `STI-2xx` | Phase 2 — assignment detail | `STI-202` assignment truck/trailer · `STI-204` typed tRPC errors |
| `STI-3xx` | Phase 3 — roles and org | `STI-302` visibility permissions · `STI-306` departure reassignment |
| `STI-4xx` | Phase 4 — Foundation | `STI-401` interface decision · `STI-405` import tests |
| `STI-5xx` | Phase 5 — desk views | `STI-501` panel registry · `STI-502` desk panels |

Two things to know before you trust that directory:

1. **Most ticket files still say `Status: READY` although the work shipped.** The status
   lines were not maintained. `docs/tickets/STATUS.md` is closer to the truth, and the code
   is closer still.
2. **There is a second, unrelated `STI-xxx` numbering** in
   `docs/workings/RELEASE_1_SPRINT_PLAN.md`, used by the Jira tickets. The same ID means
   different things in the two documents — `STI-103` is "one active assignment per asset"
   here and "Equipment entity management" there. Check which document a number came from
   before acting on it.

---

## 4. What was built, phase by phase

### Phase 1 — Custody trail

The history is now defensible at the database, not merely by convention.

- **The ledger is append-only in Postgres.** A trigger raises `0A000` on any `UPDATE`,
  `DELETE` or `TRUNCATE` against `transaction`. Application code cannot rewrite history even
  by mistake.
- **Every ledger write carries a complete `toState` snapshot.** The fold *replaces*, it does
  not merge, so a partial snapshot silently means "custodian, project and location are now
  unknown". This shipped wrong three times; `packages/domain/src/fold.test.ts` pins it now.
- **One custody chokepoint.** All custody writes go through
  `packages/api-contracts/src/custody.ts`. A partial unique index
  `assignment_one_active_uq` is the backstop: a second active assignment for one asset now
  fails loudly instead of quietly producing two custodians.
- **Reconciliation runs on a schedule.** Every six hours and at boot, the projection is
  re-folded from the ledger and any divergence raises a desk notification. Compare and repair
  are separate actions on purpose — `asset.verifyProjection` reports, `asset.rebuild` fixes.

### Phase 2 — Assignment detail

- `assignment` carries `truck_id` and `trailer_id`, with a composite foreign key so the
  database itself insists a truck id names a truck.
- **A three-state rule**, which is the subtle part: an **absent** key means "not recorded", an
  explicit **null** means "affirmatively none", and a uuid means a specific vehicle. The fold
  keeps all three distinct so pre-existing history stays readable.
- Company and personal vehicles are distinguished, because that distinction drives what
  happens on departure in Phase 3 — a personal truck leaves with its owner.
- Typed `TRPCError` and error boundaries across the routers.

### Phase 3 — Roles, accounts and organisation structure

The largest phase, and the one Urban touches most.

- **One login per role**, thirteen of them, all seeded.
- **A four-tier visibility ladder** — `assets.view.all`, `.project`, `.crew`, `.own` —
  resolved widest-first, first match wins. Critically it is **applied to the query, never as
  a post-filter**: a total computed over rows you may not read is itself a read of those rows.
- **No role-name branching in server code.** Permissions decide everything. The one
  deliberate exception is which *navigation* a user sees, which is a layout question.
- **User administration** at `/admin/users` — create, assign role, deactivate, reset
  password, with forced password change on issue.
- **An editable permission matrix** at `/admin/roles`. This one is worth understanding: the
  original plan assumed Urban would return a signed permission matrix. They never did, so
  rather than freeze six guesses into code, the matrix became a screen. An administrator
  ticks permissions per role in plain English and creates roles of their own — no developer,
  no deploy.
- **Departure reassignment** — everything a leaver holds moves to a named successor in one
  auditable action, containers included, with the leaver's personal vehicle correctly
  recorded as gone rather than reassigned.

### Phase 5 — Desk views by role

- `/desk` is a route, composed from `apps/web/components/desk/panel-registry.tsx` **by
  permission alone**. No role name appears in the composition, and adding a panel is one
  entry in an array.
- It is a route rather than a dashboard tab because `/home` redirects field roles to
  `/my-tools`, so a Desk living there would have been unreachable for exactly the people who
  need it.

---

## 5. Production defects found and fixed after delivery

A QA pass against production raised fifteen tickets. All are addressed; the round is worth
recording because two of them were not what they appeared to be.

| Area | What was actually wrong |
|---|---|
| Create flows (UI-73/74/75) | Creates were refused or invisible: a dialog taller than the viewport with no scroll, a validation error rendered as raw JSON, and lists with no `ORDER BY` |
| Reports export (UI-68/69) | Two tickets, one cause — an empty report offered a disabled button with no explanation |
| Fleet map (UI-67) | Not missing GPS. Every vehicle shared one coordinate, so markers stacked and only the top one was clickable |
| Capital split (UI-70) | API returned the breakdown; the chart drew both slices and labelled neither |
| Duplicate hand-off (UI-66) | The chat path queued transfers without the one-open-hand-off guard the router enforces |
| Inbox dismiss (UI-72) | Copy belonged to a different button, and a dismissed *message* vanished from every bucket |
| Warranty dates (UI-60) | Date-only columns parsed as UTC midnight, so every date rendered a day early **for Dallas users** and correctly for the Kathmandu tester |

The last one is the lesson: **a date bug can be invisible to the person testing and wrong
for every user.** `packages/types` now runs its suite under `TZ=America/Chicago` for that
reason, and that line is load-bearing — under UTC the broken and fixed parses are
indistinguishable.

---

## 6. Phase 4 — why it is parked

Foundation entity load is the one phase not built. It is **parked by agreement**, not
blocked on engineering:

- There is no auth for Foundation, and credentials must be requested through the client.
- Foundation will not expose an API. Without one the mechanism is scheduled polling against
  their database or a file drop — a different design, and a different estimate, from what
  the plan assumed.

The identity model itself is fully specified in `SYSTEM_PLAN.md` §6.4 and could be built
quickly once the transport and auth are known. Building it before then risks getting the
shape wrong.

**What unblocks it:** credentials, and a decision between nightly export and database access.

---

## 7. Running it

```bash
cp .env.example .env.local     # required — the Makefile hard-errors without it
make ENV=local up              # postgres + api + web
make ENV=local seed            # sample data; SEED_RESET=1 to wipe first
```

- web → http://localhost:3100
- api → http://localhost:4100 (health at `/health`)
- database → `make ENV=local psql`

`make help` lists every target. Logins are all `stinventory-demo`:
`owner@`, `admin@`, `office@`, `warehouse@`, `pm@`, `engineer@`, `super@`, `foreman@`,
`mechanic@`, `hr@`, `finance@`, `procurement@`, `readonly@` — all `@stinventory.local`.

**Migrations, never push.** `make generate` → commit the SQL → `make migrate`. The escape
hatch is deliberately named `push-dangerous`.

---

## 8. How to test each phase

Automated first, then by hand. Counts are deliberately not quoted here — run the command,
it will tell you.

```bash
make ENV=local typecheck    # every package
make ENV=local test         # unit + integration, real Postgres for the integration ones
make ENV=local lint
make ENV=local e2e          # browser suite; needs `make e2e-install` once
```

### Phase 1 — custody trail

**The ledger really is append-only.** In `make ENV=local psql`:

```sql
UPDATE transaction SET note = 'tampered' WHERE id = (SELECT id FROM transaction LIMIT 1);
-- expect: ERROR 0A000
--   "transaction" is append-only: UPDATE blocked. The ledger is the system of
--   record for the custody chain; corrections are compensating events, never
--   edits (STI-104).
```

`DELETE` and `TRUNCATE` are blocked by the same function (migration `0014`).

**No tool has two custodians:**

```sql
SELECT asset_id, count(*) FROM assignment
WHERE status = 'active' GROUP BY asset_id HAVING count(*) > 1;
-- expect: 0 rows
```

**No snapshot is empty** — an empty `to_state` blanks an asset on rebuild:

```sql
SELECT count(*) FROM transaction WHERE to_state IS NULL;
-- expect: 0
```

**The projection agrees with the ledger.** Watch the API log at boot for the reconciliation
sweep, or call `asset.verifyProjection`. It reports; it does not repair.

By hand: assign a tool to somebody, then read its ledger in fold order —

```sql
SELECT event_type, occurred_at, to_state FROM transaction
WHERE asset_id = '<uuid>' ORDER BY occurred_at, id;
```

Every row should carry a complete snapshot, not a fragment.

### Phase 2 — assignment detail

Assign a tool and put it in a truck or on a trailer. Then check the ledger event carries
**both** vehicle keys explicitly — a custody move must not inherit the previous holder's rig.

Return the same tool to the yard and confirm the snapshot now records `truckId: null`
(affirmatively none), not a missing key (not recorded). That distinction is the whole of
STI-202/203 and is the easiest thing to break.

Try to assign a trailer id where a truck belongs — the composite foreign key should refuse
it.

### Phase 3 — roles, accounts and visibility

**The ladder narrows what each role can see.** Log in as each and compare the Tool Register
count. On the seeded data:

| Login | Should see |
|---|---|
| `owner@`, `admin@`, `office@`, `warehouse@`, `hr@`, `finance@`, `procurement@`, `readonly@` | every tool |
| `pm@` | the tools on Lone Star only |
| `engineer@` | the tools on DART only |
| `super@` | what his crew hold, spanning two jobs |
| `foreman@` | only the tools in his own hands |
| `mechanic@` | only the shop tools he holds |

The important check is that the **dashboard totals and reports narrow too**, not just the
register. A count over rows you cannot read is a leak.

**Permissions, not role names.** Open `/admin/roles`, untick a permission for a role, log in
as that role and confirm the capability is gone. Tick it back. Nothing is redeployed.

**User administration.** At `/admin/users` create an account, confirm it must change its
password on first login, deactivate it, confirm it can no longer sign in — and confirm
deactivating did **not** move any custody.

**Departure.** Run a departure for someone holding tools and a container. Everything they
hold should move to the named successor in one action, the ledger should record it, and a
personal vehicle should be recorded as gone rather than handed on.

### Phase 5 — desk views

Open `/desk` as several roles. The panels should differ by permission, and no panel should
appear for a role lacking its permission. Adding a panel should require one array entry in
`panel-registry.tsx` and no role check.

### The inbox

Open `/inbox` as `admin@`. All three sections should have something in them from a fresh
seed — this is recent, and worth knowing why: until the seed carried messages and tasks,
every bucket was empty on every machine, so **Dismiss, Try again and Decline were never
clickable without hand-made rows.** Two defects shipped in the dismiss path because nobody
could reach the screen to look at it.

- **Unrecognized** — an unparseable message and a parser failure. Dismiss one and confirm it
  moves to Completed rather than disappearing; that is the bug UI-72 turned out to be.
  Cancelling the prompt should leave the item exactly where it was.
- **Recognized** — a proposed action and a task carrying an `actionType`. Decline is wired;
  Approve is not, which is the STI-121 hole noted in §9.
- **Completed** — history. It should hold what you just dismissed.

If a bucket is empty on a fresh database, the seed has regressed — that is the whole point
of seeding them.

### The browser suite

```bash
make ENV=local up && make ENV=local seed
make e2e-install     # once
make ENV=local e2e
```

It drives a real browser against the running stack from outside, per role. It is
**non-blocking in CI** for now, deliberately, until it has a fortnight of clean history —
tracked as STI-122.

---

## 9. What is not done

These are not one list. They come from three different places, and lumping them together
hides which are managed and which are only written down somewhere.

### Tracked, deferred on purpose

Each has a ticket and a stated reason.

- **Phase 4** — parked by agreement, see §6.
- **STI-002** — the six critical-path browser journeys. The harness exists; the journeys do
  not, because a **mutating** browser test needs a database-isolation mechanism designed
  first, and every spec in the suite today is read-only for exactly that reason.
- **STI-121** — procedures no screen can reach. `reachability.test.ts` enumerates them, each
  with a written reason, and fails the build on any new one. So this is *managed*, not
  ignored. Two entries look like real product holes rather than absent screens:
  `assignment.return` and `task.approve` — **a desk can refuse a request from the UI and
  cannot grant one.**
- **STI-122** — make the browser suite blocking in CI, once it has a fortnight of clean
  history behind it. It is deliberately non-blocking until then.

### Found during the 2026-08-23 QA round

Side-findings from root-causing the production bugs. None had a ticket when it was found —
they existed only as prose in a Jira comment, which is how things get lost.

| Finding | State |
|---|---|
| Seed gave every trailer one identical GPS coordinate | **Fixed** — it is why the map bug was never seen internally |
| Seed created no messages and no tasks, so the inbox was unreachable | **Fixed** — every bucket now has an occupant |
| `downloadCsv` never appended its anchor and revoked the blob synchronously | **Fixed** — the app's only download path |
| `make e2e` never ran the browser suite (target collided with the `e2e/` directory) | **Fixed** |
| A partial unique index on `transfer` | **Still open** — see below |

**The `transfer` index is the one still outstanding.** It would make "one open hand-off per
tool" a database guarantee rather than an application one, and close a TOCTOU window in
`transfer.create`. It is not done because `CREATE UNIQUE INDEX` fails at deploy time if the
table already holds duplicates, and deciding which duplicate survives is a judgement about
Urban's real data rather than a code decision. It needs a sweep against production first.

### A caveat about the CSV export test

`e2e/tests/csv-export.spec.ts` exercises the export path end to end, but it does **not**
catch either of the two defects it was written alongside — verified by restoring the broken
version and watching it still pass. Chromium follows a detached anchor happily. Catching
that one needs a Gecko project, which the suite deliberately does not have. The spec's own
comment says all of this; do not read more into it than it claims.

---

## 10. Traps that have already cost time

| Symptom | Cause |
|---|---|
| Tests fail only inside Docker | Missing `node_modules` anonymous volume for that package |
| A rebuild blanks everything | A writer emitted a partial `toState` |
| Two custodians for one tool | A write bypassed `custody.ts` |
| A permission check "does nothing" | You are on the `/api/*` REST surface, which has none |
| Stale deps after a `package.json` change | Anonymous volumes survive rebuilds — `make ENV=local reset` |
| A date is one day out | A date-only column parsed as an instant — see `toDate` in `packages/types/src/format.ts` |
| An overdue view is asked for | Overdue was removed. Nothing falls due, so nothing goes overdue |

---

## 11. Where to read next

| I need… | Read |
|---|---|
| To run it, seed it, unstick the containers | `docs/SETUP.md` |
| The domain model, roadmap, ADRs | `AGENTS.md` |
| Rules for the area I am editing | `.claude/rules/` — nothing loads these for you |
| A verified architecture walkthrough | `STINVENTORY-EXPLAINER.md` |
| What is agreed versus what is built | `SYSTEM_PLAN.md`, then `docs/tickets/STATUS.md` |

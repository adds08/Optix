# A button that pulls people from BambooHR

Steps 2 through 5 of `docs/workings/BAMBOOHR_PEOPLE_SYNC.md`, built end to end after the
user asked for the plain version of it: a button to sync in users. Step 1 (the schema)
landed on 2026-09-06; `employee.department_id`, the column its own field mapping had
pointed at for a day without it existing, landed earlier today.

Nothing here has called BambooHR. The `GET` client is written and the button is wired,
and the first live request is the user's to make — settled explicitly.

## What changed

### The adapter, pure, in `packages/domain`

`bamboohr.ts` maps one `data[]` record to Optix's vocabulary with no network and no
database, so the part most likely to be wrong is the part that needs least to test it.
Three output buckets, and the split is policy made structural rather than asked for in a
comment:

- `writable` — email, job title, division, department. Applied freely.
- `identity` — `code` and `name`. Proposed and never applied to an existing person.
- `observed` — `status`. Reported and never written by a sync at all.

A caller that spreads `writable` therefore *cannot* deactivate anybody or rename anybody.

**`_restrictedFields` is the rule the file is shaped around.** BambooHR nulls a field the
key may not read and names it in that array, so a null means "not allowed to see it", not
"empty". Withheld fields are OMITTED from the output rather than emitted as undefined —
a present key holding undefined still overwrites on a spread, which is exactly the
silent blanking this guards against. Every mapped read goes through one `visible()`
helper, so a field added later inherits the protection instead of having to remember it.

### The queue: `tbl_ops_sync_run`, migration `0054`

One row per press. The button inserts and returns; a worker executes; the client polls.
Same shape as `messaging.send`, deliberately — a second mechanism for "started now,
finished later" is a second thing to reason about.

There is no general job queue in this repo (the background layer is four `setInterval`
callbacks) and this does not try to become one. A partial unique index,
`sync_run_one_open_uq` on `(tenant_id, source) WHERE status in ('queued','running')`,
allows one open run per tenant per source — the same tool `assignment_one_active_uq`
uses, because a router guard can be raced and an index cannot.

`refused` and `skipped` are separate counts on purpose: a refused record could not be
adapted at all, a skipped one was understood and had nothing to change. Collapsing them
would hide the only category that needs a human.

### The fetch, the diff, the apply

`apps/api/src/bamboo-sync.ts`. `bambooGet` is the only function that touches the network,
hardcodes `method: "GET"` and takes no verb parameter, so there is no argument anybody can
pass to make it write. It never logs the key or the response body — `errorNote` is stored
and displayed, and a credential in an error string would end up on a screen.

`buildSyncPlan` is pure with respect to the database, so preview and apply cannot disagree
about what would happen; a preview computed by a different path from the apply is a
preview that can lie. Matching is on `(system, external_id)` first — the whole reason
`employee_external_ref` exists — falling back to name only on a first bind, and a name
matching more than one person is refused for a human rather than bound to a coin flip.

`applySyncPlan` builds its patch as an explicit object and never spreads `writable`:
that object speaks BambooHR's field names and the table speaks ours, and Drizzle drops an
unknown key with no error `tsc` can see. It is not wrapped in one transaction — postgres.js
pins one of ten pool connections for a transaction's life, and this one spans a network
fetch. The manager edge is a second pass, because a manager may be imported after their
report.

### The worker, with an in-flight guard the others do not have

A fifth `setInterval` in `apps/api/src/index.ts`, every 10s.
`.claude/rules/api-server.md` records that none of the existing loops has an in-flight
flag, so a scan slower than its interval overlaps itself. Those are local database work;
this one fetches a paginated roster over the internet and will routinely outrun a 10s
tick. Without the flag a slow sync would be re-entered every ten seconds and hammer the
client's production HR system — the opposite of the restraint the rest of this is built
around.

### The screens

`Sync from ▾` on `/people` beside Import, offering Preview (writes nothing) and Sync now,
with a result dialog that leads on the two categories needing a decision rather than on
totals. A menu and not a button because this repo's comments already name three far
systems, and a flat button per system is how a toolbar stops fitting.

`/settings/integrations` holds the same trigger plus run history, and states the three
rules on the screen: new people are added but not invited, nobody is ever deactivated,
badge numbers and names are never overwritten. Credentials are described honestly as
coming from the environment rather than offered as a form that writes nowhere.

**That page is a CARD GRID, at the user's request, because more integrations are coming**
— this codebase's comments already name Mark 85 and FoundationSoft. Adding the second is
one entry in the `INTEGRATIONS` array and nothing else: no new component, no new layout
decision, no second opinion about where a status label goes. Each card carries a glyph on
a neutral tile, the name, an **Installed** badge and its own action, with the action on
`mt-auto` so cards of different blurb lengths still line their buttons up.

Two deliberate constraints on it. **Only built integrations get a card** — there is no
greyed-out "Mark 85, coming soon" tile, because a card advertising a capability the system
does not have is the same defect as `tenant_settings.sms_enabled`. And **the icon is a
lucide glyph, never a vendor logo**: we do not hold BambooHR's artwork, and
`--brand-navy`/`--brand-yellow` belong to the Optix mark alone, so nothing on the card is
painted in a brand colour, theirs or ours.

The three rules sit BELOW the grid rather than inside the card. A card carrying five lines
of policy stops being scannable and scanning is the grid's whole job.

### `BAMBOOHR_*` reaches the typed env, and `TWILIO_*` leaves it

The two BambooHR keys were in `.env.local` and `.env.example` and absent from
`serverSchema`, which is a bare `z.object` — Zod strips what it does not declare, so
`serverEnv()` returned an object without them while the values sat on disk.

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` are removed from the schema
and `.env.example`. Three optional keys read by nothing, no `twilio` dependency in any
package.json, empty in every env file: declared config for an SMS path never built.
Notifications are email only, by decision.

## What was found while building it

- **The endpoint was doubted and is real.** The plan document's `list-employees` decision
  was challenged on the grounds that it is not in BambooHR's docs. It is:
  `GET /api/v1/employees`, cursor-paginated, `data[]` + `meta.page.nextCursor` + `_links`,
  with `_restrictedFields` always returned and `reportsToId` available. Checked against the
  published reference, not against a call. The user's `/api/v1/` prefix was right and the
  plan document's `/v1/` was the one thing wrong in it.
- **The client's sample payloads are not in the repository.** `find` turns up only the plan
  document, which nonetheless cites them repeatedly. So step 2's "both response shapes
  fixtured from the client's two samples" was not buildable as written; the adapter is
  fixtured from the published field list instead, and `directory` is not implemented at all
  now that `list-employees` is settled.
- **`reachability.test.ts` earned its keep.** The router landed before the settings screen
  and the suite failed with `procedures no screen can reach: sync.history` — naming the
  procedure and offering three ways out. The screen was the right one. A feature that
  typechecks and has no way in is not built, and this repo has a test that says so.

## Verified

- `pnpm typecheck` — exit 0, after every step.
- `pnpm vitest run` in the api container — **600 tests, 595 passing, 5 failing**, all five
  `rbac-matrix.test.ts` reporting missing fixture accounts because the database holds
  Urban's real register. That is the documented baseline (constraint 2), unchanged by this
  work. 32 of the new tests are the adapter's.
- The reachability regression was seen, diagnosed and fixed inside this change, and the
  re-run returned to the 5-failure baseline.
- Migration `0054` SQL read before applying: `CREATE TABLE IF NOT EXISTS`, two FKs in
  `DO $$ ... duplicate_object` blocks, three indexes. Purely additive. The partial unique
  index confirmed in `pg_indexes` with its `WHERE` clause intact.
- Both screens driven in a real browser signed in as `optix_it@optixtec.com`:
  `Sync from` renders in the `/people` toolbar and its menu opens with both options;
  `/settings/integrations` renders the panel, the three rules and the empty-history state.
  Console clean on both — zero errors, zero warnings.
- `tbl_ops_sync_run` is empty, so nothing is queued and no run can fire unattended.

**Not verified, and deliberately:** no sync has been executed. The apply path, the manager
second pass, the pagination loop and the failure branches have never run against a real
payload, because doing so means calling the client's production HR system and that call is
the user's. Preview mode is the safe first exercise — it writes nothing to Optix.

## Deliberately not done

- **No per-tenant credentials.** Server environment only. Per-tenant rows want AES-GCM at
  rest the way the tenant LLM key already has, and that is its own change.
- **No invitations.** The sync adds a person; giving them a login stays separate. The
  user's call, and it is why 81 people with no email address is a fact this feature
  exposes rather than fixes.
- **No deactivation, and no reconcile.** A leaver is a flag. Full two-way reconcile was
  offered and declined for now.
- **No `bamboo-sync.test.ts`.** The adapter is covered; the fetch, the plan builder and the
  apply are not. `buildSyncPlan` is pure and is the obvious next test — including the
  ambiguous-name refusal, which is the branch protecting Urban's five deliberately-separate
  near-duplicate pairs.
- **`directory` is not implemented** as a fallback, now that the endpoint question is
  settled. §3's caveat about a narrow key stands: `_restrictedFields` on the first live
  call is what would reopen it.

## Where it is

Branch `development`, uncommitted, on top of `176ebc5`. Migrations `0053` and `0054`
applied to the local database only. Not committed, not deployed. No call has been made to
BambooHR.

---

## Addendum, same day: the first real run, and what it broke

The user pressed it. The fetch, the adapter and the diff all worked; the apply did not.

### The preview was the most valuable thing here

It came back `created: 1816, updated: 35, flagged: 1578`. Urban's Optix roster is 83
people — BambooHR holds ~1851 employee records, 1578 of them former employees. An apply
on that plan grows the register to ~1899, of which the working roster is 4%. Nobody knew
that before the button existed, and a dry run that writes nothing is how it was found
rather than discovered afterwards.

The user's decision, recorded: **pull everyone and flag the inactive**, not a status
filter. Offered `filter[status]=Active` and it was declined. So the register is expected
to hold former employees carrying a flag, and whatever surfaces them is a screen problem
rather than a sync one.

### Three faults, all in the apply

**`ON CONFLICT` named one arbiter and the table has two unique indexes.**
`eer_system_id_uq` (tenant, system, external_id) and `eer_employee_system_uq` (tenant,
employee_id, system). An insert carrying a NEW external_id for a person who already has a
bamboohr ref does not conflict on the first, so it proceeds and dies on the second. Fixed
by checking the employee+system row FIRST and reporting a disagreement into
`needsConfirming` — rebinding a person to a different foreign id is the same class of
change as overwriting their `code`, and gets the same treatment: proposed, never applied.

The trigger was seeded data. `seed.ts` binds three real people to FABRICATED bamboohr ids
(4471/4472/4473); real BambooHR returned them under different ids, the name fallback
matched the employee, and the second index fired. Those seeded refs are not decorative,
they are wrong, and they will do this again on any database seeded before a first sync.

**A crash discarded the run's progress.** It died on person 520 of 1816 and reported
`created: 0` with 519 rows in the table — the report actively misinformed the person who
pressed the button. Row failures are now counted, not thrown: the loop continues, the
count lands in `refused`, the first message lands in `errorNote`, and the run finishes
`done` rather than `failed` because most of it worked.

**Partial writes are real and were not cleaned up by anything.** 519 employees, 14
divisions, 16 departments and 79 job titles from an aborted run, holding no tools and on
no crews. Hence the new make target below.

### `make reset-bare`

Empties the register — every employee, tool, job, vehicle, custody row and ledger event —
and KEEPS the tenant, permissions, roles, settings and both logins. `make reset` already
existed and reseeds a full dataset, which is the wrong tool when the intent is to start
from nothing and pull the real roster in over the top.

Implemented as `packages/db/sql/empty-register.sql` plus a Makefile target, deliberately
NOT as a third seed dataset. A `SEED_DATASET=bare` with empty spec arrays was built first
and abandoned: `seed.ts` calls `.insert().values(specs.map(...))` in about ten places and
Drizzle throws on an empty array, so it would have meant guarding ten inserts inside the
most destructive file in the repo to serve one caller. The SQL touches `seed.ts` not at
all.

`DELETE` and not `TRUNCATE ... CASCADE`, because cascade would reach the retained tables
through the FK graph and take the logins with it — the one thing the script exists not to
do. One transaction, and it disables the ledger's append-only trigger for exactly that
block, the same sanctioned exception `seed.ts`'s own wipe uses.

### Where the synced fields actually went

Worth recording because it read as data loss and was not. Job title, division and
department all landed — 518, 516 and 507 of 519 respectively. They are absent from the
People register because it has no columns for them, which is a UI gap. The ROLE column
reads `roleName`, the RBAC role that grants permissions, and the sync deliberately leaves
`role_id` null: granting Optix permissions from an HR job title is how a Carpenter
silently acquires a foreman's access. BambooHR sends `jobTitleName` (verified against a
stored `raw` payload, not assumed) and `_restrictedFields` came back empty, so the API key
can read every mapped field.

### Verified

- `pnpm typecheck` exit 0.
- `pnpm vitest run` after `make seed-demo`: **44 files, 600 tests, all passing, exit 0.**
- `make reset-bare` run against the polluted database: 0 employees, 0 tools, 0 jobs, 2
  logins kept, 15 roles, 35 permissions — and `POST /auth/login` returns 200 afterwards,
  which is the property that matters.
- The empty-array failure was found by RUNNING the abandoned bare-dataset approach, not by
  reasoning about it; the seed crashed at the project insert with 0 logins in the database,
  and `make seed-urban` restored it.

### Still not done

- No test for `buildSyncPlan` or the ref-conflict path. The adapter has 32; the plan
  builder is pure and is the obvious next one, especially the ambiguous-name refusal.
- The three fabricated `employee_external_ref` rows in `seed.ts` are still there and still
  wrong. They should be removed or given real ids; they exist to make the table reachable
  from a clean database, which is a good goal served by bad data.
- People still has no Job title / Division / Department columns, so the synced fields
  remain invisible.
- The sync has not been re-run since the fix.

---

## Addendum — the field list, and an enum value that had no source

The client confirmed in Postman that a `list-employees` call with no `fields=`
parameter returns only the eight base fields. Everything else has to be named
explicitly, which made "which fields do we need" a question with a checkable
answer rather than a matter of taste: map each column on `tbl_entity_employee`
to a field in the payload, and see what is left over on both sides.

Two things were left over.

**`employee.terminated_at` had no source.** The column exists and the clearance
queue reads it to find an ex-employee still holding tools, but nothing in the
sync filled it. Since a departure is a flag an admin acts on rather than
something the sync performs, the flag was going to arrive with no date attached.
`terminationDate` is now requested, and reported as an observation.

**`on_leave` could not be produced by any input.** `EMPLOYMENT_STATUSES` defines
three values; `status` carries Active and Inactive and nothing else, so
`normaliseBambooStatus` could return two of the three and never the third. The
value was dead by construction rather than by choice — not a bug anybody would
see, because the absent case looks exactly like "nobody is on leave".

`employmentStatusName` is the only field in the payload that can fix it. A
person on a leave of absence is still `status: Active` in BambooHR, so the flag
cannot separate them from somebody at work; HR's own status wording can.
`normaliseBambooStatus` gained a second optional argument, so existing one-arg
calls are unchanged.

Inactive is checked **before** the leave refinement, deliberately. Somebody HR
has marked Inactive is off the roster whatever their status name still says, and
reading that as `on_leave` would keep them out of the clearance queue. Getting
a tool back from somebody who turns out to be on leave is the cheaper of the two
mistakes.

## What was found while adding them

`company_role`, `division` and `department` each carry only `id`, `tenant_id`,
`name`, `code` and `is_active` — **no external-id column on any of the three.**
BambooHR's `jobTitleId`, `divisionId` and `departmentId` therefore have nowhere
to land, so they are not requested; name-matching is the only resolution
available.

That leaves a hazard worth naming, because it is silent: rename a division in
BambooHR and the next sync will not rename the Optix row. It creates a second
one and moves every employee onto it, orphaning the first. Closing it needs an
external-id column on three tables, which was not done here — the plan document
carries it now so it is a known cost rather than a future surprise.

## Verified

`pnpm typecheck` — 14/14 tasks successful. Adapter tests 39 passing, up from 32:
the leave path, the Inactive-wins ordering, the fold through
`adaptBambooEmployee`, and a withheld `terminationDate` omitting the key rather
than emitting `undefined`.

**Not verified:** the two new field names were not re-checked against the
published spec, which the client pasted into chat rather than into the repo. The
failure mode is safe — `visible()` returns undefined for an absent key and every
read is guarded, so a name Bamboo does not recognise degrades to "field absent"
and cannot fail a run — but it is unconfirmed until the first live call.

## Deliberately not done

`hireDate` (no column exists to hold it), `reportsToName` (ids only — the roster
carries five near-duplicate name pairs), and the external-id columns described
above.

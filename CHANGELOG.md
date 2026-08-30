# Changelog

All notable changes are documented in this file. The product is called **Optix**;
the repository, the package scope and the storage keys still say STInventory, which
is deliberate.

Per-change detail — what was verified, what was found, what was deliberately not
done — is in `docs/changelogs/`, indexed at `docs/changelogs/INDEX.md`. This file
is the release-level summary.

## v1.0.0 — 2026-08-29 — "Optix for small tools implemented"

The first tagged release. Small-tools custody, end to end: a register, a ledger
that is the system of record, one writer that may move custody, role-based access
with a matrix asserted against the database in both directions, a conversational
path that reaches the same procedures the screens do, reporting on ownership and
custody as separate axes, and a desk client shipped as a PWA alongside an Expo
field client.

What is in it, feature by feature and with what is deliberately *not* built, is
`docs/architecture/05-features.md`. The architecture as built is
`docs/architecture/`; where the code is and what to read before touching it is
`docs/CODEMAP.md`.

Known and deliberate at this tag:

- `/home`'s fleet monitor is a wall-board and overlaps its own text on a phone.
  Routing narrow viewports to the `command` tab is the answer; it is a product
  decision, not a media query.
- CSV export from the register reads the post-pagination row model, so it exports
  one page.
- `role.can_hold_custody` and `uses_field_layout` are stored, seeded and editable,
  but the navigation and the custodian pickers still read hard-coded role lists.
- Invite-only signup is wired end to end but no mailbox has been pointed at it.
- Vendors, purchase orders, cost codes and phases are not built.

## Unreleased

### Removed: rented equipment, loans, and foreman-to-foreman hand-offs

Three things the system modelled that Urban does not do.

**Rented equipment is gone.** STInventory tracks the small tools Urban owns. Hire
contracts, vendors and their return dates are a different problem and are no longer
part of this system.

**Loans are gone.** A tool issued to somebody is simply in their custody — there is
no due date, nothing falls overdue, and no screen chases a return. Every overdue
banner, alert and report went with it.

**Only the equipment desk moves tools.** A foreman can see what he is holding; he can
no longer transfer a tool to another foreman or assign one to himself. Issuing and
reassigning is the equipment department's job, which is how the yard already works.
The one approval left is by value: a tool above the high-value threshold still needs
a second administrator to sign it off.

### Changed: the dashboard no longer reports money

Fleet value and shop capital are off the desk dashboard, along with the capital
split chart on the Command Center. They are totals of what tools cost, which is a
question finance asks rather than one the yard acts on between jobs. All three
remain as reports — capital by project, capital by department, and the capital
split chart — so nothing was lost, it moved to where that question belongs.
"Capital on jobs" stayed: what a job is holding matters when it closes out.

### Fixed: a failed screen no longer blanks the app

A render error anywhere in the app used to unmount everything and leave a white
page — no navigation, no message, nothing to report. Failures are now contained to
the panel that broke, with the shell still around it and a Try again button. A
reference code is shown so a report can be matched to the server log.

### Added: the equipment desk is told when something needs it

A hand-off held for approval, or a borrow recorded and awaiting checking, used to
appear only as a number on the dashboard — the desk found out by looking. Both now
raise an alert to whoever holds the approver role (Settings → custody approver,
defaulting to the equipment department). The two read differently on purpose: one
says the tool has not moved, the other says it already has.

Note that the queue these alerts point at still has no screen to action it from.

### Changed: clearer errors from custody actions

Acting on a transfer or assignment that had already been approved, declined or
completed returned an unhelpful server error. It now says which state the record
is actually in, and missing records are reported as missing rather than as a fault.

### Removed: three unused packages

`frontend-shared`, `design-system` and `notifications` were never imported by either
app. They described a shared layer that was never built and had misled earlier work.

### Added: rented equipment

> Superseded within the same unreleased cycle — see "Removed: rented equipment, loans,
> and foreman-to-foreman hand-offs" above. This entry is kept because the work was done
> and the reasoning is worth reading; none of it ships.

Urban rents from United Rentals; the system only knew about tools Urban owns. New
`vendor` / `rental_order` / `rental_line` tables, deliberately **not** rows in `asset` — the
register's whole premise is that the Equipment Department owns everything in it, and a
rented pump has no owning project, is never disposed, and has a date after which it costs
money every day. Mixing them would corrupt the one number the register exists to produce.

- **The real vendor export imports as-is.** The `rental` import spec uses United Rentals'
  own column headers verbatim and parses their MM/DD/YYYY dates, because a file you have to
  reformat before it loads is a file nobody loads. One row is one line item with contract
  fields repeated; the importer groups them back into orders by contract number. Verified
  against Urban's actual 137-line export: 137/137 valid, grouped into exactly the 60
  contracts in the file, and re-importing creates nothing new.
- **`rental.onRent`** — what is still out, soonest due first, overdue at the top. On the real
  export this immediately surfaced **21 of 23 on-rent lines already past their end date**.
- **`rental.offRent`** — the one write that stops money leaving. Records the date the yard
  says it went back, not the date somebody typed it, and closes the contract when its last
  live line returns.
- **`rental.linkProject`** — the vendor calls a job "TXDOT PUMP STATION IMPROVEMENT"; Urban
  calls it something else. No automatic match is possible, so jobsite text is stored verbatim
  and linked once per label by a person. Re-import never overwrites that link.
- **Alerts** go to the equipment desk, not the field — a foreman cannot end a hire contract.
- **No cost figures.** The export carries no rates, so any total would be invented. Rate
  fields exist on the line for when rates arrive; until then the API reports days and
  quantities, which are real.
- 16 new tests on the rental clock.

### Fixed: bulk import preview was broken for any real file

`import.preview` was a tRPC **query**, so its input travelled in the URL. A 137-row export is
39KB of URL and the server rejected it with **431 Request Header Fields Too Large** — and the
spec allows 5000 rows. Preview had therefore never worked on a file large enough to be worth
previewing, for **any** entity, since it was written. It is now a mutation (POST body); it
still writes nothing.

### Production readiness

**The production build never worked.** `pnpm build && node dist/index.js` died on the first
cross-package import: every workspace package sets `"main": "./src/index.ts"`, and node will
not load a `.ts` file. Nothing had ever been run outside `tsx`, so nobody hit it. `apps/api`
and `packages/db` now bundle with esbuild (`build.mjs`), inlining workspace packages and
leaving node_modules external — bundling those too breaks `pino`, which resolves its worker
thread by path at runtime and fails on first log rather than at build time.

**Migrations replace push.** `packages/db/drizzle/0000_*.sql` is the baselined schema; the
existing dev database was baselined into the journal. `drizzle-kit push` is renamed
`push:dangerous` / `make push-dangerous` — it diffs a live database and applies the difference
with no review and no record, which is how a production column gets dropped silently. The dev
compose ran `push --force` on every boot; it now migrates. `packages/db` `clean` no longer
deletes `drizzle/` — those files are source now, not build output.

**`project_phase` gained `tenant_id`**, the one table that lacked it. RLS policies do not
follow joins, so its absence blocked row-level security for the whole schema.

**59 tests, from zero.** `packages/domain` covers the custody approval gate, the overdue rule
and the event fold — including the rebuild guarantee the architecture rests on, which had
never been executed once. One test pins the partial-`toState` bug that shipped twice: the fold
is last-snapshot-wins, so `{ status: "in_maintenance" }` alone means custodian, project and
location are now null. `packages/types` covers the @ parser; `packages/api-contracts` covers
the permission map that keeps chat from being a privilege escalation.

**Production containers.** `docker/Dockerfile.{api,web,engine}` — multi-stage, non-root,
healthchecked, `NODE_ENV=production`, Next.js standalone output. `docker-compose.prod.yml`
has restart policies, dependency gating, an unpublished database port, and required-variable
syntax so it refuses to start without real secrets. The engine is in both compose files now;
its absence from the dev one is why chat silently degraded to `pending_manual`.

**CI** (`.github/workflows/ci.yml`) — typecheck, tests, all three image builds, and a smoke
job that migrates a fresh Postgres and boots the API. The image build step exists precisely
because a build that is never executed proves nothing.

**Auth hardening.**
- bcrypt cost 10 → 12, with transparent rehash on next login (verified: owner moved to 12).
- Session tokens 24 → 32 bytes.
- `/auth/login` rate limited to 10 attempts per 15 min per IP+email, cleared on success.
  In-memory, so single-instance only — documented in `rate-limit.ts` rather than pretended
  away. Previously unlimited, which made bcrypt a CPU exhaustion vector as well as a
  credential-stuffing surface.
- `assertProductionSafe` refuses to boot with `NODE_ENV=production` if `SESSION_SECRET` is the
  shipped example value, has too little variety, or `WEB_ORIGIN` is plain http.
- The seed refuses to run with `NODE_ENV=production` — it creates five accounts with a
  published password, one of them an owner.

### Added: editing and deleting existing records

There were **no update procedures at all** — not for assets, employees, projects, locations or
vehicles. Every form was create-only, so a mistyped tag was permanent, and the only delete
anywhere was on tasks. Assigning a tool was reachable only from its detail page.

**Update** for all five, restricted to descriptive fields. Where a tool is and who has it are
projections of the transaction log, so they stay off the edit forms — moving something is
Assign / Transfer / Return, and editing around those would put the register and its own audit
trail into disagreement. Same reasoning excludes `employee.primaryProjectId` (that is
`assignToProject`, which moves their tools too) and container/vehicle custodian (that is
`setCustodian`, which moves the contents). Tag and unit uniqueness is re-checked on rename;
renaming a vehicle renames its location row, since they are the same thing under two names.

**Delete** with referential guards, because this is a system of record. Transactions cascade
from `asset`, so deleting a tool with history would delete its audit trail — refused, with
"mark it disposed instead". Likewise a person who appears in custody history (terminate), a
project anything is charged to (complete), a location holding tools, a vehicle with tools
aboard. Hard delete stays for what it is actually for: a row typed in wrong five minutes ago
that has never been used. The refusal message is shown on the row rather than swallowed.

**Row actions on every register** — `components/sti/row-actions.tsx`, so the five pages cannot
drift apart. Tools additionally carry Assign / Transfer / Return inline, so acting on a tool no
longer means opening it first; People carry "Move job"; Locations and vehicles carry "Hand over".

**The assign form gained a location field.** Assigning a tool to a foreman almost always means
it is going into their trailer or gang box, and there was previously no way to say so — it took
a second, separate Transfer afterwards.

### Added: a tappable @ button, and every message now reaches an end state

**The @ button.** `@` was discoverable only by being told about it, and on a phone keyboard
it sits behind the numeric layer — so the people the feature exists for were the least likely
to find it. Both clients now show a visible `@` control on the input that does exactly what
typing the character does (inserting a leading space first when needed, so it actually
triggers). Nothing changes for anyone already typing it.

**Every message reaches a terminal state.** The unresolved queue had no controls at all —
the screen said resolving them "is not built yet", so the only way to clear one was to redo
the work elsewhere and leave the message sitting there forever.

- `messaging.manualEntry` was a **fourth hand-rolled copy** of the custody logic and had
  drifted the way copies do: assign never closed the previous custody link, and repair/lost
  wrote `toState: { status }` alone. Since the fold is last-snapshot-wins, that partial
  snapshot means "custodian, project and location are now null" — rebuilding the projection
  from the log would have quietly emptied those tools. It now delegates to `applyChatAction`
  like every other path, which also gets it `report` and `intake` support it never had, and
  charges permission per action rather than per screen.
- `messaging.dismiss` + a `dismissed` processing status — close chatter, duplicates and
  mistakes without touching the register. A queue that cannot be emptied stops being read.
- Both paths notify the sender. A dismissal carries its reason, which is the useful part.
- `apps/web/components/resolve-message.tsx` — the desk picks the action and the entities and
  records it, or closes it as nothing. `apps/web/components/entity-field.tsx` is the web
  counterpart of the mobile picker, running the same `entity.search` as the `@` list, so the
  desk finds a tool by typing part of a tag rather than scrolling a `<select>` of everything.

### Fixed: a declined hand-off told nobody

Declining a transfer ended at the database row. The foreman who raised it never found out,
which from the field is indistinguishable from being ignored — and on web there was nowhere
it could have appeared anyway.

- `packages/api-contracts/src/notify.ts` — one place that tells the requester, the intended
  recipient and the current holder what was decided. Wired into `transfer.approve`/`decline`
  and `assignment.approve`/`decline`; `task.approve`/`decline` already did this.
- `/inbox` serves two audiences off one route — the desk reaches it as "Inbox", a foreman as
  "Alerts" (see `nav-config`). It only ever rendered the desk queue, so a foreman got the
  whole department's work list with approve buttons that could only 403, and none of their
  own alerts. Alerts now come first for everyone; desk sections are gated on
  `assignment.read` and no longer fetched for field roles.
- `applyChatAction` parked approval-needing hand-offs with
  `toCustodianId: action.custodianId ?? asset.currentCustodianId` — so a message whose
  destination the parser could not resolve produced a transfer reading "Dwayne → Dwayne".
  Approving it would do nothing and declining it meant nothing. A hand-off with no
  destination of any kind is now refused at the point of parking, with a message saying to
  name who is taking it.

### Added: assign / unassign a container to a foreman

`location.setCustodian` — hand a trailer, truck or gang box over, or take it back by passing
a null custodian. The custodian could only be set when the row was created, so a trailer
reassigned in the yard stayed recorded against whoever first had it.

Contents move with the container by default, because that is what physically happens: nobody
checks out forty tools one at a time, they hitch up a trailer. Unassigning sends the contents
back to available stock. Custody links go through `custody.ts`, so the one-active-link
invariant holds here too, and every tool gets a `custodian_change` event. `vehicle.foremanEmployeeId`
is kept in step with the authoritative `location.custodianEmployeeId`.

UI: a Hand over / Change control per row on Locations, for both containers and vehicles.
Warehouses and project sites do not get one — nobody carries a yard.

### Fixed: the approval button did nothing

Two separate reasons, both real:

1. `ApproveButton` on the Inbox was a hardcoded `disabled` placeholder whose `onClick` only
   invalidated the query. Its comment claimed the approve endpoints were REST-only; they were
   not — `assignment.approve` and `transfer.approve` are tRPC procedures and simply had never
   been connected. Now wired, with `assignment.decline` / `transfer.decline` added so the gate
   can say no as well as yes.
2. **A foreman's request had no action to approve.** `requestChatAction` recorded the request
   as a task title and description and discarded the action itself, so the desk got
   "Repair requested: UIC-1008" as prose with nothing any button could execute. Requests now
   carry `actionType` + `pendingAction`, plus `requestedByEmployeeId` and `department`.
   `task.approve` replays that payload through `applyChatAction` — the same executor every
   other path uses — so an approved request is indistinguishable from a direct one in the
   ledger. Permission is charged to the **approver**, so a foreman cannot approve their own
   request into existence. `task.decline` records the refusal and tells the requester.

Also fixed while in there: the Inbox filtered open tasks on `status !== "done"`, but the
status is `"completed"` — so completed tasks never left the list.

### Added: request worker

`apps/api/src/request-worker.ts`, sweeping every 60s alongside the existing pollers.

- **Requeues stranded messages.** A message that failed because the parser was unreachable
  stayed `error` forever — the foreman's hand-off was simply lost. Retried up to
  `MAX_PARSE_ATTEMPTS` (tracked on the new `message.attempts`, incremented on claim so a
  message that kills the worker still counts), then left for the desk. `pending_manual` is
  excluded on purpose: the parser answered there, it just could not match a tool, and that is
  a judgement retrying will not change.
- **Unsticks dead `processing` rows** whose worker died mid-parse.
- **Announces new requests** to the equipment desk, and **chases aging ones** after an hour
  then daily, raising priority after the second chase.

It does **not** approve anything. Applying a request after a timeout would let anyone obtain a
permission by waiting, which is the hole the gate exists to close (ADR-4).

### Added: @-mentions in chat (web + mobile)

The message stays a plain sentence — that is the whole design constraint. Foremen will not
remember a command syntax, so there isn't one. `@` plus two characters is the only addition,
and it does the obvious thing: opens a list.

- `packages/types/src/mentions.ts` — mention shape, the caret-fragment parser, and the
  kind→slot mapping (asset → `assetIds`, employee → `custodianId`, project → `projectId`,
  location/vehicle → `locationId`). Kinds decide roles, so there is no ordering convention.
- `entity.search` — one ranked query across assets, employees, projects, locations and
  vehicles. `@10` returns UIC-1001…, TRU-004 and job codes together; exact code sorts above
  prefix above substring. Asset rows carry who holds them, which is usually what identifies
  the right row.
- `message.mentions` jsonb + `messaging.send` — mentions are re-verified server side against
  the tenant before they are stored; an id that does not resolve is dropped, not rejected.
- `messaging-worker` — a picked entity beats a parsed one in every slot, and a picked tool
  satisfies the "no asset in this message" check that otherwise sends messages to
  `pending_manual`. Fuzzy custodian/project resolution is skipped entirely for slots that were
  filled by hand — that guesswork is the main source of wrong matches today.
- `apps/web/components/mention-input.tsx`, `apps/mobile/components/mention-input.tsx` — the
  picker on both clients, with the resolved entities shown as chips before sending. Deleting a
  name from the sentence drops its id.

Typing a sentence with no `@` behaves exactly as before.

### Added: tools follow the foreman

**Schema**
- `packages/db/src/schema/employee.ts` — new `employee_project_assignment` table: one row per
  job posting, `endedOn` null means current. `employee.primaryProjectId` only ever answers
  "now"; this is the backtrack.
- `packages/db/src/schema/location.ts` — `location.custodianEmployeeId`: who carries a
  container. Authoritative over the older vehicle-only `vehicle.foremanEmployeeId`.
- `packages/db/src/schema/project.ts` — `project.siteAddress`.

**API**
- `employee.assignToProject` — closes the open posting, opens the next, updates
  `primaryProjectId`, and moves every tool in that person's custody to the new project with a
  `project_change` transaction each. `owningProjectId` is never touched: who paid does not
  change when a tool changes job. Lost and disposed tools stay put.
- `employee.get`, `employee.postings` — the person detail surface.
- `employee.create` and the employee importer now open the initial posting.
- `location.list`/`create`, `vehicle.create` and the vehicle importer carry the container
  custodian. `project.list`/`create` carry `siteAddress`.
- Import specs gained `project.site_address` and `location.held_by`.

**Web**
- `/people/[id]` — what a person holds now, and every job they have held it on.
- `components/posting-form.tsx` — move-to-job dialog; moving their tools is the default.
- People rows link to the detail page; Locations shows "Held by"; Projects shows the site.

### Fixed: one active custody link per tool

`assignment.create`, `transfer.create`, `transfer.approve` and the chat executor each
handled the previous custody link differently — the transfer procedures never closed it at
all. A transferred tool stayed `active` under its old holder while the register showed the
new one, so custody screens, offboarding clearance and "what does this foreman carry"
disagreed with each other. All four now route through the new
`packages/api-contracts/src/custody.ts`, which closes every active link before opening the
next.

## v0.2.0 — 2026-07-13

### Added: Messaging System + AI Engine

**Schema & DB**
- `packages/db/src/schema/messaging.ts` — New `channel` and `message` tables with tenant isolation, processing status queue, jsonb intent storage, and audit trail.
- `packages/db/src/seed.ts` — Seeds "Equipment Department" channel for foreman messaging.

**Types & Env**
- `packages/types/src/index.ts` — Added `ChannelId`, `MessageId` branded IDs; `PROCESSING_STATUSES`, `MESSAGE_INTENTS`, `CHANNEL_KINDS` enums.
- `packages/env/src/server.ts` — Added `ENGINE_BASE_URL`, `ENGINE_TIMEOUT_MS`, `MOBILE_ORIGIN` env vars for engine connectivity and CORS.

**AI Engine (Python)**
- `engine/main.py` — FastAPI service with `POST /parse` endpoint. Calls local OMLX/Ollama (Gemma 3 4B IT) via OpenAI-compatible client. Returns structured intents with entity labels (no DB IDs). Retry-safe JSON extraction.
- `engine/prompts/system.md` — STInventory domain prompt encoding tool tags, foreman roles, projects, and 8 intent types.
- `engine/requirements.txt` — Python dependencies.
- `engine/README.md` — Run instructions and env reference.

**API Layer**
- `apps/api/src/engine-types.ts` — Shared TypeScript types matching engine JSON request/response.
- `apps/api/src/engine-client.ts` — HTTP client with configurable timeout, signal combiner, and fallback JSON parser.
- `apps/api/src/entity-resolve.ts` — Generalized entity resolution extracted from `ai.ts`. Functions: `matchEntity`, `resolveCustodian`, `resolveDestination`, `resolveProject`, `resolveLocation`, `resolveEngineAssets`.
- `apps/api/src/messaging-worker.ts` — Background poller (4s interval) that picks `queued` messages, builds foreman context, calls engine, resolves DB IDs, and sets status to `action_proposed` or `pending_manual`.
- `apps/api/src/index.ts` — Wired messaging worker poller alongside notification scheduler; added `MOBILE_ORIGIN` to CORS origin list.

**tRPC Routers**
- `packages/api-contracts/src/routers/messaging.ts` — 7 procedures: `listChannels`, `messages` (cursor-paginated), `send`, `confirmAction`, `manualEntry`, `pendingActions`, `feed`. All actions write to `transaction` table and update `asset.current_*` projections.
- `packages/api-contracts/src/routers/entity.ts` — `entity.suggest` procedure for typeahead search across assets, employees, projects, locations, and vehicles.
- `packages/api-contracts/src/audit.ts` — Added `"messaging"` audit category.

### Known Limitations
- Background poller uses plain Drizzle `select()` without `FOR UPDATE SKIP LOCKED` (Drizzle 0.36.4 limitation). Single-instance safe; multi-instance may double-process in edge cases.
- Engine auto-execute only handles the `report` intent. All other intents require foreman confirmation or admin manual entry.
- Engine has no streaming or caching. Each message triggers a fresh LLM call.

# STInventory — how this repo actually works

> A technical explainer built by reading the source, running the stack, and probing the
> live API. Written 2026-08-15 against commit `72cbcdc` (`main`).
>
> **Every claim below is either cited to `file:line` or marked as something I verified
> by running it.** Where the repo's own docs disagree with the code, the code wins and
> the disagreement is called out rather than smoothed over.

---

## 1. What it is, in one sentence

**STInventory tracks who is physically holding each of Urban Infraconstruction's ~750 small
tools, by treating every hand-off as an immutable ledger entry and deriving "where is it now"
from that ledger rather than storing it as editable state.**

It is modelled on United Rentals' operating shape (catalog → warehouse → dispatch → charge to
project) but for an **internal owner/custodian** model: nobody rents anything, the Equipment
Department owns everything forever, and foremen are custodians who are accountable for kit
they hold (`README.md:3-6`, `AGENTS.md:11-14`).

## 2. Why it exists

Urban tracked tools through "a spreadsheet nobody updates, paper tags that get lost, and
WhatsApp threads buried under other messages" (`AGENTS.md:37-38`). The concrete failures that
drove the build (`AGENTS.md:39-45`):

| Failure today | What the system does about it |
|---|---|
| Nobody knows where a given tool is | Every movement is a ledger row; current location is derived |
| Foremen on multiple projects can't say what's on which site | Custody is per-person, project is a separate axis |
| Terminated employees walk off holding assets | HR clearance queue, driven off `employment_status` |
| Temporary loans go overdue silently | `expected_end_date` + a scheduler that raises overdue alerts |
| Procurement is reactive — "buy another one" | Idle-tools report, checked before approving a purchase |

## 3. How I verified all of this

Rather than trust the docs, I stood the system up and interrogated it.

| Check | Result |
|---|---|
| `make ENV=local up` | ✅ Postgres 16 + API + Web all healthy |
| Migrations | ✅ 10 applied automatically on API boot |
| `make seed` | ✅ 754 assets, 41 employees, 29 trailers, 16 projects, 754 transactions |
| API `/health` | ✅ `{"ok":true}` |
| Web UI, logged in as Owner | ✅ Dashboard, register, custody, reports, settings all render on real data |
| Browser console | ✅ Clean apart from a missing `favicon.ico` |
| Test suite | ⚠️ Fails under Docker, **passes on a correct install: 139/139** — see §12.1 |
| Privilege enforcement | ❌ Bypassable — see §12.2, proven live |
| Event-sourcing rebuild | ✅ Works on seeded data since STI-101/STI-108 — see §12.3 |

The stack runs. The defects below are real, reproduced findings, not code review speculation.

---

## 4. The shape of the system

```mermaid
flowchart TB
    subgraph clients["Clients"]
        WEB["apps/web<br/>Next.js 15 · 136 files"]
        MOB["apps/mobile<br/>Expo Router"]
    end

    subgraph api["apps/api — one Node process, port 4100"]
        HONO["Hono HTTP server"]
        TRPC["tRPC router<br/>24 routers"]
        REST["/api/* REST surface<br/>⚠️ dead code, no perm checks"]
        W1["notification scheduler · 60s"]
        W2["messaging worker · 4s"]
        W3["request sweeper · 60s"]
    end

    subgraph pkgs["packages/ — shared logic"]
        CONTRACTS["api-contracts<br/>routers + custody chokepoint"]
        DOMAIN["domain<br/>pure fold + custody rules"]
        INTENT["intent<br/>catalog · prompt · parser"]
        AUTH["auth · sessions + RBAC"]
        DB["db · Drizzle schema + seed"]
    end

    PG[("Postgres 16<br/>35 tables")]
    LLM["Any OpenAI-compatible<br/>/chat/completions"]

    WEB -- "tRPC over HTTP<br/>Bearer token" --> HONO
    MOB --> HONO
    HONO --> TRPC --> CONTRACTS
    HONO --> REST
    CONTRACTS --> DOMAIN
    CONTRACTS --> DB --> PG
    W2 --> INTENT --> LLM
    W1 --> PG
    W3 --> PG
    TRPC --> AUTH
```

**One process does everything.** The API server is also the notification scheduler, the chat
worker and the retry sweeper — three `setInterval` loops in the same Node process
(`apps/api/src/index.ts:262-307`). There is no queue and no lock, which is fine for one
instance and breaks silently on two (§12.6).

### Monorepo map

| Package | Lines | What it owns |
|---|---|---|
| `apps/web` | 20,398 | Next.js 15 dashboard — the desk app |
| `packages/api-contracts` | 8,928 | All 24 tRPC routers **and** the custody chokepoint |
| `packages/db` | 4,054 | Drizzle schema (35 tables), 10 migrations, seed |
| `apps/mobile` | 2,340 | Expo Router field app |
| `apps/api` | 2,096 | Hono server, auth routes, the three workers |
| `packages/intent` | 1,108 | Intent catalog, generated LLM prompt, parser |
| `packages/types` | 991 | Enums, permissions, branded IDs |
| `packages/domain` | 605 | **The pure core** — event fold + custody rules |
| `packages/auth` | 267 | Sessions, RBAC resolution, secret encryption |
| `packages/env` | 125 | Zod-validated env, production safety guard |
| `frontend-shared`, `design-system` | 252 | ⚠️ **Dead — imported by nothing** |

*Totals: 256 TS/TSX files, 41,208 lines, plus 4,465 lines of docs across 22 markdown files.*

---

## 5. The core idea: state is derived, not stored

This is the one concept that explains most of the codebase. Get it and the rest follows.

**A conventional inventory app** stores `asset.current_holder` and updates it. When it's wrong,
you can't tell when or why it went wrong.

**STInventory** appends a row to `transaction` for every movement, and treats
`asset.current_custodian_id` as a *cache* of that log — a projection that can be thrown away
and recomputed (`AGENTS.md:23-26`, `packages/db/src/schema/asset.ts:11,61`).

The UI states this outright. The tool detail page labels the status block
**"Where it stands now — derived from the log below, not entered"** and the history block
**"Custody chain — append-only · this log is the audit trail"** *(verified live on `/tools/<id>`)*.

```mermaid
flowchart LR
    E1["tag<br/>TOOL-0001 created"] --> E2["assign<br/>→ Alejandro"]
    E2 --> E3["transfer<br/>→ Jobani"]
    E3 --> E4["return<br/>→ warehouse"]
    E4 --> FOLD{{"foldAssetState()"}}
    FOLD --> PROJ["asset.current_*<br/>(the projection)"]

    style FOLD fill:#2d3748,color:#fff
    style PROJ stroke-dasharray: 5 5
```

### The fold is simpler than "event sourcing" implies

`packages/domain/src/fold.ts:5-12` is the whole thing:

```ts
const sorted = [...events].sort(compareOccurred);
for (let i = sorted.length - 1; i >= 0; i--) {
  const e = sorted[i]!;
  if (e.toState) return { ...e.toState };   // last snapshot wins
}
return { ...INITIAL_STATE };
```

It is **not** a field-wise reducer. Each event carries a *complete* post-state snapshot in
`transaction.to_state` (jsonb), and the fold simply walks backwards and returns the newest one.
It is a max-by-timestamp, not an accumulation.

**The consequence is load-bearing:** every writer must emit a *complete* `toState`. A writer
that emits `{status: "in_maintenance"}` alone is not saying "status changed" — it is saying
"custodian, project and location are now undefined". That exact bug shipped once and is now
pinned by a regression test (`packages/domain/src/fold.test.ts:114-135`), and the codebase
carries scar-tissue comments at every write site that violated it
(`assignment.ts:129-133`, `transfer.ts:163-166`, `asset.ts:422-427`).

Ties are broken by row `id` (`fold.ts:29-35`) — load-bearing because bulk writers insert many
events with an identical `occurred_at` (`location.ts:120`, `project-assign.ts:291`).

---

## 6. The custody gate

When someone hands a tool over, the system asks **one** question
(`packages/domain/src/rules.ts:28-38`):

```mermaid
flowchart TD
    START["Someone hands a tool over"] --> Q{"Asset cost &ge;<br/>high-value threshold?"}
    Q -- Yes --> APPROVE["<b>approve</b><br/>Write NOTHING.<br/>Register does not move until<br/>a second person signs."]
    Q -- No --> AUTO["<b>auto</b><br/>Apply as a permanent<br/>custody change."]

    style APPROVE fill:#7f1d1d,color:#fff
    style AUTO fill:#14532d,color:#fff
```

That is the whole function. `custodyOutcome` takes an asset cost and a threshold and
returns one of two outcomes.

**It used to ask two questions.** There was a third outcome, `verify`, and a second input —
"does the actor hold the approve permission". Together they modelled a foreman handing a
tool to another foreman: the tool moved immediately, ownership did not, and the desk
confirmed it afterwards. It was a genuinely clever design for a problem Urban does not
have. **Tools are moved by the equipment desk, and a foreman does not reassign one.** With
foreman-initiated movement gone, no actor could reach the function without already holding
the approve permission, so the question had one answer and was deleted on 2026-08-09. The
rationale comment at `rules.ts:13-20` is worth reading in full.

> ⚠️ **This section described the old three-outcome gate until 2026-08-18** (STI-111),
> including a `pending_verification` lifecycle and a claim that `transfer.approve` refuses
> such rows. None of that code exists. If you are holding a copy of this file older than
> that date, distrust this chapter specifically.

### What survives from the old design

The `pending_verification` transfer status still exists in `packages/types` and in both
badge maps, marked **historical only** — no writer can produce it, and it is kept solely so
that a pre-removal row still renders. The live database holds zero of them.

### The edges, all pinned by test

- **`>=`, not `>`** — a tool priced *exactly* at the threshold needs the second signature.
  That is the one most likely to be argued about, so it is pinned
  (`rules.test.ts:23-27`).
- **A null threshold disables the gate entirely** rather than parking every move. A tenant
  that has not said what "high value" means has not asked for a gate
  (`rules.test.ts:33-37`).
- **A null cost counts as 0**, not as "needs approval" — imported rows routinely have no
  price (`rules.test.ts:43-44`).


### The one-custodian invariant

"At most one active assignment per asset" is enforced in two places. The mechanism is a single
file, `packages/api-contracts/src/custody.ts`; since STI-103 the backstop is a partial unique
index, `assignment_one_active_uq` on `assignment (asset_id) WHERE status = 'active'`.

The index makes a bypass throw rather than silently produce two custodians, but it cannot *close*
the row that was already active — that logic exists only in `custody.ts`, which is why the file is
still the chokepoint every writer must go through.

The header comment at the top of `custody.ts` records why it exists: three separate writers each
opened custody without closing the previous row, so the register showed the new holder while
the custody screen showed the old one — and every downstream reader (offboarding, value-per-
foreman, tools-follow-the-foreman) named someone who'd given the tool away weeks earlier.

`closeActiveCustody` updates **by predicate, not by id** (`custody.ts:39-41`), deliberately,
because rows written before the `assignment_one_active_uq` index (STI-103) may still carry
duplicates, and closing only the first would strand the rest forever. The local database was
verified duplicate-free on 2026-08-18; production has not been checked.

> ✅ **The chokepoint hole is closed.** This section previously warned that
> `assignment.approve` never called `closeActiveCustody`, so a high-value assignment routed
> through approval left two active custody rows. **STI-102 fixed that** — `approve` now closes
> the prior link inside the same transaction — and **STI-114 removed the last exception**, so
> `assignment.return` routes through the helper too. As of 2026-08-18 every custody writer goes
> through `custody.ts`, and the partial unique index makes a bypass fail loudly rather than
> silently produce two custodians.

---

## 7. Who can do what

Ten roles, 30 permissions, mapped in exactly one place — **the seed**
(`packages/db/src/seed.ts:51-116`). The mapping lives as `role_permission` rows, not as code,
so it can drift from source after seeding.

| Role | Notably |
|---|---|
| `owner`, `equipment_admin` | full access |
| `warehouse` | can manage assets/locations/vehicles, **cannot approve custody** |
| `superintendent` | can approve custody |
| `foreman` | **read-only** — cannot create or approve any custody movement |
| `project_manager` | + `project.manage`, which silently grants global project visibility |
| `hr`, `finance`, `procurement` | narrow |
| `read_only` | reads |

Counts are deliberately omitted; query `role_permission` for the authoritative set.

**The foreman row is the one that surprises people.** A foreman holds only `*.read`
permissions — not `assignment.create`, not `transfer.create`, and not `assignment.approve`.
This is not an oversight and not an unfinished feature: **the equipment desk is the only
writer of custody movements.** Until 2026-08-09 a foreman could initiate a hand-off, which
is what the deleted `verify`/borrow path in §6 existed to model.

> ⚠️ **Corrected 2026-08-18** (STI-111). This table previously stated that a foreman
> "can *create* assignments/transfers … → always `verify`", which was the exact inverse of
> the live permission set, and gave per-role counts that had all drifted.

**Auth is bearer-token, not cookies.** There are no cookies anywhere in the system. Login
returns a 64-hex-char random session id as plain JSON (`packages/auth/src/index.ts:67`); the web
app stores it in `localStorage["sti-session"]` (`apps/web/lib/auth.ts:21`) and sends it as
`Authorization: Bearer`. Sessions live 7 days, are looked up in the DB on every request, and
die immediately if the user is deactivated (`auth/src/index.ts:90-117`). `SESSION_SECRET` does
*not* sign sessions — it only derives the AES key for encrypting tenant LLM keys.

---

## 8. The conversational layer

A foreman types a sentence; it becomes a *proposed* custody transaction a human confirms.

```mermaid
sequenceDiagram
    participant F as Foreman
    participant API as messaging.send
    participant DB as message table
    participant W as worker (4s)
    participant LLM as OpenAI-compatible
    participant D as Desk

    F->>API: "Give TOOL-0001 to Jobani for Little Elm"
    API->>DB: insert status=queued
    Note over API: nothing parsed synchronously

    W->>DB: claim ≤5 queued → processing
    W->>LLM: system prompt + context
    alt no model configured
        LLM-->>W: (never called)
        W->>DB: pending_manual ✅ verified live
    else confidence < 0.6 or no asset resolved
        W->>DB: pending_manual
    else parsed
        W->>DB: action_proposed + proposedAction
        D->>API: confirmAction
        API->>DB: applyChatAction → ledger write
    end
```

**Verified live:** with no model configured, I posted
`"Give TOOL-0001 to Jobani Abarca for the Little Elm job"`. Four seconds later the row was
`processing_status=pending_manual`, `intent_type=none`, `attempts=1`, and the log read
`[engine] no model configured for this tenant — message goes to the manual queue`. The message
is preserved, not lost — exactly as designed.

**Confidence is an input to the workflow, never authority over it** (ADR-4). Only two intents
are auto-safe — `report` and `task` — and even those are executed through `applyChatAction` with
an **empty permission set** (`messaging-worker.ts:428`), so any future auto-safe intent that
tries to move custody is refused rather than applied unattended. That is deliberate
belt-and-braces.

**Two kinds of intent**, discriminated by one field, `IntentSpec.apply` (`catalog.ts:40`):

| | `apply: null` | `apply: {permission: P}` |
|---|---|---|
| Examples | `request_purchase`, `task`, `none` | `assign`, `transfer`, `return`, `repair`, `lost`, `intake`, `report` |
| Effect | no apply path — always files a task for the desk | applied if the actor holds `P` |

Note `{permission: null}` (report — any member may apply) is a *third* case, distinct from
`apply: null`, and the tests pin the difference (`catalog.test.ts:53-59`).

Any OpenAI-compatible `/chat/completions` endpoint works — there is no vendor SDK, just `fetch`
(`packages/intent/src/parse.ts:214-317`), with a retry ladder that strips `response_format`,
`temperature` or renames `max_tokens` when a provider 400s on them.

---

## 9. The data model

35 tables. The load-bearing distinction is **two independent axes** that most inventory systems
conflate:

```mermaid
erDiagram
    ASSET ||--o{ TRANSACTION : "append-only ledger"
    ASSET ||--o{ ASSIGNMENT : "active custody link"
    ASSET ||--o{ TRANSFER : "movement request"
    ASSIGNMENT }o--|| EMPLOYEE : custodian
    EMPLOYEE }o--|| PROJECT : "primary project"
    ASSET }o--|| PROJECT : "owning AND current"
    ASSET }o--|| DEPARTMENT : "owning dept"
    ASSET }o--|| LOCATION : "where it sits"
    LOCATION ||--o| VEHICLE : "truck or trailer"
```

The single `ASSET → PROJECT` line above is really **two columns doing two different jobs** — and
conflating them is the mistake this schema exists to prevent:

- **Financial ownership** — `owning_project_id` / `owning_department_id`: who paid. Never transfers.
- **Operational custody** — `current_custodian_id` / `current_project_id`: who holds it now.

**Tools follow the foreman, not the site.** When a foreman changes job, `current_project_id` on
everything they hold moves with them; `owning_project_id` never does
(`project-assign.ts:260-320`). The default project for any custody move is the *recipient's*
primary project (`projectForCustodian` in `custody.ts`) — a form that let you type a project independently of the
person is how a tool ends up booked to a job its holder never worked.

**Multi-tenancy is application-enforced.** Every row carries `tenant_id`; there is **no RLS, no
policies, no session tenant context**. Isolation is the discipline of every individual `WHERE`
clause (33 of 35 tables carry the column; `permission` and `role_permission` are global).

---

## 10. The clients

### The web app is a thin, honest tRPC consumer

One `httpBatchLink` at `${NEXT_PUBLIC_API_URL}/trpc` with a `superjson` transformer
(`apps/web/lib/trpc.ts:16-18`). The bearer token is attached per-request from
`localStorage["sti-session"]`, window-guarded so SSR sends no header (`trpc.ts:19-22`). One
`QueryClient`, `staleTime: 10s` (`lib/providers.tsx:15-23`).

**There is no 401 interceptor.** Auth failure is handled in the shell instead: if
`identity.me` errors, `AppShell` clears the session and redirects to `/`
(`components/sti/app-shell.tsx:96-101`). Login lives at `/`, not `/login`.

**Two disjoint navigations, chosen by role** (`components/sti/nav-config.ts`):

| | Roles | Items |
|---|---|---|
| `FIELD_NAV` | `foreman`, `superintendent` | My Tools · Hand Off · Alerts |
| `DESK_NAV` | everyone else | Overview · Equipment · Insight · Entity (11 items) |

Each nav item carries an optional permission, filtered against `me.permissions`
(`components/app-sidebar.tsx:55`) — so the sidebar reflects what you can actually do.

**The job-scope selector** in the sidebar has three levels — Show All / a job group / a single
project — persisted to localStorage and exposed as a `Set<string> | null`
(`components/job-scope.tsx:93-122`). Per that file's own comment, pages filter **client-side**
on this set; the server scopes independently. It is a convenience lens, not a security boundary
— which matters given §12.4.

**The shared `DataTable` is dual-mode** (`components/sti/data-table/data-table.tsx`): client-side
sorting/filtering/pagination by default, or `manualPagination`/`manualSorting`/`manualFiltering`
driven by the parent's `{page, pageSize, sortKey, sortDir, search}` when the `server` flag is set
(`:276-280`). Row selection and CSV export operate over *all filtered rows*, not just the visible
page (`:184-202`) — the right behaviour for "select everything this foreman holds".

**12 named themes** (`apps/web/lib/themes/themes.ts:34-46`), applied as inline CSS custom
properties on `<html>` rather than class swaps, with a boot script replaying the cached choice to
avoid a flash (`apply-theme.ts:32-48`, `app/layout.tsx:30`). *Verified live in Settings →
Appearance.*

> ⚠️ `packages/design-system` — the "shared tokens + tailwind preset" package the README
> advertises — has **zero consumers**. The live theming system is entirely
> `apps/web/lib/themes` + `globals.css`.

### The mobile app is more than the README's "shell"

Genuinely wired: a tRPC client that derives the LAN host for physical devices
(`apps/mobile/lib/trpc.ts:16-28`); **My Tools** fully bound to `asset.list` scoped by custodian
plus an overdue banner, pull-to-refresh and proper loading/error/empty states
(`(tabs)/index.tsx:17-102`); and a single action screen covering all six action types through one
`action.submit` mutation (`app/action/[type].tsx`).

Notably, its client-side permission map only chooses **button wording** — the server decides and
downgrades to a request on mismatch. That is the correct division.

Genuinely absent: **no camera or photo capture anywhere**, and **no offline queue or optimistic
mutation** — every action needs connectivity, which is a real constraint for a yard app. The
"Desk" tab also pulls the unscoped full register and filters it in memory (`(tabs)/desk.tsx:28-45`).

---

## 11. What is actually built

The README is materially out of date. Here is the real state, verified in the running app.

| Area | README says | Actually |
|---|---|---|
| Routes | "routes under `/d02`" | ❌ No `/d02` anywhere. Real routes are `/home`, `/tools`, `/custody`, `/jobsites`, `/map`, `/reports`, `/inbox`, `/people`, `/projects`, `/activity`, `/chat`, `/settings` |
| Reports | "**API only** — six procedures, no web pages yet" | ❌ **13 report pages are built**, incl. 3 chart pages and a paged audit trail |
| `make dev` / `make mobile` | "**Broken** — invokes flutter against apps/desktop" | ❌ Both work. `dev` = `up` + banner; `mobile` runs Expo |
| Demo logins | lists `foreman.miguel@stinventory.local` | ❌ Seed creates only 3 users: owner, admin, warehouse |
| Non-Docker setup | `pnpm --filter @stinventory/db push --force` | ❌ Script is named `push:dangerous`; that command fails |
| Asset register, custody, vehicles, dashboard, notifications, chat | built | ✅ Confirmed working |
| Procurement, Maintenance/Inspections | not built | ✅ Correct — no tables, no code |
| Mobile | "Expo shell, login + index only" | ⚠️ More than a shell — tabs, tool detail, action screens exist; no QR scan, no offline queue |

`docs/03-data-model.md` claims 26 tables (there are 35), documents a `project_phase` table that
was dropped six migrations ago (`0003_nasty_thunderbolt.sql:1`), and lists `vendor` under
"planned, not built" when it is built and migrated (`schema/rental.ts:24-45`).

---

## 12. Verified defects

Ordered by severity. Every one of these I either reproduced live or traced to a specific line.

### 12.1 — `make test` and `make typecheck` are broken by a compose misconfiguration ✅ FIXED

`docker-compose.yml` bind-mounts `./packages` over the image, then restores each package's
`node_modules` with an anonymous volume — but the list **omitted `packages/domain` and
`packages/intent`** (and two dead packages). Those two are exactly the ones whose tests failed.

**Reproduced:** `pnpm test` in the container → `TSConfckParseError: failed to resolve
"extends":"@stinventory/config-tsconfig/library.json"`, domain reporting `Test Files 3 failed,
Tests: no tests`. **After restoring the links: all 6 packages pass, 139/139 tests green.**

The domain package's tests are the executable form of the event-sourcing guarantee — so the
practical effect was that *the tests protecting the core architectural claim silently did not run.*

**I fixed this** by adding the two missing volumes to both services in `docker-compose.yml`.

### 12.2 — 🔴 The `/api/*` REST surface has no permission checks at all

`apps/api/src/rest-routes.ts:14-21` authenticates and then stops. 28 routes are mounted with
**zero** authorization. Proven live:

```
warehouse user permissions: ['employee.read']       # no employee.manage

tRPC  employee.create  → 403  "missing permission: employee.manage"   ✅ enforced
REST  POST /api/employees → 200  employee created                     ❌ bypassed
```

It also accepts **mass assignment** — `{...body}` is spread straight into the insert
(`rest-routes.ts:203,236,264,287,352`). I created a row with a client-chosen primary key,
an injected `externalId`, and `employmentStatus: "terminated"`:

```json
{"id":"deadbeef-0000-4000-8000-000000000001","externalId":"INJECTED-999",
 "employmentStatus":"terminated","name":"MASSASSIGN Test"}
```

Worse, these writes **bypass the ledger and the custody chokepoint**:
`POST /api/assignment/:id/approve` flips a status without touching `asset.current_*` or writing
a `transaction`; `POST /api/assignments` inserts an active row without `closeActiveCustody`;
`POST /api/transfers` writes `status:"pending"`, which is **not a member of
`TRANSFER_STATUSES`**, so those rows surface in no queue at all.

**Mitigating:** its only caller is `packages/frontend-shared`, which **nothing imports** — and
in production `docker/Caddyfile` doesn't route `/api/*` anyway. So this is dead code carrying a
live auth middleware. **It should be deleted**, not fixed.

### 12.3 — ✅ ~~The rebuild guarantee is a no-op on seeded data~~ (closed by STI-101/STI-108)

The headline architectural claim (`README.md:223`) is that state can be rebuilt from the log.
It used to fail on every seeded database, proven live at the time:

```
SELECT count(*), count(to_state) FROM transaction;   →  754 |  0
POST /trpc/asset.rebuild                             →  {"assetsRebuilt":0,"totalEvents":754}
```

`seed.ts` wrote `toState: null` for every transaction while setting `current_*` directly on
the asset rows — and the seed's own comments claimed this was done "so the rebuild guarantee
holds". It did the opposite: the projection survived only because rebuild skips every event.
Runtime writers always emitted complete snapshots, so only seeded databases were affected —
but that is every demo and dev instance.

*Closed in two steps: migration 0013 (STI-101) appended a `projection_baseline` snapshot per
asset to repair existing ledgers once, and STI-108 made the seed itself emit a complete
four-key `toState` on every event, derived from the same spec that sets `current_*` — so a
fresh `make ENV=local reset` now folds to its own projection and `asset.verifyProjection`
reports zero divergences.*

Two structural aggravators:
- **`asset.rebuild` doesn't use the tested fold.** ~~It reimplements it inline
  (`asset.ts:450-459`). `foldAssetState` is imported by **nothing outside its own test file** —
  the tested implementation and the production implementation are different code that currently
  happen to agree.~~ *Closed by STI-106: rebuild and the new `asset.verifyProjection`
  reconciliation check both call `foldAssetState` from `packages/domain`; the inline copy is
  deleted.*
- **`assignment.return` desyncs ledger and projection** — ~~it keeps
  `currentProjectId`/`currentLocationId` on the asset row, while the transaction it writes nulls
  them. A rebuild would silently blank both.~~ *Verified live by QA on 2026-08-16 and closed by
  STI-113: a return now nulls the project on both sides (no custodian, no job — tools follow the
  person) and keeps the last recorded location on both sides, with one `next` object feeding the
  projection update and the `toState` so they cannot drift apart. `custody.test.ts` pins
  fold-equals-projection after a return through the real procedure.*

### 12.4 — 🟠 Project scoping is applied in 2 of ~24 read paths

`visibleProjectScope` (`scope.ts:27-72`) is the row-level visibility gate. It is called by
`project.list` and `projectTeam.all` — **and nowhere else**. `asset.list`, `transaction.list`,
`employee.list`, `assignment.list`, `transfer.list`, all nine `report.*` procedures and every
`dashboard.*` procedure return tenant-wide data to any session. A foreman holding only
`asset.read` can enumerate the entire fleet, every employee, and the full audit trail.

Separately, `project.manage` silently grants global project visibility (`scope.ts:28-30`), and
the seed grants it to `warehouse` and `project_manager` — contradicting that module's own
docstring.

### 12.5 — 🟠 CORS reflects any origin with credentials

`origin: (origin) => origin ?? env.WEB_ORIGIN` (`index.ts:37`) echoes back whatever `Origin` the
caller sends. `WEB_ORIGIN` is only the fallback for origin-less requests, so the production
safety check that validates it protects nothing. Impact is bounded — auth is a bearer token from
`localStorage`, not a cookie, so a third-party page has no token to send — but it is a
wildcard-with-credentials configuration.

Related: rate limiting (10 login attempts / 15 min) keys off a client-supplied
`X-Forwarded-For` (`rate-limit.ts:73-77`), so rotating that header gives a fresh bucket per
request. It is the only rate limit in the system, and it guards the only bcrypt endpoint.

### 12.6 — 🟡 The workers are single-instance by construction

The message worker claims a batch with a `SELECT` then a separate `UPDATE`
(`messaging-worker.ts:35-56`) — no `FOR UPDATE SKIP LOCKED`, so two API instances would both
claim the same rows. All three `setInterval` callbacks are `async` with no in-flight flag, so a
scan slower than its interval overlaps itself. `deliverPendingNotifications` selects every
undelivered row tenant-wide with no pagination.

### 12.7 — 🟡 The notification "providers" don't exist

`notifications.ts:195-212` is the entire delivery layer:

```ts
if (env.SMTP_HOST) console.log(`[notify:email] ...`);
else               console.log(`[notify:in_app] ...`);
await db.update(notification).set({ deliveredAt: new Date() })
```

There is no `nodemailer` and no `twilio` in any package's dependencies. `SMTP_PORT/USER/PASS/FROM`
and all three `TWILIO_*` vars are declared in the env schema and **read by nothing** — only
`SMTP_HOST` is read, and only to pick which `console.log` prefix to print. Every notification is
marked delivered regardless. The genuinely working channel is in-app, which the UI does read.

### 12.8 — Smaller things worth knowing

- `assignment.status = 'overdue'` is defined and **never written** — overdue is always derived.
- The domain rule treats "due today" as *not* overdue (strict `<`, `rules.ts:62`) but the
  notification worker uses `lte` (`notifications.ts:66`), so the email fires a day before the UI agrees.
- `asset.tag` uniqueness is checked on update but **not** on create or import.
- Email lookup at login is case-sensitive (`auth/src/index.ts:45`) while the rate-limit key
  lowercases — `Alice@x.com` won't match a stored `alice@x.com`.
- `notification.markRead` has no ownership check; any user can mark another's alerts read.
- `asset.setStatus` takes `z.string()`, not the enum — arbitrary strings reach the ledger.
- Branded ID types are declared (`types/src/index.ts:1-26`) and **used nowhere**.
- `tsconfig.base.json` at the root is orphaned — nothing extends it, yet it ships in both images.
- CI runs lint with `continue-on-error: true` for a failure that no longer occurs; lint now passes.

---

## 13. Running it yourself

```bash
cd /home/subedim/inventory
cp .env.example .env.local     # REQUIRED — the Makefile hard-errors without it
make ENV=local up              # builds + starts postgres, api, web
make ENV=local seed            # 754 tools, 41 people, 16 projects
```

| Service | URL |
|---|---|
| Web | http://localhost:3100 |
| API | http://localhost:4100 (health: `/health`) |
| Postgres | `postgres://postgres:stinventory@localhost:5433/stinventory` |

**Logins** — password `stinventory-demo`:

| Email | Role |
|---|---|
| `owner@stinventory.local` | Owner — full access |
| `admin@stinventory.local` | Karen Osei — Equipment Admin |
| `warehouse@stinventory.local` | Yard Desk — Warehouse |

Chat needs a model: **Settings → Chat parser** (any OpenAI-compatible endpoint), then
**Test connection** — which runs a real sentence through the real prompt and reports failure if
the model answers `none`.

**Gotchas**
- `.env.local` is gitignored and nothing creates it; the Makefile's error says "copy `.env.local`",
  which is circular — it means `.env.example`.
- The `web` service has no `build:` section; it reuses the image `api` builds. `docker compose up web`
  alone fails on a cold checkout.
- Container-run make targets leave root-owned `node_modules/` and `.turbo/` in your working tree.
- After changing dependencies, refresh the anonymous volumes: `make ENV=local reset`.

---

## 14. Where to look next

| If you want to understand… | Read |
|---|---|
| The whole model in 10 rules | `AGENTS.md` §2 — the best orientation in the repo |
| Why custody works the way it does | `packages/domain/src/rules.ts:4-28` (the comment, not the code) |
| The one-custodian invariant | `packages/api-contracts/src/custody.ts` — the header comment |
| What the event log guarantees | `packages/domain/src/fold.test.ts` — 10 tests, incl. a pinned shipped bug |
| How to add a chat intent | `docs/08-custom-intents.md` + `packages/intent/src/catalog.ts` |
| What shipped, per body of work | `docs/changelogs/` |

**A note on this codebase's comments.** Unusually, the rationale comments name the specific bug
each rule prevents, often with the real asset tag involved (UIC-1001, UIC-090). `rules.ts:4-28`,
the `custody.ts` header and `fold.test.ts:114-135` are the best examples. When changing custody logic,
read the comment before the code — it tells you what breaks if you get it wrong.

**Where the docs are least trustworthy:** `README.md` (routes, reports, make targets),
`docs/03-data-model.md` (table count, dropped tables, missing columns), and
`docs/07-conversational-layer.md` §7 (three of its four "known gaps" are fixed). `AGENTS.md` and
the in-code comments held up best against the source.

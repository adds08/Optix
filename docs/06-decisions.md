# STInventory — Architecture Decisions

Numbered decision records. Each is decision → rationale → consequence. Append, don't edit;
supersede an old record with a new one and mark it.

Records 1-6 were made during the build and are documented retroactively (2026-07-25) as part
of reconciling `docs/` with the running system.

---

## ADR-1 — Event-sourced core

**Status:** Accepted · **Date:** 2026-07 (retroactive)

**Decision.** The append-only `transaction` table is the system of record for asset state.
Every other operational value — `asset.current_status`, `current_custodian_id`,
`current_project_id`, `current_location_id`, and the `assignment` row — is a projection that
can be dropped and rebuilt from the log.

**Rationale.** The product's core promise is answering "who had this, when, and who says so"
in a dispute. If current state is a hand-edited field, that promise is only as good as the
last person to edit the cell — which is exactly the spreadsheet failure being replaced. With
a log, the audit trail is not a feature to build; it is the storage format.

**Consequences.**
- The audit trail and the rebuild guarantee are free.
- Every write path must append a transaction. A write that updates `asset.current_*` without
  appending is a corruption bug, not a style issue.
- `foldAssetState` (`packages/domain/src/fold.ts`) is last-snapshot-wins, not a field-wise
  reducer, so **every writer must emit a complete `to_state`**. See `03-data-model.md` §A8.
- `assignment_history` was dropped as redundant — `transaction` with
  `ref_type = 'assignment'` answers the same question.

---

## ADR-2 — tRPC is the single API surface

**Status:** Accepted · **Date:** 2026-07-25

**Decision.** tRPC (`packages/api-contracts/`) is the only API surface. The hand-rolled REST
layer in `apps/api/src/rest-routes.ts` is transitional debt to be deleted; the mobile app
migrates from `packages/frontend-shared/src/api-client.ts` to a tRPC client.

**Rationale.** The two surfaces currently implement the same queries twice — dashboard KPIs,
assets, assignments, vehicles, employees, transactions, tasks and messaging all exist in both
`rest-routes.ts` and the routers. Duplicated query logic drifts, and the REST copy re-derives
permission and audit behaviour that the routers already have via `requirePermission` and
`logEvent`. End-to-end type inference between API and clients is worth more than the
convenience of hand-written REST.

**Consequences.**
- ~352 lines in `apps/api/src/rest-routes.ts` to delete once mobile is migrated.
- `packages/frontend-shared/src/api-client.ts` is replaced rather than extended.
- Any future third-party or webhook integration that genuinely needs REST gets a **thin**
  adapter that calls the same procedures — it does not re-implement queries.
- Until the migration lands, treat the routers as authoritative: fix bugs there first, then
  mirror only if the REST path is still live.

---

## ADR-3 — Mobile is Expo Router, superseding Flutter

**Status:** Accepted · **Date:** 2026-07-25 · **Supersedes:** the Flutter mobile line in
`05-build-proposal.md` §1.7 and §4

**Decision.** The mobile client is Expo (React Native) with Expo Router. Flutter is dropped.

**Rationale.** Sharing TypeScript types, the tRPC client, and validation logic with the web
app removes an entire parallel implementation of the domain contract. A Dart client would
need its own hand-maintained mirror of every type the API returns — for a small tools app
whose main mobile job is scan, confirm, and submit, that is a poor trade.

**Consequences.**
- `Makefile` `dev` and `mobile` targets are dead: they build Flutter from `apps/desktop`,
  which does not exist. `make dev` fails today.
- `05-build-proposal.md` misstates the mobile deliverable and the team line; the addendum
  flags it for the client's sign-off.
- The Expo app is currently a shell (login + index). The scan/offline-queue flows are unbuilt.
- `packages/design-system` (tokens) and `packages/frontend-shared` exist to serve both
  clients; they only pay off under this decision.

> **Follow-up, 2026-08-09.** That last consequence did not hold. Neither package was ever
> imported by `apps/web` or `apps/mobile` — the two clients share only
> `@stinventory/api-contracts` and `@stinventory/types` — so both were deleted. The
> decision itself stands; only the prediction about how the sharing would be structured
> was wrong. Share logic (as `packages/domain` does), not tokens or components: the web
> app is Radix + Tailwind v4 and the field app is NativeWind + Tailwind v3, so there is no
> component layer for them to hold in common.

---

## ADR-4 — Chat-first intent capture

**Status:** Accepted · **Date:** 2026-07 (retroactive)

**Decision.** Foremen record custody events by typing a sentence into an in-app channel. A
sidecar LLM service parses it into a structured intent; the API resolves the named entities
to database rows and proposes an action for confirmation.

**Rationale.** The behaviour being replaced is a WhatsApp message. Any workflow that asks a
foreman to open a form, find a tool in a dropdown, and pick a project will lose to WhatsApp,
because WhatsApp costs one sentence. Matching that cost — one sentence — is the only way the
data actually gets captured. This is the field-simplicity constraint applied literally.

**Consequences.**
- The LLM never touches the database. It returns raw text spans and labels; entity resolution
  to IDs happens in `apps/api/src/entity-resolve.ts`, under tenant scope. A hallucinated ID
  is therefore impossible by construction.
- A confirmation step is required for anything that moves custody — the model's confidence is
  an input to the workflow, not an authority.
- The system takes a dependency on an inference endpoint being reachable; when it is not,
  messages queue rather than fail, and the verification queue is the fallback.
- Full specification in `07-conversational-layer.md`.

---

## ADR-5 — Multi-tenant-ready, multi-tenant later

**Status:** Accepted · **Date:** 2026-07 (retroactive; restates `02-saas-architecture.md` §2)

**Decision.** Every table carries `tenant_id` from the first commit, and every query filters
on it in the application layer. Postgres RLS is **not** enabled while Urban is the only
tenant.

**Rationale.** Retrofitting tenancy into a schema is expensive; carrying an unused column is
nearly free. Running RLS from day one, by contrast, costs real debugging time for a boundary
that has nothing to isolate yet.

**Consequences.**
- Tenant isolation currently depends on application discipline — `ctx.session.tenantId` on
  every query — with no database backstop. A missed filter is a cross-tenant leak the moment
  tenant two exists.
- Turning RLS on is a prerequisite for Phase 2 pilots, not a nice-to-have.
- **`project_phase` has no `tenant_id`, so this decision is currently violated.** No RLS
  policy can be written for that table until the column is added.

---

## ADR-6 — Approval gate on custody changes

**Status:** Accepted · **Date:** 2026-07 (retroactive)

**Decision.** Assignments and transfers can enter a `pending_approval` state. The gate fires
on cross-person hand-offs and on assets above a value threshold, both configured per tenant
via `tenant_settings.high_value_threshold` and `custody_approver_role`.

**Rationale.** Custody of a $12,000 GNSS unit moving between foremen is a different event
from a $60 hand tool being picked up, and a system that treats them identically will either
be too slow for the common case or too loose for the expensive one. Making it a threshold in
tenant data rather than a constant in code keeps the rule tunable per customer.

**Consequences.**
- `dashboard.pendingApprovals` and the approve endpoints exist to service the queue.
- The threshold is tenant config, so it does not need a code change to tune — this is also
  what makes the rule portable to a second tenant.
- Chat-confirmed actions currently bypass the gate: `messaging.confirmAction` writes
  assignments with `status: "active"` and transfers with `status: "completed"` directly. This
  is an inconsistency to resolve, not an intended exemption.

---

## ADR-7 — "Blocky" replaces the shadcn visual layer; the primitives stay

**Status:** Accepted (provisional — the layout is agreed, the palette is not)
**Date:** 2026-08-15 · **Concept:** `design/claude-design/Tools by Jobsite Blocky.dc.html`

**Decision.** The product's visual language becomes Blocky: 3–4px radius, JetBrains Mono for
every numeral, 8–10px row density, a coloured left edge bar for state, zebra-striped tables,
and bare coloured status text instead of badge components. The shadcn *look* is dropped.

**The Radix primitives underneath shadcn are kept.** Dialog, popover, combobox, dropdown and
the rest keep their behaviour: focus traps, keyboard navigation, ARIA wiring.

**Rationale.** These screens are yard manifests, not marketing surfaces. Rounded cards and
proportional numerals make a column of tag numbers and counts harder to scan, which is the
one job the screen has. Blocky is a set of decisions about density and typography; it says
nothing about component behaviour, so there is nothing in it that requires dropping Radix.

Rebuilding the primitives by hand would cost weeks and would regress accessibility that
works today — paying that price to change a border radius is not a trade worth making. If
the intent was ever to remove Radix as well, that is a separate decision needing its own record.

**Consequences.**
- Blocky lands as **tokens plus restyled primitives** (STI-1001), then existing surfaces
  migrate (STI-1002). New UI is built in Blocky from the start, so the dashboard is not
  built twice.
- The concept's hex palette is **not** adopted verbatim. It must be expressed in the oklch
  token system in `apps/web/app/globals.css`, so light/dark and the reserved status hues
  (`--ok`, `--warn`, `--crit`, `--idle`) keep working. This is the unconfirmed half.
- The field app (NativeWind) does not automatically follow. ADR-3's follow-up already
  established the two clients share logic, not components.

---

## ADR-8 — Foundation integration is read-only ODBC, not a file drop

**Status:** Accepted · **Date:** 2026-08-15 · **Supersedes:** the "nightly CSV drop vs live
API" open question in `docs/workings/SYSTEM_PLAN.md` §8.2

**Decision.** Foundation is reached over its **ODBC database layer**. Urban already runs a
PHP sync against it; that script is the reference for table and column mapping. STInventory
reads Foundation directly — projects, phases, cost codes and users — rather than consuming
an exported file.

**Rationale.** ODBC removes the export step entirely, which removes the class of failure
where a load runs against a stale file. It also makes ongoing sync a scheduling problem
rather than an integration problem, because the same query serves the one-time load and
every later refresh.

**Consequences.**
- **Read-only, always.** STInventory never writes to Foundation. Foundation is authoritative
  for the entities it owns; the flow is one-directional until someone decides otherwise.
- The connection needs credentials and a service account, and **the PHP script's auth is the
  open item** — it is the thing standing between this decision and a working sync.
- The identity rules in STI-201 do not change. `external_ref(foundation, type, native_id)`
  is still how a row is matched, whatever the transport.
- Because the transport is a live query rather than a file, **ongoing sync is now days of
  work rather than weeks**, which is what the file-drop-versus-API question was sizing.
  Release 1 still ships the one-time load; scheduled sync becomes cheap enough to pull
  forward if wanted.
- Whether the existing PHP is kept as a sidecar or ported into the monorepo is deferred.
  Not urgent: it changes who runs the sync, not what the sync means.

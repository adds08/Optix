# STInventory — SaaS Architecture & Productization Path

How STInventory grows from an Urban-only internal tool into a multi-tenant SaaS product,
and how it lines up with the Mark 85 customer-zero → SaaS strategy already decided.

Design rule: **build single-tenant-shaped but multi-tenant-ready from day one.** Every row
carries `tenant_id`; the prototype just hardcodes it to Urban. Retrofitting tenancy later
is expensive; carrying an unused column is nearly free.

---

## 1. Why this mirrors Mark 85

Mark 85's strategy is: Urban runs it as customer-zero (Phase 1), 3-5 friendly pilots join
(Phase 2), full SaaS launch + Series A (Phase 3). STInventory is a **narrower, faster
instance of the same arc** — small-tools management is a well-bounded, universally painful
construction problem, so it can reach a sellable multi-tenant state sooner than the full
ERP. It can serve as an early SaaS proof point and even a standalone paid module.

Two viable end states (decide later, don't block on it now):

- **A — STInventory as a Mark 85 module.** Folds into Mark 85's tenant model, auth, and
  data layer. One login, one bill, shared Projects/Employees. Best if Mark 85 lands first.
- **B — STInventory as a satellite SaaS.** Ships and sells on its own (equipment-focused
  buyers who don't want a full ERP), sharing Mark 85's platform primitives but its own
  onboarding. Best if STInventory reaches market first.

Either way the platform primitives are shared, so build them the same way Mark 85 does.

## 2. Tenancy model

Single database, shared schema, **row-level `tenant_id` + Postgres RLS**. Chosen over
database-per-tenant for operational simplicity at pilot scale (3-5 tenants), matching the
Mark 85 prototype-first posture (no RLS in the very first thin prototype, added when the
second tenant appears).

```
Request → resolve tenant (subdomain / JWT claim) → set app.tenant_id
       → every query filtered by RLS policy USING (tenant_id = current_tenant())
```

Isolation boundaries:
- Postgres RLS on every table — the hard boundary.
- Object storage (photos, asset docs, PO PDFs) prefixed by `tenant_id/`.
- No cross-tenant joins in application code; enforced by RLS as backstop.

Escalation path if a large tenant needs isolation: promote to its own schema or database
without changing application code (tenant resolver swaps the connection).

## 3. Layered architecture

As built (2026-07-25). Items marked *planned* have no code behind them yet.

```
┌ Presentation ─────────────────────────────────────────────┐
│  Web — Next.js 15, shadcn (reports-first)                  │
│  Mobile — Expo Router (shell only; scan flows planned)     │
├ Application / API ─────────────────────────────────────────┤
│  Hono + tRPC (single API surface — ADR-2)                  │
│  Auth (Lucia-style sessions) · RBAC per permission          │
│  Command handlers → append transactions (event-sourced)    │
│  Projection writers → asset.current_*, assignment          │
│  Background: notification scheduler · messaging worker      │
├ Intent engine (sidecar) ───────────────────────────────────┤
│  Python FastAPI, POST /parse → self-hosted LLM             │
│  Returns raw text spans only; never DB IDs                 │
├ Domain ────────────────────────────────────────────────────┤
│  Asset · Assignment · Transfer · (Procurement, Maintenance  │
│  planned)                                                   │
│  Invariants: one active custodian, financial≠operational   │
├ Data ──────────────────────────────────────────────────────┤
│  Postgres 16 + Drizzle (transaction = source of truth)     │
│  RLS planned — off while Urban is the only tenant           │
│  Projections for reports; materialized views planned        │
│  Object store for media — planned                           │
├ Integration ───────────────────────────────────────────────┤
│  FoundationSoft (cost/charge-back) · BambooHR (employees,  │
│  termination events) · HCSS (equipment/telemetry)          │
│  All three planned; `external_id` seams exist on            │
│  `project` and `employee`                                   │
└────────────────────────────────────────────────────────────┘
```

The intent engine is a **separate process**, not a library, so the LLM can be swapped or
hosted independently without touching the API. It is stateless and holds no database
credentials. See `07-conversational-layer.md`.

## 4. Reports as materialized projections

The reports are the moat, so they are first-class: each report (utilization, idle, lost,
cost allocation, asset-by-project/foreman) is a view or materialized view folded from
`transactions`. New tenants get every report for free because the derivation is generic —
no per-tenant report code.

## 5. Multi-tenant readiness checklist

Carry these from the first commit even while Urban is the only tenant. Status as of
2026-07-25:

- [x] All IDs are uuids (no sequential leakage across tenants) — the two append-only log
      tables (`transaction`, `event_log`) use bigint identity by design, for ordering
- [x] Tenant resolver in the request pipeline — `session.tenant_id`, threaded through every
      tRPC procedure as `ctx.session.tenantId`
- [x] Auth issues tenant-claimed sessions
- [x] External IDs — `external_id` present on `project` and `employee`
- [x] Config is tenant-scoped data, not code — `tenant_settings` (high-value threshold,
      approver role, SLA cadences, delivery channels)
- [x] No hardcoded "Urban" strings in domain logic — Urban appears only in seed data
- [ ] **`tenant_id` column on every table — FAILING.** `project_phase` has no `tenant_id`
      (`packages/db/src/schema/project.ts`). It is reachable only via `project_id`, so no RLS
      policy can be written against it as it stands. **This blocks tenant two** and must be
      fixed before Phase 2 onboarding.
- [ ] Tool templates as tenant config — the table does not exist yet (still an open topic in
      `01-plan.md` §20)

## 6. Configuration that must be tenant-data, not code

Every tenant differs on: category tree, tool templates per work package, approval matrix
(who signs off on PR/PO and high-value custody), warehouse/location hierarchy,
charge-back policy (flat / daily / none), notification SLAs. All of these live in tenant
config tables, seeded from a default template at onboarding.

## 7. Onboarding flow (Phase 2+)

```
Create tenant → seed default categories + templates → import employees (BambooHR/CSV)
→ import/enter warehouses + locations → bulk-import asset register (CSV/scan)
→ set approval matrix → go live
```

## 8. Phasing (aligned to Mark 85 arc)

- **Phase 1 (Urban customer-zero).** Single tenant, `tenant_id` present but constant.
  Asset register → procurement → assignments/transfers → reports. Prove it on Urban's real
  tool fleet.
- **Phase 2 (pilots, months ~12-24).** Turn on RLS + tenant resolver, onboard 3-5 pilots.
  Mobile QR. Harden integrations behind per-tenant credentials.
- **Phase 3 (SaaS launch).** Self-serve onboarding, billing, tenant admin console.
  Decide A (Mark 85 module) vs B (satellite) based on where each product actually is.

## 9. What NOT to build yet

Per the prototype-first cadence: no RLS, no ClickHouse, no event bus, no sync engine in
Phase 1. Postgres + a transactions table + projection views is enough to run Urban and
prove the model. Add tenancy machinery when the second tenant is real, not before.

**Re-checked 2026-07-25 and still held.** None of the above has crept in: there is no RLS,
no event bus, no analytics store, no sync engine. Tenant isolation is enforced in the
application layer (`ctx.session.tenantId` on every query) with RLS deferred as the backstop.
Stated explicitly so a reader knows this was verified, not overlooked.

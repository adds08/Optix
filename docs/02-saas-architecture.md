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

```
┌ Presentation ─────────────────────────────────────────────┐
│  Web (UR-style dashboard, reports-first)                   │
│  Mobile (QR scan, offline queue) — later phase             │
├ Application / API ─────────────────────────────────────────┤
│  Hono/Node REST+RPC · Auth (Lucia-style) · RBAC per role   │
│  Command handlers → append transactions (event-sourced)    │
│  Projection rebuilders → assets.current_*, assignments     │
├ Domain ────────────────────────────────────────────────────┤
│  Asset · Assignment · Transfer · Procurement · Maintenance │
│  Invariants: one active custodian, financial≠operational   │
├ Data ──────────────────────────────────────────────────────┤
│  Postgres (transactions = source of truth) + RLS           │
│  Projections/materialized views for reports                │
│  Object store for media                                    │
├ Integration ───────────────────────────────────────────────┤
│  FoundationSoft (cost/charge-back) · BambooHR (employees,  │
│  termination events) · HCSS (equipment/telemetry)          │
└────────────────────────────────────────────────────────────┘
```

## 4. Reports as materialized projections

The reports are the moat, so they are first-class: each report (utilization, idle, lost,
cost allocation, asset-by-project/foreman) is a view or materialized view folded from
`transactions`. New tenants get every report for free because the derivation is generic —
no per-tenant report code.

## 5. Multi-tenant readiness checklist

Carry these from the first commit even while Urban is the only tenant:

- [ ] `tenant_id` column on every table (constant in prototype)
- [ ] Tenant resolver in the request pipeline (returns Urban always, for now)
- [ ] All IDs are uuids (no sequential leakage across tenants)
- [ ] External IDs (`external_id`) namespaced per tenant for FoundationSoft/BambooHR maps
- [ ] Config (categories, tool templates, approval matrix) is tenant-scoped data, not code
- [ ] Auth issues tenant-claimed tokens
- [ ] No hardcoded "Urban" strings in domain logic

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

> **Table names in this document predate the 2026-08-28 rename.** Where it says
> `asset`, `assignment`, `transaction` and so on, the physical tables are now
> `tbl_entity_asset`, `tbl_ops_smalltools_custody`, `tbl_ops_transaction`. The
> reasoning here is unaffected; only the names are. The current schema is
> [`architecture/01-data-model.md`](architecture/01-data-model.md).

# Bodhi Labs — STInventory Build Proposal

**Prepared by:** Bodhi Labs Pvt. Ltd. (Kathmandu, Nepal)
**Prepared for:** Urban Infraconstruction (Dallas, TX)
**Subject:** Design and build of STInventory — internal small-tools & equipment management
platform
**Date:** 2026-07-09
**Status:** Draft for review

This proposal covers a standalone STInventory engagement. It is scoped so it can run
independently of the Mark 85 Phase 1 engagement or fold into it (§9). Pricing follows the
same Nepal-aligned, market-defensible basis as the Mark 85 proposal (blended senior rate
~one-third of US/EU agency equivalent).

---

## 1. What Bodhi will deliver

A production-ready STInventory platform for Urban as customer-zero, built greenfield,
event-sourced, and multi-tenant-ready from day one (so it can become SaaS without a
rewrite). Delivered in priority order, reports-first per module:

1. **Asset Register** — catalog (categories/manufacturers/models), serialized + bulk
   assets, tagging/QR values, warehouse & location hierarchy, current-state projection.
2. **Procurement** — purchase requests → approvals → purchase orders → receive → inspect
   → tag → assign; charge-to-project at receive.
3. **Assignments & Transfers** — custody model, temporary loans with overdue alerts,
   transfers between foremen/projects/locations, the operational scenarios (project
   complete, multi-project foreman, phase change).
4. **HR Offboarding / Clearance** — termination event → clearance queue → return / transfer
   / mark-missing, sign-off gate. (Consumes a BambooHR or Mark 85 HR signal.)
5. **Maintenance & Inspections** — preventive / corrective / calibration / warranty /
   damage, schedules, vendor tracking.
6. **Reporting pack** — asset register, assets by project, assets by foreman, utilization,
   idle assets, lost assets, maintenance history, procurement status, audit trail, cost
   allocation.
7. **Mobile QR** — scan-to-assign / scan-to-transfer / scan-to-return with an offline
   queue for yards and sites without signal.
8. **Integrations** — FoundationSoft (cost/charge-back), BambooHR (employees +
   termination), HCSS (equipment cross-reference) behind a provider interface.

Out of scope for this engagement (candidate Phase 2+): RFID/BLE tracking, predictive
procurement/AI forecasting, route optimization, internal chargeback billing engine,
self-serve SaaS onboarding + billing. The architecture leaves clean seams for all of them.

## 2. Approach

- **Greenfield, event-sourced core.** Append-only `transactions` table is the system of
  record; all operational state is a projection (see `03-data-model.md`). Audit trail is free.
- **Reports-first.** Each module ships its reports before its edit UI, honoring Urban's
  "reports are the moat" and field-simplicity constraints.
- **UR-style dashboard.** Matches the United Rentals look Urban already likes; validated in
  the runnable prototype under `prototype/`.
- **Multi-tenant-ready, not multi-tenant yet.** `tenant_id` carried from commit one,
  constant for Urban; RLS turned on when the second tenant is real.
- **Code in Urban/FieldOS-owned Git from day one**; Bodhi engineers commit as collaborators.

## 3. Delivery plan (24 weeks)

| Phase | Weeks | Deliverable | Acceptance |
|---|---|---|---|
| 0 — Discovery & data model | 1–2 | Finalized schema, event catalog, tool-template + category taxonomy from Urban's real fleet, environment setup | Schema + migrations reviewed and signed off |
| 1 — Asset Register foundation | 3–8 | Auth/RBAC, catalog, assets, locations/warehouses, current-state projection, register report + dashboard KPIs | Urban's real asset list imported and queryable |
| 2 — Procurement + Assignments | 7–14 | PR→PO→Receive→Tag; assignments, transfers, temporary loans, overdue alerts, operational scenarios | Full procure-to-assign flow run on a live project |
| 3 — Maintenance + Reports pack | 13–18 | Maintenance/inspection module, all §1.6 reports, cost allocation, HR clearance workflow | All ten report categories produced; clearance drill passes |
| 4 — Mobile QR + hardening | 17–22 | Flutter scan flows, offline queue, FoundationSoft/BambooHR/HCSS integrations, performance + security pass | Scan-to-assign works offline; integrations reconcile |
| 5 — UAT, handoff, cutover | 21–24 | UAT with Urban equipment dept, docs, training, production cutover, KT sessions | Urban runs the yard on STInventory; sign-off |

Phases overlap intentionally (a 24-week calendar, not 27 sequential weeks).

## 4. Team

Ring-fenced Kathmandu team with the same US-Nepal daily overlap window used on Mark 85.

| Role | Allocation | Weeks | Hours | Responsibility |
|---|---|---|---|---|
| Tech Lead / Architect | 0.4 FTE | 24 | 384 | Event-sourced design, data model, reviews, integration architecture |
| Senior Full-stack Engineer | 1.0 FTE | 24 | 960 | API, domain logic, projections, procurement |
| Full-stack Engineer | 1.0 FTE | 24 | 960 | Assignments/transfers, maintenance, reports |
| Frontend / UX Engineer | 0.9 FTE | 24 | 864 | UR-style dashboard, register, forms, reports UI |
| Mobile Engineer (Flutter) | 0.5 FTE | 12 | 240 | QR scan flows, offline queue |
| QA Engineer | 0.5 FTE | 20 | 400 | Test coverage, UAT support, scenario validation |
| PM / Business Analyst | 0.3 FTE | 24 | 288 | Sprint cadence, Urban liaison, acceptance tracking |
| **Total** | **≈4.3 blended FTE** | | **4,096** | |

## 5. Effort & pricing

Per-role blended rates (Nepal senior delivery market; ~one-third of US/EU equivalent):

| Role | Rate (USD/hr) | Hours | Cost |
|---|---|---|---|
| Tech Lead / Architect | $65 | 384 | $24,960 |
| Senior Full-stack | $50 | 960 | $48,000 |
| Full-stack | $40 | 960 | $38,400 |
| Frontend / UX | $42 | 864 | $36,288 |
| Mobile (Flutter) | $45 | 240 | $10,800 |
| QA | $32 | 400 | $12,800 |
| PM / BA | $45 | 288 | $12,960 |
| **Subtotal** | | **4,096** | **$184,208** |

**Blended rate: ~$45/hour. Fixed-fee quote: USD $185,000** for the full 24-week scope
(§1 items 1–8), fixed on the §3 plan and §4 team.

Basis of estimate: this is direct team cost plus a ~25% margin, consistent with the Mark 85
proposal's rate structure. A US/EU agency doing the same scope would quote roughly
$520K–$600K; the gap is Bodhi's structural cost advantage, not corners cut.

### Scope options

| Option | Scope | Weeks | Hours (approx) | Fixed fee |
|---|---|---|---|---|
| **A — MVP** | Items 1–3 + core reports (register, procurement, assignments/transfers, dashboard) | 14 | ~2,300 | **$105,000** |
| **B — Operational** (recommended) | Items 1–6 (adds maintenance, full report pack, HR clearance) | 20 | ~3,400 | **$155,000** |
| **C — Full** | Items 1–8 (adds mobile QR + integrations) | 24 | ~4,100 | **$185,000** |

Recommendation: start at **A** to get the register live on Urban's real fleet fast, then
continue into **B/C** on a confirmed change order once the model is proven in the yard.

### Pass-through costs (paid by Urban directly to vendors, no Bodhi markup)

| Item | Estimate (annual) |
|---|---|
| Cloud (AWS or GCP) — small footprint | $6K–$14K |
| SaaS tooling (GitHub, Sentry, Linear, Posthog) | $3K–$6K |
| QR label stock + scanners (if mobile phase) | $2K–$5K |
| **Total pass-through** | **$11K–$25K** |

### Payment schedule (Option C)

Milestone-gated, net-30, on phase acceptance:

| Milestone | Trigger | Amount |
|---|---|---|
| Kickoff | Signed SOW | $27,750 (15%) |
| Phase 1 accepted | Register live with real data | $46,250 (25%) |
| Phase 2 accepted | Procure-to-assign on a live project | $46,250 (25%) |
| Phase 3 accepted | Reports pack + clearance drill | $37,000 (20%) |
| Production cutover | Urban runs the yard on STInventory | $27,750 (15%) |
| **Total** | | **$185,000** |

## 6. Assumptions

- Urban provides its real asset list, categories, warehouse/location hierarchy, and one
  equipment-dept SME available ~4 hrs/week.
- FoundationSoft, BambooHR, and HCSS API credentials/sandboxes are provided by Urban;
  integration effort assumes documented, reachable APIs.
- One production environment (Urban tenant). Additional tenants are a Phase 2 change order.
- Scope changes handled by written change order against the §5 rate card.

## 7. What Urban owns at the end

- All source code, in Urban/FieldOS-controlled Git from day one.
- Data model, migrations, and the running production system.
- Documentation: architecture notes, runbook, API docs, report catalog.
- Trained equipment-dept + admin users; recorded KT sessions.

## 8. Handoff & path to production

1. **Continuous handoff, not a month-24 dump.** Monthly written KT notes from Phase 1;
   Bodhi commits to Urban's repo throughout; no black-box components.
2. **Staging → UAT → cutover.** Phase 5 runs real Urban yard operations in parallel
   (staging) before flipping the equipment dept fully onto STInventory.
3. **Data migration.** Existing tool records (spreadsheets / legacy) imported via a
   one-time loader into the asset register with an intake inspection event per asset.
4. **Hypercare.** 4 weeks post-cutover of Bodhi support included in the fixed fee
   (bug fixes, not new scope), then transition to an agreed support retainer or Urban's
   internal team.
5. **Runbook + on-call doc** delivered so Urban (or the Mark 85 team) can operate it
   without Bodhi as primary owner.

## 9. Relationship to Mark 85

STInventory is deliberately buildable as a standalone track. Two convergence paths, decided
later (see `02-saas-architecture.md` §1):

- **Fold into Mark 85** as its Equipment/Small-Tools module — shared auth, tenancy, and
  Projects/Employees. Best if Mark 85 lands first.
- **Ship as a satellite SaaS** sharing Mark 85's platform primitives but its own onboarding.
  Best if STInventory reaches market first and serves equipment-focused buyers.

Either way, Bodhi builds STInventory on the same primitives and conventions as Mark 85, so
convergence is an integration exercise, not a rewrite. Bodhi's existing Mark 85 equity
alignment extends the same incentive here.

## 10. Next steps

1. Urban selects a scope option (A / B / C).
2. Confirm the first-module priority and integration credentials availability.
3. Bodhi issues the SOW with the finalized §3 plan and §5 schedule.
4. Kickoff within 2 weeks of signature.

---

## Appendix A — Delivery status as of 2026-07-25

Added when `docs/` was reconciled against the running codebase. **Scope, hours, team, and
pricing in §1-§8 above are unchanged** — this appendix reports progress against them and
flags two items needing Urban's sign-off.

### A.1 Status against the §1 deliverables

| # | Deliverable | Status | Notes |
|---|---|---|---|
| 1 | Asset Register | **Built** | catalog, serialized + bulk, tagging, warehouse/location hierarchy, current-state projection |
| 2 | Procurement | **Not started** | no PR/PO/vendor tables exist |
| 3 | Assignments & Transfers | **Built** | custody model, temporary loans with overdue alerts, transfers, approval gate on high-value and cross-person moves |
| 4 | HR Offboarding / Clearance | **Partial** | the clearance queue derives and displays; the BambooHR trigger and the sign-off **gate** are not built |
| 5 | Maintenance & Inspections | **Not started** | no tables exist |
| 6 | Reporting pack | **Partial** | 6 of 11 report categories exist as API procedures; **none has a UI**; utilization, maintenance history, procurement status and transfers reports are outstanding |
| 7 | Mobile QR | **Not started** | app shell only; no scan flows, no offline queue |
| 8 | Integrations | **Not started** | `external_id` seams exist on `project` and `employee`; no connector code |

Built beyond the priced scope (see A.2): vehicles/fleet tracking, and the conversational
layer with its task extraction and verification queue.

Phase 3 (assignments/transfers) was delivered ahead of Phase 2 (procurement), departing from
the §3 sequence. Rationale: custody is where the spreadsheet fails hardest and procurement can
continue on the existing process meanwhile. Net effect on the §3 calendar is neutral;
the deferred procurement work is unchanged in size.

### A.2 Two items requiring Urban's sign-off

**1. Mobile platform: Flutter → Expo (React Native).**
§1.7 and the §4 team table specify a Flutter mobile engineer at 0.5 FTE / 240 hours. The
build has moved to Expo so the mobile client shares TypeScript types, the API client, and
validation with the web app rather than maintaining a parallel Dart mirror of every API
contract. Rationale and consequences: `06-decisions.md` ADR-3.

*Commercial effect:* none proposed. The hours and the fixed fee are unchanged; the role is
re-labelled from Flutter to React Native at the same rate. **Confirm or reject.**

**2. Conversational layer — delivered scope that was never priced.**
The chat → LLM intent → proposed-custody-action subsystem (plus chat-extracted tasks, the
admin verification queue, and the Python intent engine) is built and working. It appears
**nowhere** in the §1 list and was not in the §5 estimate.

It is the direct answer to the "WhatsApp threads" problem in `00-executive-summary.md`, and
it is what makes field capture cheap enough that foremen actually do it. But it is
unbudgeted work, and it carries an ongoing cost the proposal does not cover: LLM hosting
(self-hosted vs. hosted API is still undecided).

*Commercial effect:* to be agreed. Options are (a) absorb it as delivered goodwill against
the existing fixed fee, (b) formalize it as a change order with a compensating deferral, or
(c) fold it into the Option C scope at renegotiated hours. **Urban's call.**

### A.3 Known defects carried into this status

Disclosed rather than deferred silently. None are scope changes; all are fix-forward items:

1. Confirming a `repair` or `lost` action in chat writes no transaction yet reports success
   (`07-conversational-layer.md` §7).
2. The intent engine is not a `docker-compose` service, so chat degrades to manual entry in a
   containerized run, without surfacing an error.
3. `project_phase` lacks `tenant_id`, which blocks Postgres RLS and therefore the §6
   assumption that additional tenants are a clean Phase 2 change order.
4. Two API surfaces (tRPC and a hand-rolled REST layer) implement the same queries; ADR-2
   retires the REST copy.
5. `make dev` fails — it still builds Flutter from a directory that does not exist.

Items 1-3 should close before any UAT (§3 Phase 5) that includes chat or a second tenant.

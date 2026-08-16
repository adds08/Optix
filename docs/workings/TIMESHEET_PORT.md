# TIMESHEET_PORT — Legacy Timesheet Port Findings & Plan

> **Memory of record** for the three legacy workspaces Urban owns alongside STInventory:
> `timesheet` (web), `timesheetservice` (PHP backend), `urbaninfraconstruction-application`
> (Flutter mobile). Verified against source on 2026-08-16. If a claim here disagrees with
> the code, the code wins. Deep-dive notes beyond this doc live in the repo commit message
> history and the two `docs/` trees of the legacy repos.

---

## 1. Conclusion (TL;DR)

Urban's live timesheet system — not a single app but **three coupled codebases** (a
jQuery/Bootstrap/Vue-2 web monolith, a raw PHP 7.4 + MySQL backend with two API
generations, and a frozen Flutter mobile app) — is portable to the STInventory stack
(pnpm monorepo, Hono + tRPC, Next.js 15, Postgres + Drizzle, Expo RN) in roughly:

| Team | Calendar | Person-weeks | Bodhi-rate fee |
|---|---|---|---|
| 4.3 blended FTE (STInventory-shaped team) | **28–36 weeks** | ~5,600–7,200 | **$255K–$330K** |
| 2-person pair | 50–60 weeks | ~5,600–7,200 | (same effort, slower clock) |

This is **~1.4–1.8× the STInventory build** (24 wks / 4,096 hrs / $185K): the port has
~2× the screens and reports and ~2× the API surface, but a port is faster per unit than
greenfield because the running system *is* the spec. The largest single line items are
(1) the ~75-table schema + data migration, (2) the weekly payroll/analysis report family,
and (3) security remediation of a backend that is **effectively unauthenticated and
MD5-hashed end to end**.

**Two corrections to working assumptions, before anything else:**
1. The web app is **NOT AngularJS** — it is jQuery 3 + Bootstrap 3/4 + embedded **Vue 2**
   components (plan/POD/equipment-template/email/JSA-signature screens). No Angular
   anywhere.
2. There are **three tenants/configs** wired in `js/app-config.js` (urban / devonian /
   localhost), and the `devonian` (Optixtec) tenant calls a *different* service base URL.

**Biggest single strategic recommendation:** keep the Flutter mobile app in the first
cut. It is frozen (last commit 2023-09) but functional and already in production on
Android tablets; the STInventory ADR-3 Flutter→Expo decision does not have to be
inherited. Port mobile only if/when feature parity is required.

---

## 2. The three legacy workspaces (findings)

### 2.1 `timesheet/` — web frontend (231 MB, branch `develop-v2`, ~180 commits)

- **Stack:** jQuery 3.2.1 / Bootstrap 3.3.7 + 4.x / Vue 2.6.12 (embedded) / Chart.js 2 /
  moment / bootstrap-table / select2 / Leaflet 1.9.4 (geofencing) / jsPDF + html2pdf /
  pdf.js (doc viewer) / signature_pad. No Angular. Build tooling is a no-op scaffold
  (Grunt + Gulp); the app ships as raw static files rsync'd to a DigitalOcean droplet.
- **Surface:** 254 HTML pages, ~180 first-party JS files, **~113K LOC app JS + ~94K LOC
  HTML**. Seven role dashboards that *duplicate* shared screens: `admindash` (112 files,
  everything), `projectmanager` (45), `equipmentmanager` (35), `superdash` (17),
  `foremandash` (13), `logisticsdash` (12), `mechanic` (6). Distinct screens after
  de-duplication: **~90–100**.
- **Role model (userType ids):** 1 Admin/Owner · 2/14 Foreman · 3 Superintendent ·
  8 Equipment Mgr · 9/10 PM · 12 Mechanic · 13 Engineer · 4–7/15 crew/HR. Role gating in
  the frontend is **client-side only** (menu built from `localStorage.user_type`).
- **Feature inventory:**
  - **Timesheet lifecycle:** 5-tab entry (labor grid → material/trucks → equipment+meter
    readings → daily report → pictures), save-draft / submit, modify (with notes),
    read-only view + PDF, delete, verify state machine (`Draft → Both Unverified →
    Super Verified → Super Re-Verify → Both Verified`), field-level modification log.
  - **Reports (~25 types):** weekly-by-dates (payroll Mon–Sun pivot), weekly compact,
    equipment weekly (+compact), timesheet analysis (budget vs actual man-hours),
    material report, picture report, overtime (wk/1M/3M/6M/YTD), missing entries, missing
    crew, crew on-time, verification report, modification report, PO log, project
    dashboard (Chart.js), JSA/JHA reports, daily tickets.
  - **Modules:** purchase orders (PM/CM/Tool line categories, cost-code % splits,
    pending/exported + PO number generation), equipment + equipment modules (mechanic
    maintenance work orders with parts + photos), equipment templates, plan management
    (weekly plan/actual Vue apps), POD (plan-of-day + verify), crew/org templates
    (PM→Super→Foreman), JSA with Hot Work / LOTO / Confined Space permit modals, JHA
    (hazard assessment + crew signatures), geofencing (Leaflet polygons), email module
    management + subscriptions, files/doc viewer (annotated PDF), inquiry/equipment
    request forms (8 types), API token management, admin super-powers (bulk delete /
    shift dates), saved timesheet filters, FoundationSoft projectsetup import pages.
  - **Embedded Flutter web builds:** `application/` (timesheet), `applications/jha/`
    (JHA), `applications/mechanic_timesheet/` — compiled `main.dart.js` sharing the same
    backend.
- **Backend contract:** two API generations consumed — legacy `{controller}index.php?method=`
  (~50+44+20+19 = ~133 methods) and REST-ish `v2/` (~115 endpoints). Newer modules use
  v2 exclusively; older report/entry pages still hit gen-1. JWT bearer in
  `Authorization` header + `APICaller: web`, 10-min token refresh via `v2/refreshToken`.

### 2.2 `timesheetservice/` — PHP backend (370 MB)

- **Stack:** PHP 7.4.33 procedural (`mysqli`) + **Slim 4** rewrite in `v2/` (php-di,
  lcobucci/jwt, swagger-php). MySQL on DigitalOcean managed. RabbitMQ consumer
  (abandoned), PHPMailer (SMTP), TCPDF (one PDF path). ~**30.8K LOC first-party PHP**
  (18.1K gen-1 + 12.7K v2), 61 SQL files.
- **Database:** **~75 tables + ~25 views + 18 audit triggers.** No full schema dump in
  repo (`backedupimport/` holds `.REMOVED.git-id` stubs) — schema was reverse-engineered
  from code. Core tables: `user`, `user_type`, `project`, `project_phase`, `projectsetup`
  (project×costcode×unit with budgeted man-hour/qty), `cost_code`, `unit`, `qty_complete`,
  `timesheet_userdate` (header), `daily_entry` (labor), `daily_entry_resource`,
  `equipmentsused`, `trucks`, `daily_absent`, `subcontractor`, `pictures`,
  `timesheet_notes`, `timesheet_update_log` (modification audit), `approval_history`,
  `daily_pod`, `plan_management`, `crew_groups`, `templatesetup`, `equipment_template`,
  `companyequipments`, `equipment_module`(+parts/pictures), `purchase_order`/
  `purchase_entry`/`purchase_costcode`, `vendor`, `files`/`file_versions`/`file_users`,
  `email_management`/`email_template`, `daily_jha`/`jhaReport`(+crew/equipment/
  materials/taskAssessment), `foundation_*` staging (projects/cost_codes/phases/units/
  projectsetup + import/update/sync logs), `timesheet_filter_list`. Plus a separate
  `timesheetLog` DB for API call logging.
- **API surface:** gen-1 `index.php` main dispatcher ~**150 methods** (timesheet entry
  engine, master data, PO, POD, equipment, reports, documents, admin repairs) + gen-2
  v2 Slim **~130 endpoints** (auth, groups, plans, JHA, filters, dashboard reports, PO
  logs, mail modules). Largest files: `timesheet.php` (2,490 LOC), `reports.php`
  (1,741), `project.php` (1,251), `pod.php` (905), `purchaseorder.php` (849),
  `EquipmentReport.php` (858), `foundationservice.php` (786).
- **Security posture (critical):** auth check is **commented out** in `loadApi.php` —
  every gen-1 method (user CRUD, PO export, `deleteAllTimesheetEntries`, password
  changes) runs unauthenticated; passwords are **unsalted MD5**; SQL is string-concatenated
  end to end (injection everywhere); **live secrets committed** (DB password `Urban#12`,
  SMTP creds, ODBC creds `mobile`/`Foundation#1`, the JWT signing key
  `v2/key/id_key.ppk`); no CSRF, `Access-Control-Allow-Origin: *`; no upload validation
  (`savetofile.php`); no rate limiting; role checks exist in 2 files only.
- **Integrations:**
  - **FoundationSoft (ERP):** ODBC (`odbc:MSCas_8611`, MS SQL Server, `Cas_8611.dbo.*`)
    → pull jobs/cost codes/phases/units/budget/employees → delta-merge into `projectsetup`
    with audit logs. Entries: `foundation.php` (10 methods, **no auth**), cron
    `foundationsyncschedule*.php`.
  - **PTO:** live ODBC read of `his_accrual` / `v_hr_employees` (`ptoservice.php`).
  - **Scheduled emails:** 7 cron PHPMailer jobs — daily POD/missing-entries, weekly POD,
    missing weekly plans, weekly equipment report, **weekly payroll email** (hours
    matrix to Deneesha), payroll-for-given-supers.
  - **RabbitMQ:** consumer on queues `timesheet`/`timesheet_app` replaying the entry
    worker — abandoned.
  - **Images:** local filesystem `uploads/` only (no S3), gated by `imageAuth.php`
    (which nothing calls).

### 2.3 `urbaninfraconstruction-application/` — Flutter mobile (6.2 MB)

- **Stack:** Flutter (SDK `>=2.19.1 <3.0.0`, pre-Dart-3), `provider` (ChangeNotifier) +
  `flutter_riverpod` 2.x, `http`/`dio`, `jwt_decoder`, EN/ES localization (115 keys),
  PlutoGrid / material_table_view (spreadsheet grids), signature canvas, PDF/printing
  (JHA only). **Frozen since 2023-09-17** (153 commits, last "everything in maain").
- **Scale:** 177 Dart files / ~36.8K LOC main app; **plus a second nested app**
  `urbaniconstruction-app/` (78 files, "SuperintendentApp" — procurement/POD/PO,
  AutoRouter + dio, disconnected from the build, targets the testing server).
- **Screens (~30):** login (split-screen EN/ES), shell with collapsible **role-switched
  side menu** (no bottom nav/drawer), 5-tab timesheet entry (labor grid + keypad →
  resource → equipment → daily report → pictures), read-only timesheet view (5 tabs),
  dashboard (calendar+POD, entries list, analysis), plan view, JHA list/form (signatures
  + PDF print, ~50-item checklist, permits), equipment-maintenance (mechanic hours +
  verify), incident prototype (mock data), OSHA-training table (hardcoded).
- **Backend:** thin client over the SAME PHP `TimesheetService` — `index.php?method=
  daily_timesheet_entry` (the big 6-section JSON payload), `timesheetindex.php`,
  `equipmentindex.php`, `podindex.php`, and `v2/login|refreshToken|plan/bydate|jha/*|
  mechanic/*|equipments/template`. JWT in `SharedPreferences`.
- **Not present:** no offline queue, no geofencing, no timesheet PDF export, no camera
  permission plumbing (image_picker only).

---

## 3. Quantified port surface

| Dimension | Legacy | Port target |
|---|---|---|
| Web screens | 254 HTML pages / 7 dashboards | **~90–100** Next.js routes (dedupe per role) |
| Web JS | ~113K LOC jQuery/Vue | React components + server components |
| API operations | ~133 gen-1 methods + ~115 v2 endpoints | **~200** tRPC procedures (dedupe ~40%) |
| DB tables | **~75** + ~25 views + 18 triggers | Postgres + Drizzle, ~70 tables |
| Reports | ~25 types | ~25 (reports-first, as STInventory) |
| Roles | 7 (userType 1–15) | 7 roles + per-role scope |
| Scheduled jobs | 7 PHP cron emails | worker + email provider |
| Integrations | FoundationSoft ODBC, PTO ODBC, RabbitMQ, SMTP | MSSQL/SFTP bridge, email provider, queue |
| Mobile | Flutter 3.2.0, ~30 screens | keep Flutter OR Expo RN (~35 screens) |
| Security | MD5, no auth, injectable, secrets committed | bcrypt/argon2, sessions+RBAC on every router, drizzle (parameterized), secrets out |

---

## 4. Architecture target (STInventory-shaped)

- **Monorepo:** pnpm + Turbo; `apps/api` (Hono + tRPC, Node 22), `apps/web` (Next.js 15
  + shadcn), `apps/mobile` (Expo RN *only if* porting; else keep Flutter), `packages/`
  for `db` (Drizzle schema + seed), `api-contracts` (tRPC routers), `auth`, `types`,
  `logger`, `config-*`.
- **Event-sourced?** STInventory's append-only `transactions` core does not map 1:1 onto
  the timesheet domain — but `timesheet_userdate`/`daily_entry`/`equipmentsused`/
  `trucks` are already append-mostly and the **modification log** (`timesheet_update_log`)
  and `approval_history` are an audit trail. Recommendation: keep the existing
  current-state tables + explicit audit tables (simpler port), add a `transactions`-style
  audit row only where legacy lacked it (verify state changes).
- **Two API generations collapse into one tRPC surface.** Use the v2 routes as the
  contract template; port gen-1 business logic (entry engine, POD grid, PO export,
  Foundation delta, reports) into tRPC routers.
- **Data migration:** MySQL dump → Postgres; **MD5 → argon2 via rehash-on-login**
  (same trick as STInventory's bcrypt-rehash); `qty_complete` accumulation re-derived.
  Foundation staging tables recreated as sync tables, not served data.
- **Reports:** each report becomes a tRPC procedure + a page under `/reports` with a
  registry (mirror `apps/web/app/(app)/reports/registry.ts`).
- **Mobile:** Flutter kept for cutover; Expo port is a follow-on (or fold into the plan
  below as Phase 5 if mobile parity is required).

---

## 5. Delivery plan (~28–36 week calendar, overlapping phases)

Phases overlap intentionally (same shape as STInventory's 24-week plan).

| Phase | Weeks | Deliverable | Acceptance |
|---|---|---|---|
| **0 — Schema + migration + scaffold** | 1–3 | Reverse-engineered Postgres/Drizzle schema (~70 tables), MySQL→PG migration script, MD5 rehash-on-login, monorepo scaffold (Hono+tRPC+Next), session auth + 7-role RBAC matrix | Real prod dump migrates; login works for all 7 roles |
| **1 — Timesheet core + master data** | 3–10 | Master-data CRUD (users/projects/phases/costcodes/units/vendors/equipment); 5-tab entry engine in one transaction (`timesheet_userdate`+`daily_entry`+`daily_entry_resource`+`equipmentsused`+`trucks`+`daily_absent`+`subcontractor`+`qty_complete`); draft/submit/verify state machine; modify/view/delete + modification log; pictures upload | A foreman enters a full day with labor+material+equipment+report+pictures and it verifies |
| **2 — Reports pack (the moat)** | 9–16 | ~25 reports, led by weekly-by-dates payroll pivot, compact, equipment weekly, analysis, material, overtime, missing, on-time, verification, modification, PO log, project dashboard | Weekly payroll numbers reconcile against legacy for 4 weeks |
| **3 — Operational modules** | 12–22 | Purchase orders (+export/PO numbers/log), equipment modules (mechanic work orders + parts + photos), equipment templates, plan management + POD, crew/org templates, JSA/JHA (+Hot Work/LOTO/Confined Space + signatures + PDF), geofencing (Leaflet or MapLibre), email module mgmt + scheduled jobs → worker, files/doc viewer, inquiry forms, filters, tokens, admin super-powers | Each module's key flow passes an operator drill |
| **4 — Integrations** | 18–26 | FoundationSoft bridge (MSSQL via `tedious`/SQL-auth or SFTP file exchange + delta logic + sync logs), PTO read-through, queue-backed scheduled emails | Foundation sync run against real ERP; delta audit logs match legacy |
| **5 — Mobile (optional)** | 20–28 | Expo RN replacement of the Flutter app (~35 screens: 5-tab entry, dashboard, plan, JHA, mechanic) — **or skip and keep Flutter** | Feature parity on Android tablets |
| **6 — Hardening + cutover** | 24–36 | Security pass (parameterized queries, auth on every router, upload validation, rate limits, secrets out), test suite, CI (typecheck+test+images+smoke), prod images, **parallel-run with shadow writes**, weekly reconciliation, training, hypercare | Two weeks of clean parallel run; Urban signs off |

---

## 6. Team & effort estimate (Bodhi-style table)

Same rate structure as STInventory proposal §5. Effort assumes the STInventory
platform (Hono/tRPC/Next/Drizzle) as the base so scaffold cost is low.

| Phase | Calendar wks | Hours (blended ~4.3 FTE) |
|---|---|---|
| 0 — Schema + migration + scaffold + auth | 3 | 550 |
| 1 — Timesheet core + master data | 7 | 1,400 |
| 2 — Reports pack | 7 | 1,200 |
| 3 — Operational modules | 10 | 1,700 |
| 4 — Integrations | 6 | 800 |
| 5 — Mobile (only if Expo port chosen) | 8 | 700 |
| 6 — Hardening + cutover | 6 | 900 |
| **Total (incl. overlap ~0.8× serial)** | **28–36** | **5,600–7,200** |

Fee at Bodhi blended ~$45/hr ≈ **$255K–$330K**. A US/EU agency equivalent would quote
~2.5× that ($650K–$850K). Add **+$25–40K** if the Expo mobile port is in scope; **–0** if
Flutter is kept.

---

## 7. Risks & decisions to resolve before/at kickoff

1. **Data integrity of the legacy DB** — no dump in repo; migration depends on a live
   prod dump + 4-week reconciliation of payroll numbers. Get the dump under version
   control before starting.
2. **FoundationSoft access** — ODBC runs from a Windows box today; Node needs
   `tedious`/SQL-auth credentials or an SFTP/file export from Foundation. Foundation owns
   the window.
3. **Devonian/Optixtec tenant** — second tenant with different service URL. Decide: fold
   into the same deployment (multi-tenant-ready, RLS off) or one product per tenant.
4. **Flutter keep-vs-port** — keeping it saves ~700h but strands the frozen app on a
   stale stack; porting to Expo unifies the client story with STInventory. **Recommend:
   keep for cutover, port as Phase 2 product work.**
5. **Scope cuts available if budget-constrained:** drop the annotated PDF doc viewer,
   drop geofencing, defer the 3 least-used reports, ship mobile parity later.
6. **Legacy `daily_timesheet_entry` mobile payload vs web `entry_timesheet_new`** — two
   slightly different write paths in legacy; the port must unify them (the 6-section
   JSON is the superset).
7. **Verification state machine** is business-critical and subtle (PM verify, super
   re-verify, notes, modification log) — treat it as a first-class state chart in
   `packages/domain`, not ad hoc checks.

---

## 8. What NOT to port

- The abandoned RabbitMQ consumer (replace with direct write or a queue only if needed).
- The broken `foundationlogservice.php` SQL and `v2/src/Controller/test.php` kitchen sink.
- Per-role duplicate HTML pages (the 7-dashboard duplication collapses into one React
  surface gated by role).
- `savetofile.php` / `testmail.php` / `connections/testmysql.php` / `test.php`(phpinfo)
  — security holes, not features.
- TCPDF (replace with a modern PDF path only if document store is ported).
- The nested, disconnected `urbaniconstruction-app` Flutter prototype unless its
  procurement flow is wanted.

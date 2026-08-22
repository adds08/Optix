/* Generates jira-import.csv and jira-import.json from one source of truth,
   so the two files cannot drift apart. Run: node gen-jira.js <outDir> */
const fs = require("fs");
const path = require("path");

const EPICS = [
  { key: "STI-000", name: "E0 Custody integrity", pts: 21, pri: "Highest",
    desc: "Not one of the eleven deliverables, and non-negotiable anyway. Every deliverable reads custody state, and four defects currently make that state untrustworthy. Building reporting on top of them multiplies the error." },
  { key: "STI-100", name: "E1 Entity and user administration", pts: 34, pri: "Highest",
    desc: "Deliverable 1. Master-data CRUD largely exists. User administration does not exist at all, and four of the ten declared roles cannot log in. That is the epic." },
  { key: "STI-200", name: "E2 Foundation identity and load", pts: 26, pri: "High",
    desc: "Deliverables 2 and 8. Deliverable 8 is not a separate feature: it is the identity rule that makes the Foundation load safe, so the two are one epic." },
  { key: "STI-300", name: "E3 Alerts and assignment gaps", pts: 21, pri: "High",
    desc: "Deliverable 3. The notification table and in-app centre exist; delivery is a console.log that then marks the row delivered. Critical-gap detection does not exist." },
  { key: "STI-400", name: "E4 Org structure and departure", pts: 34, pri: "High",
    desc: "Deliverable 4. project_team_member and the assignment hierarchy already work. Missing: the departure path, and a management view built for the Equipment department." },
  { key: "STI-500", name: "E5 Custody context and rig model", pts: 29, pri: "Highest",
    desc: "Deliverables 6 and 7, and the schema blocker for four other epics. Backtracking tool to trailer to truck is impossible today: assignment carries one nullable location_id and cannot hold a truck and a trailer at once." },
  { key: "STI-600", name: "E6 Purchase order attachments", pts: 16, pri: "Medium",
    desc: "Deliverable 5, deliberately small. File attachments and a searchable PO number. This is NOT procurement: no requisition, approval chain, vendor workflow or receipt." },
  { key: "STI-700", name: "E7 Project scoping", pts: 13, pri: "High",
    desc: "Deliverable 10. project_group and visibleProjectScope exist. This epic extends scoping to every remaining procedure and makes the switcher consistent." },
  { key: "STI-800", name: "E8 Permissions and role surfaces", pts: 26, pri: "Highest",
    desc: "Deliverable 11. Runs through every screen. The permission matrix is the critical path for four other epics." },
  { key: "STI-900", name: "E9 Dashboard tabs and generated views", pts: 34, pri: "Highest",
    desc: "Deliverable 9, the largest piece of new product. Tabs become data rather than an enum, panels are declared in a registry, and a PM can generate a view in words. Promoted to Sprint 2 on Urban's call." },
  { key: "STI-1000", name: "E10 Blocky design language", pts: 21, pri: "High",
    desc: "ADR-7. The product's visual language becomes Blocky: 3-4px radius, monospace numerals, dense rows, coloured left edge bars, zebra tables, bare status text. The shadcn LOOK is dropped; the Radix primitives underneath it are kept, so accessibility and component behaviour are unaffected." },
];

const S = (key, epic, summary, pts, pri, labels, desc, ac, cases, deps) =>
  ({ key, epic, summary, pts, pri, labels, desc, ac, cases: cases || [], deps: deps || [] });

const STORIES = [
  // ---- E0
  S("STI-001", "STI-000", "Make custody writes atomic", 5, "Highest", ["custody", "data-integrity"],
    "Custody executes three consecutive unwrapped statements: close the old assignment, open the new one, append the ledger event. A failure between any two leaves register and ledger permanently and silently disagreeing. Import already does this correctly inside a transaction; custody does not. Wrap it, take a row lock (SELECT ... FOR UPDATE) so concurrent writers cannot interleave, and validate the transition against the pure rules in packages/domain before writing anything.",
    ["Every caller routes through one function: assignment.create, transfer.create, transfer.approve, the chat executor, and the import commit",
     "An injected failure at each of the three write points leaves the database unchanged",
     "The ledger event carries a COMPLETE to_state. foldAssetState is last-snapshot-wins, not field-wise; a partial snapshot silently erases fields. This bug has shipped twice",
     "Notification dispatch happens after commit; a failing notifier must not roll back custody"],
    ["Two desk operators assign the same tool simultaneously: one wins, one gets a clean conflict error, no duplicate active row",
     "Asset has no active assignment (first issue from the yard): current is null and the transition validator accepts it"], []),
  S("STI-002", "STI-000", "Enforce one active assignment per asset at the database", 5, "Highest", ["custody", "data-integrity", "migration"],
    "The invariant is stated in three documents and enforced nowhere. Duplicates already exist in live data, so the index cannot simply be added: the backfill must choose a survivor first. CREATE UNIQUE INDEX CONCURRENTLY assignment_one_active_uq ON assignment (asset_id) WHERE status = 'active'.",
    ["The duplicate report is produced and reviewed WITH the Equipment department before any row is touched. Which of two active assignments survives is a per-tool judgement about where the tool physically is. It is not a script and must not be automated",
     "Each correction is written as a compensating ledger event, never an UPDATE or DELETE on history",
     "The index exists and a second active insert fails at the database, not in application code",
     "CONCURRENTLY, so the migration does not lock the table"],
    ["Backfill finds a tool nobody can locate: it becomes 'lost', a real state, rather than being force-assigned to whoever appears first in the table"], []),
  S("STI-003", "STI-000", "Make the ledger append-only at the database", 3, "High", ["custody", "data-integrity"],
    "Append-only is currently a code comment. Revoke the grants so it becomes a property of the database: REVOKE UPDATE, DELETE ON transaction FROM app_role.",
    ["Application UPDATE/DELETE against transaction fails",
     "Migrations run under a role that still holds DDL rights",
     "A rejected write surfaces as a typed error, not a 500"], [], []),
  S("STI-004", "STI-000", "Scheduled projection reconciliation", 5, "High", ["custody", "data-integrity"],
    "Invariant 4 says folding the ledger from the beginning reproduces the current register exactly. Nothing proves it. A scheduled job folds every asset and compares against the projection.",
    ["Runs nightly",
     "A non-empty result raises a desk alert naming the divergent assets",
     "The job is read-only. It reports drift and never silently repairs it, because a silent repair destroys the evidence of the bug that caused the drift"], [], ["STI-001"]),
  S("STI-005", "STI-000", "Commit outstanding migrations and fail CI on drift", 3, "Highest", ["ci", "migration"],
    "Two migrations are uncommitted, so production may not match main. CI should have caught it. This is free and should be done on day 1.",
    ["Outstanding migrations committed",
     "Deployed schema verified against main",
     "CI job fails when drizzle generate produces a non-empty diff"], [], []),

  // ---- E1
  S("STI-101", "STI-100", "User administration", 8, "Highest", ["deliverable-1", "identity"],
    "There is no screen for creating a user, granting a role, deactivating someone or resetting a password. Every account today came from the seed. Build CRUD over the existing user / role / user_role tables.",
    ["Create user (email, employee link, role), assign and revoke roles, deactivate, reset password",
     "Deactivation ends sessions immediately. A deactivated user with a live token is a departed employee still holding access",
     "Deactivating a user who holds tools is refused, and the error names STI-402 as the path. Custody must land somewhere before access is removed",
     "Password reset issues a single-use expiring token; bcrypt cost 12 matching login",
     "Every action writes an audit event with the acting user"],
    ["The last owner account cannot be deactivated or stripped of its role: a tenant with no administrator is unrecoverable",
     "Email already in use: typed field error, not a constraint violation surfacing as a 500"], []),
  S("STI-102", "STI-100", "Add the missing login roles", 5, "Highest", ["deliverable-1", "identity", "rbac"],
    "ROLES declares ten but ROLE_PERMS covers only some, so the rest cannot log in usefully. Bodhi Labs has PROPOSED the three open definitions for Urban's confirmation (drafted in docs/workings/PERMISSION_MATRIX.md; still BLOCKED on Urban as of 2026-08-22 - do not treat as agreed): an ENGINEER is a PM with a different operational purpose and an identical relationship to small tools, so it takes the project_manager permission set and exists separately only so the two can diverge later without a migration. A MECHANIC is an Equipment department employee who holds and uses tools like a foreman, but for repair rather than construction, and whose tools charge to the DEPARTMENT rather than a project. ADMIN resolves to three distinct roles: System Administrator (the developers who build this system), Equipment Administrator (owns the tools programme) and Office Administrator (operations and accounts).",
    ["Every role in ROLES has an explicit permission set; no role falls through to empty",
     "engineer is added, taking the project_manager permission set and the assets.view.project scope",
     "mechanic is added as a login role, holding assets.view.own and repair actions. Its cost target defaults to department, not project — the schema already supports this (docs/built/11-department-cost-targets.md), so only the default needs wiring",
     "system_administrator, office_administrator and equipment_administrator are DISTINCT roles. No procedure branches on the name 'admin'",
     "seed.ts ROLE_PERMS matches docs/workings/PERMISSION_MATRIX.md exactly"], [], ["STI-801"]),
  S("STI-103", "STI-100", "Equipment entity management: trucks and trailers", 5, "High", ["deliverable-1", "fleet"],
    "Trucks and trailers are vehicle rows 1:1 with a location row. CRUD exists but the desk cannot see fleet-wide state or find an unassigned unit. Scope boundary: these are moving locations for tools, NOT a fleet module. No maintenance schedules, mileage or fuel.",
    ["List and filter by type, ownership (company_owned | personal_allowance) and assignment status",
     "'Unassigned' is a first-class filter: it is what the desk actually searches for",
     "Personal vehicles are visually distinct everywhere; they are not Urban property and behave differently on departure",
     "Deleting a vehicle carrying history is refused, naming the status change to use instead"], [], []),
  S("STI-104", "STI-100", "Small tools entity management hardening", 5, "Medium", ["deliverable-1"],
    "Bulk operations and delete safety on the tool register.",
    ["Bulk edit of category and department across a selection",
     "tag remains optional and is never generated. A tag is a physical label, not an identity; asset.id is identity",
     "Delete refuses anything with history"], [], []),
  S("STI-105", "STI-100", "Project entity management", 3, "Medium", ["deliverable-1"],
    "Project CRUD with lifecycle guards.",
    ["Job ID and name shown together everywhere via idName()",
     "Status transitions awarded -> active -> closing -> complete",
     "A project with active assignments cannot be completed without naming where the tools go"], [], []),
  S("STI-106", "STI-100", "Entity management integration test harness", 8, "High", ["testing"],
    "apps/api and apps/web have no test script. Every existing test is a pure-function unit test, so nothing exercises a router, a database or a screen. This story builds the first integration layer; later epics extend it.",
    ["Router-level integration tests against a real Postgres for every entity mutation in this epic",
     "pnpm test runs them in CI",
     "Tenant isolation asserted on every list procedure"], [], []),

  // ---- E2
  S("STI-201", "STI-200", "External reference model", 5, "High", ["deliverable-2", "deliverable-8", "foundation", "migration"],
    "external_id today is a nullable NON-UNIQUE text column on exactly two tables (project, employee). It cannot prevent a duplicate, cannot say which system a value came from, and cannot record when it was last confirmed. Three entry paths must converge on one identity rule: synced from Foundation (external_ref is authoritative), imported from spreadsheet (matched on natural key, adopts a ref later), added by hand (no ref until a sync adopts it).",
    ["external_system, external_id, source and last_synced_at on project, employee, cost code and phase",
     "Uniqueness enforced per (tenant, system, type, native_id), partial so hand-entered rows with no ref are unconstrained",
     "Fields owned by Foundation become read-only in the UI once an external_ref exists, so a local edit cannot diverge and then be silently overwritten by the next sync"], [], []),
  S("STI-202", "STI-200", "Idempotent Foundation load", 8, "High", ["deliverable-2", "deliverable-8", "foundation"],
    "Re-running a load must update, never duplicate. Unmatched rows are surfaced for a human, never dropped: a dropped row is silent data loss nobody discovers until a report is wrong. Match on external_ref first, then fuzzy-match on name plus job number to adopt pre-existing hand-entered rows.",
    ["Loads projects, phases, cost codes and users over the ODBC connection from STI-205",
     "Running the same export twice produces zero creates on the second pass. This is the headline test",
     "Every unmatched row appears in the report with a stated reason",
     "The whole load is one transaction: a partial load is worse than none",
     "Reuses the existing preview -> commit shape in routers/import.ts, which already does typed validation, dedup and transactional commit well. Because the transport is a live query rather than a file (ADR-8), the same code path serves the one-time load and every later refresh"],
    ["Foundation renames a project: matched on external_ref, name updated, no duplicate",
     "Two Foundation rows carry the same native_id: the load aborts and names both. Do not guess",
     "A hand-entered project fuzzy-matches a Foundation row: adopted, and the adoption is recorded as a ledger event so it can be audited later"], ["STI-201"]),
  S("STI-203", "STI-200", "Load preview and report screen", 5, "Medium", ["deliverable-2", "foundation"],
    "The load must be inspectable before it commits, and its unmatched rows must be resolvable without a developer.",
    ["Dry-run preview showing created / updated / unmatched before commit",
     "Unmatched rows are individually resolvable: adopt, skip, or create new",
     "The report is downloadable"], [], ["STI-202"]),
  S("STI-204", "STI-200", "Foundation load tests", 5, "High", ["deliverable-2", "testing"],
    "Idempotency is asserted, not assumed.",
    ["Fixture-driven coverage: fresh load, re-run, renamed entity, conflicting ref, adoption path"], [], ["STI-202"]),
  S("STI-205", "STI-200", "Foundation ODBC connection and field mapping", 3, "High", ["deliverable-2", "foundation", "adr-8"],
    "ADR-8: Foundation is reached over its ODBC database layer, not a file drop. Urban already runs a PHP sync against it, and that script is the reference for table and column mapping. Stand up a read-only connection and write the mapping down. Whether the PHP is kept as a sidecar or ported into the monorepo is deferred — it changes who runs the sync, not what the sync means.",
    ["Read-only ODBC connection from a service account. STInventory NEVER writes to Foundation",
     "Credentials handled as secrets, never in the repo. The PHP script's auth is the open item standing between this and a working sync — resolve it here",
     "Field mapping written down: Foundation table and column to STInventory entity and field, for projects, phases, cost codes and users",
     "Connection failure is a loud, typed error, never a silent empty result set — an empty sync that looks successful would mark every entity as unmatched"],
    ["Foundation is unreachable at sync time: the load aborts and reports, leaving prior data intact"], []),

  // ---- E3
  S("STI-301", "STI-300", "Gap detection engine", 8, "High", ["deliverable-3", "alerts"],
    "A scheduled pass over the current projection, expressed as independent rules so a new check is a new rule and not a new job. Rules cover: foreman with no truck, foreman with no trailer, project with no foreman, project with no PM, tool out with no custodian, assignment not confirmed in 30 days.",
    ["Alerts are idempotent by (rule, subject). Re-running the pass does not multiply alerts. This is the failure mode that makes people stop reading them",
     "An alert self-clears when the condition resolves. Nobody dismisses a gap manually",
     "Severity drives placement: crit on the desk and dashboard, warn in the alert list, info in the digest only",
     "Adding a rule requires no change to the scheduler"],
    ["A foreman with no truck who is also on no project: one alert, not two, and the project rule does not fire for an unassigned person",
     "A project completes with open gaps: alerts resolve on completion rather than lingering"], ["STI-501"]),
  S("STI-302", "STI-300", "Real notification delivery", 5, "High", ["deliverable-3", "alerts"],
    "Replace the console stub with a provider interface that has at least one working implementation. Mark delivered_at from the provider's response, not optimistically before the call. The current stub is worse than no delivery because the record claims success.",
    ["Email delivery works against a real provider",
     "Failures are retried with backoff and surfaced after N attempts",
     "delivered_at reflects reality",
     "Per-tenant enable flags (email_enabled, sms_enabled) are honoured",
     "SMS may remain an unimplemented interface if Urban has no provider yet, but it must fail loudly rather than log and claim success"], [], []),
  S("STI-303", "STI-300", "Desk alert surface", 5, "High", ["deliverable-3", "alerts", "ui"],
    "Critical alerts need one place that the Equipment desk actually looks at.",
    ["Critical alerts appear on the desk grouped by severity then project",
     "Each alert names its subject and links to the screen that resolves it",
     "The count is visible in the nav badge"], [], ["STI-301"]),
  S("STI-304", "STI-300", "Alert preferences", 3, "Low", ["deliverable-3", "alerts"],
    "Per-user control over non-critical noise.",
    ["Per-user, per-rule opt-out for warn and info",
     "crit cannot be muted. The point of a critical alert is that it is not optional"], [], ["STI-301"]),

  // ---- E4
  S("STI-401", "STI-400", "Equipment department management view", 8, "Highest", ["deliverable-4", "ui"],
    "One screen where the Equipment department assigns foremen to projects and rigs (truck plus trailer) to foremen. /jobsites is the closest existing surface. The interaction model comes from the Blocky concept in design/README.md: the gap is the affordance. A crew with no truck renders a clickable '+ truck' chip where the value would be, opening an inline picker of unassigned vehicles. No modal, no navigation.",
    ["Job -> crew -> tools, three levels, on one page. Jobs open by default, crews closed",
     "Assign and unassign foreman, truck and trailer inline; every change writes a ledger event",
     "The vehicle picker offers only genuinely unassigned units",
     "'Needs vehicle' filter, because that is the department's morning question"], [], ["STI-501"]),
  S("STI-402", "STI-400", "Departure reassignment", 8, "Highest", ["deliverable-4", "custody"],
    "When a foreman leaves, everything they hold moves in ONE auditable action, not tool by tool. The successor comes from the reporting chain by default (superintendent, then PM). Personal vehicles are never reassigned: they are not Urban property and they leave with the person.",
    ["One transaction. Partial reassignment is the failure this replaces",
     "Successor defaults to superintendent, then PM; if neither exists the action stops and demands an explicit choice rather than guessing",
     "Personal vehicles are skipped AND listed in the result so the desk knows what walked",
     "A preview shows exactly what will move, before it moves",
     "Ends the leaver's sessions"],
    ["The successor is themselves inactive: refused, with a named alternative",
     "Leaver holds a trailer containing tools: the trailer moves and its contents follow, which is what physically happens",
     "Leaver holds nothing: succeeds quietly and still deactivates the account"], ["STI-001", "STI-101"]),
  S("STI-403", "STI-400", "PM and superintendent management views", 5, "High", ["deliverable-4", "ui"],
    "The project side of the org structure, scoped by permission rather than by role name.",
    ["A PM sees their projects, teams and rigs and can assign superintendents and foremen within the existing hierarchy",
     "A superintendent sees their crews and can assign foremen",
     "Both are scoped by permission (STI-802), not by role name"], [], ["STI-802"]),
  S("STI-404", "STI-400", "Temporary assignment on departure", 5, "Medium", ["deliverable-4", "custody"],
    "The specific case Urban named: a foreman is dismissed and custody goes temporarily to their superintendent, then to the PM if there is no superintendent.",
    ["A reassignment can be flagged temporary with a review date",
     "Temporary holdings appear on the desk as an open item",
     "A temporary holding older than the SLA raises a warn alert"], [], ["STI-402"]),
  S("STI-405", "STI-400", "Org structure and departure tests", 8, "High", ["deliverable-4", "testing"],
    "Departure has more branches than any other flow in the system and each one loses tools if it is wrong.",
    ["Integration coverage for the full assignment hierarchy",
     "Every departure branch: with and without successor, personal vs company vehicle, trailer with contents, inactive successor"], [], ["STI-402"]),

  // ---- E5
  S("STI-501", "STI-500", "Truck and trailer as first-class assignment fields", 8, "Highest", ["deliverable-6", "deliverable-7", "migration", "blocker"],
    "Split assignment.location_id into independently nullable truck_id and trailer_id. Both are recordable at once because both are true at once: a tool sits in a trailer that is towed by a truck. THE MIGRATION RISK IS THE FOLD, NOT THE COLUMNS. Ledger snapshots are historical and must never be rewritten, so foldAssetState has to handle the old single-location_id shape and the new one, forever. Blocks STI-301, STI-401, STI-503.",
    ["Both columns exist, independently nullable, independently recordable",
     "Every reader of location_id is migrated. Grep for it; leave none",
     "The fold reads old and new snapshot shapes; a test pins an old-shape event replaying correctly",
     "Backfill maps existing location_id to whichever column matches the row's vehicle_type",
     "Company vs personal truck is visible wherever a truck is shown, because that distinction drives STI-402"],
    ["A snapshot predating this change folds without loss",
     "A tool on a truck with no trailer, and a tool in a trailer parked in the yard with no truck: both are legal states and both render"], ["STI-001"]),
  S("STI-502", "STI-500", "Rig model: truck, trailer and foreman", 5, "High", ["deliverable-7", "migration"],
    "Deliverable 7's redundancy point. A rig is one truck, one trailer, one foreman. Rather than storing that triple on every tool, store the rig once and derive tool -> trailer through the holder. The governing rule for this epic: store what varies independently, derive what does not.",
    ["A partial unique index enforces one active truck and one active trailer per foreman",
     "The assignment's explicit trailer_id OVERRIDES the derived rig value. A tool can be somewhere other than its holder's usual trailer and the record must be able to say so",
     "Changing a foreman's rig does NOT rewrite historical assignments. History records where a tool was, not where it would be today"],
    ["Foreman swaps trailers mid-job: new assignments pick up the new trailer, closed ones keep the old. This is the difference between a ledger and a spreadsheet",
     "Two foremen sharing one truck: refused by the index, with an error naming the current holder"], ["STI-501"]),
  S("STI-503", "STI-500", "Backtrack view: tool to trailer, truck, project and PO", 8, "Highest", ["deliverable-6", "ui"],
    "Deliverable 6, finally answerable. From any tool, resolve the full custody context (holder, project, truck, trailer, PO, since) and its complete history. Derived values fall back through the holder's rig when the assignment does not name them explicitly.",
    ["Reachable from the tool detail page and from every table row that shows a tool",
     "Shows current context AND full history: each prior holder, project, truck and trailer, with dates",
     "Derived values are visually marked as derived, so nobody mistakes an inference for a record",
     "Works in reverse: from a trailer, list every tool currently in it"], [], ["STI-501", "STI-502"]),
  S("STI-504", "STI-500", "Drop the redundant custodian mirror", 3, "Medium", ["deliverable-7", "migration"],
    "vehicle.foreman_employee_id mirrors location.custodian_employee_id for the same physical thing. The schema comment already admits the location column is authoritative and the mirror exists only because three screens read it. Two writers, one truth: they will drift.",
    ["One authoritative column",
     "Readers migrated",
     "The other column dropped in the same migration"], [], []),
  S("STI-505", "STI-500", "Custody context tests", 5, "High", ["deliverable-6", "testing"],
    "The fold is the highest-consequence pure function in the system and this epic changes its input shape.",
    ["Fold tests across both snapshot shapes",
     "Rig uniqueness enforced",
     "Explicit trailer_id overrides derived rig value",
     "Backtrack correctness over a multi-hop history"], [], ["STI-503"]),

  // ---- E6
  S("STI-601", "STI-600", "Attachment model and storage", 8, "Medium", ["deliverable-5", "migration"],
    "A polymorphic attachment hanging off a project, a foreman or a tool, carrying an optional indexed po_number so the backtrack view can reach it. Scope discipline: this is NOT procurement. No requisition, approval chain, vendor workflow or receipt. Resist every temptation to grow it.",
    ["Upload, list, download and delete (soft: an attachment is evidence)",
     "Type and size limits enforced server-side; PDF and common image types",
     "Storage keys are opaque and non-guessable; downloads are authorised per request, never served from a public path",
     "Filenames are sanitised; the original is preserved for display only",
     "Every upload and delete writes an audit event"],
    ["The same PO number on several attachments across projects is legal, and searching the number returns all of them",
     "Upload arriving after the subject is deleted is rejected cleanly"], []),
  S("STI-602", "STI-600", "Attachment UI", 5, "Medium", ["deliverable-5", "ui"],
    "The attachment panel wherever a PO might be filed.",
    ["An attachments panel on project, foreman and tool detail",
     "Drag-and-drop with visible progress",
     "PO number is an editable field on the row"], [], ["STI-601"]),
  S("STI-603", "STI-600", "PO number search and backtrack link", 3, "Medium", ["deliverable-5", "deliverable-6"],
    "The PO number is the handle that makes an attachment findable rather than merely stored.",
    ["PO number is searchable from global search and returns tools, projects and foremen",
     "The STI-503 backtrack view shows the PO when one exists"], [], ["STI-601", "STI-503"]),

  // ---- E7
  S("STI-701", "STI-700", "Scope every list procedure", 5, "Highest", ["deliverable-10", "security"],
    "project.list is scoped server-side, but the KPI dashboard and several reports ignore project scoping entirely, so a PM currently sees fleet-wide numbers.",
    ["Every list and report procedure applies visibleProjectScope",
     "Authorisation is applied to the query BEFORE execution, never as a post-filter over results",
     "A test asserts a PM cannot retrieve another project's tools through any procedure"], [], ["STI-802"]),
  S("STI-702", "STI-700", "Project and group switcher consistency", 3, "Medium", ["deliverable-10", "ui"],
    "One switcher, one selected scope, honoured everywhere.",
    ["One switcher, one selected scope, respected by every screen including reports and the dashboard",
     "The selection survives navigation and reload"], [], ["STI-701"]),
  S("STI-703", "STI-700", "Scoping matrix tests", 5, "High", ["deliverable-10", "testing", "security"],
    "This is the test that catches a cross-tenant leak before a second tenant exists.",
    ["A matrix test: for each role and each scope, assert exactly which projects are visible through every list procedure"], [], ["STI-701"]),

  // ---- E8
  S("STI-801", "STI-800", "Agree the permission matrix with Urban", 3, "Highest", ["deliverable-11", "rbac", "blocker", "decision"],
    "THIS IS A MEETING AND IT IS THE CRITICAL PATH. Book it for working day 2. STI-102, STI-403, STI-701 and STI-802 are all blocked on the output. Escalate on day 3 if it has not happened.",
    ["A written matrix: every role against every permission, signed off by Urban",
     "Resolves the three 'admin' identities separately: System, Office and Equipment Administrator",
     "ANSWERS WHAT AN ENGINEER MAY DO. The role appears in Urban's requirements and nowhere in the codebase, and nobody has yet defined it",
     "Confirms whether mechanics log in or only hold tools. Holding custody and having an account are different things"], [], []),
  S("STI-802", "STI-800", "Replace role-name branching with permission checks", 8, "Highest", ["deliverable-11", "rbac", "security"],
    "The rule is already written in AGENTS.md and is not held everywhere. Scope resolution should read has_permission(actor, 'assets.view.all' | '.project' | '.crew' | '.own') and fall through in that order, never comparing role names.",
    ["No actor.role == '...' comparison survives in routers or components. Grep is the test",
     "New scope permissions (assets.view.all, .project, .crew, .own) are added and seeded",
     "Adding a role requires no code change"], [], ["STI-801"]),
  S("STI-803", "STI-800", "Role-shaped navigation", 5, "Medium", ["deliverable-11", "rbac", "ui"],
    "nav-config.ts has two shapes, FIELD_NAV and DESK_NAV, and is explicit that this is deliberate: two shapes of navigation, not one list with items hidden. A PM falls through to DESK_NAV and gets the equipment administrator's surface. Whether the PM gets a THIRD shape is an open design question (see design/README.md); default to project scoping doing the work unless Urban says otherwise.",
    ["Navigation is composed from permissions",
     "A user never sees a link they cannot open"], [], ["STI-802"]),
  S("STI-804", "STI-800", "RBAC matrix test", 5, "High", ["deliverable-11", "rbac", "testing"],
    "The matrix and the test must not be able to drift apart.",
    ["For every role and every procedure, assert allowed or denied",
     "Generated from the STI-801 matrix so the test and the document cannot drift"], [], ["STI-801", "STI-802"]),
  S("STI-805", "STI-800", "Permission-aware UI affordances", 5, "Medium", ["deliverable-11", "rbac", "ui"],
    "Actions a user cannot perform should be absent rather than present-and-failing.",
    ["Actions the user cannot perform are absent, not present-and-failing",
     "Server-side authorisation is unconditional regardless of what the UI renders. A hidden button is a usability affordance, never a security control"], [], ["STI-802"]),

  // ---- E9
  S("STI-901", "STI-900", "Custom dashboard tabs", 8, "Medium", ["deliverable-9", "dashboard", "migration"],
    "Today user_preferences.dashboard holds { widgets, defaultTab } where defaultTab is one of two hard-coded values. Tabs become data: a DashboardTab row per user with name, position, is_default and an ordered list of panels.",
    ["Create, rename, reorder and delete tabs; choose a default",
     "Per-user, per-tenant persistence",
     "Deleting the last tab is refused",
     "Reorder is optimistic with a pending guard. The job-group tick bug, where rapid consecutive changes were dropped, is the precedent to avoid"], [], []),
  S("STI-902", "STI-900", "Panel registry", 5, "Medium", ["deliverable-9", "dashboard"],
    "Panels are declared, not hard-coded per role, so Release 2 adds panels without touching role logic. Each registry entry pairs a panel id with the permission that gates it.",
    ["A panel the user lacks permission for is not rendered AND not fetched",
     "Adding a panel is one registry entry"], [], ["STI-802"]),
  S("STI-903", "STI-900", "Generated views from natural language", 13, "Medium", ["deliverable-9", "dashboard", "llm", "security"],
    "A PM describes the view they want and the system assembles it from the panel registry. packages/intent already parses natural language, so this extends built work rather than starting a capability. Parse intent, check it against the actor's visible scope, execute a scoped query, then select a panel and stream it. SPLIT THIS IF IT GROWS: 13 points is the ceiling.",
    ["NON-NEGOTIABLE: the model chooses presentation, never scope. Authorisation is applied to the query before execution, never as a post-filter over results, and never delegated to the model",
     "NON-NEGOTIABLE: the LLM never receives raw data it should not see and never emits an ID. It returns labels and spans; resolution to IDs happens server-side under tenant scope, exactly as entity-resolve.ts already does. A hallucinated ID is then impossible by construction",
     "A generated view is savable as a tab panel",
     "An out-of-scope request is refused without revealing that the entity exists",
     "Failure is graceful: an unreachable parser degrades to the manual panel picker and does not break the dashboard"],
    ["'Show me tools on Trinity' from a PM not on Trinity: refused, and the refusal does not confirm Trinity exists",
     "Parser returns malformed intent: validation error, no query runs",
     "Ambiguous entity name: asks rather than guessing"], ["STI-902", "STI-701"]),
  S("STI-904", "STI-900", "Dashboard scoping and default tab", 3, "Medium", ["deliverable-9", "dashboard"],
    "The dashboard must obey the same scope as everything else.",
    ["Every panel honours the STI-701 project scope",
     "The default tab loads on sign-in",
     "The choice is per user"], [], ["STI-701", "STI-901"]),
  S("STI-905", "STI-900", "Generated-view scope tests", 5, "High", ["deliverable-9", "testing", "security"],
    "The generated-view surface is the one place where a user's words influence a query, so scope enforcement is the whole test suite.",
    ["For each role, assert that a generated query cannot reach out-of-scope data through any intent shape, including adversarial phrasing"], [], ["STI-903"]),

  // ---- E10
  S("STI-1001", "STI-1000", "Blocky tokens and restyled primitives", 8, "High", ["design-system", "adr-7", "ui"],
    "ADR-7. Express Blocky in the existing oklch token system in apps/web/app/globals.css rather than adopting the concept's hex values, so light/dark and the reserved status hues (--ok, --warn, --crit, --idle) keep working. Then restyle the shared primitives: radius down to 3-4px, JetBrains Mono for every numeral, 8-10px row density, zebra table rows, bare coloured status text in place of badges, a 3px left edge bar for state. The Radix primitives underneath are NOT replaced.",
    ["Blocky is defined as tokens; no component hard-codes a hex value",
     "Light and dark both work; status hues stay reserved and never decorative",
     "Radix behaviour is untouched: focus traps, keyboard navigation and ARIA on dialog, popover, combobox and dropdown all still pass",
     "A single reference screen is converted end to end to prove the tokens before anything else migrates",
     "Numerals are tabular so columns of tags and counts align"],
    ["A status colour that must survive both themes: verify against the oklch tokens, not the concept's hex",
     "A component with no Blocky equivalent in the concept: derive it from the tokens rather than inventing a second style"], []),
  S("STI-1002", "STI-1000", "Migrate existing surfaces to Blocky", 13, "Medium", ["design-system", "adr-7", "ui"],
    "Convert the built screens to the new language, highest-traffic first: tool register, jobsites, people, reports, inbox, dashboard. New UI is built in Blocky from the start, so this story covers only what already exists. Split it if it grows past 13.",
    ["Every screen uses the Blocky tokens; no screen mixes the two languages",
     "No regression in behaviour: the story is a restyle, not a rewrite",
     "The field app (NativeWind) is explicitly out of scope. ADR-3's follow-up established the two clients share logic, not components"],
    ["A screen whose density cannot survive the tighter rows: raise it in design review rather than keeping an exception in the code"], ["STI-1001"]),
];

/* Which sprint each story is committed to. Capacity, not preference:
   ~3.3 dev FTE x 6 working days = ~20 dev-days = ~60 points for S1. */
const SPRINT = {
  // S1 — committed, ships by 24 Aug. Deliberately backend/schema-heavy:
  // the UI-led stories wait for designs, which are still in progress.
  "STI-005": "S1", "STI-801": "S1", "STI-001": "S1", "STI-002": "S1",
  "STI-501": "S1", "STI-502": "S1", "STI-503": "S1",
  "STI-101": "S1", "STI-301": "S1", "STI-303": "S1",
  // S1 stretch — pulled forward only if S1 lands early. Never at the cost of S1.
  "STI-003": "S1-stretch", "STI-004": "S1-stretch", "STI-504": "S1-stretch",
  /* S2 — the dashboard, promoted on Urban's call. It cannot travel alone: the
     panel registry gates panels by permission and generated views must be
     scope-safe, so STI-802 and STI-701 come with it. Blocky tokens land first
     so the dashboard is built in the new language rather than twice. */
  "STI-1001": "S2", "STI-802": "S2", "STI-701": "S2", "STI-804": "S2",
  "STI-901": "S2", "STI-902": "S2", "STI-903": "S2", "STI-904": "S2", "STI-905": "S2",
  // S3 — roles completed, org structure and departure, Blocky migration
  "STI-102": "S3", "STI-803": "S3", "STI-805": "S3", "STI-702": "S3", "STI-703": "S3",
  "STI-401": "S3", "STI-402": "S3", "STI-403": "S3", "STI-404": "S3", "STI-405": "S3",
  "STI-1002": "S3",
  // S4 — Foundation load, PO attachments, remaining entity management
  "STI-201": "S4", "STI-202": "S4", "STI-203": "S4", "STI-204": "S4", "STI-205": "S4",
  "STI-601": "S4", "STI-602": "S4", "STI-603": "S4",
  "STI-103": "S4", "STI-104": "S4", "STI-105": "S4", "STI-106": "S4",
  "STI-302": "S4", "STI-304": "S4", "STI-505": "S4",
};
/* No commas: Jira's importer treats Sprint as a multi-value field and splits on
   them, which silently truncated every name on the first attempt. */
const SPRINT_NAME = {
  "S1": "S1 Release 1 - by 24 Aug 2026",
  "S1-stretch": "S1 stretch - only if S1 lands early",
  "S2": "S2 Dashboard - permissions and scoping",
  "S3": "S3 Roles - org structure and Blocky migration",
  "S4": "S4 Foundation - PO and entity management",
};
const SPRINT_LABEL = {
  "S1": "sprint-1", "S1-stretch": "sprint-1-stretch",
  "S2": "sprint-2", "S3": "sprint-3", "S4": "sprint-4",
};

/* Urban's Jira tracks time, not story points, so Original Estimate is the field
   that ships. Points stay in this file as the relative sizing the team actually
   argues about; hours are derived from them by one table so the two cannot
   disagree.

   Calibrated so Sprint 1 lands exactly on its capacity: 58 points maps to 160
   hours = 20 developer-days, which is the 3.3 dev FTE x 6 working days figure
   from the build proposal. */
const ESTIMATE_HOURS = { 1: 3, 2: 5, 3: 8, 5: 16, 8: 20, 13: 32 };
/* Jira's CSV importer takes time-tracking fields in SECONDS. A duration string
   like "16h" does not fail the import — it logs
   `WARN Unable to parse original estimate: [16h]` and creates the issue with no
   estimate at all, which is worse than an error because the board then looks
   populated and every sprint reads as zero work. */
const secondsFor = (pts) => hoursFor(pts) * 3600;
const hoursFor = (pts) => {
  const h = ESTIMATE_HOURS[pts];
  if (!h) throw new Error(`no estimate mapping for ${pts} points`);
  return h;
};
const days = (h) => (h / 8).toFixed(1).replace(/\.0$/, "");
for (const s of STORIES) {
  s.sprint = SPRINT[s.key];
  if (!s.sprint) throw new Error(`${s.key} has no sprint assignment`);
}

// ---------- validation ----------
const byEpic = {};
for (const s of STORIES) (byEpic[s.epic] ||= []).push(s);
let total = 0;
for (const e of EPICS) {
  const sum = (byEpic[e.key] || []).reduce((a, s) => a + s.pts, 0);
  if (sum !== e.pts) throw new Error(`Epic ${e.key} declares ${e.pts} but stories sum to ${sum}`);
  total += sum;
}
const keys = new Set(STORIES.map((s) => s.key));
for (const s of STORIES)
  for (const d of s.deps)
    if (!keys.has(d)) throw new Error(`${s.key} depends on unknown ${d}`);
if (new Set(STORIES.map((s) => s.key)).size !== STORIES.length) throw new Error("duplicate story key");

/* A story may never depend on one scheduled later. This is the check that
   caught STI-503 (backtrack) sitting in S1 while the rig model it derives
   from sat in stretch. */
const ORDER = ["S1", "S1-stretch", "S2", "S3", "S4"];
const at = (k) => ORDER.indexOf(SPRINT[k]);
for (const s of STORIES)
  for (const d of s.deps)
    if (at(d) > at(s.key))
      throw new Error(`${s.key} (${s.sprint}) depends on ${d} (${SPRINT[d]}), which is scheduled later`);

/* S1 capacity gate. ~3.3 dev FTE x 6 working days = ~20 dev-days; at 3 points
   per developer-day that is ~60 points, and STI-801 is a meeting, not dev work. */
const S1_HOURS = STORIES.filter((s) => s.sprint === "S1")
  .reduce((a, s) => a + hoursFor(s.pts), 0);
if (S1_HOURS > 160) throw new Error(`S1 is ${S1_HOURS}h (${days(S1_HOURS)}d), over the 160h ceiling`);

// ---------- description rendering ----------
function description(s) {
  const h = hoursFor(s.pts);
  const parts = [
    `Plan ID: ${s.key} | Sprint: ${SPRINT_NAME[s.sprint]} | Estimate: ${h}h (${days(h)}d)`,
    `Full specification: docs/workings/RELEASE_1_SPRINT_PLAN.md`,
    `h3. Mechanism\n${s.desc}`,
  ];
  parts.push("h3. Acceptance criteria\n" + s.ac.map((a) => `* ${a}`).join("\n"));
  if (s.cases.length) parts.push("h3. Cases\n" + s.cases.map((c) => `* ${c}`).join("\n"));
  if (s.deps.length) parts.push(`h3. Depends on\n${s.deps.join(", ")}`);
  parts.push("h3. Definition of done\n* Reachable through the UI by a user with the right permission\n* Custody-affecting changes write a complete ledger event\n* Permissions checked, never role names\n* Authorisation before data access\n* Migrations committed with the code; CI green with no drift\n* Integration tests cover the happy path and the listed cases\n* Lead review");
  return parts.join("\n\n");
}

// ---------- CSV ----------
const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const maxLabels = Math.max(...STORIES.map((s) => s.labels.length), 1);

/* Target Jira is a SCRUM project with key `UI`, which assigns its own issue keys
   on import — so there is no Issue Key column. The plan ID travels in the summary
   as [STI-nnn] and again as a label, which is what keeps an imported UI-42
   traceable back to this document. Epics are linked by Epic Name, not by key,
   because the keys do not exist until the import runs. */
/* Target Jira is the SCRUM project `UI`, which assigns its own issue keys on
   import — so there is no Issue Key column, and epics are linked by Epic Name
   rather than key. The plan ID travels in the summary as [STI-nnn] and again as
   a label, which keeps an imported UI-42 traceable back to this document.

   Deliberately NOT emitted:
   - Sprint. The importer demands a numeric sprint id, and those do not exist
     until the sprints are created on the board. Sprint travels as a label
     (sprint-1, sprint-2, ...) so the backlog can be bulk-moved after import.
   - Story Points. Urban's Jira is time-tracked; Original Estimate carries the
     size instead. */
const LABEL_COLS = maxLabels + 2;                 // + plan id, + sprint
const header = ["Issue Type", "Summary", "Description", "Priority",
  "Original Estimate", "Epic Name", "Epic Link", ...Array(LABEL_COLS).fill("Labels")];
// Original Estimate is emitted in seconds; the readable form is in the description.

const rows = [header.map(q).join(",")];
for (const e of EPICS) {
  rows.push([ "Epic", e.name, e.desc, e.pri, "", e.name, "",
    ...Array(LABEL_COLS).fill("") ].map(q).join(","));
}
for (const s of STORIES) {
  const epicName = EPICS.find((e) => e.key === s.epic).name;
  const labels = [s.key.toLowerCase(), SPRINT_LABEL[s.sprint], ...s.labels];
  rows.push([ "Story", `[${s.key}] ${s.summary}`, description(s), s.pri,
    secondsFor(s.pts), "", epicName,
    ...labels, ...Array(LABEL_COLS - labels.length).fill("") ].map(q).join(","));
}

// ---------- JSON ----------
const bySprint = {};
for (const s of STORIES) (bySprint[s.sprint] ||= []).push(s);

const json = {
  generatedFrom: "docs/workings/RELEASE_1_SPRINT_PLAN.md",
  release: "Release 1",
  targetDate: "2026-08-24",
  totalPoints: total,
  totalEstimateHours: STORIES.reduce((a, s) => a + hoursFor(s.pts), 0),
  note: "Jira is time-tracked: Original Estimate ships, story points do not. Sprint travels as a label because the importer requires numeric sprint ids.",
  sprints: Object.keys(SPRINT_NAME).map((k) => ({
    id: k,
    name: SPRINT_NAME[k],
    label: SPRINT_LABEL[k],
    points: (bySprint[k] || []).reduce((a, s) => a + s.pts, 0),
    estimateHours: (bySprint[k] || []).reduce((a, s) => a + hoursFor(s.pts), 0),
    estimateDays: Number(days((bySprint[k] || []).reduce((a, s) => a + hoursFor(s.pts), 0))),
    stories: (bySprint[k] || []).map((s) => s.key),
  })),
  epics: EPICS.map((e) => ({
    key: e.key, name: e.name, priority: e.pri, points: e.pts,
    estimateHours: byEpic[e.key].reduce((a, s) => a + hoursFor(s.pts), 0),
    description: e.desc,
    stories: byEpic[e.key].map((s) => ({
      key: s.key, summary: s.summary, points: s.pts, priority: s.pri,
      estimateHours: hoursFor(s.pts), estimateSeconds: secondsFor(s.pts),
      originalEstimate: `${hoursFor(s.pts)}h`,
      sprint: s.sprint, sprintName: SPRINT_NAME[s.sprint],
      sprintLabel: SPRINT_LABEL[s.sprint],
      labels: s.labels, mechanism: s.desc, acceptanceCriteria: s.ac,
      cases: s.cases, dependsOn: s.deps,
    })),
  })),
};

const outDir = process.argv[2];
fs.writeFileSync(path.join(outDir, "jira-import.csv"), rows.join("\n") + "\n");
fs.writeFileSync(path.join(outDir, "jira-import.json"), JSON.stringify(json, null, 2) + "\n");
const TH = STORIES.reduce((a, s) => a + hoursFor(s.pts), 0);
console.log(`OK  ${EPICS.length} epics, ${STORIES.length} stories, ${total} pts = ${TH}h (${days(TH)}d)`);
for (const k of Object.keys(SPRINT_NAME)) {
  const h = (bySprint[k] || []).reduce((a, s) => a + hoursFor(s.pts), 0);
  console.log(`    ${k.padEnd(11)} ${String(h).padStart(4)}h  ${days(h).padStart(5)}d  ${(bySprint[k]||[]).length} stories`);
}

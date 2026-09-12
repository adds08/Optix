# STInventory — source-verified issues and gaps

Date of review: 2026-09-12

This document contains only issues and gaps directly supported by the current STInventory source. It does not treat an old planning document, a source-code comment, or a stakeholder preference as proof by itself. Where the source establishes a structural risk but not a reproduced production failure, that limitation is stated. No claim is made here about production data corruption, an exploited security vulnerability, measured response time, or deployed behavior that was not observed.

STInventory was read only during this review. Existing uncommitted changes in its People page and documentation were not modified.

## 1. One person still has multiple overlapping representations called “role”

Severity: high design and maintenance risk. Verified in current schema, API, form, report, and People register code.

The current model separates several real concepts, but it also keeps overlapping legacy representations alive:

- `employee.role` is a legacy text value. Its schema comment says it is no longer the source of truth and says not to add new readers.
- `employee.roleId` references the role register and is described as the person's current role source of truth.
- `user_role` still carries a role for accounts because session authorization reads it; a writer is expected to keep the account and person representations synchronized.
- `employee.companyRoleId` means the HR job title, despite the database name containing “Role.”
- `projectTeamMember.role` is another text field for a role held on one project.

Evidence: [`employee.ts`](../../../STInventory/packages/db/src/schema/employee.ts) defines the deprecated `employee.role`, `employee.roleId`, and HR `companyRoleId`; later in the same file it defines `projectTeamMember.role`. [`employee-form.tsx`](../../../STInventory/apps/web/components/employee-form.tsx) writes both `roleId` and a converted legacy `role` value. The helper can map `project_manager` to `pm`, recognizes a fixed legacy set, and retains a fallback for tenant-defined role names that have no legacy equivalent.

This is more than confusing terminology. A single person edit has to maintain two role values with different expressive ranges. New tenant-defined role names cannot be represented faithfully in the legacy field. Readers that choose different columns can reach different answers about the same person.

The conflict is already visible in report code. The Assets by Mechanic query intentionally reads deprecated `employee.role = 'mechanic'`, because its own source comment says real rows can have `employee.role = 'foreman'` while `roleId` points to `crew`, and a tenant-defined custody tier would appear in neither fixed report. Evidence: [`report.ts`](../../../STInventory/packages/api-contracts/src/routers/report.ts).

What is not proven: this review did not query production rows or establish how many current Urban records disagree. The source itself documents a real-data example, but this document does not independently validate that dataset.

## 2. The People UI still presents an ambiguous “Role” field next to “Job Title”

Severity: high UX and administration risk. Verified in current rendered column/form definitions.

The People table labels the access-role register column simply `Role`, immediately followed by `Job Title`. The employee form also labels the access-role picker `Role`. The code comments understand the distinction, but the user-facing labels do not explain whether “Role” means application access, company responsibility, project responsibility, or HR title.

Evidence: [`people/page.tsx`](<../../../STInventory/apps/web/app/(app)/people/page.tsx>) declares table headers `Role` and `Job Title`; [`employee-form.tsx`](../../../STInventory/apps/web/components/employee-form.tsx) fetches `role.options` and displays the picker label `Role`.

This is specifically hazardous in Urban's organization because Assistant Superintendent and Superintendent can be different HR titles while sharing a project responsibility, and neither fact should silently grant application permissions. The system has distinct Access Roles and Job Tiers settings screens, but the central People edit surface does not carry that precision in its wording.

What is not proven: this review does not claim every operator has made an incorrect assignment. The issue is that the active UI exposes an ambiguous control over a security-relevant value.

## 3. Company codes are still named `externalId` across active API and form contracts

Severity: high integration and migration risk. Verified in current schema-to-API mappings.

The database correctly distinguishes a company-known code from a foreign system identifier: `project.code` and `employee.code` are company identifiers, while separate external-reference records represent provider IDs. Active API contracts nevertheless expose those company codes as `externalId`.

For projects, the list query maps `schema.project.code` to `externalId`; create/update inputs accept `externalId`; server code trims it into the `code` column. The project form stores that value in local state named `externalId` while labeling the input `Project Code`. Evidence: [`project.ts`](../../../STInventory/packages/api-contracts/src/routers/project.ts), [`project-form.tsx`](../../../STInventory/apps/web/components/project-form.tsx), and [`project.ts` schema](../../../STInventory/packages/db/src/schema/project.ts).

The employee router repeats the pattern: API rows expose `employee.code` as `externalId`, and mutation adapters write `externalId` back to `employee.code`. Evidence: [`project.ts`](../../../STInventory/packages/api-contracts/src/routers/project.ts), where the employee router is currently colocated.

This creates a semantic trap at every integration boundary. A future BambooHR or warehouse connector can reasonably interpret `externalId` as the provider's immutable key and overwrite or match against a company code. It also makes generated clients and low-context implementers carry the wrong domain vocabulary even though the database comments have corrected it.

What is not proven: the mapping is internally deliberate and currently consistent in the inspected paths. The issue is semantic debt and collision risk, not proof that a current request writes the wrong column.

## 4. A new user's appearance default depends on which fallback answers first

Severity: medium, user-visible inconsistency. Verified by comparing current web and API defaults.

The web theme catalog defines `DEFAULT_PREFS.fontFamily` as `arial`. The preferences API returns `fontFamily: 'system'` when no preference row exists. The web shell also uses its local default while preference loading fails or before a stored answer is applied.

Evidence: [`themes.ts`](../../../STInventory/apps/web/lib/themes/themes.ts) defines the current client default as Blocky/Arial/comfortable/soft. [`preferences.ts`](../../../STInventory/packages/api-contracts/src/routers/preferences.ts) returns Blocky/system/comfortable/soft for a missing row. [`app-shell.tsx`](../../../STInventory/apps/web/components/sti/app-shell.tsx) applies the local `DEFAULT_PREFS` in fallback paths.

Because `system` is the Inter Tight/JetBrains Mono house pairing while `arial` changes both text and mono slots, this is not a tiny metadata mismatch. First render, API success, API failure, and a newly stored preference can produce materially different typography for a person who never chose a font.

What is not proven: the review did not time a deployed first render or reproduce visible flicker. The conflicting contracts themselves are verified.

## 5. Rig resolution is order-dependent when a foreman has more than one truck record

Severity: high operational ambiguity. Verified in helper and database constraints.

The shared `rigOf()` helper picks the first vehicle in an input list whose type is `truck` and whose `foremanEmployeeId` matches. It does not filter by project, ownership, active selection, or a stable sort. It then resolves the trailer from that chosen truck.

Evidence: [`rig.ts`](../../../STInventory/apps/web/lib/rig.ts) uses `list.find(...)` for both truck and trailer. [`location.ts`](../../../STInventory/packages/db/src/schema/location.ts) enforces only one **company-owned** truck per foreman through a partial unique index. Its comment explicitly permits a personal-allowance truck and a company truck for the same foreman.

Those two rules do not compose deterministically. A state allowed by the database can give the helper multiple matching trucks, and whichever row the unsorted list supplies first becomes the displayed rig. The vehicle list query has no final `orderBy`, so row order is not a defined business rule. Evidence: the `vehicle.list` query in [`location.ts` router](../../../STInventory/packages/api-contracts/src/routers/location.ts).

Potential visible effects include different truck/trailer display after a data/query-order change and a picker/card choosing a personal truck when the dispatcher intended the company rig. This is a verified ambiguity; a specific incorrect production selection was not reproduced.

## 6. Equipment responsibility is duplicated between vehicle and location records

Severity: high consistency risk. Explicitly acknowledged in current schema.

An equipment record has `foremanEmployeeId`, while its associated location has `custodianEmployeeId`. The schema comment says the location value is authoritative and the vehicle field is “kept in sync” because existing pages, forms, and import specifications still read it. It also says the two should eventually be collapsed.

Evidence: [`location.ts`](../../../STInventory/packages/db/src/schema/location.ts), on the vehicle fields around `ownershipType`, `payeeEmployeeId`, and `foremanEmployeeId`.

This is a duplicated writable fact. Every assignment, departure, import, correction, and project move must update both representations through exactly the right path. A missed writer can make the Equipment register and a location/custody reader disagree about who holds the same truck. Even when all current writers are correct, adding a new workflow requires knowing this hidden synchronization contract.

What is not proven: no current drift count was run against a database, so the issue is the structurally duplicated source of truth and documented synchronization obligation, not a claim that rows are presently inconsistent.

## 7. Asset model/manufacturer normalization is vestigial beside active flat fields

Severity: medium schema and import complexity. Explicitly acknowledged in current schema.

The asset table retains `modelId` and normalized `asset_model`/`manufacturer` structures, while the active application uses flat `make`, `modelNumber`, and `description` fields. The schema comment states that nothing reads or writes the normalized relationship except seeding and calls it an apparent duplicate of the flat columns.

Evidence: [`asset.ts`](../../../STInventory/packages/db/src/schema/asset.ts), immediately around `modelId` and the flat make/model fields. A source search found application references to displayed asset models built from the flat fields, not operational joins back through `assetModel`.

This leaves two apparent ways to represent model/manufacturer information, one of which looks authoritative from the relational structure but is not part of active behavior. It increases migration and implementation error risk: a developer can populate the normalized path and see no UI change, or migrate both paths without a defined reconciliation rule.

What is not proven: the unused tables do not by themselves corrupt data or create a performance failure. The verified issue is dead/duplicate modeling with no active ownership contract.

## 8. Maintenance is a status/action, not a maintainable service-case workflow

Severity: high functional gap against the stated equipment-department workflow. Verified by route, schema, action, and UI scans.

STInventory can mark an asset `in_maintenance`, emit `repair_start`, show repair-related activity, and report tools held by mechanics. It does not have a maintenance/service-case table or a maintenance route that records intake, diagnosis/progress, waiting for parts, assigned mechanic, completion decision, or explicit return destination.

Evidence:

- [`apply-action.ts`](../../../STInventory/packages/api-contracts/src/apply-action.ts) handles `repair` by closing active custody and producing a snapshot with status `in_maintenance`, null custodian, and null truck/trailer.
- [`flags.tsx`](../../../STInventory/apps/web/components/sti/flags.tsx) explicitly says there is no maintenance table, so service-due cannot be derived.
- The current web route inventory contains no `/maintenance` page.
- The current schema/router search contains no maintenance-case or service-case table/router.
- Repair controls exist in [`tool-menu.tsx`](../../../STInventory/apps/web/components/tool-menu.tsx), [`report-form.tsx`](../../../STInventory/apps/web/components/report-form.tsx), chat/action code, activity, reports, and status filters, confirming that repair is currently represented through general asset status/events.

The missing model makes the requested lifecycle impossible to represent cleanly: receive at shop; retain or release foreman/project responsibility; record issue; assign mechanic; progress through assessment/repair/waiting; and close only with an explicit disposition. The current chat repair action always clears the custodian, so it cannot represent “physically at the shop while responsibility remains with the foreman/project.”

This does not mean STInventory has no repair support. It has repair entry/status/history. The verified gap is the absence of case-level maintenance management and the retain/release/return workflow.

## 9. Tools by Jobsite assembles several complete lists in the browser

Severity: medium-to-high scalability risk; actual latency not measured.

The page simultaneously requests complete employee, asset, project, vehicle, and project-team lists and performs grouping/filtering in the client. The asset list itself has filtering inputs but no cursor, page size, offset, or limit in its list contract; it returns every scoped matching row. The project and vehicle list queries similarly return their full scoped sets for this page's default calls.

Evidence: [`jobsites/page.tsx`](<../../../STInventory/apps/web/app/(app)/jobsites/page.tsx>) calls `employee.list`, `asset.list`, `project.list`, `vehicle.list`, and `projectTeam.all` without page-specific narrowing. [`asset.ts` router](../../../STInventory/packages/api-contracts/src/routers/asset.ts) constructs and returns the complete selected row set with an `orderBy`, but no pagination. Employee/project list behavior is in [`project.ts` router](../../../STInventory/packages/api-contracts/src/routers/project.ts); vehicle list is in [`location.ts` router](../../../STInventory/packages/api-contracts/src/routers/location.ts).

This means payload size and browser grouping work grow with the visible tenant inventory and roster, rather than with the expanded project or current page. It also makes aggregate counts and list/card state dependent on multiple independently completed requests. The source mentions hundreds of assets in comments, making this more than a purely theoretical code path, but no performance benchmark was run in this review.

What is not proven: “the page is slow in production” is not asserted here. Network timings, database plans, memory use, and deployed tenant sizes were not measured. The verified issue is the unbounded fan-in architecture and its growth behavior.

## 10. Tools by Jobsite contains stale documentation that contradicts its current roster implementation

Severity: medium developer-error risk. Verified within the same current source file.

The top-level explanatory comment says a crew is a `(project, custodian)` pair derived from `asset.list`. The executable page now also loads `projectTeam.all`, and a later comment correctly calls that data the project roster. This is important because the difference determines whether a foreman with zero tools exists on the screen.

Evidence: both comments and the `projectTeam.all.useQuery()` call are in [`jobsites/page.tsx`](<../../../STInventory/apps/web/app/(app)/jobsites/page.tsx>).

The current executable implementation is roster-aware, so it is inaccurate to describe the whole screen as deriving crews only from tools. The stale explanation can cause a future refactor or replacement implementation to restore the old defect by dropping no-tool crews. It also contributed to earlier analysis overstating the problem.

What is not proven: this is not a claim that the current page necessarily hides empty crews. The issue is contradictory current source guidance around a core domain rule.

## 11. Project-team movement deliberately couples people, rigs, trailers, and tools

Severity: high workflow-surprise risk. Verified in current project assignment code and comments.

The project-team model states that linking a foreman to a project means they work there now and that their truck, hitched trailer, and tools follow them. The project assignment implementation includes logic to move or release directly held tools and describes the rig moving with its owner. Tools aboard a truck/trailer are treated differently from directly held tools.

Evidence: the `projectTeamMember` contract in [`employee.ts`](../../../STInventory/packages/db/src/schema/employee.ts) and movement logic in [`project-assign.ts`](../../../STInventory/packages/api-contracts/src/project-assign.ts).

The behavior may match an earlier business decision, but it creates a large side-effect boundary around what appears to be a crew/posting action. A project-team edit can affect employment posting, primary project, roster, equipment placement, attachment context, and tool placement. The directly-held-versus-aboard distinction makes the result difficult to predict without a detailed preview. It is also incompatible with the newly stated requirement that moving a person or reattaching a trailer must not silently transfer tool responsibility or project.

What is not proven: this document does not label every coupled move incorrect. The verified issue is that multiple operational aggregates are coupled behind one action and the desired replacement rule differs. Existing data/history must therefore be characterized before changing it.

## 12. Repair behavior differs depending on the entry path's historical implementation

Severity: high consistency/migration risk, partly repaired but historically encoded in events.

Current messaging code documents that manual entry previously implemented custody separately: assignment did not close the previous link, and repair/lost wrote partial `toState` snapshots. With last-snapshot-wins folding, those partial snapshots could null unrelated placement fields when rebuilding. The current implementation delegates to the shared executor, but legacy events with the old shape remain a compatibility concern and are explicitly covered by fold tests.

Evidence: [`messaging.ts`](../../../STInventory/packages/api-contracts/src/routers/messaging.ts) documents the former hand-written path and current delegation. [`fold.test.ts`](../../../STInventory/packages/domain/src/fold.test.ts) contains explicit partial `in_maintenance` snapshot fixtures and distinguishes omitted fields from explicit nulls. [`apply-action.ts`](../../../STInventory/packages/api-contracts/src/apply-action.ts) contains the current shared repair behavior.

This is a discovered historical defect with an implemented code-path correction, not an allegation that current manual entry still executes the old writer. The remaining issue is migration/replay sensitivity: old event shapes cannot be interpreted as if they were newly written full snapshots, and any replacement must preserve the source fold boundary or explicitly reconcile those records.

## 13. The repository acknowledges a reconciliation operation with no operator screen

Severity: medium operational-support gap. Verified in API reachability tests.

The source contains projection verification/rebuild behavior for detecting and repairing asset current-state divergence. A reachability test records that the boot sweep uses the fold mechanism, but a desk operator who is told the register diverged has no screen from which to inspect or act on it. The same test records a missing department-update page, even though departments are financial cost targets for shop tools.

Evidence: [`reachability.test.ts`](../../../STInventory/packages/api-contracts/src/reachability.test.ts), together with verify/rebuild procedures in [`asset.ts` router](../../../STInventory/packages/api-contracts/src/routers/asset.ts).

This leaves operational recovery dependent on backend procedures or developer intervention instead of an authorized, reviewable workflow. It does not prove divergence currently exists; it proves the recovery capability is not reachable through a corresponding operator surface.

## Confirmed boundaries: items intentionally not listed as defects

The following findings were inspected and are not treated as issues in this register:

- Optional asset codes and non-unique serial/VIN values reflect the documented source data and are not, by themselves, schema defects.
- Separate physical location, operational project, holder, and financial charge target are legitimate distinct facts.
- Access Roles and Job Tiers already have separate settings routes; the issue is remaining ambiguous/legacy role representation, not total absence of that separation.
- Current custody has an event ledger and projection-fold logic. It is inaccurate to claim STInventory has no custody history.
- Projects with no tools and roster-backed crews are supported by the current Jobsites implementation; only the contradictory stale comment is listed.
- No loans, due dates, or overdue-tool workflow exists by design; this review does not propose restoring one.
- No production exploit, cross-tenant data leak, data corruption count, or performance timing was established by this source-only review.

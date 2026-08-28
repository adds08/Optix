# The system, by feature

What Optix does, grouped the way the product is grouped rather than the way the
code is laid out. Each feature names the screens, the procedures and the tables it
actually uses, so a question about one lands in the right file first.

Status is one of **built** (in use), **built, unreached** (the backend exists and
no screen opens it), or **not built**. Nothing here is aspirational.

---

## Registry — the small-tools register

**Built.** The centre of the product.

| | |
|---|---|
| Screens | `/tools`, `/tools/[id]` |
| Procedures | `asset.list`, `get`, `create`, `update`, `bulkUpdate`, `delete`, `setStatus`, `category.*`, `import.preview`, `import.commit` |
| Tables | `tbl_entity_asset`, `tbl_entity_asset_model`, `tbl_entity_category`, `tbl_entity_manufacturer` |

Every tool has an identity (`id`) and a label (`tag`). **The tag is a label, not an
identifier** — never generate one, never suggest one, never key anything on it.

Bulk edit and bulk move operate over all *filtered* rows, not just the visible
page, because the point of selecting is a bulk action.

CSV import goes through a preview that validates before anything is written, and
commit writes baseline ledger events so imported tools have a history from the
start.

> **Known defect, not a design:** CSV *export* reads the post-pagination row model,
> so a register of hundreds exports one page. It also writes column ids rather than
> header labels. `report-table.tsx` gets all three right and is the reference.

## Custody — who is holding what

**Built.** The invariant the whole system exists to protect.

| | |
|---|---|
| Screens | `/custody`, `/desk`, `/my-tools` |
| Procedures | `assignment.create`, `approve`, `decline`, `return`; `transfer.create`, `approve`, `decline`; `departure.preview`, `reassign` |
| Tables | `tbl_ops_smalltools_custody`, `tbl_ops_transfer`, `tbl_ops_transaction` |
| Rules | `.claude/rules/custody-and-ledger.md` |

Custody moves through **one writer** — `packages/api-contracts/src/custody.ts`.
High-value moves park for a second signature; everything else applies immediately.
See `04-data-flow.md` §1.

Tools follow the person. Moving somebody to another job takes their tools with
them, which is why "Move project" is its own action on a person rather than an
edit of a field.

> **Deliberately absent:** there is no borrow model, no due date and no overdue
> view. Removed 2026-08-09 — `expected_end_date` was dropped, `isOverdueLoan` was
> deleted. Nothing falls due, so nothing goes overdue. A ticket asking for an
> overdue report is describing a deleted feature.

> **Deliberately absent:** the HR offboarding clearance gate. Removed 2026-08-27 on
> the product call that a tool can be marked lost or left on a departed person's
> name, and the ledger is append-only so either is reversible. `dashboard.clearanceQueue`
> and the departure reassignment engine still exist — **built, unreached.**

## Tools by jobsite — the operational view

**Built.**

| | |
|---|---|
| Screens | `/jobsites` |
| Procedures | `asset.list`, `projectTeam.*`, `location.setCustodian`, `vehicle.*` |
| Tables | `tbl_entity_project`, `tbl_entity_vehicle`, `tbl_ops_project_team_member` |

The same custody facts as `/custody`, arranged by job and crew instead of by tool.
Both directions write through the same chokepoint, so the two screens cannot
disagree.

Trucks and trailers are equipment *and* moving locations. A tool aboard a container
is decided by **precedence, not a union**: an active custody naming the vehicle
wins; a tool with no custody at all is aboard if its location is the container's.
For a non-vehicle container — a gang box, a yard — the location column remains
authoritative. Both halves are pinned by tests.

Hitching a trailer to a different truck does **not** rewrite the recorded truck of
the tools aboard it. That is a writer honestly declining to claim something it was
not asked about, not a staleness bug. Do not "fix" it.

## Organization — people, projects, teams

**Built.**

| | |
|---|---|
| Screens | `/people`, `/people/[id]`, `/projects`, `/job-groups` |
| Procedures | `employee.*`, `project.*`, `projectTeam.*`, `projectGroup.*`, `user.*` |
| Tables | `tbl_entity_employee`, `tbl_entity_employee_contact`, `tbl_entity_project`, `tbl_ops_project_team_member`, `tbl_entity_project_group` |

**A login is a property of a person.** There is no separate user register — the
People row carries the account state directly, in five states ordered so each is
only reachable once the one above it is ruled out: the role never signs in; no
account; invited but never verified; verified but never used; live.

A person carries an HR-issued `external_id`, a system role (which grants
permissions) and a company role (their job title). Small-tools custody backtracks
to the project's PM and superintendent through the project team.

> Cost codes and phases are **not built** — explicitly deferred.

## Access control — roles and permissions

**Built.**

| | |
|---|---|
| Screens | `/admin/roles` |
| Procedures | `role.catalogue`, `list`, `options`, `setFlags`, `setPermissions`, `create`, `delete` |
| Tables | `tbl_entity_role`, `tbl_entity_permission`, `tbl_entity_role_permission`, `tbl_entity_user_role` |
| Source of truth | `packages/db/src/role-perms.ts` |

Roles carry permissions *and* behavioural flags: `needs_login`, `can_hold_custody`,
`uses_field_layout`, `is_system`.

> **Partly unreached:** the flags are stored, seeded and editable, but
> `nav-config.ts` and the custodian pickers still read hard-coded role lists.
> `can_hold_custody` is the easy half (a field on `employee.list`);
> `uses_field_layout` needs the session payload.

## Conversational layer

**Built.**

| | |
|---|---|
| Screens | `/chat`, `/inbox`, `/desk` |
| Procedures | `messaging.*`, `inbox.*`, `action.submit` |
| Tables | `tbl_ops_channel`, `tbl_ops_message`, `tbl_ops_task` |
| Docs | `docs/07-conversational-layer.md`, `docs/08-custom-intents.md` |

A foreman says what happened; the worker parses it, resolves the tools and people,
and either applies it through the chokepoint or parks it for a human. See
`04-data-flow.md` §3.

Everything the chat can do, a screen can also do. The chat is a faster path to the
same procedures, never a second implementation of them.

## Reporting

**Built.**

| | |
|---|---|
| Screens | `/reports`, `/reports/[slug]`, `/reports/charts/[slug]`, `/reports/audit-trail`, `/activity` |
| Procedures | `report.assetRegister`, `byProject`, `byForeman`, `byMechanic`, `idle`, `lost`, `needsTag`, `capitalByProject`, `capitalByDepartment`, `auditTrail` |

Capital by project and by department is where ownership and custody being separate
axes pays off: a mechanic's custody charges Equipment, a foreman's charges the job.

## Dashboard

**Built**, with one screen that is not responsive.

| | |
|---|---|
| Screens | `/home`, `/old-dash` |
| Procedures | `dashboard.kpis`, `recentActivity`, `awaitingDesk`, `briefing`, `pendingApprovals`, `notifications`, `charts` |

`/home`'s fleet monitor is a **wall-board** — fixed row heights, sized for a screen
on a wall. Measured at 390px it overlaps its own text. That wants a product
decision (route narrow viewports to the `command` tab), not a media query;
reflowing it would degrade the display it was built for.

`dashboard.clearanceQueue` is **built, unreached** — see Custody.

## Fleet and map

**Built.**

| | |
|---|---|
| Screens | `/map` |
| Procedures | `vehicle.list`, `updateGps`, `location.*` |
| Tables | `tbl_entity_vehicle`, `tbl_entity_location`, `tbl_entity_warehouse` |

Trucks and trailers, classified as vehicle or heavy equipment. **This is not a
fleet module** — no maintenance schedules, no fuel, no telematics. Vehicles exist
here because tools ride on them.

## Platform — settings, appearance, notifications

**Built.**

| | |
|---|---|
| Screens | `/settings`, `/settings/ai`, `/settings/appearance`, `/profile`, `/account/password` |
| Procedures | `settings.get`, `update`, `testLlm`, `testEmail`; `preferences.get`, `set`; `notification.*` |
| Tables | `tbl_entity_tenant_settings`, `tbl_entity_user_preferences`, `tbl_ops_notification` |

Tenant settings carry the high-value threshold and the LLM configuration. **The LLM
key is AES-GCM encrypted at rest and no procedure returns it.**

Per-user appearance: palette, font family, font scale, icon scale, density,
dashboard tab.

## Reference data

**Partly built.** `tbl_entity_uom_category`, `tbl_entity_unit_of_measure` and
`tbl_entity_company_role` exist and are seeded; units of measurement have no
dedicated management screen yet.

---

## Not built, and known to be

- **Vendors and purchase orders** — where a tool came from. `docs/15-vendors-and-orders.md`.
- **Cost codes and phases** — deferred by the client.
- **Onboarding and in-product guidance** — the next thing after v1.0.0.
- **Email delivery in anger.** SMTP is wired and `settings.testEmail` proves a
  configuration, but invite-only signup is blocked on nobody having pointed it at a
  real mailbox.

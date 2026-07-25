# STInventory — Data Model & Schema

Schema reference for STInventory. Design is **event-sourced at the core**: the
`transaction` table is the append-only system of record; every other operational table
(`asset.current_*`, `assignment`) is a **projection** that can be rebuilt from it. This is
what enforces the §2 principle "current state is derived from history."

This document is split deliberately:

- **Part A — As-built.** Every table that exists in `packages/db/src/schema/`. If Part A and
  the code disagree, the code is right and this document is a bug.
- **Part B — Planned, not built.** Designed tables with no migration behind them. Nothing in
  Part B exists in the database today.

Conventions: `id` = uuid PK (`bigint` identity for the two log tables), `*_id` = FK, most
tables carry `created_at` / `updated_at`. Multi-tenancy adds `tenant_id` to every row (see
`02-saas-architecture.md`); for the Urban-only deployment `tenant_id` is a constant.

Table naming note: Drizzle table exports are camelCase, physical table names are snake_case
and singular (`asset`, `assignment`, `asset_model`). The catalog table is named
`asset_model`, not `models`, to avoid the reserved-word collision.

---

# Part A — As-built schema

26 tables across `packages/db/src/schema/`. Grouped by concern.

## A1. Identity, tenancy & RBAC

`packages/db/src/schema/identity.ts`

### tenant
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| slug | text unique | tenant resolver key |

### user
Auth identity, distinct from the domain `employee`.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| employee_id | uuid | **plain uuid, no FK** — keeps the schema import graph acyclic; the user↔employee link is resolved in the API layer |
| email | text | |
| password_hash | text | |
| first_name, last_name | text | |
| is_active | bool | |

### session
Lucia-compatible. `id` is text (the session token), not a uuid.
| column | type | notes |
|---|---|---|
| id | text pk | |
| user_id | fk user | |
| tenant_id | fk tenant | |
| expires_at | timestamptz | |

### role / permission / role_permission / user_role
| table | columns | notes |
|---|---|---|
| role | id, tenant_id (nullable), name, description | `tenant_id = null` means a system role; unique on (tenant_id, name) |
| permission | name (text pk), description | permission names are the PK — see `PERMISSIONS` in `packages/types/src/index.ts` |
| role_permission | role_id, permission_name | composite PK |
| user_role | user_id, role_id | composite PK |

Roles (`ROLES`): `owner, equipment_admin, warehouse, procurement, project_manager,
superintendent, foreman, hr, finance, read_only`. Only `owner, equipment_admin, warehouse,
foreman, read_only` are seeded today.

Permissions (`PERMISSIONS`): `asset.read/manage`, `location.read/manage`,
`vehicle.read/manage`, `project.read/manage`, `employee.read/manage`,
`assignment.read/create/approve`, `transfer.read/create/approve`, `report.read`,
`notification.read/manage`, `config.manage`, `audit.read`.

### tenant_settings
Tenant config as data, not code (`packages/db/src/schema/event.ts`).
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| high_value_threshold | jsonb\<number\> | drives the approval gate; default `5000` |
| custody_approver_role | text | default `equipment_admin` |
| overdue_escalate_after_days | jsonb\<number\> | |
| missing_review_sla_days | jsonb\<number\> | |
| discrepancy_review_sla_days | jsonb\<number\> | |
| email_enabled, sms_enabled | bool | delivery channel toggles |

## A2. Catalog

`packages/db/src/schema/catalog.ts`

### category
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| name | text | Power Tools, Hand Tools, Safety, Survey, Concrete, Access |
| parent_id | fk category | nullable, self-referencing |
| default_maintenance_interval_days | int | seeds preventive schedule (unused until maintenance ships) |

### manufacturer
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| name | text | Hilti, DeWalt, Milwaukee, Bosch, Trimble |

### asset_model
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| manufacturer_id | fk manufacturer | |
| name | text | e.g. "TE 60-ATC/AVR" |
| category_id | fk category | |
| default_unit_cost | numeric(14,2) | |
| is_serialized | bool | true = track individually; false = bulk/consumable |

## A3. Locations, fleet & org

`packages/db/src/schema/location.ts`, `project.ts`, `employee.ts`

### warehouse
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| name | text | Main (Dallas), Regional (Houston) |
| region, address | text | |

### location
Polymorphic "place an asset can be." A gang box or vehicle is a location that can itself move.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| type | text | `warehouse / site_container / gang_box / vehicle / project_site` |
| name | text | "Truck 12", "Gang Box A", "Container - Legacy West" |
| warehouse_id | fk warehouse | nullable |
| project_id | fk project | nullable, when the location is a jobsite |
| parent_location_id | fk location | nullable, e.g. gang box inside a container |

### vehicle
Not in the original design. A truck/trailer as a **tracking location** — 1:1 with a
`location` row of type `vehicle`, so tools "on" it inherit its geolocation.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| location_id | fk location | the vehicle's location row |
| vehicle_type | text | `truck / trailer` |
| unit | text | "TRU-112", "TRA-1001" |
| plate, make_model | text | |
| ownership_type | text | `company_owned / personal_allowance` |
| payee_employee_id | fk employee | allowance payee |
| allowance_rate | numeric(10,2) | |
| allowance_frequency | text | `weekly / monthly` |
| gps_lat, gps_lng | numeric | |
| gps_at, gps_source | timestamptz / text | |
| project_id | fk project | |
| foreman_employee_id | fk employee | |

`ownership_type` and the allowance fields are **recorded for reporting only** — STInventory
does not compute or pay allowances.

### project
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| external_id | text | FoundationSoft / Mark 85 map (seam, not yet synced) |
| name | text | |
| status | text | `awarded / active / closing / complete` |
| start_date, end_date | date | |
| cost_center | text | for charge-to-project |

### project_phase
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| project_id | fk project | |
| name | text | WBS phase name |
| sort_order | int | |
| start_date, end_date | date | drives idle-tool detection |

> **Known defect.** `project_phase` has **no `tenant_id`**, breaking the mandatory
> multi-tenant checklist item in `02-saas-architecture.md` §5. It is tenant-reachable only
> through `project_id`. This must be fixed before a second tenant exists, because an RLS
> policy cannot be written against this table as it stands.

### employee
A person who can hold custody. Separate from the auth `user`.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| external_id | text | BambooHR / Mark 85 map (seam, not yet synced) |
| name | text | |
| role | text | `foreman / superintendent / pm / equipment_admin / warehouse / procurement / hr / finance` |
| primary_project_id | fk project | nullable |
| employment_status | text | `active / terminated / on_leave` |
| terminated_at | timestamptz | set on the HR event; drives the clearance queue |
| reports_to_employee_id | fk employee | self-referencing org chart |
| email, phone | text | |

## A4. Assets — the register

`packages/db/src/schema/asset.ts`

### asset
The `current_*` columns are the **projection**, denormalized from `transaction` for fast
reads and reporting. They are never the source of truth.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| tag | text | asset tag / QR value, e.g. `UIC-1012` |
| model_id | fk asset_model | nullable |
| **model_name** | text | denormalized for fast register reads |
| **category_name** | text | denormalized |
| serial_number | text | nullable for bulk |
| is_serialized | bool | copied from the model |
| quantity | int | 1 for serialized; N for bulk lines |
| acquisition_cost | numeric(14,2) | |
| acquisition_date | date | |
| owning_project_id | fk project | **financial owner** — the project it was charged to |
| warranty_expires_on | date | |
| **current_status** | text | see lifecycle statuses below |
| **current_custodian_id** | fk employee | null = in warehouse |
| **current_project_id** | fk project | operational; may differ from `owning_project_id` |
| **current_location_id** | fk location | |
| condition | text | `new / good / fair / poor / damaged` |
| created_by | fk user | |

Lifecycle statuses (`ASSET_STATUSES`): `requested, approved, on_order, received, available,
reserved, assigned, in_transit, in_maintenance, lost, disposed`. The procurement-side
statuses (`requested, approved, on_order, received`) are defined but unreachable until
Part B ships.

Note the deliberate split: `owning_project_id` (who paid, financial) vs `current_project_id`
(who is using it now, operational). This is §2's "financial allocation separate from
operational custody," made concrete.

## A5. Custody & movement

### assignment
Active custody link. At most one row per serialized asset with `status = active`.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| asset_id | fk asset | |
| custodian_id | fk employee | on delete restrict |
| project_id | fk project | |
| location_id | fk location | |
| type | text | `permanent / temporary` |
| start_date | date | |
| expected_end_date | date | temporary loans require it; drives overdue |
| status | text | `active / returned / transferred / overdue / pending_approval` |
| approved_by | fk user | |
| returned_at | timestamptz | |

> `assignment` has **no `phase_id`**. Phase-level custody was designed but not built, so the
> phase-change scenario (`01-plan.md` §7.5) currently works off `project_phase` dates joined
> through the project, not off the assignment itself.

### transfer
A movement record between two custody states.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| asset_id | fk asset | |
| from_custodian_id / to_custodian_id | fk employee | |
| from_location_id / to_location_id | fk location | |
| from_project_id / to_project_id | fk project | |
| reason | text | `project_complete / phase_change / reallocation / hr_offboarding / repair / handoff` |
| status | text | `pending_approval / approved / in_transit / completed / cancelled` |
| requested_by | fk user | **required** |
| approved_by | fk user | |
| completed_at | timestamptz | |

**Approval workflow (undocumented in the original design).** Both `assignment` and
`transfer` default to `pending_approval` for cross-person or high-value hand-offs, gated on
`tenant_settings.high_value_threshold` and `custody_approver_role`. Approvals surface via
`dashboard.pendingApprovals`.

## A6. Event log & notifications

`packages/db/src/schema/event.ts`

### transaction
Append-only. Nothing is ever updated or deleted. Every projection above is a fold over this
table.
| column | type | notes |
|---|---|---|
| id | bigint identity pk | monotonic |
| tenant_id | fk tenant | |
| asset_id | fk asset | |
| event_type | text | see below |
| actor_id | fk user | who performed it |
| from_state | jsonb | custodian/project/location/status before |
| to_state | jsonb | custodian/project/location/status after |
| ref_type | text | `assignment / transfer / maintenance / message / manual` |
| ref_id | uuid | |
| occurred_at | timestamptz | |
| note | text | |

Event types (`EVENT_TYPES`): `purchase, receive, tag, assign, transfer, return, reserve,
repair_start, repair_complete, inspection, lost, found, dispose, custodian_change,
project_change, location_change, status_change`. Only `assign, transfer, return,
status_change` are emitted by code today.

### notification
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| recipient_employee_id | fk employee | |
| recipient_user_id | fk user | |
| type | text | `overdue / maintenance_due / clearance_required / approval_pending / missing / custody_discrepancy` |
| ref_type, ref_id | text / uuid | |
| title, body | text | |
| channel | text | `in_app / email / sms` |
| delivered_at, read_at, escalated_at | timestamptz | escalation drives the SLA timers |

### event_log
`packages/db/src/schema/audit.ts`. Generic audit log, mirroring Mark 85's `event_log`.
Best-effort insert.

> **`event_log` is never the system of record for domain state — `transaction` is.**
> `event_log` records who called what (category, action, entity, result, http path, ip,
> user agent); `transaction` records what happened to an asset. Do not conflate them.

| column | type | notes |
|---|---|---|
| id | bigint identity pk | |
| tenant_id | fk tenant | nullable |
| actor_user_id, actor_role, actor_label | uuid / text | |
| category, action | text | category incl. `messaging` |
| entity_type, entity_id, entity_label | text | |
| result, error_message | text | default `success` |
| source, http_method, http_path, ip, user_agent | text | |
| details | jsonb | |

## A7. Conversational layer

`packages/db/src/schema/messaging.ts`, `task.ts`. Full behaviour is specified in
`07-conversational-layer.md`; this is the storage shape only.

### channel
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| name, slug | text | "Equipment Department" |
| kind | text | `department / role_group` |
| member_role | text | role-based membership |

### message
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| channel_id | fk channel | |
| author_user_id | fk user | |
| author_employee_id | fk employee | |
| body | text | what the foreman typed |
| processing_status | text | `queued / processing / parsed / pending_manual / action_proposed / action_executed / error` |
| intent_type | text | one of the nine `MESSAGE_INTENTS` |
| intent_payload | jsonb | the raw engine response |
| proposed_action | jsonb | resolved DB IDs awaiting confirmation |
| executed_transaction_ids | jsonb | links the message to the `transaction` rows it produced |
| handled_by_user_id, handled_at | uuid / timestamptz | |
| error_note | text | |

### task
Work items extracted from chat that are not custody events.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | fk tenant | |
| title, description | text | |
| status | text | default `pending` |
| priority | text | default `medium` |
| assigned_to_employee_id | fk employee | |
| created_by_user_id | fk user | |
| related_asset_id | fk asset | |
| related_project_id | fk project | |
| source | text | default `chat` |
| source_message_id | uuid | the originating message (no FK) |
| due_date, completed_at | timestamptz | |

## A8. Derivation rules (projection logic)

- `asset.current_*` = apply the latest `assign / transfer / return / status_change` events in
  `occurred_at` order.
- An asset is **Idle** if `current_status = available` OR (assigned but its
  `current_project_id` phase has ended and no new assignment exists).
- An asset is **Overdue** if it has an active `temporary` assignment past
  `expected_end_date`.
- **Utilization** = assigned-days ÷ owned-days over a window, from the event stream.
  *(Designed; no report procedure implements it yet.)*
- **HR clearance queue** = all assets whose `current_custodian_id` is an employee with
  `employment_status = terminated` and status not in (returned, transferred, lost).

### The fold, as implemented

`foldAssetState` (`packages/domain/src/fold.ts`) sorts events by `occurred_at` then `id`
and returns the `to_state` of the **latest event that carries one**. It is a
last-snapshot-wins projection, not a field-by-field reducer.

**This makes one constraint load-bearing: every writer must emit a complete `to_state`.**
A partial `to_state` (e.g. `{status}` with no `custodianId`) does not merge with prior
state — it replaces it, and the omitted fields read back as undefined. The rebuild guarantee
in §A9 holds only as long as that discipline holds. Note that
`autoExecuteAction` in `apps/api/src/messaging-worker.ts` currently writes `toState: {}` for
the `report` intent, which satisfies the letter of this rule only because a `report` is a
note against an asset and is never meant to move it.

## A9. Rebuild guarantee

Because state is a fold over `transaction`, the entire operational picture can be dropped
and rebuilt. This makes the audit trail free — the log *is* the audit trail — and makes
disputes ("who lost this drill") answerable to the exact event.

---

# Part B — Planned, not built

None of the following exists in `packages/db/src/schema/`. There is no migration for any of
it. Procurement and maintenance are the two largest unbuilt modules; see `01-plan.md` §18.

## B1. Procurement

### vendors
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | supplier or repair shop |
| type | enum | supplier / repair / both |
| contact, phone, email, address | text | |
| lead_time_days | int | drives forecasting |

### purchase_requests
| column | type | notes |
|---|---|---|
| id | pk | |
| project_id | fk | charge target |
| requested_by | fk employees | |
| status | enum | draft / submitted / approved / rejected / ordered |
| needed_by | date | |
| justification | text | |

### purchase_request_lines
| column | type | notes |
|---|---|---|
| id | pk | |
| purchase_request_id | fk | |
| model_id | fk asset_model | |
| quantity | int | |
| estimated_unit_cost | numeric | |

### purchase_orders
| column | type | notes |
|---|---|---|
| id | pk | |
| vendor_id | fk | |
| purchase_request_id | fk | nullable |
| status | enum | issued / partially_received / received / closed / cancelled |
| ordered_at | timestamp | |
| expected_delivery | date | |
| total_cost | numeric | |

### purchase_order_lines / receipts
Track received quantity vs ordered; receiving creates `asset` rows + `receive` transactions.

## B2. Maintenance & inspection

### maintenance_records
| column | type | notes |
|---|---|---|
| id | pk | |
| asset_id | fk | |
| type | enum | preventive / corrective / calibration / warranty / damage |
| status | enum | scheduled / in_progress / completed / cancelled |
| vendor_id | fk vendors | nullable (in-house if null) |
| scheduled_for | date | |
| completed_at | timestamp | |
| cost | numeric | |
| notes | text | |

### inspections
| column | type | notes |
|---|---|---|
| id | pk | |
| asset_id | fk | |
| type | enum | intake / periodic / return / offboarding |
| result | enum | pass / fail / needs_repair |
| inspector_id | fk employees | |
| performed_at | timestamp | |
| notes | text | |

## B3. Dropped by design

### assignment_history
Immutable snapshots of assignment changes. **Deliberately not built** — `transaction` with
`ref_type = 'assignment'` answers "who held this and when" without a second history table.
Listed here only so its absence reads as a decision rather than an omission.

# Database schema — Optix

**Generated from the live database, not from the schema files**, so this is what
actually exists. **46 tables, 496 columns, 79 migrations, 23 CHECK constraints.**

The `→` column names the table a foreign key points at.

---

## Read this first

**Three things carry the product, and confusing them is the usual source of a wrong bug report.**

| | Holds | Note |
|---|---|---|
| `tbl_entity_small_tool` | drills, saws, grinders, generators, survey gear | ~753 at Urban |
| `tbl_entity_equipment` | trucks and trailers | 88 at Urban |
| `tbl_ops_transaction` | **every custody event, append-only** | the system of record |

A tool's `current_status` / `current_custodian_id` / `current_project_id` /
`current_location_id` are a **projection** folded from the ledger. The ledger
wins; those columns are a cache that `asset.verifyProjection` checks.

**Four things sound like "role" and are all different:**

| Column | Question it answers | Scope |
|---|---|---|
| `employee.company_role_id` | what payroll calls the post (BambooHR owns it) | per person |
| `user_role.role_id` → `role` | what an ACCOUNT may see and do | per person |
| `project_team_member.role` → `team_role` | where somebody sits on ONE job | **per project** |
| `employee.role` | LEGACY, abandoned — do not read | — |

**One `code` per entity**, and nothing else identifies a row unless it is a
genuinely different fact:

- `code` — the company's own identifier. Every entity has one, spelled the same.
- `serial_number` — the MANUFACTURER's. Small tools only; 346 of 753 have one.
- `vin` — the manufacturer's permanent identity. Equipment only.
- `plate` — the registration. Gets reassigned, so not an identity.
- `external_id` — a foreign system's key. Never on the entity; lives in
  `tbl_entity_employee_external_ref`.

**Every table carries `tenant_id` except five**, each deliberately:
`tenant` (it *is* the tenant), `permission` (a global vocabulary), and the three
join tables `role_permission`, `user_role`, `team_role_assigner` (whose parents
carry it). There is **no RLS** — isolation is the correctness of every `WHERE`,
guarded by a build-time scan over writes.

## Renamed today (migrations 0074–0079)

| Was | Now | Why |
|---|---|---|
| `tbl_entity_asset` | `tbl_entity_small_tool` | "asset" could mean a truck or a building |
| `tbl_entity_vehicle` | `tbl_entity_equipment` | the UI had said Equipment since August |
| `equipment.unit` + `code` | `code` | same value on all 88 real vehicles |
| `small_tool.asset_number` | *dropped* | a second number (`A-000001`) beside the code |
| `location.type` ×5 | ×3 | gang boxes and site containers were never used |

`vehicle_type` keeps its name deliberately: `assignment.truck_id`/`trailer_id`
reference `(id, vehicle_type)` through composite FKs with a generated constant,
which is the only way a plain FK can insist a truckId names a truck.

## The 23 CHECK constraints, and their allowed values

Every status/type column is plain `text` with a CHECK — not a Postgres enum, so
adding a value is a migration on the constraint rather than a type. Validate at
the router edge with Zod as well; the CHECK is the floor under writers that
never pass an edge (an import, a worker, a hand-run UPDATE).

```
tbl_entity_auth_token . CHECK ((kind = ANY (ARRAY[invite, reset])))
tbl_entity_employee . CHECK ((employment_status = ANY (ARRAY[active, inactive, terminated, on_leave])))
tbl_entity_employee_contact . CHECK ((kind = ANY (ARRAY[mobile, work, personal, home, other])))
tbl_entity_equipment . CHECK ((equipment_class = ANY (ARRAY[vehicle, attachment, heavy, other])))
tbl_entity_equipment . CHECK ((ownership_type = ANY (ARRAY[company_owned, personal_allowance])))
tbl_entity_equipment . CHECK ((vehicle_type = ANY (ARRAY[truck, trailer])))
tbl_entity_location . CHECK ((type = ANY (ARRAY[warehouse, vehicle, project_site])))
tbl_entity_project . CHECK ((kind = ANY (ARRAY[project, yard])))
tbl_entity_project . CHECK ((status = ANY (ARRAY[not_awarded, awarded, in_progress, completed, cancelled, on_hold])))
tbl_entity_small_tool . CHECK ((current_status = ANY (ARRAY[requested, approved, on_order, received, available, reserved, assigned, in_transit, in_maintenance, diagnosing, waiting_parts, ready_for_pickup, lost, disposed])))
tbl_ops_channel . CHECK ((kind = ANY (ARRAY[department, role_group])))
tbl_ops_message . CHECK ((processing_status = ANY (ARRAY[queued, processing, parsed, pending_manual, action_proposed, action_executed, action_requested, error, dismissed])))
tbl_ops_notification . CHECK ((channel = ANY (ARRAY[in_app, email, sms])))
tbl_ops_notification . CHECK ((type = ANY (ARRAY[approval_pending, custody_discrepancy, request_pending, request_overdue, request_approved, request_declined])))
tbl_ops_project_team_member . CHECK ((source = ANY (ARRAY[equipment_department, payroll_import, manual_entry, api_sync, onboarding])))
tbl_ops_smalltools_custody . CHECK ((status = ANY (ARRAY[active, returned, transferred, overdue, pending_approval, cancelled])))
tbl_ops_sync_run . CHECK ((source = bamboohr))
tbl_ops_sync_run . CHECK ((status = ANY (ARRAY[queued, running, done, failed])))
tbl_ops_task . CHECK ((classification = ANY (ARRAY[recognized, completed, unrecognized])))
tbl_ops_task . CHECK ((priority = ANY (ARRAY[low, medium, high, urgent])))
tbl_ops_task . CHECK ((source = ANY (ARRAY[chat, manual])))
tbl_ops_task . CHECK ((status = ANY (ARRAY[pending, in_progress, completed, cancelled])))
tbl_ops_transfer . CHECK ((status = ANY (ARRAY[pending_approval, pending_verification, approved, in_transit, completed, cancelled])))
```

**Deliberately NOT constrained**, each for a reason: `project_team_member.role`
(tenant-created tiers — a CHECK would make adding one need a migration),
`employee.role` (legacy, holds off-list values) and `event_log.source` (a
rejected audit insert would abort the business transaction that caused it).

---

# The 46 tables

## 1. What Urban owns

### `tbl_entity_small_tool` · 28 columns

> Drills, saws, grinders, generators, survey gear. **Renamed from `tbl_entity_asset`** (0076). `code` is the one identifier — `asset_number` was dropped (0079).

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `code` | text | — | — | — |
| `model_id` | uuid | — | — | asset_model |
| `category_name` | text | — | — | — |
| `serial_number` | text | — | — | — |
| `is_serialized` | boolean | **NOT NULL** | true | — |
| `quantity` | integer | **NOT NULL** | 1 | — |
| `acquisition_cost` | numeric | — | — | — |
| `acquisition_date` | date | — | — | — |
| `owning_project_id` | uuid | — | — | project |
| `warranty_expires_on` | date | — | — | — |
| `current_status` | text | **NOT NULL** | available | — |
| `current_custodian_id` | uuid | — | — | employee |
| `current_project_id` | uuid | — | — | project |
| `current_location_id` | uuid | — | — | location |
| `condition` | text | — | good | — |
| `created_by` | uuid | — | — | user |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `photo_key` | text | — | — | — |
| `make` | text | — | — | — |
| `model_number` | text | — | — | — |
| `description` | text | — | — | — |
| `other_ref` | text | — | — | — |
| `cost_target` | text | **NOT NULL** | project | — |
| `owning_department_id` | uuid | — | — | department |
| `is_manual_code` | boolean | **NOT NULL** | false | — |

### `tbl_entity_equipment` · 24 columns

> Trucks and trailers. **Renamed from `tbl_entity_vehicle`** (0075). `unit` was dropped (0077) — it held the same value as `code`.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `location_id` | uuid | **NOT NULL** | — | location |
| `vehicle_type` | text | **NOT NULL** | — | — |
| `plate` | text | — | — | — |
| `make_model` | text | — | — | — |
| `ownership_type` | text | **NOT NULL** | company_owned | — |
| `payee_employee_id` | uuid | — | — | employee |
| `allowance_rate` | numeric | — | — | — |
| `allowance_frequency` | text | — | — | — |
| `gps_lat` | numeric | — | — | — |
| `gps_lng` | numeric | — | — | — |
| `gps_at` | timestamptz | — | — | — |
| `gps_source` | text | — | — | — |
| `project_id` | uuid | — | — | project |
| `foreman_employee_id` | uuid | — | — | employee |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `equipment_class` | text | **NOT NULL** | vehicle | — |
| `can_attach` | boolean | **NOT NULL** | false | — |
| `is_attachable` | boolean | **NOT NULL** | false | — |
| `code` | text | **NOT NULL** | — | — |
| `description` | text | — | — | — |
| `vin` | text | — | — | — |

### `tbl_entity_project` · 15 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `code` | text | — | — | — |
| `name` | text | **NOT NULL** | — | — |
| `status` | text | **NOT NULL** | not_awarded | — |
| `start_date` | date | **NOT NULL** | — | — |
| `end_date` | date | — | — | — |
| `site_address` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `description` | text | — | — | — |
| `latitude` | numeric | — | — | — |
| `longitude` | numeric | — | — | — |
| `geofence_radius_m` | integer | — | — | — |
| `kind` | text | **NOT NULL** | project | — |

### `tbl_entity_employee` · 20 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `code` | text | — | — | — |
| `name` | text | **NOT NULL** | — | — |
| `role` | text | **NOT NULL** | foreman | — |
| `primary_project_id` | uuid | — | — | project |
| `employment_status` | text | **NOT NULL** | active | — |
| `terminated_at` | timestamptz | — | — | — |
| `reports_to_employee_id` | uuid | — | — | employee |
| `email` | text | — | — | — |
| `phone` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `company_role_id` | uuid | — | — | company_role |
| `role_id` | uuid | — | — | role |
| `division_id` | uuid | — | — | division |
| `department_id` | uuid | — | — | department |
| `hr_flagged_inactive_at` | timestamptz | — | — | — |
| `creation_source` | text | **NOT NULL** | unknown | — |
| `created_by_user_id` | uuid | — | — | user |

### `tbl_entity_location` · 9 columns

> Where a tool sits: `warehouse | vehicle | project_site`. Gang boxes and site containers removed (0074).

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `type` | text | **NOT NULL** | — | — |
| `name` | text | **NOT NULL** | — | — |
| `warehouse_id` | uuid | — | — | warehouse |
| `project_id` | uuid | — | — | project |
| `parent_location_id` | uuid | — | — | location |
| `custodian_employee_id` | uuid | — | — | employee |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_warehouse` · 6 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `region` | text | — | — | — |
| `address` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |


## 2. What happens to it — the ledger and custody

### `tbl_ops_transaction` · 12 columns

> **The system of record.** Append-only by trigger; every `current_*` on a tool is a projection folded from this.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | bigint | **NOT NULL** | identity | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `asset_id` | uuid | **NOT NULL** | — | small_tool |
| `event_type` | text | **NOT NULL** | — | — |
| `actor_id` | uuid | — | — | user |
| `from_state` | jsonb | — | — | — |
| `to_state` | jsonb | — | — | — |
| `ref_type` | text | — | — | — |
| `ref_id` | uuid | — | — | — |
| `occurred_at` | timestamptz | **NOT NULL** | now() | — |
| `note` | text | — | — | — |
| `ref_message_id` | uuid | — | — | — |

### `tbl_ops_smalltools_custody` · 16 columns

> Who holds which tool. Written only through `custody.ts`.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `asset_id` | uuid | **NOT NULL** | — | small_tool |
| `custodian_id` | uuid | **NOT NULL** | — | employee |
| `project_id` | uuid | — | — | project |
| `location_id` | uuid | — | — | location |
| `start_date` | date | **NOT NULL** | — | — |
| `status` | text | **NOT NULL** | active | — |
| `approved_by` | uuid | — | — | user |
| `returned_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `truck_id` | uuid | — | — | equipment |
| `trailer_id` | uuid | — | — | equipment |
| `truck_kind` | text | — | — | equipment |
| `trailer_kind` | text | — | — | equipment |

### `tbl_ops_transfer` · 20 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `asset_id` | uuid | **NOT NULL** | — | small_tool |
| `from_custodian_id` | uuid | — | — | employee |
| `to_custodian_id` | uuid | — | — | employee |
| `from_location_id` | uuid | — | — | location |
| `to_location_id` | uuid | — | — | location |
| `from_project_id` | uuid | — | — | project |
| `to_project_id` | uuid | — | — | project |
| `reason` | text | **NOT NULL** | reallocation | — |
| `status` | text | **NOT NULL** | pending_approval | — |
| `requested_by` | uuid | **NOT NULL** | — | user |
| `approved_by` | uuid | — | — | user |
| `completed_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `to_truck_id` | uuid | — | — | equipment |
| `to_trailer_id` | uuid | — | — | equipment |
| `to_truck_kind` | text | — | — | equipment |
| `to_trailer_kind` | text | — | — | equipment |

### `tbl_ops_task` · 25 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `title` | text | **NOT NULL** | — | — |
| `description` | text | — | — | — |
| `status` | text | **NOT NULL** | pending | — |
| `priority` | text | **NOT NULL** | medium | — |
| `assigned_to_employee_id` | uuid | — | — | employee |
| `created_by_user_id` | uuid | — | — | user |
| `related_asset_id` | uuid | — | — | small_tool |
| `related_project_id` | uuid | — | — | project |
| `source` | text | **NOT NULL** | chat | — |
| `source_message_id` | uuid | — | — | — |
| `action_type` | text | — | — | — |
| `pending_action` | jsonb | — | — | — |
| `requested_by_employee_id` | uuid | — | — | employee |
| `department` | text | — | — | — |
| `decline_reason` | text | — | — | — |
| `escalation_count` | integer | **NOT NULL** | 0 | — |
| `last_escalated_at` | timestamptz | — | — | — |
| `due_date` | timestamptz | — | — | — |
| `completed_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `classification` | text | — | — | — |
| `llm_summary` | text | — | — | — |


## 3. Who is on which job

### `tbl_ops_project_team_member` · 14 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `project_id` | uuid | **NOT NULL** | — | project |
| `employee_id` | uuid | **NOT NULL** | — | employee |
| `role` | text | **NOT NULL** | — | — |
| `assigned_by_user_id` | uuid | — | — | user |
| `started_on` | date | **NOT NULL** | — | — |
| `ended_on` | date | — | — | — |
| `note` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `source` | text | **NOT NULL** | equipment_department | — |
| `reports_to_employee_id` | uuid | — | — | employee |
| `confirmed_at` | timestamptz | — | — | — |
| `confirmed_by_user_id` | uuid | — | — | user |

### `tbl_ops_employee_project_assignment` · 9 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `employee_id` | uuid | **NOT NULL** | — | employee |
| `project_id` | uuid | **NOT NULL** | — | project |
| `started_on` | date | **NOT NULL** | — | — |
| `ended_on` | date | — | — | — |
| `assigned_by_user_id` | uuid | — | — | user |
| `note` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_ops_project_role_deferral` · 9 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `project_id` | uuid | **NOT NULL** | — | project |
| `team_role` | text | **NOT NULL** | — | — |
| `deferred_by_user_id` | uuid | — | — | user |
| `deferred_to_employee_id` | uuid | — | — | employee |
| `note` | text | — | — | — |
| `resolved_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_ops_project_access_restriction` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `project_id` | uuid | **NOT NULL** | — | project |
| `employee_id` | uuid | **NOT NULL** | — | employee |
| `created_by_user_id` | uuid | — | — | user |
| `reason` | text | **NOT NULL** | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `restored_at` | timestamptz | — | — | — |

### `tbl_ops_user_onboarding` · 10 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `user_id` | uuid | **NOT NULL** | — | user |
| `current_step` | text | **NOT NULL** | projects | — |
| `started_at` | timestamptz | **NOT NULL** | now() | — |
| `completed_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `dismissed_at` | timestamptz | — | — | — |
| `claiming_closed_at` | timestamptz | — | — | — |


## 4. Identity, access and authority

### `tbl_entity_tenant` · 4 columns

> It *is* the tenant.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `name` | text | **NOT NULL** | — | — |
| `slug` | text | **NOT NULL** | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_user` · 12 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `employee_id` | uuid | — | — | — |
| `email` | text | **NOT NULL** | — | — |
| `password_hash` | text | **NOT NULL** | — | — |
| `first_name` | text | **NOT NULL** | — | — |
| `last_name` | text | **NOT NULL** | — | — |
| `is_active` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `must_change_password` | boolean | **NOT NULL** | false | — |
| `email_verified_at` | timestamptz | — | — | — |
| `last_sign_in_at` | timestamptz | — | — | — |

### `tbl_entity_session` · 4 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | text | **NOT NULL** | — | — |
| `user_id` | uuid | **NOT NULL** | — | user |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `expires_at` | timestamptz | **NOT NULL** | — | — |

### `tbl_entity_auth_token` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `user_id` | uuid | **NOT NULL** | — | user |
| `token_hash` | text | **NOT NULL** | — | — |
| `kind` | text | **NOT NULL** | — | — |
| `expires_at` | timestamptz | **NOT NULL** | — | — |
| `consumed_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_role` · 12 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | — | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `description` | text | — | — | — |
| `needs_login` | boolean | **NOT NULL** | true | — |
| `can_hold_custody` | boolean | **NOT NULL** | false | — |
| `uses_field_layout` | boolean | **NOT NULL** | false | — |
| `is_system` | boolean | **NOT NULL** | false | — |
| `onboarding_kind` | text | **NOT NULL** | equipment | — |
| `is_cross_tenant` | boolean | **NOT NULL** | false | — |
| `claim_tier_names` | jsonb | **NOT NULL** | [] | — |
| `category` | text | — | — | — |

### `tbl_entity_permission` · 2 columns

> No `tenant_id` — a global vocabulary, so `asset.manage` means the same everywhere.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `name` | text | **NOT NULL** | — | — |
| `description` | text | — | — | — |

### `tbl_entity_role_permission` · 2 columns

> Join table; the tenant comes from `role`.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `role_id` | uuid | **NOT NULL** | — | role |
| `permission_name` | text | **NOT NULL** | — | permission |

### `tbl_entity_user_role` · 2 columns

> Join table; the tenant comes from both parents.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `user_id` | uuid | **NOT NULL** | — | user |
| `role_id` | uuid | **NOT NULL** | — | role |

### `tbl_entity_team_role` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `label` | text | **NOT NULL** | — | — |
| `can_hold_custody` | boolean | **NOT NULL** | false | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `reports_to_team_role_id` | uuid | — | — | team_role |
| `assignable_by_everyone` | boolean | **NOT NULL** | false | — |

### `tbl_entity_team_role_assigner` · 2 columns

> Join table — which tier may place which.

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `team_role_id` | uuid | **NOT NULL** | — | team_role |
| `assigner_team_role_id` | uuid | **NOT NULL** | — | team_role |


## 5. Vocabularies

### `tbl_entity_category` · 6 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `parent_id` | uuid | — | — | category |
| `default_maintenance_interval_days` | integer | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_company_role` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `code` | text | — | — | — |
| `is_active` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `default_role_id` | uuid | — | — | role |

### `tbl_entity_department` · 7 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `code` | text | — | — | — |
| `is_active` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_division` · 7 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `code` | text | — | — | — |
| `is_active` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_unit_of_measure` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `category_id` | uuid | — | — | uom_category |
| `symbol` | text | **NOT NULL** | — | — |
| `name` | text | **NOT NULL** | — | — |
| `is_active` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_uom_category` · 7 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `code` | text | **NOT NULL** | — | — |
| `is_active` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |


## 6. Configuration

### `tbl_entity_tenant_settings` · 27 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `high_value_threshold` | jsonb | — | — | — |
| `custody_approver_role` | text | — | equipment_admin | — |
| `email_enabled` | boolean | **NOT NULL** | true | — |
| `sms_enabled` | boolean | **NOT NULL** | false | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `llm_enabled` | boolean | **NOT NULL** | false | — |
| `llm_base_url` | text | — | — | — |
| `llm_model` | text | — | — | — |
| `llm_api_key_enc` | text | — | — | — |
| `llm_api_key_hint` | text | — | — | — |
| `llm_timeout_ms` | integer | **NOT NULL** | 15000 | — |
| `llm_last_checked_at` | timestamptz | — | — | — |
| `llm_last_check_ok` | boolean | — | — | — |
| `llm_last_check_error` | text | — | — | — |
| `smtp_host` | text | — | — | — |
| `smtp_port` | integer | — | — | — |
| `smtp_user` | text | — | — | — |
| `smtp_pass_enc` | text | — | — | — |
| `smtp_pass_hint` | text | — | — | — |
| `smtp_from` | text | — | — | — |
| `smtp_last_checked_at` | timestamptz | — | — | — |
| `smtp_last_check_ok` | boolean | — | — | — |
| `smtp_last_check_error` | text | — | — | — |
| `branding_name` | text | — | — | — |
| `branding_layout_mode` | text | **NOT NULL** | icon_and_text | — |

### `tbl_entity_tenant_feature` · 5 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `key` | text | **NOT NULL** | — | — |
| `state` | text | **NOT NULL** | enabled | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_user_preferences` · 12 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `user_id` | uuid | **NOT NULL** | — | user |
| `theme_name` | text | **NOT NULL** | blocky | — |
| `font_family` | text | **NOT NULL** | arial | — |
| `font_scale` | text | **NOT NULL** | 1.0 | — |
| `density` | text | **NOT NULL** | comfortable | — |
| `dashboard` | jsonb | **NOT NULL** | {"widgets": {}} | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `icon_scale` | text | **NOT NULL** | 1.0 | — |
| `radius` | text | **NOT NULL** | soft | — |


## 7. Chat, alerts and audit

### `tbl_ops_channel` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `slug` | text | **NOT NULL** | — | — |
| `kind` | text | **NOT NULL** | department | — |
| `member_role` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_ops_message` · 20 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `channel_id` | uuid | **NOT NULL** | — | channel |
| `author_user_id` | uuid | — | — | user |
| `author_employee_id` | uuid | — | — | employee |
| `body` | text | **NOT NULL** | — | — |
| `mentions` | jsonb | — | — | — |
| `processing_status` | text | **NOT NULL** | queued | — |
| `intent_type` | text | — | — | — |
| `intent_payload` | jsonb | — | — | — |
| `proposed_action` | jsonb | — | — | — |
| `executed_transaction_ids` | jsonb | — | — | — |
| `handled_by_user_id` | uuid | — | — | user |
| `handled_at` | timestamptz | — | — | — |
| `error_note` | text | — | — | — |
| `attempts` | integer | **NOT NULL** | 0 | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |
| `escalation_count` | integer | **NOT NULL** | 0 | — |
| `last_escalated_at` | timestamptz | — | — | — |

### `tbl_ops_notification` · 17 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `recipient_employee_id` | uuid | — | — | employee |
| `recipient_user_id` | uuid | — | — | user |
| `type` | text | **NOT NULL** | — | — |
| `ref_type` | text | — | — | — |
| `ref_id` | uuid | — | — | — |
| `title` | text | **NOT NULL** | — | — |
| `body` | text | — | — | — |
| `channel` | text | — | in_app | — |
| `delivered_at` | timestamptz | — | — | — |
| `read_at` | timestamptz | — | — | — |
| `escalated_at` | timestamptz | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `delivery_attempts` | integer | **NOT NULL** | 0 | — |
| `delivery_error` | text | — | — | — |
| `last_attempt_at` | timestamptz | — | — | — |

### `tbl_ops_event_log` · 19 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | bigint | **NOT NULL** | identity | — |
| `tenant_id` | uuid | — | — | tenant |
| `actor_user_id` | uuid | — | — | — |
| `actor_role` | text | — | — | — |
| `actor_label` | text | — | — | — |
| `category` | text | **NOT NULL** | — | — |
| `action` | text | **NOT NULL** | — | — |
| `entity_type` | text | — | — | — |
| `entity_id` | text | — | — | — |
| `entity_label` | text | — | — | — |
| `result` | text | **NOT NULL** | success | — |
| `error_message` | text | — | — | — |
| `source` | text | — | api | — |
| `http_method` | text | — | — | — |
| `http_path` | text | — | — | — |
| `ip` | text | — | — | — |
| `user_agent` | text | — | — | — |
| `details` | jsonb | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |


## 8. Grouping, sync and contacts

### `tbl_entity_project_group` · 5 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `description` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_project_group_project` · 5 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | — |
| `project_group_id` | uuid | **NOT NULL** | — | project_group |
| `project_id` | uuid | **NOT NULL** | — | project |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_project_group_user` · 5 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | — |
| `project_group_id` | uuid | **NOT NULL** | — | project_group |
| `user_id` | uuid | **NOT NULL** | — | user |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_employee_contact` · 9 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `employee_id` | uuid | **NOT NULL** | — | employee |
| `kind` | text | **NOT NULL** | mobile | — |
| `value` | text | **NOT NULL** | — | — |
| `is_primary` | boolean | **NOT NULL** | false | — |
| `note` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_employee_external_ref` · 10 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `employee_id` | uuid | **NOT NULL** | — | employee |
| `system` | text | **NOT NULL** | — | — |
| `external_id` | text | **NOT NULL** | — | — |
| `last_synced_at` | timestamptz | — | — | — |
| `restricted_fields` | jsonb | — | — | — |
| `raw` | jsonb | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `updated_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_ops_sync_run` · 18 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `source` | text | **NOT NULL** | — | — |
| `mode` | text | **NOT NULL** | preview | — |
| `status` | text | **NOT NULL** | queued | — |
| `requested_by_user_id` | uuid | — | — | user |
| `created_count` | integer | **NOT NULL** | 0 | — |
| `updated_count` | integer | **NOT NULL** | 0 | — |
| `skipped_count` | integer | **NOT NULL** | 0 | — |
| `refused_count` | integer | **NOT NULL** | 0 | — |
| `flagged_count` | integer | **NOT NULL** | 0 | — |
| `detail` | jsonb | — | — | — |
| `attempts` | integer | **NOT NULL** | 0 | — |
| `error_note` | text | — | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |
| `started_at` | timestamptz | — | — | — |
| `finished_at` | timestamptz | — | — | — |
| `last_attempt_at` | timestamptz | — | — | — |


## 9. Vestigial — nothing reads these

### `tbl_entity_asset_model` · 8 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `manufacturer_id` | uuid | — | — | manufacturer |
| `name` | text | **NOT NULL** | — | — |
| `category_id` | uuid | — | — | category |
| `default_unit_cost` | numeric | — | — | — |
| `is_serialized` | boolean | **NOT NULL** | true | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |

### `tbl_entity_manufacturer` · 4 columns

| Column | Type | Null | Default | → |
|---|---|---|---|---|
| `id` | uuid | **NOT NULL** | uuid | — |
| `tenant_id` | uuid | **NOT NULL** | — | tenant |
| `name` | text | **NOT NULL** | — | — |
| `created_at` | timestamptz | **NOT NULL** | now() | — |


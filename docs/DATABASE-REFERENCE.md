# Database reference — every table, every field

**Generated 2026-09-14** from the live local database (`optix`), not from the
schema files — so this is what actually exists. 46 tables, 498 columns.

Read the changes section first; the tables below are the current state, which
includes the names we have agreed to change.

---

# WHAT WE ARE CHANGING

Six items, agreed with the client on 2026-09-14. **None is done yet.** They are
ordered by dependency — 3 is unsafe before 2, and 1 is actively wrong today so
it goes first.

## The naming rule these enforce

One word for one idea, settled with the client 2026-09-07:

- **`code`** is the COMPANY's own identifier. Urban assigns it. Every entity has
  one, spelled the same way: `employee.code`, `project.code`, `asset.code`,
  `vehicle.code`.
- **`serial_number`** is the MANUFACTURER's. Only small tools carry one.
- **`vin`** is the manufacturer's permanent identity for a vehicle.
- **`plate`** is the registration.
- **`external_id`** is a foreign system's key (BambooHR's `4471`) and never
  lives on the entity — it goes in a child ref table.

Anything else that identifies a row is only allowed if it is a **genuinely
different fact**. A second name for the same value is not.

## 1. Fix the swapped labels on the tool form — ACTIVELY WRONG

`apps/web/components/asset-form.tsx`

| Line | Says | Writes to | Should say |
|---|---|---|---|
| 145 | "Tag" | `code` | **"Code"** — `tag` was renamed 2026-09-07 |
| 182 | "Code" | `serial_number` | **"Serial number"** |

So somebody typing into the box marked **Code** is writing the **serial**. This
conflates the exact two fields the client distinguished, and it corrupts data
today. Two lines. Do it first, independent of everything else.

## 2. Build a code generator for small tools — NOT BUILT

The client's rule: *"we also generate a code for it, or assign a code if
importing."*

Today nothing mints a code. `asset.is_manual_code` is only a FLAG recording
whether a human typed it; there is no generator anywhere (verified: no
`generateCode`/`nextCode`/`mintCode` in the codebase). So `asset.code` is
nullable and frequently null.

**This is the real work in this list**, and it is what makes item 3 safe.

**OPEN QUESTION — needed before building it:** what shape is a generated code?
The form's placeholder suggests `UIC-2001`. Is that the convention, sequential
per tenant? And should a generated code be visibly distinguishable from one
Urban assigned, or indistinguishable?

## 3. Drop `asset.asset_number` — the "reference number"

The client: *"no reference_no field on small tools."*

`asset_number` is a database-generated counter, `notNull`, shown as a column on
`/tools` and on the tool detail page. Its stated justification was that Urban's
sheets carry no tool-ID column, so it was "what a report can always point to".

**Item 2 removes that premise.** Once every tool has a code, the counter is a
third identifier with no job.

~19 sites, including `assetNumberDisplay()` in `apps/web/lib/format.ts`, the
`/tools` column, the detail page, two entity-resolver label builders and an
index. **Unsafe before item 2** — dropping the fallback before the replacement
exists would leave untagged tools with nothing to point at.

## 4. Drop `vehicle.unit` — a duplicate of `code`

Verified against the real fleet: **all 88 vehicles have `unit` and `code` set
to the identical value** (`unit: "TRK-003", code: "TRK-003"`). Zero of 88
differ. It is one field stored twice.

`unit` is `notNull` and `code` is nullable, so the migration is: copy `unit` →
`code` where null, make `code` notNull, drop `unit`. It also touches the import
spec's only other required field and the one-truck-per-foreman unique index.

**136 references across 26 files.**

## 5. `tbl_entity_asset` → `tbl_entity_small_tool`

The client: *"remove calling small tools asset at table level."*

Right: the table holds ONLY small tools — drills, saws, grinders, generators,
survey gear. No excavators, no trucks. "Asset" could mean a building or a
laptop. The file header already says "small tools are the first-class entity".

**619 references across 50 files, 4 incoming foreign keys.**

**DO NOT rename in the same pass:** the permission strings (`asset.read`,
`asset.manage`, `assets.view.*`) and the tRPC route names (`asset.list`). Those
six permissions are ROWS in `tbl_entity_permission` granted to roles; renaming
them needs a grants migration, and this repo's own rules record that permission
changes have already cost three tickets by reaching fresh databases and not live
ones. Renaming them buys nothing a user sees. The UI already says "Small Tools".

## 6. `tbl_entity_vehicle` → `tbl_entity_equipment`

The client: *"equipment table not vehicle table."*

The UI already says Equipment; only the table lags. It was kept because renaming
reaches the composite foreign keys behind custody
(`assignment.truck_id`/`trailer_id` reference `vehicle(id, vehicle_type)`) — so
this one needs care, not just a substitution.

Note `vehicle_type` (truck | trailer) STAYS. It is load-bearing: those composite
FKs depend on the two literal values, which is why migration 0073 constrains it.

---

# CURRENT STATE — all 46 tables

Types are as Postgres reports them. `jsonb` columns holding a single number are
a historical quirk, not a design.

**Every table carries `tenant_id` except five**, each deliberately:
`tbl_entity_tenant` (it IS the tenant), `tbl_entity_permission` (a global
vocabulary — `asset.manage` must mean the same everywhere),
`tbl_entity_role_permission`, `tbl_entity_user_role` and
`tbl_entity_team_role_assigner` (join tables, whose parents carry it).

## Core entities — the things Urban owns

### `tbl_entity_asset` — 29 columns

> **CHANGING (items 3 + 5).** Renaming to `tbl_entity_small_tool`, and dropping
> `asset_number`. The two identifiers that STAY are `code` (Urban's, generated
> or assigned) and `serial_number` (the manufacturer's, often missing or faded).

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `code` | text | null ok |
| `model_id` | uuid | null ok |
| `category_name` | text | null ok |
| `serial_number` | text | null ok |
| `is_serialized` | boolean | NOT NULL |
| `quantity` | integer | NOT NULL |
| `acquisition_cost` | numeric | null ok |
| `acquisition_date` | date | null ok |
| `owning_project_id` | uuid | null ok |
| `warranty_expires_on` | date | null ok |
| `current_status` | text | NOT NULL |
| `current_custodian_id` | uuid | null ok |
| `current_project_id` | uuid | null ok |
| `current_location_id` | uuid | null ok |
| `condition` | text | null ok |
| `created_by` | uuid | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `photo_key` | text | null ok |
| `make` | text | null ok |
| `model_number` | text | null ok |
| `description` | text | null ok |
| `other_ref` | text | null ok |
| `cost_target` | text | NOT NULL |
| `owning_department_id` | uuid | null ok |
| `asset_number` | bigint | NOT NULL |
| `is_manual_code` | boolean | NOT NULL |

### `tbl_entity_vehicle` — 25 columns

> **CHANGING (items 4 + 6).** Renaming to `tbl_entity_equipment`, and dropping
> `unit` — all 88 rows have `unit` = `code`. `vehicle_type` STAYS (load-bearing
> for the custody composite FKs). `vin` and `plate` stay: different facts.

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `location_id` | uuid | NOT NULL |
| `vehicle_type` | text | NOT NULL |
| `unit` | text | NOT NULL |
| `plate` | text | null ok |
| `make_model` | text | null ok |
| `ownership_type` | text | NOT NULL |
| `payee_employee_id` | uuid | null ok |
| `allowance_rate` | numeric | null ok |
| `allowance_frequency` | text | null ok |
| `gps_lat` | numeric | null ok |
| `gps_lng` | numeric | null ok |
| `gps_at` | timestamptz | null ok |
| `gps_source` | text | null ok |
| `project_id` | uuid | null ok |
| `foreman_employee_id` | uuid | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `equipment_class` | text | NOT NULL |
| `can_attach` | boolean | NOT NULL |
| `is_attachable` | boolean | NOT NULL |
| `code` | text | null ok |
| `description` | text | null ok |
| `vin` | text | null ok |

### `tbl_entity_project` — 15 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `code` | text | null ok |
| `name` | text | NOT NULL |
| `status` | text | NOT NULL |
| `start_date` | date | NOT NULL |
| `end_date` | date | null ok |
| `site_address` | text | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `description` | text | null ok |
| `latitude` | numeric | null ok |
| `longitude` | numeric | null ok |
| `geofence_radius_m` | integer | null ok |
| `kind` | text | NOT NULL |

### `tbl_entity_employee` — 20 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `code` | text | null ok |
| `name` | text | NOT NULL |
| `role` | text | NOT NULL |
| `primary_project_id` | uuid | null ok |
| `employment_status` | text | NOT NULL |
| `terminated_at` | timestamptz | null ok |
| `reports_to_employee_id` | uuid | null ok |
| `email` | text | null ok |
| `phone` | text | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `company_role_id` | uuid | null ok |
| `role_id` | uuid | null ok |
| `division_id` | uuid | null ok |
| `department_id` | uuid | null ok |
| `hr_flagged_inactive_at` | timestamptz | null ok |
| `creation_source` | text | NOT NULL |
| `created_by_user_id` | uuid | null ok |

### `tbl_entity_location` — 9 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `type` | text | NOT NULL |
| `name` | text | NOT NULL |
| `warehouse_id` | uuid | null ok |
| `project_id` | uuid | null ok |
| `parent_location_id` | uuid | null ok |
| `custodian_employee_id` | uuid | null ok |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_warehouse` — 6 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `region` | text | null ok |
| `address` | text | null ok |
| `created_at` | timestamptz | NOT NULL |


## Operations — what happens to them

### `tbl_ops_transaction` — 12 columns

| Column | Type | Null |
|---|---|---|
| `id` | bigint | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `asset_id` | uuid | NOT NULL |
| `event_type` | text | NOT NULL |
| `actor_id` | uuid | null ok |
| `from_state` | jsonb | null ok |
| `to_state` | jsonb | null ok |
| `ref_type` | text | null ok |
| `ref_id` | uuid | null ok |
| `occurred_at` | timestamptz | NOT NULL |
| `note` | text | null ok |
| `ref_message_id` | uuid | null ok |

### `tbl_ops_smalltools_custody` — 16 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `asset_id` | uuid | NOT NULL |
| `custodian_id` | uuid | NOT NULL |
| `project_id` | uuid | null ok |
| `location_id` | uuid | null ok |
| `start_date` | date | NOT NULL |
| `status` | text | NOT NULL |
| `approved_by` | uuid | null ok |
| `returned_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `truck_id` | uuid | null ok |
| `trailer_id` | uuid | null ok |
| `truck_kind` | text | null ok |
| `trailer_kind` | text | null ok |

### `tbl_ops_transfer` — 20 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `asset_id` | uuid | NOT NULL |
| `from_custodian_id` | uuid | null ok |
| `to_custodian_id` | uuid | null ok |
| `from_location_id` | uuid | null ok |
| `to_location_id` | uuid | null ok |
| `from_project_id` | uuid | null ok |
| `to_project_id` | uuid | null ok |
| `reason` | text | NOT NULL |
| `status` | text | NOT NULL |
| `requested_by` | uuid | NOT NULL |
| `approved_by` | uuid | null ok |
| `completed_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `to_truck_id` | uuid | null ok |
| `to_trailer_id` | uuid | null ok |
| `to_truck_kind` | text | null ok |
| `to_trailer_kind` | text | null ok |

### `tbl_ops_task` — 25 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `title` | text | NOT NULL |
| `description` | text | null ok |
| `status` | text | NOT NULL |
| `priority` | text | NOT NULL |
| `assigned_to_employee_id` | uuid | null ok |
| `created_by_user_id` | uuid | null ok |
| `related_asset_id` | uuid | null ok |
| `related_project_id` | uuid | null ok |
| `source` | text | NOT NULL |
| `source_message_id` | uuid | null ok |
| `action_type` | text | null ok |
| `pending_action` | jsonb | null ok |
| `requested_by_employee_id` | uuid | null ok |
| `department` | text | null ok |
| `decline_reason` | text | null ok |
| `escalation_count` | integer | NOT NULL |
| `last_escalated_at` | timestamptz | null ok |
| `due_date` | timestamptz | null ok |
| `completed_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `classification` | text | null ok |
| `llm_summary` | text | null ok |

### `tbl_ops_project_team_member` — 14 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `project_id` | uuid | NOT NULL |
| `employee_id` | uuid | NOT NULL |
| `role` | text | NOT NULL |
| `assigned_by_user_id` | uuid | null ok |
| `started_on` | date | NOT NULL |
| `ended_on` | date | null ok |
| `note` | text | null ok |
| `created_at` | timestamptz | NOT NULL |
| `source` | text | NOT NULL |
| `reports_to_employee_id` | uuid | null ok |
| `confirmed_at` | timestamptz | null ok |
| `confirmed_by_user_id` | uuid | null ok |

### `tbl_ops_employee_project_assignment` — 9 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `employee_id` | uuid | NOT NULL |
| `project_id` | uuid | NOT NULL |
| `started_on` | date | NOT NULL |
| `ended_on` | date | null ok |
| `assigned_by_user_id` | uuid | null ok |
| `note` | text | null ok |
| `created_at` | timestamptz | NOT NULL |

### `tbl_ops_project_role_deferral` — 9 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `project_id` | uuid | NOT NULL |
| `team_role` | text | NOT NULL |
| `deferred_by_user_id` | uuid | null ok |
| `deferred_to_employee_id` | uuid | null ok |
| `note` | text | null ok |
| `resolved_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |

### `tbl_ops_project_access_restriction` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `project_id` | uuid | NOT NULL |
| `employee_id` | uuid | NOT NULL |
| `created_by_user_id` | uuid | null ok |
| `reason` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `restored_at` | timestamptz | null ok |


## Identity and access

### `tbl_entity_tenant` — 4 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `slug` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_user` — 12 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `employee_id` | uuid | null ok |
| `email` | text | NOT NULL |
| `password_hash` | text | NOT NULL |
| `first_name` | text | NOT NULL |
| `last_name` | text | NOT NULL |
| `is_active` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `must_change_password` | boolean | NOT NULL |
| `email_verified_at` | timestamptz | null ok |
| `last_sign_in_at` | timestamptz | null ok |

### `tbl_entity_session` — 4 columns

| Column | Type | Null |
|---|---|---|
| `id` | text | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `expires_at` | timestamptz | NOT NULL |

### `tbl_entity_role` — 12 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | null ok |
| `name` | text | NOT NULL |
| `description` | text | null ok |
| `needs_login` | boolean | NOT NULL |
| `can_hold_custody` | boolean | NOT NULL |
| `uses_field_layout` | boolean | NOT NULL |
| `is_system` | boolean | NOT NULL |
| `onboarding_kind` | text | NOT NULL |
| `is_cross_tenant` | boolean | NOT NULL |
| `claim_tier_names` | jsonb | NOT NULL |
| `category` | text | null ok |

### `tbl_entity_permission` — 2 columns

| Column | Type | Null |
|---|---|---|
| `name` | text | NOT NULL |
| `description` | text | null ok |

### `tbl_entity_role_permission` — 2 columns

| Column | Type | Null |
|---|---|---|
| `role_id` | uuid | NOT NULL |
| `permission_name` | text | NOT NULL |

### `tbl_entity_user_role` — 2 columns

| Column | Type | Null |
|---|---|---|
| `user_id` | uuid | NOT NULL |
| `role_id` | uuid | NOT NULL |

### `tbl_entity_auth_token` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `token_hash` | text | NOT NULL |
| `kind` | text | NOT NULL |
| `expires_at` | timestamptz | NOT NULL |
| `consumed_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_team_role` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `label` | text | NOT NULL |
| `can_hold_custody` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `reports_to_team_role_id` | uuid | null ok |
| `assignable_by_everyone` | boolean | NOT NULL |

### `tbl_entity_team_role_assigner` — 2 columns

| Column | Type | Null |
|---|---|---|
| `team_role_id` | uuid | NOT NULL |
| `assigner_team_role_id` | uuid | NOT NULL |


## Reference data — vocabularies

### `tbl_entity_category` — 6 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `parent_id` | uuid | null ok |
| `default_maintenance_interval_days` | integer | null ok |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_company_role` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `code` | text | null ok |
| `is_active` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `default_role_id` | uuid | null ok |

### `tbl_entity_department` — 7 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `code` | text | null ok |
| `is_active` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_entity_division` — 7 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `code` | text | null ok |
| `is_active` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_entity_unit_of_measure` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `category_id` | uuid | null ok |
| `symbol` | text | NOT NULL |
| `name` | text | NOT NULL |
| `is_active` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_entity_uom_category` — 7 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `code` | text | NOT NULL |
| `is_active` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |


## Configuration

### `tbl_entity_tenant_settings` — 27 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `high_value_threshold` | jsonb | null ok |
| `custody_approver_role` | text | null ok |
| `email_enabled` | boolean | NOT NULL |
| `sms_enabled` | boolean | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `llm_enabled` | boolean | NOT NULL |
| `llm_base_url` | text | null ok |
| `llm_model` | text | null ok |
| `llm_api_key_enc` | text | null ok |
| `llm_api_key_hint` | text | null ok |
| `llm_timeout_ms` | integer | NOT NULL |
| `llm_last_checked_at` | timestamptz | null ok |
| `llm_last_check_ok` | boolean | null ok |
| `llm_last_check_error` | text | null ok |
| `smtp_host` | text | null ok |
| `smtp_port` | integer | null ok |
| `smtp_user` | text | null ok |
| `smtp_pass_enc` | text | null ok |
| `smtp_pass_hint` | text | null ok |
| `smtp_from` | text | null ok |
| `smtp_last_checked_at` | timestamptz | null ok |
| `smtp_last_check_ok` | boolean | null ok |
| `smtp_last_check_error` | text | null ok |
| `branding_name` | text | null ok |
| `branding_layout_mode` | text | NOT NULL |

### `tbl_entity_tenant_feature` — 5 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `key` | text | NOT NULL |
| `state` | text | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_entity_user_preferences` — 12 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `theme_name` | text | NOT NULL |
| `font_family` | text | NOT NULL |
| `font_scale` | text | NOT NULL |
| `density` | text | NOT NULL |
| `dashboard` | jsonb | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `icon_scale` | text | NOT NULL |
| `radius` | text | NOT NULL |


## Messaging and notifications

### `tbl_ops_channel` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `slug` | text | NOT NULL |
| `kind` | text | NOT NULL |
| `member_role` | text | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_ops_message` — 20 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `channel_id` | uuid | NOT NULL |
| `author_user_id` | uuid | null ok |
| `author_employee_id` | uuid | null ok |
| `body` | text | NOT NULL |
| `mentions` | jsonb | null ok |
| `processing_status` | text | NOT NULL |
| `intent_type` | text | null ok |
| `intent_payload` | jsonb | null ok |
| `proposed_action` | jsonb | null ok |
| `executed_transaction_ids` | jsonb | null ok |
| `handled_by_user_id` | uuid | null ok |
| `handled_at` | timestamptz | null ok |
| `error_note` | text | null ok |
| `attempts` | integer | NOT NULL |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `escalation_count` | integer | NOT NULL |
| `last_escalated_at` | timestamptz | null ok |

### `tbl_ops_notification` — 17 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `recipient_employee_id` | uuid | null ok |
| `recipient_user_id` | uuid | null ok |
| `type` | text | NOT NULL |
| `ref_type` | text | null ok |
| `ref_id` | uuid | null ok |
| `title` | text | NOT NULL |
| `body` | text | null ok |
| `channel` | text | null ok |
| `delivered_at` | timestamptz | null ok |
| `read_at` | timestamptz | null ok |
| `escalated_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |
| `delivery_attempts` | integer | NOT NULL |
| `delivery_error` | text | null ok |
| `last_attempt_at` | timestamptz | null ok |

### `tbl_ops_event_log` — 19 columns

| Column | Type | Null |
|---|---|---|
| `id` | bigint | NOT NULL |
| `tenant_id` | uuid | null ok |
| `actor_user_id` | uuid | null ok |
| `actor_role` | text | null ok |
| `actor_label` | text | null ok |
| `category` | text | NOT NULL |
| `action` | text | NOT NULL |
| `entity_type` | text | null ok |
| `entity_id` | text | null ok |
| `entity_label` | text | null ok |
| `result` | text | NOT NULL |
| `error_message` | text | null ok |
| `source` | text | null ok |
| `http_method` | text | null ok |
| `http_path` | text | null ok |
| `ip` | text | null ok |
| `user_agent` | text | null ok |
| `details` | jsonb | null ok |
| `created_at` | timestamptz | NOT NULL |


## Grouping, sync, onboarding

### `tbl_entity_project_group` — 5 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `description` | text | null ok |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_project_group_project` — 5 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `project_group_id` | uuid | NOT NULL |
| `project_id` | uuid | NOT NULL |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_project_group_user` — 5 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `project_group_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_employee_contact` — 9 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `employee_id` | uuid | NOT NULL |
| `kind` | text | NOT NULL |
| `value` | text | NOT NULL |
| `is_primary` | boolean | NOT NULL |
| `note` | text | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_entity_employee_external_ref` — 10 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `employee_id` | uuid | NOT NULL |
| `system` | text | NOT NULL |
| `external_id` | text | NOT NULL |
| `last_synced_at` | timestamptz | null ok |
| `restricted_fields` | jsonb | null ok |
| `raw` | jsonb | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |

### `tbl_ops_sync_run` — 18 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `source` | text | NOT NULL |
| `mode` | text | NOT NULL |
| `status` | text | NOT NULL |
| `requested_by_user_id` | uuid | null ok |
| `created_count` | integer | NOT NULL |
| `updated_count` | integer | NOT NULL |
| `skipped_count` | integer | NOT NULL |
| `refused_count` | integer | NOT NULL |
| `flagged_count` | integer | NOT NULL |
| `detail` | jsonb | null ok |
| `attempts` | integer | NOT NULL |
| `error_note` | text | null ok |
| `created_at` | timestamptz | NOT NULL |
| `started_at` | timestamptz | null ok |
| `finished_at` | timestamptz | null ok |
| `last_attempt_at` | timestamptz | null ok |

### `tbl_ops_user_onboarding` — 10 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `user_id` | uuid | NOT NULL |
| `current_step` | text | NOT NULL |
| `started_at` | timestamptz | NOT NULL |
| `completed_at` | timestamptz | null ok |
| `created_at` | timestamptz | NOT NULL |
| `updated_at` | timestamptz | NOT NULL |
| `dismissed_at` | timestamptz | null ok |
| `claiming_closed_at` | timestamptz | null ok |


## Vestigial — nothing reads these

### `tbl_entity_asset_model` — 8 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `manufacturer_id` | uuid | null ok |
| `name` | text | NOT NULL |
| `category_id` | uuid | null ok |
| `default_unit_cost` | numeric | null ok |
| `is_serialized` | boolean | NOT NULL |
| `created_at` | timestamptz | NOT NULL |

### `tbl_entity_manufacturer` — 4 columns

| Column | Type | Null |
|---|---|---|
| `id` | uuid | NOT NULL |
| `tenant_id` | uuid | NOT NULL |
| `name` | text | NOT NULL |
| `created_at` | timestamptz | NOT NULL |


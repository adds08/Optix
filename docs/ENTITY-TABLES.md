# Entity tables — current structure and proposed changes

**Generated 2026-09-14** from the live `optix` database. **32 entity tables,
293 columns.** Operational tables (`tbl_ops_*`, 14 more) are in
[DATABASE-REFERENCE.md](DATABASE-REFERENCE.md); this document is the entities
and what changes about them.

🔴 = being dropped. Everything else in the Change column either changes
nullability or is called out because it looks like a candidate and is NOT.

---

## The proposed changes, in one table

| # | Table | Change | Refs | Risk |
|---|---|---|---|---|
| 1 | — | Fix swapped labels on the tool form (`asset-form.tsx:145,182`) | 2 lines | **none — it is wrong today** |
| 2 | `tbl_entity_asset` | **Build a code generator.** Nothing mints a code today | new code | low, but it is new behaviour |
| 3 | `tbl_entity_asset` | Drop `asset_number` (the "reference number") | ~19 | **unsafe before 2** |
| 4 | `tbl_entity_vehicle` | Drop `unit` — all 88 rows have `unit` = `code` | 136 / 26 files | low |
| 5 | `tbl_entity_asset` | Rename → `tbl_entity_small_tool` | 619 / 50 files, 4 FKs | medium |
| 6 | `tbl_entity_vehicle` | Rename → `tbl_entity_equipment` | similar, + custody FKs | medium |
| 7 | `tbl_entity_location` | Remove `gang_box` and `site_container` from `type` | 6 sites | low |

**Nothing here is done.** Items 3–7 need a migration each; 5 and 6 also need
the Drizzle export renamed (`schema.asset` → `schema.smallTool`).

## The naming rule all of this enforces

- **`code`** — the COMPANY's identifier. Urban assigns or the system generates
  it. Spelled the same on every entity.
- **`serial_number`** — the MANUFACTURER's. Small tools only. Often absent or
  faded, which is exactly why `code` must always exist.
- **`vin`** — the manufacturer's permanent identity. Equipment only.
- **`plate`** — the registration. Reassigned over time, so not an identity.
- **`external_id`** — a foreign system's key. Never on the entity; it lives in
  a child ref table (`tbl_entity_employee_external_ref`).

Two identifiers on small tools, for the reason the client gave: there are
hundreds of them, a serial is the natural key, but not every tool has a
readable one — so a code is generated or assigned to guarantee one exists.

## What is NOT changing, and why

| | Why |
|---|---|
| `vehicle_type` (truck \| trailer) | Load-bearing. `assignment.truck_id`/`trailer_id` reference `vehicle(id, vehicle_type)` through composite FKs with a generated constant; migration 0073 constrains it to those two values. A third value breaks custody. |
| Permission strings (`asset.read`, `assets.view.*`) | They are ROWS in `tbl_entity_permission` granted to roles. Renaming needs a grants migration, and this repo has already spent three tickets on permission changes reaching fresh databases and not live ones. No user sees them. |
| tRPC routes (`asset.list`) | Same reasoning — internal, invisible, and a rename churns every client call site for nothing. |
| `employee.role` | Legacy and abandoned. Read `role_id`. Documented as "do not add a new reader". |
| `asset.serial_number` | The manufacturer's — a genuinely different fact from `code`. |
| `tbl_entity_asset_model` / `manufacturer` | Vestigial: nothing reads or writes them. Left for their own change rather than tangled into a rename. |

## One open question, blocking item 2

**What shape is a generated code?** The tool form's placeholder suggests
`UIC-2001`. Is that the convention, sequential per tenant? And should a
generated code be visibly distinguishable from one Urban assigned by hand, or
indistinguishable?

`is_manual_code` already records WHICH it was, so the data supports either
answer — this is a decision about what a person should see.

---

# The 32 entity tables

## 1. The things Urban owns

### `tbl_entity_asset` → **`tbl_entity_small_tool`** · 29 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `code` | text | — | — | — | **becomes NOT NULL** once the generator exists (item 2) |
| `model_id` | uuid | — | — | FK->asset_model | — |
| `category_name` | text | — | — | — | — |
| `serial_number` | text | — | — | — | stays — the MANUFACTURER's, often missing or faded |
| `is_serialized` | boolean | NOT NULL | true | — | — |
| `quantity` | integer | NOT NULL | 1 | — | — |
| `acquisition_cost` | numeric | — | — | — | — |
| `acquisition_date` | date | — | — | — | — |
| `owning_project_id` | uuid | — | — | FK->project | — |
| `warranty_expires_on` | date | — | — | — | — |
| `current_status` | text | NOT NULL | 'available' | — | — |
| `current_custodian_id` | uuid | — | — | FK->employee | — |
| `current_project_id` | uuid | — | — | FK->project | — |
| `current_location_id` | uuid | — | — | FK->location | — |
| `condition` | text | — | 'good' | — | — |
| `created_by` | uuid | — | — | FK->user | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `photo_key` | text | — | — | — | — |
| `make` | text | — | — | — | — |
| `model_number` | text | — | — | — | — |
| `description` | text | — | — | — | — |
| `other_ref` | text | — | — | — | — |
| `cost_target` | text | NOT NULL | 'project' | — | — |
| `owning_department_id` | uuid | — | — | FK->department | — |
| `asset_number` | bigint | NOT NULL | — | — | 🔴 **DROP** |
| `is_manual_code` | boolean | NOT NULL | false | — | keeps its meaning: did a human type the code, or was it generated |

### `tbl_entity_vehicle` → **`tbl_entity_equipment`** · 25 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `location_id` | uuid | NOT NULL | — | FK->location | — |
| `vehicle_type` | text | NOT NULL | — | — | STAYS — load-bearing for the custody composite FKs |
| `unit` | text | NOT NULL | — | — | 🔴 **DROP** |
| `plate` | text | — | — | — | stays — the registration, reassigned over time |
| `make_model` | text | — | — | — | — |
| `ownership_type` | text | NOT NULL | 'company_owned' | — | — |
| `payee_employee_id` | uuid | — | — | FK->employee | — |
| `allowance_rate` | numeric | — | — | — | — |
| `allowance_frequency` | text | — | — | — | — |
| `gps_lat` | numeric | — | — | — | — |
| `gps_lng` | numeric | — | — | — | — |
| `gps_at` | timestamptz | — | — | — | — |
| `gps_source` | text | — | — | — | — |
| `project_id` | uuid | — | — | FK->project | — |
| `foreman_employee_id` | uuid | — | — | FK->employee | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `equipment_class` | text | NOT NULL | 'vehicle' | — | — |
| `can_attach` | boolean | NOT NULL | false | — | — |
| `is_attachable` | boolean | NOT NULL | false | — | — |
| `code` | text | — | — | — | **becomes NOT NULL** — backfilled from `unit` |
| `description` | text | — | — | — | — |
| `vin` | text | — | — | — | stays — manufacturer's, permanent, nullable and unconstrained on purpose |

### `tbl_entity_project` · 15 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `code` | text | — | — | — | — |
| `name` | text | NOT NULL | — | — | — |
| `status` | text | NOT NULL | 'not_awarded' | — | — |
| `start_date` | date | NOT NULL | — | — | — |
| `end_date` | date | — | — | — | — |
| `site_address` | text | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `description` | text | — | — | — | — |
| `latitude` | numeric | — | — | — | — |
| `longitude` | numeric | — | — | — | — |
| `geofence_radius_m` | integer | — | — | — | — |
| `kind` | text | NOT NULL | 'project' | — | — |

### `tbl_entity_employee` · 20 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `code` | text | — | — | — | — |
| `name` | text | NOT NULL | — | — | — |
| `role` | text | NOT NULL | 'foreman' | — | — |
| `primary_project_id` | uuid | — | — | FK->project | — |
| `employment_status` | text | NOT NULL | 'active' | — | — |
| `terminated_at` | timestamptz | — | — | — | — |
| `reports_to_employee_id` | uuid | — | — | FK->employee | — |
| `email` | text | — | — | — | — |
| `phone` | text | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `company_role_id` | uuid | — | — | FK->company_role | — |
| `role_id` | uuid | — | — | FK->role | — |
| `division_id` | uuid | — | — | FK->division | — |
| `department_id` | uuid | — | — | FK->department | — |
| `hr_flagged_inactive_at` | timestamptz | — | — | — | — |
| `creation_source` | text | NOT NULL | 'unknown' | — | — |
| `created_by_user_id` | uuid | — | — | FK->user | — |

### `tbl_entity_location` · 9 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `type` | text | NOT NULL | — | — | **two values removed**: `gang_box` and `site_container` (D2) |
| `name` | text | NOT NULL | — | — | — |
| `warehouse_id` | uuid | — | — | FK->warehouse | — |
| `project_id` | uuid | — | — | FK->project | — |
| `parent_location_id` | uuid | — | — | FK->location | — |
| `custodian_employee_id` | uuid | — | — | FK->employee | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_warehouse` · 6 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `region` | text | — | — | — | — |
| `address` | text | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |


## 2. Identity, access and authority

### `tbl_entity_tenant` · 4 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `name` | text | NOT NULL | — | — | — |
| `slug` | text | NOT NULL | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_user` · 12 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `employee_id` | uuid | — | — | — | — |
| `email` | text | NOT NULL | — | — | — |
| `password_hash` | text | NOT NULL | — | — | — |
| `first_name` | text | NOT NULL | — | — | — |
| `last_name` | text | NOT NULL | — | — | — |
| `is_active` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `must_change_password` | boolean | NOT NULL | false | — | — |
| `email_verified_at` | timestamptz | — | — | — | — |
| `last_sign_in_at` | timestamptz | — | — | — | — |

### `tbl_entity_session` · 4 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | text | NOT NULL | — | — | — |
| `user_id` | uuid | NOT NULL | — | FK->user | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `expires_at` | timestamptz | NOT NULL | — | — | — |

### `tbl_entity_auth_token` · 8 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `user_id` | uuid | NOT NULL | — | FK->user | — |
| `token_hash` | text | NOT NULL | — | — | — |
| `kind` | text | NOT NULL | — | — | — |
| `expires_at` | timestamptz | NOT NULL | — | — | — |
| `consumed_at` | timestamptz | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_role` · 12 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | — | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `description` | text | — | — | — | — |
| `needs_login` | boolean | NOT NULL | true | — | — |
| `can_hold_custody` | boolean | NOT NULL | false | — | — |
| `uses_field_layout` | boolean | NOT NULL | false | — | — |
| `is_system` | boolean | NOT NULL | false | — | — |
| `onboarding_kind` | text | NOT NULL | 'equipment' | — | — |
| `is_cross_tenant` | boolean | NOT NULL | false | — | — |
| `claim_tier_names` | jsonb | NOT NULL | '[]' | — | — |
| `category` | text | — | — | — | — |

### `tbl_entity_permission` · 2 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `name` | text | NOT NULL | — | — | — |
| `description` | text | — | — | — | — |

### `tbl_entity_role_permission` · 2 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `role_id` | uuid | NOT NULL | — | FK->role | — |
| `permission_name` | text | NOT NULL | — | FK->permission | — |

### `tbl_entity_user_role` · 2 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `user_id` | uuid | NOT NULL | — | FK->user | — |
| `role_id` | uuid | NOT NULL | — | FK->role | — |

### `tbl_entity_team_role` · 8 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `label` | text | NOT NULL | — | — | — |
| `can_hold_custody` | boolean | NOT NULL | false | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `reports_to_team_role_id` | uuid | — | — | FK->team_role | — |
| `assignable_by_everyone` | boolean | NOT NULL | false | — | — |

### `tbl_entity_team_role_assigner` · 2 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `team_role_id` | uuid | NOT NULL | — | FK->team_role | — |
| `assigner_team_role_id` | uuid | NOT NULL | — | FK->team_role | — |


## 3. Vocabularies (reference data)

### `tbl_entity_category` · 6 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `parent_id` | uuid | — | — | FK->category | — |
| `default_maintenance_interval_days` | integer | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_company_role` · 8 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `code` | text | — | — | — | — |
| `is_active` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `default_role_id` | uuid | — | — | FK->role | — |

### `tbl_entity_department` · 7 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `code` | text | — | — | — | — |
| `is_active` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_division` · 7 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `code` | text | — | — | — | — |
| `is_active` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_unit_of_measure` · 8 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `category_id` | uuid | — | — | FK->uom_category | — |
| `symbol` | text | NOT NULL | — | — | — |
| `name` | text | NOT NULL | — | — | — |
| `is_active` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_uom_category` · 7 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `code` | text | NOT NULL | — | — | — |
| `is_active` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |


## 4. Configuration

### `tbl_entity_tenant_settings` · 27 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `high_value_threshold` | jsonb | — | — | — | — |
| `custody_approver_role` | text | — | 'equipment_admin' | — | — |
| `email_enabled` | boolean | NOT NULL | true | — | — |
| `sms_enabled` | boolean | NOT NULL | false | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `llm_enabled` | boolean | NOT NULL | false | — | — |
| `llm_base_url` | text | — | — | — | — |
| `llm_model` | text | — | — | — | — |
| `llm_api_key_enc` | text | — | — | — | — |
| `llm_api_key_hint` | text | — | — | — | — |
| `llm_timeout_ms` | integer | NOT NULL | 15000 | — | — |
| `llm_last_checked_at` | timestamptz | — | — | — | — |
| `llm_last_check_ok` | boolean | — | — | — | — |
| `llm_last_check_error` | text | — | — | — | — |
| `smtp_host` | text | — | — | — | — |
| `smtp_port` | integer | — | — | — | — |
| `smtp_user` | text | — | — | — | — |
| `smtp_pass_enc` | text | — | — | — | — |
| `smtp_pass_hint` | text | — | — | — | — |
| `smtp_from` | text | — | — | — | — |
| `smtp_last_checked_at` | timestamptz | — | — | — | — |
| `smtp_last_check_ok` | boolean | — | — | — | — |
| `smtp_last_check_error` | text | — | — | — | — |
| `branding_name` | text | — | — | — | — |
| `branding_layout_mode` | text | NOT NULL | 'icon_and_text' | — | — |

### `tbl_entity_tenant_feature` · 5 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `key` | text | NOT NULL | — | — | — |
| `state` | text | NOT NULL | 'enabled' | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_user_preferences` · 12 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `user_id` | uuid | NOT NULL | — | FK->user | — |
| `theme_name` | text | NOT NULL | 'blocky' | — | — |
| `font_family` | text | NOT NULL | 'arial' | — | — |
| `font_scale` | text | NOT NULL | '1.0' | — | — |
| `density` | text | NOT NULL | 'comfortable' | — | — |
| `dashboard` | jsonb | NOT NULL | '{"widgets": {}}' | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |
| `icon_scale` | text | NOT NULL | '1.0' | — | — |
| `radius` | text | NOT NULL | 'soft' | — | — |


## 5. Grouping and links

### `tbl_entity_project_group` · 5 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `description` | text | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_project_group_project` · 5 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | — | — |
| `project_group_id` | uuid | NOT NULL | — | FK->project_group | — |
| `project_id` | uuid | NOT NULL | — | FK->project | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_project_group_user` · 5 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | — | — |
| `project_group_id` | uuid | NOT NULL | — | FK->project_group | — |
| `user_id` | uuid | NOT NULL | — | FK->user | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_employee_contact` · 9 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `employee_id` | uuid | NOT NULL | — | FK->employee | — |
| `kind` | text | NOT NULL | 'mobile' | — | — |
| `value` | text | NOT NULL | — | — | — |
| `is_primary` | boolean | NOT NULL | false | — | — |
| `note` | text | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_employee_external_ref` · 10 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `employee_id` | uuid | NOT NULL | — | FK->employee | — |
| `system` | text | NOT NULL | — | — | — |
| `external_id` | text | NOT NULL | — | — | — |
| `last_synced_at` | timestamptz | — | — | — | — |
| `restricted_fields` | jsonb | — | — | — | — |
| `raw` | jsonb | — | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |
| `updated_at` | timestamptz | NOT NULL | now() | — | — |


## 6. Vestigial — nothing reads or writes these

### `tbl_entity_asset_model` · 8 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `manufacturer_id` | uuid | — | — | FK->manufacturer | — |
| `name` | text | NOT NULL | — | — | — |
| `category_id` | uuid | — | — | FK->category | — |
| `default_unit_cost` | numeric | — | — | — | — |
| `is_serialized` | boolean | NOT NULL | true | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |

### `tbl_entity_manufacturer` · 4 columns

| Column | Type | Null | Default | FK | Change |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | uuid | — | — |
| `tenant_id` | uuid | NOT NULL | — | FK->tenant | — |
| `name` | text | NOT NULL | — | — | — |
| `created_at` | timestamptz | NOT NULL | now() | — | — |


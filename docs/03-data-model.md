# STInventory — Data Model & Schema

Detailed schema for STInventory. Design is **event-sourced at the core**: the
`transactions` table is the append-only system of record; every other operational table
(`assets.current_*`, `assignments`) is a **projection** that can be rebuilt from it. This
is what enforces the §2 principle "current state is derived from history."

Conventions: `id` = uuid/bigint PK, `*_id` = FK, all tables carry `created_at`,
`updated_at`, `created_by`. SaaS multi-tenancy adds `tenant_id` to every row (see
`02-saas-architecture.md`); for the Urban-only prototype `tenant_id` is a constant.

---

## 1. Reference / catalog tables

### categories
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | Power Tools, Hand Tools, Safety, Survey, Concrete, Access |
| parent_id | fk categories | nullable, for sub-categories |
| default_maintenance_interval_days | int | seeds preventive schedule |

### manufacturers
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | Hilti, DeWalt, Milwaukee, Bosch, Trimble |

### models
| column | type | notes |
|---|---|---|
| id | pk | |
| manufacturer_id | fk | |
| name | text | e.g. "TE 60-ATC/AVR" |
| category_id | fk | |
| default_unit_cost | numeric | for procurement estimates |
| is_serialized | bool | true = track individually; false = bulk/consumable |

### vendors
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | supplier or repair shop |
| type | enum | supplier / repair / both |
| contact, phone, email, address | text | |
| lead_time_days | int | drives forecasting |

## 2. Locations & org

### warehouses
| column | type | notes |
|---|---|---|
| id | pk | |
| name | text | Main (Dallas), Regional (Houston) |
| region | text | |
| address | text | |

### locations
Polymorphic "place an asset can be." A gang box or vehicle is a location that can itself
move.
| column | type | notes |
|---|---|---|
| id | pk | |
| type | enum | warehouse / site_container / gang_box / vehicle / project_site |
| name | text | "Truck 12", "Gang Box A", "Container - Legacy West" |
| warehouse_id | fk | nullable, when nested under a warehouse |
| project_id | fk | nullable, when the location is a jobsite |
| parent_location_id | fk locations | nullable, e.g. gang box inside a container |

### projects
| column | type | notes |
|---|---|---|
| id | pk | |
| external_id | text | maps to FoundationSoft / Mark 85 project |
| name | text | |
| status | enum | awarded / active / closing / complete |
| start_date, end_date | date | |
| cost_center | text | for charge-to-project |

### project_phases
| column | type | notes |
|---|---|---|
| id | pk | |
| project_id | fk | |
| name | text | WBS phase name |
| start_date, end_date | date | drives idle-tool detection |

### employees
| column | type | notes |
|---|---|---|
| id | pk | |
| external_id | text | maps to BambooHR / Mark 85 employee |
| name | text | |
| role | enum | foreman / superintendent / pm / equipment_admin / warehouse / procurement / hr / finance |
| primary_project_id | fk projects | nullable |
| employment_status | enum | active / terminated / on_leave |
| terminated_at | timestamp | set by HR event, triggers clearance |

## 3. Assets (the register)

### assets
The `current_*` columns are the **projection** — denormalized from `transactions` for fast
reads and reporting. They are never the source of truth.
| column | type | notes |
|---|---|---|
| id | pk | |
| tag | text | asset tag / barcode / QR value, unique |
| model_id | fk models | |
| serial_number | text | manufacturer serial, nullable for bulk |
| is_serialized | bool | copied from model |
| quantity | int | 1 for serialized; N for bulk lines |
| acquisition_cost | numeric | |
| acquisition_date | date | |
| owning_project_id | fk projects | **financial owner** — project it was charged to |
| warranty_expires_on | date | nullable |
| **current_status** | enum | see lifecycle statuses below |
| **current_custodian_id** | fk employees | nullable (null = in warehouse) |
| **current_project_id** | fk projects | operational, may differ from owning_project |
| **current_location_id** | fk locations | |
| condition | enum | new / good / fair / poor / damaged |

Lifecycle statuses: `requested, approved, on_order, received, available, reserved,
assigned, in_transit, in_maintenance, lost, disposed`.

Note the deliberate split: `owning_project_id` (who paid, financial) vs
`current_project_id` (who's using it now, operational). This is §2's
"financial allocation separate from operational custody," made concrete.

## 4. Custody & movement

### assignments
Active custody link. At most one row per serialized asset with `status = active`.
| column | type | notes |
|---|---|---|
| id | pk | |
| asset_id | fk | |
| custodian_id | fk employees | |
| project_id | fk projects | |
| phase_id | fk project_phases | nullable |
| location_id | fk locations | |
| type | enum | permanent / temporary |
| start_date | date | |
| expected_end_date | date | nullable; temporary loans require it |
| status | enum | active / returned / transferred / overdue |
| approved_by | fk employees | nullable |
| returned_at | timestamp | nullable |

### assignment_history
Immutable snapshots of assignment changes (superseded by transactions, but convenient for
"who held this and when" reports). Optional if querying transactions directly.

### transfers
A movement request/record between two custody states.
| column | type | notes |
|---|---|---|
| id | pk | |
| asset_id | fk | |
| from_custodian_id, to_custodian_id | fk employees | |
| from_location_id, to_location_id | fk locations | |
| from_project_id, to_project_id | fk projects | |
| reason | enum | project_complete / phase_change / reallocation / hr_offboarding / repair |
| status | enum | requested / approved / in_transit / completed / cancelled |
| requested_by, approved_by | fk employees | |
| completed_at | timestamp | |

## 5. Procurement

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
| model_id | fk | |
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
Track received quantity vs ordered; receiving creates `assets` rows + `receive`
transactions.

## 6. Maintenance & inspection

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
| result | enum | pass / fail / needs_repair | |
| inspector_id | fk employees | |
| performed_at | timestamp | |
| notes | text | |

## 7. The event log (system of record)

### transactions
Append-only. Nothing is ever updated or deleted. Every projection above is a fold over
this table.
| column | type | notes |
|---|---|---|
| id | pk | monotonic |
| asset_id | fk | |
| event_type | enum | see below |
| actor_id | fk employees | who performed it |
| from_state | jsonb | custodian/project/location/status before |
| to_state | jsonb | custodian/project/location/status after |
| ref_type, ref_id | text/fk | links to assignment / transfer / PO / maintenance |
| occurred_at | timestamp | |
| note | text | |

Event types: `purchase, receive, tag, assign, transfer, return, reserve, repair_start,
repair_complete, inspection, lost, found, dispose, custodian_change, project_change,
location_change, status_change`.

### notifications
| column | type | notes |
|---|---|---|
| id | pk | |
| recipient_id | fk employees | |
| type | enum | overdue / maintenance_due / clearance_required / approval_pending / missing |
| ref_type, ref_id | text/fk | |
| read_at | timestamp | nullable |

## 8. Derivation rules (projection logic)

- `assets.current_*` = apply latest `assign/transfer/return/status_change` events in
  `occurred_at` order.
- An asset is **Idle** if `current_status = available` OR (assigned but its
  `current_project_id` phase has ended and no new assignment exists).
- An asset is **Overdue** if it has an active `temporary` assignment past
  `expected_end_date`.
- **Utilization** = assigned-days ÷ owned-days over a window, from the event stream.
- **HR clearance queue** = all assets where `current_custodian_id` ∈ employees with
  `employment_status = terminated` and status not in (returned, transferred, lost).

## 9. Rebuild guarantee

Because state is a fold over `transactions`, the entire operational picture can be dropped
and rebuilt. This makes the audit trail (§12 of the plan) free — the log *is* the audit
trail — and makes disputes ("who lost this drill") answerable to the exact event.

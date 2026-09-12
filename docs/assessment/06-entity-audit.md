# Entity Audit — Fields, Data Quality, Import Requirements

**Date:** 2026-09-12
**Database:** local `stinventory`, Urban tenant, **immediately before the wipe**
**Purpose:** record what each entity holds, how complete it is, and what a real
import must supply — so the wipe destroys data, not knowledge.

---

## Row counts at time of audit

| Entity | Table | Rows |
|---|---|---|
| Asset (small tools) | `tbl_entity_asset` | **762** |
| Ledger | `tbl_ops_transaction` | 758 |
| Custody links | `tbl_ops_smalltools_custody` | 757 |
| Employee | `tbl_entity_employee` | 46 |
| Location | `tbl_entity_location` | 32 |
| Project team member | `tbl_ops_project_team_member` | 31 |
| Vehicle | `tbl_entity_vehicle` | 31 |
| Role (login) | `tbl_entity_role` | 18 |
| Project | `tbl_entity_project` | 15 |
| User | `tbl_entity_user` | 15 |
| Company role (job title) | `tbl_entity_company_role` | 9 |
| Notification | `tbl_ops_notification` | 8 |
| Category | `tbl_entity_category` | 8 |
| Team role (tier) | `tbl_entity_team_role` | 8 |
| Department | `tbl_entity_department` | 3 |
| Division | `tbl_entity_division` | 3 |
| Event log | `tbl_ops_event_log` | 1 |

---

## ASSET — 762 rows

### Three identifiers, deliberately different

| Column | Meaning | Nullable | Quality |
|---|---|---|---|
| `asset_number` | DB-generated sequence, always present | no | 762/762 — **the only reliable key** |
| `code` | Urban's own identifier, read aloud | yes | 2 missing |
| `serial_number` | Manufacturer's, or hand-typed stand-in | yes | **414 missing (54%)**, 14 duplicated |

`is_manual_code` (2 rows) is the only thing distinguishing a real serial from a
typed stand-in. **Serial is NOT a key** — 14 duplicates confirm it.

### Field completeness

```
total ............. 762
no code ............  2
no serial ......... 414   (54%)
no make ........... 188   (25%)
no model_number ... 341   (45%)
no description .....  0   (100% present)
no category ....... 348   (46%)
```

`description` is the only universally populated descriptor. **Category is missing
on nearly half** — that breaks filtering and any category-based report.

### Status distribution

```
assigned ..........  756
available .........    2
in_maintenance ....    1
ready_for_pickup ..    1
waiting_parts .....    1
diagnosing ........    1
```

99% assigned. The maintenance states exist but are barely exercised.

### Import must supply

`code`, `description` (required in practice), `make`, `model_number`,
`serial_number`, `category_name`, `quantity`, `is_serialized`. **Category mapping
needs a decision** — 46% arrived with none.

---

## EMPLOYEE — 46 rows

```
total .............. 46
no code ............  0   (all have badge numbers)
no email ........... 40   (87%)
no reports_to ...... 43   (93%)
no primary_project . 16   (35%)
no job title .......  0
no login role ......  0
no department ......  9
```

**`email` missing on 87%** — that blocks invitations and every email
notification. BambooHR's `workEmail` is the source and will fix most of it.

**`reports_to` missing on 93%** — see `05-roles-and-org.md`. Bamboo's
`reportsToId` fills this (919/1859 populated at source).

### Import must supply

`code` (badge), `name`, `email`, `job title`, `department`, `division`,
`reports_to`, `employment_status`. **All available from BambooHR.**

---

## PROJECT — 15 rows — WEAKEST DATASET

```
total ....... 15
no code ......  3   (20%)
no name ......  0
no status ....  0
```

**These came from a screenshot** carrying code, name and bid valuation. There is
**no system of record**, no source file, and no way to verify them. Migration
`0065_one_job_code_per_tenant` made `code` unique per tenant, yet 3 of 15 have no
code at all.

**This is the blocking unknown for the import.** Everything else — people, tools,
vehicles, custody — references projects. Needs a real source before step 1.

---

## VEHICLE — 31 rows

| Type | Count | No plate | No VIN |
|---|---|---|---|
| trailer | 29 | 29 | 29 |
| truck | **2** | 2 | 2 |

**Only 2 trucks for 29 trailers.** Either Urban's truck list was never imported,
or trailers were loaded without them. Given that the custody model is
"tools in a trailer, hitched to a truck, driven by a foreman," 2 trucks cannot
serve 28 tool-holding foremen.

**No plate or VIN on any vehicle.** `unit` is the only identifier present.

### Import must supply

`unit`, `vehicle_type` (truck/trailer), `make_model`, `plate`, `vin`,
`ownership`. Source is the separate truck Excel.

---

## CUSTODY — 757 links (756 active)

```
total ............ 757
active ........... 756
no project ........   3
no location .......   0   (all placed)
no truck ......... 754   (99.6%)
no trailer ........   5
custodians ........  28
```

**752 tools are in trailers with no truck recorded.** Consistent with only 2
trucks existing. The three-column location model (`location_id` / `truck_id` /
`trailer_id`) is working, but the truck half is effectively unpopulated.

### Distribution — this looks like real yard data

```
CANDELARIO CASTANEDA  foreman   77 tools
ROQUE GUERRERO        foreman   67
MARIANO JIMENEZ       foreman   55
FELIPE PORTILLO       foreman   52
JUAN MARTINEZ         foreman   43
ALBERTO MENDES ALEMAN foreman   41
```

28 foremen holding 756 tools, 27–77 each. Plausible and internally consistent.

### Import must supply

asset → custodian → project → (location | truck + trailer). Source is the
tools/trailer/person spreadsheet.

---

## USER — 15 rows — ALL DEMO ACCOUNTS

One account per login role:

```
foreman 2, read_only 2, owner 1, engineer 1, mechanic 1, warehouse 1,
project_manager 1, finance 1, procurement 1, superintendent 1,
equipment_admin 1, office_admin 1
```

These are the seed's **one-per-role test accounts**, not real Urban logins. They
exist so the permission matrix is exercised by every role. **None should survive
the wipe** — real users get invited manually.

---

## REFERENCE DATA

**Categories (8):** Blowers & Yard, Compaction, Drills & Drivers, Generators &
Power, Grinders, Hand Tools, Saws, Survey & Layout.
Reasonable for small tools — but 348 of 762 assets carry none.

**Locations (32):** 31 `vehicle` + 1 `warehouse`. Every vehicle gets a mirror
location row. **No site containers, no gang boxes, no yard** — the location model
supports them (`warehouse | site_container | gang_box | vehicle | project_site`)
and only two types are used.

**Company roles / job titles (9):** vs **123 distinct in BambooHR**. The extract
kept only what it could resolve.

**Divisions 3, Departments 3** — vs Bamboo's real structure. Under-populated.

**Team roles / tiers (8):** the ladder is complete and correct — see
`05-roles-and-org.md`.

---

## Summary of data-quality problems

| # | Problem | Entity | Severity |
|---|---|---|---|
| 1 | **Projects came from a screenshot; no system of record** | Project | **BLOCKING** |
| 2 | Only 2 trucks for 29 trailers; 752 tools have no truck | Vehicle / Custody | **HIGH** |
| 3 | 87% of employees have no email — blocks all invitations | Employee | **HIGH** |
| 4 | 46% of assets have no category | Asset | MEDIUM |
| 5 | 54% of assets have no serial; 14 serials duplicated | Asset | MEDIUM |
| 6 | 93% of employees have no reports_to | Employee | MEDIUM (Bamboo fixes) |
| 7 | 9 job titles vs 123 in Bamboo | Company role | MEDIUM |
| 8 | No plate/VIN on any vehicle | Vehicle | LOW |
| 9 | Only 2 of 5 location types used | Location | LOW |
| 10 | All 15 users are demo accounts | User | expected — do not migrate |

---

## Import order (dependency-forced)

```
1. Reference    categories, divisions, departments, job titles, tiers
2. Projects     ← BLOCKED: needs a real source
3. People       BambooHR sync (278 active). Everyone lands as `crew`, no logins.
4. Vehicles     truck Excel — trucks AND trailers
5. Locations    warehouse, yard, containers + vehicle mirrors
6. Assets       tools spreadsheet
7. Custody      tools/trailer/person spreadsheet — must come last
8. Roster       project_team_member — MANUAL, per the agreed plan
```

Custody is last because it references asset, employee, project, vehicle and
location simultaneously.

---

## Open questions

1. **What is the real source for projects?** Blocks everything.
2. **Where is Urban's truck list?** 2 trucks cannot serve 28 foremen.
3. **How should the 348 uncategorised assets be handled** — a real category, an
   "Uncategorised" bucket, or left null?
4. **Do we need plate/VIN?** No screen shows them today.
5. **Are the 14 duplicate serials real** (two identical tools) or extract errors?

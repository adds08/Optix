# Role Model, Org Structure & BambooHR — Findings and Plan

**Date:** 2026-09-12
**Status:** analysis complete, implementation not started
**Source:** live queries against the Urban tenant + a read-only probe of Urban's production BambooHR

---

## 1. The role model has FOUR axes

Not three. All four are live in the schema today.

| Axis | Column / Table | Scope | Answers |
|---|---|---|---|
| **Employment role** | `employee.role` | per person | What is your job? |
| **HR job title** | `employee.company_role_id` → `tbl_entity_company_role` | per person | What does BambooHR call you? |
| **Login role** | `employee.role_id` → `tbl_entity_role` | per person | What may you click? |
| **Team tier** | `tbl_ops_project_team_member.role` | **per person, per project** | Where do you sit *on this job*? |

Live data showing why this confuses people:

```
ALBERTO MENDES ALEMAN | foreman | Foreman | crew
Alejandro Capuchino   | foreman | Foreman | foreman
```

Same employment role, same HR title, **different login role** — because Alejandro
has an account and Alberto does not (`crew` = holds tools, never signs in). The
distinction is legitimate but invisible on screen.

**Conclusion: this is a presentation problem, not a modelling problem.** Three of
the four axes should never be shown to an end user. Show the team tier — the one
that is operationally meaningful — and keep the rest in admin.

---

## 2. Who assigns whom — ALREADY BUILT AND POPULATED

`tbl_entity_team_role` + `tbl_entity_team_role_assigner`, per tenant, editable.

### The tier ladder (`reports_to_team_role_id`)

```
Director
└── Area In-charge
    ├── Project Manager
    └── General Superintendent
        └── Superintendent
            ├── Foreman
            ├── Field Engineer
            └── Project Engineer
```

### The assigner matrix (16 rows, queried live)

| Tier | May be assigned by |
|---|---|
| Area In-charge | Director |
| General Superintendent | Area In-charge, Director |
| Project Manager | Area In-charge, General Superintendent |
| Superintendent | Area In-charge, General Superintendent |
| Foreman | General Superintendent, Project Manager, Superintendent |
| Field Engineer | General Superintendent, Project Manager, Superintendent |
| Project Engineer | General Superintendent, Project Manager, Superintendent |

### `can_hold_custody`, per tier

| Tier | Holds tools |
|---|---|
| Superintendent, Foreman, Field Engineer, Project Engineer, General Superintendent | **yes** |
| Director, Area In-charge, Project Manager | no |

**Nothing needs building here.** What is missing is roster rows to apply it to
(section 4).

---

## 3. Tier MUST stay per-project — do not collapse it into role

A proposal was raised to roll tier, role and jobTitle into one mapping. Two of
the three are fine. **Tier is not**, and Urban's own data is the reason
(`packages/domain/src/role-suggestion.ts:36-40`):

> a `Superintendent` reports to **six different titles** depending on the job —
> CEO, Project Director, General Superintendent, Project Manager, Senior Project
> Manager, Director of Project Controls — and a `Project Manager` reports to
> another `Project Manager`.

If tier became a property of the role, a person who is superintendent on DART and
foreman on Lone Star gets one tier on both, and their crew scope on the second job
leaks the first job's foremen. This was already fixed once
(`packages/api-contracts/src/scope.ts:117-122`):

> **PER PROJECT, not pooled.** Pooling the projects first, as the old code did,
> would have leaked the first job's foremen into the second job's answer.

### Agreed design

- **jobTitle → login role** — one mapping table, admin-editable. **Default `crew`** for anything unmapped.
- **role → assignable tiers** — already exists as the assigner matrix.
- **tier stays per-project** — set on the roster, never derived from a title.

---

## 4. BambooHR — the integration is built, configured, and READ-ONLY

### Read-only is enforced structurally, not trusted

`apps/api/src/bamboo-sync.ts:14-25` — `bambooGet` is the only function that
touches the network, hardcodes `method: "GET"`, and **takes no verb parameter**,
so no argument can make it write. `bamboo-sync.test.ts:85` asserts the method, so
adding a verb fails a test rather than shipping.

Client instruction (2026-09-06) and re-confirmed 2026-09-12: **GET only, never
POST, against their production HR system.**

### Live probe results (2026-09-12, read-only, nothing written)

```
Bamboo reported total ... 1859      records read 1859, complete
Adapted OK .............. 1859      adapt failures 0
restricted fields ....... 0 people
```

**Roster status — leavers are cleanly identifiable:**

```
Inactive / Terminated ... 1580   (ALL carry a terminationDate)
Active ..................  278
unreadable ..............    1
```

Active roster breakdown by `employmentStatusName`:

```
Full-Time ... 259
Contractor ..  10
Intern ......   1
(absent) ....   9
```

**Org chart — the data exists:**

```
with a supervisor (reportsToId) ... 919 / 1859  (49%)
distinct supervisors named ........ 132
isManager = true ..................  64
isManager = false ................. 1795
isManager not said ................    0
```

`isManager` is **fully populated — zero unknowns.** HR has asserted
manager/not-manager for every person. This is what automates crew creation.

**Job titles — 123 distinct, 65 held by one person, 935 with none:**

```
935  (none)          27  Foreman
247  Carpenter       25  Superintendent
 86  Concrete Finisher  16  Foreman - Structures
 86  Labor           14  Project Engineer
 52  Leadman         10  Field Engineer
 51  Operator        10  Project Manager
                      8  Assistant Superintendent
                      6  Senior Project Manager
```

**This validates the "default to `crew`, map manually" decision.** The titles that
imply access are ~10–15 and small. The bulk (Carpenter, Labor, Operator, the 65
singletons, the 935 blanks) are trade titles implying no system access — they stay
`crew` and are never mapped. This is what avoids the 131-row mapping screen that
killed the previous attempt (retired 2026-09-09).

### A prior real sync happened

`packages/db/src/schema/employee.ts:129-131` records *"the first real sync flagged
1578 of 1851 people."* Today's probe: **1580 of 1859.** Same roster, weeks apart.
The `tbl_ops_sync_run` table is empty because history was cleared, **not** because
the integration has never run against production.

### `employmentType` is dead weight

Absent for all 1859 records. `employmentStatusName` carries Contractor/Intern
instead. Candidate for removal from `BAMBOO_OPTIONAL_FIELDS`.

---

## 5. Employment status — use the existing two-column design

A third status state ("not assigned / NULL") was requested. **The codebase already
solves this, with a better shape**, and no schema change is recommended.

Two columns, deliberately separate (`employee.ts:117-138`):

| Column | Meaning |
|---|---|
| `employment_status` | **Optix's own record.** The admin's call. |
| `hr_flagged_inactive_at` | **The source system's opinion.** Nullable. |

The settled policy (2026-09-07):

> a departure reported by a sync is a flag for an admin to act on, **never a write
> Optix performs itself** — so this column exists precisely so that opinion has
> somewhere to land WITHOUT touching `employmentStatus`, which stays the admin's
> own call.

This gives the three states requested — *"not assigned"* is
`hr_flagged_inactive_at IS NULL` — as a **separate axis**, so a sync can never
silently deactivate someone who is holding tools. The flag clears if a later sync
reports the person active again, so a rehire is not permanently scarred.

`EMPLOYMENT_STATUSES` already has four values (`active | inactive | terminated |
on_leave`) if a genuine fifth state is ever needed.

**Open:** confirm this is accepted, or add the third value as originally asked.

---

## 6. Current org data in the Urban tenant (before any sync)

```
active employees ................ 45
  with no reports_to ............ 43   (96%)
project_team_member rows ........ 31
  foreman ....................... 27 active
  superintendent .................  2 active
  pm ............................  2 active
  confirmed ..................... 1 of 31
projects ........................ 15
  with no roster rows ............ 4
foremen on jobs with NO superintendent  17
```

**Consequence, confirmed by reading `scope.ts`:** only ONE superintendent exists
(Marcus Whitfield, on DART and Lone Star, seeing 10 foremen). Any other
superintendent logging in resolves `assets.view.crew` to `[self]` — they see their
own tools and nothing else, **with no error and nothing on screen explaining why.**

`scope.ts:100-104` anticipated exactly this: *"a silent empty result is the worst
possible failure for a visibility rule."*

Combined with the unguarded `employee.list` query in `jobsites/page.tsx`
(see `04-web.md` finding 3), there are **two independent paths** to the same user
experience: *"the system lost my data."* This is a likely contributor to the failed
launch, and neither is a code bug — one is an empty roster, one is a missing guard.

### Correction to an earlier finding

`employee.reportsToEmployeeId` is **no longer read for scoping.** Changed
2026-08-23 (`scope.ts:83-91`): crew is now derived from project roster membership,
not the org-chart column. The column remains for display and for the org chart
screen. **So the fix for crew visibility is roster rows, not the reportsTo column.**

---

## 7. Agreed plan — NOT YET STARTED

Decisions taken in conversation, recorded here so they survive:

1. **Job/project assignment stays MANUAL.** Bamboo seeds who-reports-to-whom; it
   cannot know who is on DART this week. `project_team_member` stays hand-managed.
2. **Role mapping is a MANUAL admin action.** Default `crew` for everyone unmapped.
3. **Wipe local and re-seed, then sync Bamboo locally first.** Verify against the
   Urban tenant before anything reaches development.
4. **Sync creates NO logins.** Everyone lands as `crew` with no user account;
   the ~15 who need access get invited.

### DECISION (2026-09-12): seed is rejected — import real data instead

`SEED_RESET` was considered and **turned down**. The reasoning is sound and should
not be revisited without new information:

> "seed reset gives and puts false data, we will sync everything from BambooHR and
> other dataset"

The seed is a **demo fixture**, and even `seed-data.urban.ts` carries invented
values — all 81 employees have `reportsTo: null`, and `asset.ts:20-28` records that
every `TOOL-0001` style tag "was invented at seed time, not a real label." Seeding
to then overwrite with real data means a window where nobody can tell seeded rows
from imported ones.

**The target: an empty tenant populated entirely from real sources.**
`packages/db/sql/empty-register.sql` and `seed-data.bare.ts` already exist for this.

### Execution order (next session)

1. **Prepare import datasets**, one per entity, each traceable to a real source:
   - **People** → BambooHR sync (278 active; the org chart comes free via `reportsToId`)
   - **Projects** → needs a real source. Today's 15 came from a screenshot; confirm what replaces it.
   - **Small tools** → Urban's own spreadsheets, via the existing import pipeline
   - **Vehicles (trucks/trailers)** → the separate truck Excel
   - **Custody (who holds what)** → the tools/trailer/person spreadsheet
2. Start from an **empty tenant** (`empty-register.sql` / bare seed), not a reset demo seed
3. Import in dependency order: projects → people → vehicles → tools → custody
4. Restart local; verify role/tier/crew behaviour by hand against the Urban tenant
5. Build the **jobTitle → role mapping** table + admin screen
6. Then: crew assignment → crew-to-projects → **Tools by Jobsite** full functionality

### Open questions

- **What is the real source for projects?** The current 15 came from a screenshot
  with code, name and bid valuation. That is the weakest dataset and the one with
  no system of record. Needs an answer before step 1.
- **Does the existing import pipeline cover all five datasets?**
  `packages/types/src/import-specs.ts` and `routers/import.ts` exist and are
  tested (`import-validation.test.ts`, `import-commit.test.ts`) — needs an audit
  against the five sources above to find the gaps.
- **Roster grows 45 → 278 (6×).** Mostly carpenters and laborers who will never log
  in. Correct as `crew`, but it changes how every people screen feels.
- **9 active people have no `employmentStatusName`** — they would sync with an
  ambiguous status. Worth a look before commit.
- **Section 5** — accept the `hr_flagged_inactive_at` design, or add a third
  `employment_status` value as originally requested.
- **Sync creates NO logins** — proposed and not yet confirmed. Everyone lands as
  `crew`; the ~15 who need access get invited by hand.

---

## 8. Tools by Jobsite — access control reference

Recorded here because it was traced in full and is the next screen to work on.

**Write permissions** (`apps/web/app/(app)/jobsites/page.tsx:85-100`), queried live:

| Role | Assign tools | Hand over | Manage rig | Assign PM/Super |
|---|---|---|---|---|
| `owner`, `tech_admin`, `equipment_admin`, `warehouse` | yes | yes | yes | yes |
| `superintendent` | yes | yes | no | no |
| `office_admin` | no | no | no | yes |
| all others (foreman, PM, director, area_in_charge, general_superintendent, engineer, mechanic, finance, hr, procurement) | no | no | no | no |

`canAssignCrew` is hardcoded `false` — crew assignment lives on Project Teams.

**View tiers** (`packages/api-contracts/src/scope.ts`), first match wins:

| Tier | Roles | Sees |
|---|---|---|
| `assets.view.all` | owner, tech_admin, equipment_admin, warehouse, office_admin, finance, hr, procurement, read_only | every tool |
| `assets.view.project` | project_manager, engineer, director, area_in_charge, general_superintendent | tools on their jobs |
| `assets.view.crew` | superintendent | their foremen's tools + own |
| `assets.view.own` | foreman, mechanic | only what is in their hands |

Two non-negotiable rules in that file: holding none of the four means **empty
result, never unscoped** (`MATCHES_NOTHING = sql\`false\``), and authorisation is
applied **to the query, never as a post-filter** — post-filtering leaks existence
through counts and totals.

**Base tables:**

| Query | Table |
|---|---|
| `employee.list` | `tbl_entity_employee` |
| `asset.list` | `tbl_entity_asset` + `tbl_ops_smalltools_custody` |
| `project.list` | `tbl_entity_project` |
| `vehicle.list` | `tbl_entity_vehicle` + `tbl_entity_location` |
| `projectTeam.all` | **`tbl_ops_project_team_member`** ← drives crew scoping |

Plus `tbl_entity_role` / `_role_permission` / `_user_role` for permissions, and
`tbl_ops_project_access_restriction` for explicit removals.

---

## 9. Data model notes

**`employee` and `user` are NOT the same, and should stay separate.** 45 employees,
15 users. Every user links to an employee; most employees have no login. A foreman
who holds tools but never signs in is an employee with no user row. Collapsing them
would require fake logins for ~30 people today, and ~263 after the Bamboo sync.

**Assets vs vehicles — the intended direction is one table.** Small tools, heavy
equipment, trucks and trailers all as `asset` rows distinguished by a class label.
`packages/types/src/enums.ts:49` already has
`EQUIPMENT_CLASSES = ["vehicle", "attachment", "heavy", "other"]`, with `heavy`
described as a placeholder "for plant that had not arrived yet."

Today `vehicle` remains a separate table with its own FK from custody. **Closing
that gap belongs to the equipment-inventory phase, not now.**

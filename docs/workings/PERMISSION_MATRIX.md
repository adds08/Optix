# Permission matrix — draft for confirmation

**Status:** Draft, 2026-08-15 · **Confirms:** STI-801 · **Blocks:** STI-102, STI-802, STI-804

This is the STI-801 deliverable, drafted from Urban's answers on the three questions that
were open. **It still needs the day-2 session** — but that session is now a confirmation
with three specific things to check, not a discovery workshop.

`packages/db/src/seed.ts` `ROLE_PERMS` and `packages/types/src/index.ts` `PERMISSIONS` must
match this table exactly. STI-804 generates its test from it so the two cannot drift.

---

## 1. The roles, resolved

### "Admin" is three distinct roles

The most dangerous ambiguity in Urban's vocabulary, now settled:

| Role | Who they are | Scope |
|---|---|---|
| **System Administrator** | Programmers and developers who build the system — Bodhi Labs | Platform, schema, releases. Not a business role |
| **Equipment Administrator** | Owns the small tools programme | Every asset, every custody move, the desk queue |
| **Office Administrator** | Operations, accounts and general business administration | Business records; **not** custody, **not** platform |

None of these three may be collapsed into a single `admin` role in code, and no procedure
may branch on the name `admin`.

### Engineer

**An Engineer is a Project Manager with a different operational purpose — identical where
small tools are concerned.** They run work on a project rather than owning it commercially,
but their relationship to tools is the same: they see their projects' tools, they place
people on their projects, they do not run the yard.

**Consequence:** `engineer` takes the same permission set as `project_manager`. It exists as
a separate role so reporting can tell them apart and so the two can diverge later without a
migration — not because they differ today.

### Mechanic

**A mechanic is an Equipment department employee who holds and uses tools, like a foreman —
but for repair and maintenance rather than construction.** The distinction that matters:

| | Foreman | Mechanic |
|---|---|---|
| Assigned to | A job | The Equipment department |
| Uses tools for | Building the work | Repairing and maintaining equipment |
| Their tools charge to | The **project** | The **department** (Equipment Yard) |

So a mechanic is a **custodian** (already true — `CUSTODIAN_ROLES` includes `mechanic`) and
now also a **login role**. Their cost target is `department`, not `project`, which the
schema already supports: `docs/built/11-department-cost-targets.md` shipped exactly this.

**Consequence:** STI-102 adds `mechanic` as a login role. The cost-target behaviour needs no
new work — only wiring the default so a mechanic's custody defaults to charging the
Equipment department.

---

## 2. The matrix

`●` granted · `—` not granted · `▲` granted but scoped (see §3)

| Permission | System Admin | Equip Admin | Office Admin | Warehouse | PM | Engineer | Super | Foreman | Mechanic | Procurement | HR | Finance | Read-only |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `asset.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | ● | — | ● | ● |
| `asset.manage` | ● | ● | — | ● | — | — | — | — | — | — | — | — | — |
| `assignment.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | — | — | ● | ● |
| `assignment.create` | ● | ● | — | ● | — | — | ● | — | — | — | — | — | — |
| `assignment.approve` | ● | ● | — | — | — | — | ● | — | — | — | — | — | — |
| `transfer.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | — | — | ● | ● |
| `transfer.create` | ● | ● | — | ● | — | — | ● | — | — | — | — | — | — |
| `transfer.approve` | ● | ● | — | — | — | — | ● | — | — | — | — | — | — |
| `custody.verify` | ● | ● | — | ● | — | — | — | — | — | — | — | — | — |
| `custody.reassign` | ● | ● | — | ● | ● | ● | ● | — | — | — | ● | — | — |
| `location.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | — | — | — | ● |
| `location.manage` | ● | ● | — | ● | — | — | — | — | — | — | — | — | — |
| `vehicle.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | — | — | — | ● |
| `vehicle.manage` | ● | ● | — | ● | — | — | — | — | — | — | — | — | — |
| `project.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | — | ● | — | ● | ● |
| `project.manage` | ● | ● | ● | ● | ▲ | ▲ | — | — | — | — | — | — | — |
| `project.team.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | — | — | — | ● | — | — |
| `project.assign.pm` | ● | ● | ● | ● | — | — | — | — | — | — | — | — | — |
| `project.assign.superintendent` | ● | ● | — | ● | ● | ● | — | — | — | — | — | — | — |
| `project.assign.foreman` | ● | ● | — | ● | ● | ● | ● | — | — | — | — | — | — |
| `employee.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ● | ● | ● | ● | ● |
| `employee.manage` | ● | ● | ● | — | — | — | — | — | — | — | ● | — | — |
| `user.manage` | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| `department.read` | ● | ● | ● | ● | — | — | — | — | ● | ● | — | ● | ● |
| `department.manage` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| `report.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | ● | — | ● | ● |
| `audit.read` | ● | ● | ● | — | — | — | — | — | — | — | — | ● | — |
| `notification.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `notification.manage` | ● | ● | — | ● | — | — | — | — | — | — | — | — | — |
| `config.manage` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |

---

## 3. Scope permissions — what `▲` resolves to

A grant says *may see*; a scope says *how much*. These are the new permissions STI-802 adds,
and they are what replaces every `actor.role == '...'` comparison.

| Scope permission | Held by | Resolves to |
|---|---|---|
| `assets.view.all` | System Admin, Equipment Admin, Office Admin, Warehouse, Procurement, Finance, Read-only | Everything in the tenant |
| `assets.view.project` | PM, **Engineer** | Assets on the projects they are on the team of |
| `assets.view.crew` | Superintendent | Assets held by foremen reporting to them |
| `assets.view.own` | Foreman, **Mechanic** | Assets they personally hold |

Resolution is first-match in that order, so a role holding two scopes gets the wider one.

**Mechanics get `assets.view.own`, not a department-wide view.** A mechanic sees the tools
in their own custody, exactly as a foreman does. Seeing every tool the Equipment department
owns is `assets.view.all` and belongs to the desk. This is the one line in this document
most likely to be wrong — confirm it.

---

## 4. The three things to confirm on day 2

Everything above is derived from answers already given. These are genuinely open:

1. **`custody.reassign` for PM, Engineer and HR.** Departure reassignment (STI-402) moves
   everything a leaver holds. Granted here to PMs, Engineers, Superintendents and HR on the
   reasoning that whoever discovers the departure should be able to act. If Urban wants that
   narrowed to the Equipment desk plus HR, say so — it is a one-line change now and a
   migration later.
2. **The mechanic's scope** — `assets.view.own` as drafted, or department-wide?
3. **Office Administrator and `project.manage` / `project.assign.pm`.** Drafted as granted,
   because placing a PM on a job reads as an administrative act. If that is an Equipment
   department decision at Urban, move it.

Everything else in this table follows from the role definitions in §1 and needs a reason,
not a review, to change.

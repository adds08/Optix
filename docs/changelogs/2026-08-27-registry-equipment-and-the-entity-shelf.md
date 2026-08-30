# The menu stops calling small tools "Equipment", and the schema learns the difference

The sidebar had a group named Equipment whose only row was the small-tools
register. Checked against the data rather than the label: `asset` holds drills,
saws, generators, grinders, blowers, survey gear and compaction plant, and no
excavator, loader, backhoe, dozer, skid steer, forklift or crane. The menu was
advertising a resource the product does not have and hiding the one it does.

That turned into a wider correction of the entity model, and a schema change to
match it. Equipment itself is deliberately not built — the instruction was to get
the schema right and leave the feature for later.

## What changed

### Registry replaces Equipment, and the row says Small Tools

The group is now **Registry**: the entity shelf, one row per kind of thing the
business keeps a record of. Its `id` is unchanged (`tool-register`), which is
what STI-1201's stable ids were for — a pin naming that row survives the rename,
and the browser suite covers it.

Stale labels went with it: the tool detail page's back link, the asset-register
report's empty state, and an eyebrow that fell back to the literal string
"Equipment" for an uncategorised **small tool**.

### Equipment is a register that already existed under the wrong name

`vehicle` carries `unit`, `plate`, `makeModel`, ownership, payee and GPS — a
register in everything but name, typed `truck | trailer`, reachable from no nav
row. It gained three columns:

- `equipment_class` — `vehicle` | `heavy`, defaulted so every existing row keeps
  its meaning with no backfill.
- `can_attach` / `is_attachable` — a truck can tow, a trailer can be towed.

**Those two are capability, not state**, and the distinction is the whole design.
What is hitched to what right now is `assignment.truckId` + `trailerId`, which is
ledger-derived like every other "where is it" in this system. An `attached_to_id`
column would be a second way to write custody, which is the most expensive pattern
this codebase has paid for.

The table keeps the name `vehicle` on purpose. Renaming it reaches `assignment`'s
composite foreign keys — `(truck_id, truck_kind)` and `(trailer_id, trailer_kind)`
both point at `vehicle(id, vehicle_type)` — plus `transfer`, every router and the
seed. The name is wrong and the shape is right; rename it when Equipment gets a
screen.

`location_id` stays NOT NULL, and that turned out to be correct rather than a
compromise: `location` is "a place an asset can be", and an excavator parked at a
yard is exactly that. Relaxing it would have rippled through sixty-odd
`vehicleType` sites to buy nothing.

### Contact numbers are a list, because a person has more than one

`employee_contact` — kind (`mobile` | `work` | `personal` | `home` | `other`),
value, `isPrimary`, with a partial unique index giving **at most one primary per
person**, the same shape as `assignment_one_active_uq` and for the same reason.

`employee.phone` is not dropped. It still holds the primary and every screen still
reads it, so nothing breaks while the new table fills.

### The company role and the operational role are different axes

`company_role` is the job title HR uses — Carpenter, Operator, Labourer — and
`employee.company_role_id` points at it. Nothing branches on it, which is the
point: titles reorganise and vary by trade.

`employee.role` stays an enum in `packages/types` because code *does* branch on
it: it decides who can hold a tool, who gets the field layout, who appears in a
custodian picker. System roles (permissions) are a third thing again and stay in
`role-perms.ts` with a matrix test — a permission model editable from a settings
screen is one editable by whoever reaches that screen.

### Units of measure, with the category axis

`uom_category` and `unit_of_measure`. Seeded with what a civil contractor's
takeoff actually uses: LF/FT/YD under length, SF/SY/AC under area, CY/GAL under
volume, TON/LB under mass, EA, HR, and LS alone under its own `lump-sum` category
— alone because LS measures nothing, and filing it under count would make it look
convertible to EA.

### Two identifiers were already there and only needed surfacing

`employee.externalId` **is** the HR-issued employee ID, confirmed rather than
assumed, so no second column was added. It is relabelled "Employee ID" in the form
("External ID" told the person typing it nothing about which of their several ids
was wanted) with the hint "As issued by HR — the number on the badge".

`project.externalId` is likewise already the project/cost code — imported under
the header `cost_code`, unique per tenant, example `LW-P3`. No `code` column was
added for the same reason.

Both carry a comment about a naming trap that has already caused confusion: a
person's employee id is sometimes spoken as their "contact", meaning the reference
you contact them by. It is not a phone number and must never be read into one.

### The offboarding gate is gone from every screen

Removed: the "Blocks offboarding" hazard band and clearance queue on `/people`,
the HR clearance card on `/old-dash`, the CLEAR rows in the blocky dashboard's
attention feed, the clearance entry in the notification centre, the command-palette
action, and the "must be returned, transferred, or marked lost" copy on the person
detail page and the employee form.

Nothing was enforcing it. The band's own copy said the blocking gate was
"specified but not yet built".

## What was found while building it

**The nav, ADR-9 and STI-1202 describe three different taxonomies.** ADR-9 (accepted)
puts the *resource* at the top level. The shipped nav splits function from record.
STI-1202 — the ticket meant to implement ADR-9 — draws Small Tools and Equipment as
sub-categories under **Operations**, which demotes the resource to level two under a
function and is the department-first shape ADR-9 explicitly rejects. That contradiction
is unresolved and STI-1202 is in S1.

**"Delete the clearance queue" was two features, not one.** The offboarding gate is
display-only. Departure reassignment (STI-306) is 666 lines with 618 lines of tests and
answers a different question: a foreman left, move every tool he holds plus his company
truck and trailer and everything riding in them, to a named successor, in one transaction
or not at all. The call was to remove the surface and keep the engine, so
`departure-form.tsx` and `dashboard.clearanceQueue` are now unreached rather than gone.
`departure-form.tsx` carries a header saying so — this repo has twice found packages
nobody imported and treated that as evidence they should go, and this is deliberately
not that.

**JSX comments are not expressions.** Two separate breakages this session from putting
`{/* … */}` where a ternary branch expects a single expression, and a `/* … */` in JSX
child position where it renders as literal text on the page. Both caught by typecheck,
neither obvious from the diff.

## Verified

- The seed produces every new table from a clean database: seven UoM categories,
  thirteen units sorted correctly along the category axis, nine company roles, a job
  title on every one of the forty-five people, and contact rows including one person
  with two numbers so the primary rule has something to be true about.
- The one-primary index enforces rather than merely existing: a second primary insert
  is refused with `employee_contact_one_primary_uq`, a second non-primary succeeds.
  Run against the database, not inferred from the DDL.
- Trucks come out `can_attach = true`, trailers `is_attachable = true`, all rows
  `equipment_class = 'vehicle'`.
- `make test` in the api container: every package passing, nothing skipped.
- `pnpm typecheck` across the workspace; `pnpm lint` clean in `apps/web` and `apps/api`.
- The browser suite, five roles, all passing — including `/people` after the clearance
  removal and the pin specs after the group rename.
- The migration is additive only: four `CREATE TABLE`, four `ADD COLUMN`, no drops and
  no type changes. Its journal entry is present, checked because a merge has dropped one
  before.

Not verified: nothing consumes the new tables yet. They are schema and seed data, which
is what was asked for.

## Deliberately not done

**No Equipment screen, and no heavy equipment rows.** The instruction was explicitly to
get the schema right and leave the feature. `equipment_class = 'heavy'` is therefore
reachable but unexercised by real data.

**Teams were not built.** `project_team_member` already exists as a project-scoped roster
with a role and an active-row unique index, and `employee.reportsToEmployeeId` carries the
crew. A named-crew entity on top of that needs a use before it needs a table.

**`employee.phone` was not dropped and no screen reads `employee_contact` yet.** Collapsing
the column into the table is its own change, once something writes those rows.

**Cost codes and phases were not modelled.** `project_phase` was built, migrated everywhere,
never held a row, and was dropped with the note that FoundationSoft is the system of record
and modelling it first means migrating twice to reach somebody else's schema. That reasoning
has not changed.

## Where it is

Committed on `development`. Not deployed. Migration `0027_massive_sleeper.sql`, applied
locally. `.claude/rules/web.md` carries the Registry rename, the small-tools-are-not-equipment
rule and the capability-not-state rule for attachment.

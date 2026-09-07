# A badge number was never a foreign key

`employee.external_id` has held Urban's own badge numbers since the first
migration, under a name promising the opposite, and with a schema comment that
admitted the double duty out loud: "the HR-issued employee ID ... It doubles as
the BambooHR / Mark 85 sync seam."

Those are two different facts. A **code** is assigned by the company: it happens
at company level, so the same value identifies a person across every system
Urban runs. An **external id** is a foreign system's primary key, minted by them
for their own purposes and meaningless outside it. The column only ever held the
first kind. The upcoming BambooHR import needs the second, and the sync that
wrote a BambooHR id into this column would have destroyed every badge number in
the register.

So the column is renamed to `code`, and `externalId` is freed to mean what it
always implied. This is preparation for `docs/workings/BAMBOOHR_PEOPLE_SYNC.md`;
no importer exists yet and nothing in this change talks to BambooHR.

## What changed

- `tbl_entity_employee.external_id` → `code`. A **RENAME**, verified in the
  generated SQL before applying: all 46 seeded employees kept their badge
  numbers, and `external_id` no longer exists on the table.
- **`tbl_entity_employee_external_ref`** — one row per (person, far system),
  carrying the foreign key verbatim plus `restricted_fields`, `raw` and
  `last_synced_at`.
- **`tbl_entity_division`** — a reference table shaped like `department` and
  `company_role`, plus `employee.division_id`.

Migration `0050_closed_blindfold.sql`.

## A child table, not two more columns

A `(external_system, external_id)` pair holds exactly ONE far system per person,
and this codebase's own comments already name three — BambooHR, Mark 85,
FoundationSoft. The pair gets widened or duplicated the first time a second
system syncs, and widening an identity column is the kind of migration that goes
wrong quietly.

The child table also lets the unique index say the true thing: the same digits
arriving from two different systems are two different facts and must not
collide. Two indexes enforce it from both directions —
`(tenant_id, system, external_id)` so two people cannot both be BambooHR 4471,
and `(tenant_id, employee_id, system)` so a re-sync updates the row it already
wrote instead of adding a second.

## Division is flat, and that was a decision

BambooHR ships `divisionName` and `departmentName` as two independent fields on
one record. Nesting department under division was proposed and rejected by the
client: a sample suggesting "Operations" contains "Heavy Civil" is one company's
shape read off one payload, and baking it into the schema forces every importer
to resolve department-within-division for data no API supplies that way.

Which combinations are legitimate is a **rule**, and rules limiting which
division or department may be offered come later, on top of two flat columns.

## The bug this nearly shipped

Three separate writers did `.values({ tenantId, ...input })` — `employee.create`,
`employee.update`, and the spreadsheet importer's `insertOne`.

**Drizzle drops an unknown key silently.** After the rename, every one of those
would have carried on accepting a badge number, typechecking clean, returning
success, and writing nothing. The People form would look like it saved. A CSV
import of the whole register would produce 46 people with blank codes and raise
nothing at all.

All three now destructure `externalId` and map it explicitly to `code`, each with
a comment naming the silent-drop trap. This is the second time a spread of
caller input into an insert has been the dangerous part of a rename; the comment
is there so the third time is caught in review.

`tsc` caught exactly one of the readers (`entity-resolve.ts`, building a display
label off the row object). It could not catch the three writes, because a spread
of a wider object into a Drizzle insert is legal TypeScript.

## The wire name did not change

`employee.list`, `employee.get` and friends still return the field as
`externalId`. Renaming the contract would have rippled through roughly forty web
components for no behavioural gain — the register's screens, the pickers, the
org chart, the onboarding crew step. The **column** needed to be truthful; the
wire name is a separate change nobody is asking for.

Same reasoning for the CSV: the import header stays `employee_id` and the spec
key stays `externalId`, because both are a contract with spreadsheets people
already have. Its hint no longer says "BambooHR id" — it says "your own payroll /
badge number", which is what the column has always held.

## Seed

Divisions get three rows, not one: a single-row reference table cannot show
whether a picker filters, and "Operations" is only the name that happened to
appear in BambooHR's sample. Every fourth person is left with no division,
because null is normal and a fixture where every row is populated hides the
empty path.

External refs reach every state the table can be in, none of which is reachable
from the product yet (rule 9):

- one person in **two** systems with different keys — the case the column pair
  could never have held, and the reason this is a child table;
- one person in one system, the ordinary case;
- one row with a non-empty `restricted_fields` and nulls in `raw` that mean "not
  permitted", not "cleared" — anything reading this table has to tell those
  apart, and cannot be tested on it unless a row exists where they differ;
- and, by omission, the 42 people no far system has heard of.

## Verified

- `pnpm typecheck` clean across all 14 packages.
- 563 tests in 43 files, run **inside the api container** so the database suites
  actually execute rather than skip.
- The live table checked directly after migrating: 46 employees, 46 codes, no
  `external_id` column.
- `/welcome` driven in a real browser as `super@`, through to the crew step —
  which reads `employee.list`'s `externalId` and is the screen most likely to
  have broken. Every crew member renders on both jobs; no console errors.

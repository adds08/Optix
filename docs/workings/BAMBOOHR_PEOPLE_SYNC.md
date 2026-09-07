# BambooHR people sync

Status: **step 1 built, steps 2-6 not.** Decisions below are settled with the
client (2026-09-06).

**Built:** the schema (§6) — migration `0050_closed_blindfold.sql`, applied
locally. `employee.external_id` renamed to `code`, `tbl_entity_division` and
`tbl_entity_employee_external_ref` created, seed reaching every new state. See
`docs/changelogs/2026-09-06-a-badge-number-was-never-a-foreign-key.md`.

`employee.department_id` — the other half of §4's division/department pair —
was **missing until 2026-09-07** and is now added by migration
`0053_simple_thunderbolt.sql`. `0050` created `division_id` alone, so the
`departmentName` row of the mapping table below pointed at a column that did
not exist; the gap was rediscovered twice before being closed.
`tbl_entity_department` itself is older than this document and is referenced by
`asset.owning_department_id` for cost targets, so this was one column, not a
new table. The seed populates it round-robin on a different modulus from
`division_id` so all four set/null combinations exist in a clean database.

**Not built:** everything that talks to BambooHR. No adapter, no HTTP client, no
fetch — steps 2 onward below.

**READ ONLY, and this is not negotiable.** The client's instruction, 2026-09-06:
the BambooHR URL is their **production** HR system and this integration only
ever reads from it. Every call is a `GET`. Do not add a write path, a method
parameter, or any helper that could issue one — the restraint has to live in our
code, because a BambooHR API key is not itself read-only and will happily accept
a write. The only things this repo writes are rows in our own Postgres.

Importing Urban's people from BambooHR, and giving the schema somewhere to put a
foreign system's identifiers so the import can run twice without duplicating
anybody.

## 1. The ask

Three things, in the client's words: *"we need an externalId as well, alongside
code which will be same for all system, and ext id for external system and also
which system"*.

That is three separate facts about one person, and the schema currently stores
one of them.

## 2. Code and external id are not the same thing

This was got wrong in a first draft and corrected by the client. The distinction
is theirs and it is the foundation of the rest:

- **A code is assigned by the company.** It happens at company level, so the
  same value identifies a person, a project or a crew consistently across every
  system Urban runs. It is Urban's, not a vendor's.
- **An external id is a foreign primary key.** The far system minted it for its
  own purposes. It means nothing outside that system.

`employee.externalId` today holds badge numbers — Urban's own value. It is a
**code** that has been sitting under a name implying the opposite, and its
schema comment admits the double duty out loud: "the HR-issued employee ID ...
It doubles as the BambooHR / Mark 85 sync seam."

So the column is renamed to `code`, and the name `externalId` is freed to mean
what it always implied: somebody else's key.

Where a foreign system's PK happens to equal Urban's code, it is still recorded
as an external ref rather than assumed equal. They are the same value that day
and may not be the next; a row costs nothing, a special case costs forever.

### Why a child table and not two more columns

A column pair (`external_system` + `external_id`) holds exactly one foreign
system per person. The codebase's own comments already name three — BambooHR,
Mark 85, FoundationSoft — so the pair gets widened or duplicated the first time
a second system syncs.

A child table also lets the unique constraint say the true thing:
`(tenant_id, system, external_id)`. The same digits arriving from two different
systems are two different facts and must not collide.

### The same problem already exists on `project`

`project.externalId` carries the identical double duty — its comment says "the
project code shown to users" *and* "the FoundationSoft / Mark 85 map". That is a
code and a foreign PK wearing one column. **Not fixed here.** Recorded so it is
not rediscovered as a surprise; if external refs prove out on people, projects
want the same treatment as their own change.

## 3. Why BambooHR has two employee endpoints

The client asked directly: *"why is there even a difference, is it like auth
users and other all users?"*

**No — both return employees, not user accounts.** What differs is which
permission system gates them.

| | `/v1/employees/directory` | `/v1/employees` |
|---|---|---|
| Shape | `fields[]` + `employees[]` | `data[]` + `meta` + `_links` |
| Gated by | Company Directory sharing settings | Per-employee record permissions |
| Narrowed to readable records | **No** — spec says so explicitly | Yes |
| Inactive / former employees | Excluded entirely | Included |
| Manager as | `supervisor`, a display-name string | `reportsToId`, a real id |
| Status | absent | `status` |
| Pagination | none, whole directory | cursor, ≤2500/page |

The spec's own words for the directory: "when the directory is shared with the
caller the employee data is not narrowed to the people whose records they can
otherwise read, and an employee with no managerial or administrative access can
normally read the full directory."

**The field gap is a default, not a capability.** The directory publishes a
fixed generous set; `list-employees` returns a small default and gives up the
rest only when asked via `fields` — over a hundred valid names, including
`divisionName`, `departmentName`, `mobilePhone`, `reportsToId`, `employeeNumber`.

### Decision: `list-employees` only

With an explicit `fields` list it reaches everything the directory offers, plus
the two things the directory cannot give:

- **`status`** — the directory holds only current employees, so it has no status
  field at all. An import built on it would look complete and silently omit
  every leaver. The client's own sample proves it: Rachel Behar is `Inactive`
  and appears only in `list-employees`.
- **`reportsToId`** — the manager as a resolvable id. The directory's
  `supervisor` is a name string, which breaks the moment two people share a name.

Using both would mean two payload shapes, two permission models, and two places
for one person's job title to disagree, for no field we cannot already reach.

**The one caveat:** if the API key turns out to be narrow, `_restrictedFields`
will say so on the first live call, and the directory becomes a fallback worth
reconsidering then.

## 4. Field mapping

Both of the client's naming observations were correct and are confirmed against
the spec.

| BambooHR (`list-employees`) | Optix | Note |
|---|---|---|
| `employeeId` | `employee_external_ref.external_id` | Bamboo's internal PK. **Not** the badge number. |
| `employeeNumber` | `employee.code` | The editable Employee #. Spec warns never to pass it as an id. |
| `firstName` + `lastName` | `employee.name` | |
| `jobTitleName` | `company_role_id` | Same fact the directory calls `jobTitle` and the dataset calls `jobInformationJobTitle`. Typed `list`, matching our table-not-enum decision. |
| `reportsToId` | `reports_to_employee_id` | Resolve by **id**, never by the directory's name string. |
| `departmentName` | `department_id` | Resolve by name; create if absent. |
| `divisionName` | `division_id` *(new)* | New reference table. Flat — see §5. |
| `locationName` | *not mapped* | An HR office, not a place a tool sits — see §5. |
| `workEmail` | `employee.email` | Often personal, exactly as `employee.email`'s comment warns. |
| `mobilePhone`, `workPhone` | `employee_contact` rows | Two numbers; that table exists for precisely this. |
| `status` | `employment_status` | Active / Inactive. |
| `photoUrl` | *not stored as a column* | Expires — see below. |

### Three names for one job title

The directory says `jobTitle`, `list-employees` says `jobTitleName`, the
reporting dataset says `jobInformationJobTitle`. One fact, three spellings. We
store it once as `company_role_id`; the adapter owns the translation.

### A null is not an empty value

`list-employees` returns `null` for fields the caller may not read and names
them in `_restrictedFields`. An importer treating null as "cleared" would blank
real data on the second sync.

**Every write must skip any field named in that array**, and the array is stored
so a thin record is explainable later rather than looking like bad data.

### The photo URL expires

Those `Policy` and `Signature` parameters are a time-limited CloudFront
signature. Decoding the one in the client's sample gives a window of **exactly
30 days**, valid until **2026-10-05** — verified by decoding the base64 policy,
not estimated. Storing it as a column yields a URL that works for a month and
then 403s. Either re-fetch each sync or download the bytes once; never treat it
as a stable link.

## 5. Settled decisions

### Division and department both sit on the employee, flat

BambooHR ships them as two independent fields on the same record. It models no
relationship between them, and neither do we: `employee.division_id` and
`employee.department_id`, each resolved from its own field.

Nesting department under division was proposed and **rejected by the client**.
The sample suggests a hierarchy ("Operations" containing "Heavy Civil") and
modelling it would stop the two contradicting each other — but it asserts a
company structure from a single sample, and forces the importer to resolve
department-within-division for data the API does not supply that way. The
client's reasoning: which combinations are legitimate is a *rule*, and rules
limiting which division or department can be shown come later, rather than
baking a hierarchy into the schema now.

### Bamboo `location` is not our `location`

Ours is "a place an asset can be" — its own schema comment — typed
`warehouse | site_container | gang_box | vehicle | project_site`, carrying
`custodianEmployeeId` for whoever hauls the container. The live table is
**31 vehicles and 1 warehouse**: every row a real thing a tool sits in.

Bamboo's is an HR office assignment, "Farmers Branch, TX". Writing that in would
put a row in every location picker, on `/map` and in the custody flows that no
tool can occupy — and since `asset.current_location_id` points at this table,
somebody eventually files a grinder in a city.

The value stays in `raw`, recoverable if Urban's offices later turn out to be
yards.

### Credentials

`BAMBOOHR_COMPANY_DOMAIN` and `BAMBOOHR_API_KEY`, added to `.env.example` as
empty keys and to the gitignored `.env.local` for the client to fill.

BambooHR authenticates with **HTTP Basic using the API key as the username** and
the literal `x` as the password — so there is no separate password setting. The
client identified this correctly before it was checked. Empty disables the sync.

### Live fetch and write

The client chose a live sync against Urban's real account rather than fixtures,
into the **local** database. Production is untouched either way. The dry-run
preview is still built (step 4) — it costs one flag and is the only cheap way to
see a bad mapping before it reaches rows.

## 6. Schema

```sql
-- The shared code: Urban's own, company-level, stable across systems.
ALTER TABLE tbl_entity_employee RENAME COLUMN external_id TO code;

-- Division: new reference table, flat. Department is unchanged.
CREATE TABLE tbl_entity_division (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tbl_entity_tenant(id) ON DELETE CASCADE,
  name       text NOT NULL,
  code       text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX division_tenant_name_uq ON tbl_entity_division (tenant_id, name);

ALTER TABLE tbl_entity_employee
  ADD COLUMN division_id uuid REFERENCES tbl_entity_division(id) ON DELETE SET NULL;

-- One row per (person, far system).
CREATE TABLE tbl_entity_employee_external_ref (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tbl_entity_tenant(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES tbl_entity_employee(id) ON DELETE CASCADE,
  system       text NOT NULL,          -- bamboohr | mark85 | foundationsoft
  external_id  text NOT NULL,          -- their primary key, verbatim
  last_synced_at    timestamptz,
  restricted_fields jsonb,             -- what the caller could not read
  raw               jsonb,             -- last payload, for diffing
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One id per system per tenant.
CREATE UNIQUE INDEX eer_system_id_uq
  ON tbl_entity_employee_external_ref (tenant_id, system, external_id);
-- One ref per system per person, so a re-sync updates rather than doubles.
CREATE UNIQUE INDEX eer_employee_system_uq
  ON tbl_entity_employee_external_ref (tenant_id, employee_id, system);
```

`raw` earns its place: when a sync produces a wrong value the question is always
"what did they actually send", and without the payload that is unanswerable
after the fact. It is also what makes a second sync a diff rather than a blind
overwrite.

## 7. Build order

1. ~~**Migration**~~ — **DONE 2026-09-06**, migration `0050_closed_blindfold.sql`.
   Renamed to `code` (verified RENAME, not drop — all 46 badge numbers intact),
   added `division` and `employee_external_ref`, seeded every new state. Caught
   three writers spreading caller input into an insert, which would have
   silently stopped persisting badge numbers; see the changelog.
2. **The adapter, as a pure function** — Bamboo payload in, our shape out. Lives
   in `packages/domain` so it is testable with no database and no network. Both
   response shapes fixtured from the client's two samples.
3. **Fetch `list-employees`, cursor-paginated** — one endpoint, one explicit
   `fields` list, Basic auth with the key as username. Follow `_links.next` to
   the end rather than assuming a single page. **`GET` only**, hardcoded, with
   no verb parameter and no write helper anywhere in the client, plus a test
   asserting the method so a future change that adds one fails rather than
   ships. See the read-only rule at the top of this document.
4. **Dry-run preview** — report created / updated / skipped / refused, no writes.
5. **The write, resolving refs in order** — people first, then the `reportsTo`
   edge in a second pass, since a manager may be imported after their report.
   Never write a field named in `_restrictedFields`.
6. **Tests, then the changelog** — adapter tests need no fixtures; integration
   tests for the restricted-field rule and the two-pass manager edge, run inside
   the api container where database tests actually execute rather than skip.

## 8. Open items

- **Urban's real division list is unknown.** Only "Operations" has been seen, in
  one sample. The flat model is robust to whatever the rest turn out to be,
  which is part of why it was chosen.
- **Key scope is unverified.** Whether the API key can read every mapped field
  is answered by `_restrictedFields` on the first live call, not before.
- **`project.externalId`** has the same code/foreign-PK conflation. Deliberately
  out of scope here.
- **WHICH ENDPOINT — reopened 2026-09-07, not resolved.** §3 records a settled
  decision for `list-employees` only. The user has since named the API as
  `{{baseUrl}}/api/v1/employees/directory?onlyCurrent=true`. That is the
  endpoint §3 examined and rejected, and `onlyCurrent=true` narrows it further
  in the same direction, so the two cannot both stand.

  This is not a preference. The reconcile behaviour the user settled on the
  same day — a leaver gets a delta flag, and acting on it stays an admin
  decision — **requires knowing who left**, and the directory excludes former
  employees entirely and carries no `status` field. Inferring departure from
  absence does not recover it: a person vanishes from that payload if they
  left, if Company Directory sharing settings changed, or if the key's scope
  changed, and those are indistinguishable. A sync that guessed would flag
  current employees as leavers on a settings change.

  Second cost, and it is worse in Urban's data than the generic argument in §3
  suggests: the directory gives the manager as `supervisor`, a display-name
  string. `docs/data/import/rejects.csv` records five near-duplicate name pairs
  deliberately kept as separate people, and both halves of each are live rows —
  `Jobani Abarca` / `JOVANI ABARCA`, `Gilmer Medina` / `Gilmar Medina`,
  `Alejandro Capuchino` / `Alejandro Aranda Capuchino`, `Romualdo` /
  `Romualdo Almaguer`, `FLORENCIO LOZA SR.` / `FLORIBERTO LOZA SR.`. Resolving
  a supervisor by name against that roster is not a hypothetical collision.

  Neither endpoint has been called, and neither will be by an agent — the
  first live call is the user's, per the standing constraint. So this is
  reasoned from the spec and from the two samples in this document, not from a
  response. Options, in the order they are worth considering: keep
  `list-employees`; or use the directory with `onlyCurrent` NOT set, if that
  parameter turns out to expose former employees; or accept the directory as
  the only reachable endpoint and drop leaver-flagging from scope, saying so out
  loud rather than shipping a flag that cannot be correct.

  Note also that the path given carries an `/api` prefix (`{{baseUrl}}/api/v1/...`)
  where §3 and §4 write `/v1/...`. The `{{baseUrl}}` placeholder is from the
  user's own API collection and must be taken from there rather than
  reconstructed — an agent guessing a base URL for a production HR system is
  exactly the wrong failure mode.

  **Consequence for the build order:** step 2's adapter is written against both
  response shapes regardless, which §7 already asks for. So this question does
  not block the adapter and must be answered before step 3.

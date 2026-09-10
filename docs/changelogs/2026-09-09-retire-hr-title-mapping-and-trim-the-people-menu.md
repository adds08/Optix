# Retire the HR title mapping, and cut the People menu to four items

The client opened the mapping screen, saw 131 BambooHR job titles waiting to be
told what they mean in Optix, and asked the right question: do we need this?

## What changed

- **`tbl_config_employee_role_mapping` and everything above it are gone** — the
  screen at `/settings/employee-mapping`, `routers/employeeMapping.ts`, the
  hardcoded `BAMBOO_JOB_TITLES` list its picker was built from, and the table
  itself (migration `0059`).

- **The People menu went from seven items to four.** Project Teams and My Crew
  were the same two-line file rendering `ProjectTeamsPanel`, one passing
  `onlyMine`; only "Crews" keeps a sidebar entry. Projects moved to its own
  group. Access Roles and Job Tiers stay in Settings but stop sharing the word
  "roles".

- **`empty-register.sql` now deletes `project_access_restriction`.**

## Why the mapping had to go rather than be improved

A job title does not answer the question the mapping was asking of it. The
BambooHR adapter says so in its own comment, and it is worth repeating because
it is the whole argument: *"Asking the title whether somebody supervises is
guesswork — `Field Engineer 3` does not say, and `Carpenter` says nothing at
all."* That is why the adapter reads `isManager` as a separate fact.

The table hedged its own guesses with a `review` disposition, which is a design
admitting it cannot be trusted unsupervised. Meanwhile `employee.update` was
already the single audited writer for a person's role, and choosing that role
while inviting somebody is both fewer steps and a decision made with the person
in front of you rather than in front of a title string.

Nothing was migrated out of the table. Its rows were suggestions that a second,
explicit action had to apply; no role in the system depended on one existing.

## What was found on the way

- **`empty-register.sql` had the same bug as the seed's wipe, and had been
  getting away with it.** It never deleted `project_access_restriction`, whose
  two foreign keys are both `NO ACTION` — a removal is a durable access decision
  that deliberately outlives the posting it refers to, so no cascade can reach
  it. The script ran clean every previous time only because that table happened
  to be empty. It failed the moment a dataset with a restriction in it was
  emptied. Fixed here; the seed's own copy of the bug was fixed earlier the same
  day.

- **Deleting a nav entry is not deleting a route.** `/project-teams` is
  deep-linked with `?projectId=` from Tools by Jobsite (twice) and from the
  projects register. The entry went; the route stays.

## Not done

`project.assign.pm`, `.superintendent` and `.foreman` are still three hardcoded
permissions naming three specific tiers, in a system where tiers are otherwise
tenant data. Urban's own `area_in_charge` and `general_superintendent` have no
matching permission and fall through to `project.team.assign`. Collapsing the
three into that one permission is the obvious next step and is not attempted
here.

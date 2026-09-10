# The tiers form a ladder

The team-role register listed a company's job-function tiers and said nothing about how
they relate. Director, Area In-charge, Project Manager and Foreman sat in one flat table,
alphabetical, with no way to record that a foreman answers to a superintendent. That is
fine for putting a person in a tier, which is all the register was built for. It is not
enough to ask somebody "who is your boss on this job", because nothing knew which tier to
even ask about.

`tbl_entity_team_role` now carries `reports_to_team_role_id`, a nullable self-reference.

## Why this is not the rank the roster comment refuses

`project_team_member.reportsToEmployeeId` carries a long comment refusing "a rank on the
role", and a reviewer who reads only the column name here will think this reverses it. It
does not, and the distinction is worth stating plainly because the next change in this
area will face the same question.

What that comment forbids is a company-wide ladder **asserted in code** — a constant
saying a PM always outranks a superintendent — on the grounds that Optix is multi-tenant
and construction firms genuinely differ in shape. This column is per-tenant data the
tenant edits on its own screen, the same category of thing every other column on that
table already is. The next customer's chain is their own rows.

Three properties keep that true, and each has a test:

- **Nothing about access reads it.** `assertCanAssign` still names `project.assign.pm` and
  its siblings. A permission decision made out of this column would be exactly the drift
  the roster comment exists to prevent.
- **It seeds, it does not bind.** A `project_team_member.reportsToEmployeeId` that
  disagrees with the ladder is legal and wins. A real job beats a template.
- **It is an edge, not an integer.** Two tiers can share a boss, which is not an edge case
  here: Urban's PM and General Superintendent both answer to the Area In-charge. A rank
  column cannot say that.

## What was built

- `findTierCycle` and `adjacentTiers` in `packages/domain`, beside the existing
  `findCycle`. A separate function rather than a parameter on that one, because the person
  edge and the tier edge look alike and are not the same thing; a shared implementation
  would be the first step toward writing one when asked for the other.
- `projectTeam.roles.setReportsTo`, gated on `project.team.manage` — describing the shape
  of the organisation is the same act as naming its parts, while putting a *person* into
  that shape stays `project.team.assign`.
- A "Reports to" column on `/settings/team-roles`, using the house `SearchSelect`. Editable
  for built-in tiers too: where a Project Manager sits differs between companies, and
  freezing it for the seeded three would make the feature useless for most of the ladder.
  Re-picking the current option clears the edge, which is how that control already behaves
  everywhere else.
- Migration `0044_short_stick`. `ON DELETE SET NULL`, so removing a tier orphans its
  children rather than deleting them.
- The seed now writes Urban's real chain — director, area in-charge, PM and general
  superintendent, superintendent, foreman — in a second pass, because a self-reference has
  no parent ids until the first insert has run. Only the three tiers carrying a dedicated
  permission are `isSystem`; Director and Area In-charge are Urban's, not the product's.

## Found while building

**The cross-tenant hole a foreign key does not close.** The self-reference has no tenant
predicate, so the database would happily accept another tenant's role id as a parent. The
router checks both ids against the caller's own register. There is no RLS here and the
`WHERE` clause is the isolation, which is easy to forget when a foreign key looks like it
is already doing the work. Two tests cover it.

**A browser probe deleted two seeded tiers.** A throwaway Playwright script used
`row.locator("button").first()`, which hit the delete button rather than the dropdown,
and its `hasText: "Director"` filter also matched the Area In-charge row whose parent cell
reads "Director". Local demo fixture only, restored by reseeding. Two lessons worth
keeping: filter table rows on an exact first-cell match, and `SearchSelect`'s trigger sets
`role="combobox"`, so `getByRole("button")` does not find it.

## Deliberately not done

This is the first slice of a larger proposal in
`docs/workings/ONBOARDING_AND_ROLE_HIERARCHY.md` — first-login onboarding, project
geography, roster confirmation and a progress screen. None of that is built. The ladder
went first because it is what everything else reads: a wizard cannot ask a person about
the tiers above and below them until the company has declared what those are.

The ladder also has no consumer yet beyond its own screen. That is the honest state: it is
seeded, editable, guarded and tested, and nothing reads it. `adjacentTiers` exists and is
tested for the wizard that will.

## Verified

`pnpm typecheck`, `pnpm lint`, and `pnpm test` run inside the api container so the database
suites actually execute rather than skipping. The Team Roles screen was driven in a real
browser: the ladder renders, a legal re-point persists across reload, re-picking clears the
edge, and pointing Director at Foreman is refused with "That would make the reporting line
circular: Foreman already reports up to Director" while leaving the edge unchanged.

Local only. Not deployed.

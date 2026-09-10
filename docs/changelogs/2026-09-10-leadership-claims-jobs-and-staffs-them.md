# Leadership takes on a job, and the chain staffs it

Every user who signed in — Directors included — was told to *"ask your manager to
assign this project"*, and every job read "0 team members". The register held
1,851 people synced from BambooHR, 20 projects, and **no roster rows at all**.

The cause was a bootstrap deadlock, not a bug. Authority to place somebody on a
job comes from the tier you hold ON THAT JOB (`assertCanAssign`), and on a job
nobody is on there is no such tier for anyone. Nothing could be placed because
nothing had been placed. `onboarding.state` then collapsed every user to a
single dead-end `review` screen, because its step list is
`(onAnyJob || canClaim) ? [projects, crew, review] : [review]` and both were
false for everybody.

## What changed

### Three leadership login roles, and the grant that breaks the circle

`director`, `area_in_charge` and `general_superintendent` did not exist — the
login list stopped at `project_manager`, so the people the client asked to invite
first had no role to receive and inviting one produced an account holding
nothing.

They are the only roles seeded with `role.claimTierNames`, which lets a person
put THEMSELVES on a job. One role able to do that is the whole bootstrap;
everybody below is placed through the ordinary "Set by" chain.

Migrations `0060` and `0061`, because `role`, `role_permission` and
`claim_tier_names` are seed data and the seed only runs against a fresh
database — the gap that already cost 0020, 0025 and 0038.

### The chain, as the client drew it

> "directors assigns general superintendents (gsupers) & area-incharge,
> area-incharge or gsupers assigns pm and superintendent, and hence forward"

Recorded as `team_role_assigner` edges: Director → Area In-charge and General
Superintendent; Area In-charge or General Superintendent → PM and
Superintendent; those → Foreman and the engineers. The migration also removed
**duplicate assigner rows** — the live register carried Superintendent four
times on Foreman, which the screen rendered as
"Superintendent, Superintendent, Superintendent…".

### Claiming stopped being one-shot

`claiming_closed_at` shut claiming permanently the moment setup finished. That
is right for somebody describing where they already work; it is wrong for the
tiers that RUN jobs, where taking on a new one is routine and the only remedy
was an administrator reopening their onboarding.

A role holding a claim grant now keeps the ability and reaches it from a
standing page, `/claim-a-job`. Everyone else is unchanged, which is what stops
this becoming a way to regain access.

The page renders the SAME component as the wizard's first step, so what is
offered and what is refused is decided once.

### The job title suggests, and never decides

`suggestRoleId`/`suggestTierName` (`packages/domain/src/role-suggestion.ts`)
pre-fill the role picker when inviting and the tier picker when staffing. Both
overridable, and the invite dialog names the title it guessed from:
*"Suggested from their job title, Project Director."*

**Deliberately a function and not a table.** The mapping table was retired on
2026-09-09 and the live data says why: ~100 distinct titles among invitable
people, **53 held by one person**, and only about six mapping cleanly to the
eight tiers. `Area In-charge` matches no title at all. The suggester returns
`null` freely — an unrecognised title leaves the picker unset, which is the
honest answer.

### The pickers show who somebody actually is

Options were `label: p.name` and nothing else — 1,851 people, repeated names.
They now carry job title and employee code as the picker's `hint`, which
`EntityField` already renders and searches, and the viewer's own HR direct
reports sort to the top.

### `/project-teams` stopped looking like an unknown page

Clicking "View project team" collapsed the sidebar to "HOME / Dashboard". The
route is deliberately absent from the nav but deep-linked from two screens, and
`matchItem` matched nothing, so `activeGroup` came back undefined. `NavItem`
gained `alsoMatches`, and the route now belongs to Crews.

## What was found while building it

- **Editing an APPLIED migration does nothing, silently.** Drizzle records a
  migration by hash, so the statements appended to `0060` never ran while
  `migrate` still reported success. Split into `0061`. Verified by querying for
  the rows afterwards rather than trusting the output.
- **`project_access_restriction` was missing its cascades**, alone among its
  siblings, so a tenant could not be deleted while a restriction existed. Every
  test teardown failed on that FK — which is how ten orphan test tenants
  accumulated in the shared dev database. Fixed in `0062`.
- **A title has no fixed place in the hierarchy.** `Field Engineer` reports to
  seven different titles depending on the job; `Superintendent` to six;
  `Project Manager` reports to another `Project Manager`. That is the structural
  argument against a title→tier mapping, beyond the tidiness one.
- **The four `Foreman` spellings hold 419 direct reports between them** and the
  reporting graph treats them identically — the suffix is trade, and duplicates
  `department_id`.
- **The phone writer added earlier ran against real BambooHR for the first
  time**: 1,418 contact rows for 1,210 people, one primary each, with
  `employee.phone` mirrored. Previously all discarded.

## Verified

Driven end to end against the real synced register — 1,851 people, 20 projects:

- Invited a real Project Director; the dialog pre-selected **Director** and said
  which title it came from. The account received the role and the claim grant.
- Signed in as her: three wizard steps and a working claim control, **not**
  "ask your manager".
- Claimed Lone Star and NEX, **completed onboarding**, then claimed Garland
  afterwards — the standing ability, which was the point.
- Staffed the job down the chain: Director → General Superintendent → Area
  In-charge, PM and Superintendent, every person landing in a tier matching
  their real BambooHR title.
- The picker showed `Eduardo Reyna / Project Engineer · 1662` with her own
  direct reports first, and `/project-teams` kept its sidebar.
- `pnpm typecheck` clean; **673 tests pass** inside the api container, up from
  647.

One existing test was rewritten rather than deleted: it asserted that finishing
setup closed claiming for everybody, which was the shipped rule and is no longer
it. The guard it was really protecting — that somebody with no grant gets no
second pass — is now asserted by its own test against an account with an empty
`claimTierNames`.

## Deliberately not done

- **No title → role/tier mapping table.** Suggestions only.
- **No `rank` column on `team_role`.** Ordering is the `reportsTo` edges, which
  a rank cannot express when two tiers share a boss.
- **No per-role feature gating yet.** The client asked to "set what each role can
  do and can not do into features" later; this change only moves the roles and
  the roster, not the permission surface.
- **No auto-population of rosters from the HR graph.** Of 933 reportsTo roots
  only five have a title, and those include a Carpenter and a Labor — "root"
  means HR left the field blank, not "executive".

## Where it is

Uncommitted on `development`. New: `packages/domain/src/role-suggestion.ts` and
its tests, `apps/web/app/(app)/claim-a-job/page.tsx`,
`packages/api-contracts/src/tier-claimable.test.ts`, migrations `0060`-`0062`.
Not deployed; `main` is what deploys.

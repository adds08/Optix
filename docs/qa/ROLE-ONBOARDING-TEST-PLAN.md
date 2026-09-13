# Role & onboarding test plan — every permutation

**Written for:** a QA engineer or coding agent testing Optix. You are testing
BEHAVIOUR, not writing fixes.

**NO CODE CHANGES.** Not a "small fix", not a typo, not an obvious one-liner.
If you find a defect you write it down. The value of this pass is an honest
list; a pass that also edits the code cannot be trusted to have reported
everything it touched.

**Written:** 2026-09-14. Derived from `packages/db/src/tenant-config.ts` and
`packages/domain/src/team-role-authority.ts` as they stand today. If the tenant
has edited its tiers on `/settings/team-roles`, the matrix in §3 is the SEEDED
shape and yours may differ — regenerate it (§3.1) rather than assuming.

---

## 1. Set up — demo data, not seed data

**There is no seed and you must not create one.** It was deleted 2026-09-13
because it invented business data that everyone then reasoned from. What you
build instead is **demo data**: obviously fake, additive, re-runnable, and
deletable in one statement.

```bash
make up
make migrate
ADMIN_PASSWORD=optix-dev-2026 make provision
```

That gives you a tenant, 35 permissions, 18 roles, 8 job tiers and exactly two
logins (`tech@optixtec.com` / `optix_it@optixtec.com`). **Zero** employees,
jobs or tools — that is correct, not broken.

### The demo fixture rules

Everything you create for these tests must obey all four:

1. **Obviously fake.** People are `Demo Director One`, `Demo Foreman Three`.
   Jobs are `DEMO-JOB-A`. Anyone glancing at a screenshot in three months must
   be able to tell it is not Urban's data.
2. **Additive and idempotent.** Re-running creates nothing twice and deletes
   nothing.
3. **Removable in one statement.** Put it all in ONE tenant, or tag every row,
   so a single `DELETE` cleans up.
4. **Never automatic.** Not from `make up`, not from `make provision`, not from
   the API boot. A command a human types.

If you cannot satisfy all four, do not build shared demo data — build the rows
inside each test and delete them after.

### What you need

**Eight people, one per tier**, each with a login, plus one job per ordering
scenario in §4. Create them through the PRODUCT — invite from `/people`,
consume the link in mailpit (`http://localhost:8025`), set a password. Creating
them with SQL skips the exact code you are testing.

Keep a table of email → tier → password as you go. You will sign in as each of
them many times.

---

## 2. The four things that sound like "role"

Confusing these produces wrong bug reports. Check which one you mean before
writing a finding.

| Thing | Where it lives | Question it answers | Scope |
|---|---|---|---|
| **Job title** | `company_role` | what payroll calls the post | per person |
| **Login role** | `role`, `/settings/roles` | what an ACCOUNT may see and do | per person |
| **Job tier** | `team_role`, `/settings/team-roles` | where somebody sits on ONE project | **per project** |
| **Employment role** | `employee.role` | LEGACY — abandoned, do not read | per person |

The same person can be a Foreman on one job and Crew on another. That is why
tier is per-project and role is not — and it is why §3 is a matrix and not a
list.

---

## 3. THE AUTHORITY MATRIX — all 64 permutations

The seeded ladder:

```
director
  └── area_in_charge
        ├── general_superintendent
        ├── pm
        └── superintendent
              ├── project_engineer
              ├── field_engineer
              └── foreman
```

Two independent grants, unioned (`canAssignIntoTier`,
`packages/domain/src/team-role-authority.ts`):

- **Set by** — the tier is explicitly listed as competent to fill that slot.
- **Ancestry** — the caller's tier is ABOVE the target on the ladder.

Plus two overrides that short-circuit everything: `hasAdminPermission`, and a
target tier marked open-to-everyone.

**8 tiers × 8 targets = 64 ordered pairs. 24 must be ALLOWED, 40 must be
REFUSED.** Test every one. The refusals matter more than the allowances —
that is your "can they change roles above them" question, and the answer must
be no, 40 times.

Two properties worth stating because they are easy to get wrong:

- **Nobody can place a Director.** `setBy: []` and nothing is above it. A
  director gets onto a job by CLAIMING it.
- **Self-placement is refused for all 8.** No tier lists itself.
- **A Superintendent cannot place a PM.** Not in PM's Set by, not above it on
  the ladder. This is the deliberate negative case that proves the hierarchy is
  real — if it ever passes, the model has collapsed.

### 3.1 Regenerate this table if the tenant edited its tiers

The matrix below is computed from the seeded `teamRoleSpecs`. Tiers are DATA —
a tenant can add or re-point them with no deploy. To recompute against the live
database, read `team_role` (`name`, `reports_to_team_role_id`) and
`team_role_assigner`, then apply: allow if caller ∈ target's assigners, OR
caller ∈ target's ancestors; else refuse.

### 3.2 The 64 pairs

| # | Caller's tier on the job | Target tier | Expected | Why |
|---|---|---|---|---|
| 1 | director | director | REFUSE | self-placement; no tier lists itself |
| 2 | director | area_in_charge | **ALLOW** | setBy |
| 3 | director | general_superintendent | **ALLOW** | setBy |
| 4 | director | pm | **ALLOW** | ancestry |
| 5 | director | superintendent | **ALLOW** | ancestry |
| 6 | director | project_engineer | **ALLOW** | ancestry |
| 7 | director | field_engineer | **ALLOW** | ancestry |
| 8 | director | foreman | **ALLOW** | ancestry |
| 9 | area_in_charge | director | REFUSE | not in Set by, not an ancestor |
| 10 | area_in_charge | area_in_charge | REFUSE | self-placement; no tier lists itself |
| 11 | area_in_charge | general_superintendent | **ALLOW** | setBy |
| 12 | area_in_charge | pm | **ALLOW** | setBy |
| 13 | area_in_charge | superintendent | **ALLOW** | setBy |
| 14 | area_in_charge | project_engineer | **ALLOW** | ancestry |
| 15 | area_in_charge | field_engineer | **ALLOW** | ancestry |
| 16 | area_in_charge | foreman | **ALLOW** | ancestry |
| 17 | general_superintendent | director | REFUSE | not in Set by, not an ancestor |
| 18 | general_superintendent | area_in_charge | REFUSE | not in Set by, not an ancestor |
| 19 | general_superintendent | general_superintendent | REFUSE | self-placement; no tier lists itself |
| 20 | general_superintendent | pm | **ALLOW** | setBy |
| 21 | general_superintendent | superintendent | **ALLOW** | setBy |
| 22 | general_superintendent | project_engineer | **ALLOW** | setBy |
| 23 | general_superintendent | field_engineer | **ALLOW** | setBy |
| 24 | general_superintendent | foreman | **ALLOW** | setBy |
| 25 | pm | director | REFUSE | not in Set by, not an ancestor |
| 26 | pm | area_in_charge | REFUSE | not in Set by, not an ancestor |
| 27 | pm | general_superintendent | REFUSE | not in Set by, not an ancestor |
| 28 | pm | pm | REFUSE | self-placement; no tier lists itself |
| 29 | pm | superintendent | REFUSE | not in Set by, not an ancestor |
| 30 | pm | project_engineer | **ALLOW** | setBy |
| 31 | pm | field_engineer | **ALLOW** | setBy |
| 32 | pm | foreman | **ALLOW** | setBy |
| 33 | superintendent | director | REFUSE | not in Set by, not an ancestor |
| 34 | superintendent | area_in_charge | REFUSE | not in Set by, not an ancestor |
| 35 | superintendent | general_superintendent | REFUSE | not in Set by, not an ancestor |
| 36 | superintendent | pm | REFUSE | not in Set by, not an ancestor |
| 37 | superintendent | superintendent | REFUSE | self-placement; no tier lists itself |
| 38 | superintendent | project_engineer | **ALLOW** | setBy |
| 39 | superintendent | field_engineer | **ALLOW** | setBy |
| 40 | superintendent | foreman | **ALLOW** | setBy |
| 41 | project_engineer | director | REFUSE | not in Set by, not an ancestor |
| 42 | project_engineer | area_in_charge | REFUSE | not in Set by, not an ancestor |
| 43 | project_engineer | general_superintendent | REFUSE | not in Set by, not an ancestor |
| 44 | project_engineer | pm | REFUSE | not in Set by, not an ancestor |
| 45 | project_engineer | superintendent | REFUSE | not in Set by, not an ancestor |
| 46 | project_engineer | project_engineer | REFUSE | self-placement; no tier lists itself |
| 47 | project_engineer | field_engineer | REFUSE | not in Set by, not an ancestor |
| 48 | project_engineer | foreman | REFUSE | not in Set by, not an ancestor |
| 49 | field_engineer | director | REFUSE | not in Set by, not an ancestor |
| 50 | field_engineer | area_in_charge | REFUSE | not in Set by, not an ancestor |
| 51 | field_engineer | general_superintendent | REFUSE | not in Set by, not an ancestor |
| 52 | field_engineer | pm | REFUSE | not in Set by, not an ancestor |
| 53 | field_engineer | superintendent | REFUSE | not in Set by, not an ancestor |
| 54 | field_engineer | project_engineer | REFUSE | not in Set by, not an ancestor |
| 55 | field_engineer | field_engineer | REFUSE | self-placement; no tier lists itself |
| 56 | field_engineer | foreman | REFUSE | not in Set by, not an ancestor |
| 57 | foreman | director | REFUSE | not in Set by, not an ancestor |
| 58 | foreman | area_in_charge | REFUSE | not in Set by, not an ancestor |
| 59 | foreman | general_superintendent | REFUSE | not in Set by, not an ancestor |
| 60 | foreman | pm | REFUSE | not in Set by, not an ancestor |
| 61 | foreman | superintendent | REFUSE | not in Set by, not an ancestor |
| 62 | foreman | project_engineer | REFUSE | not in Set by, not an ancestor |
| 63 | foreman | field_engineer | REFUSE | not in Set by, not an ancestor |
| 64 | foreman | foreman | REFUSE | self-placement; no tier lists itself |

---

## 4. ORDERING — who onboards first changes what the second one sees

This is the area with no test coverage at all, and where your questions land.
The permutations are large, so they are organised by the variable that matters
rather than listed as a flat cross-product.

### 4.1 The variable

For any pair of people A and B on the same job, three things vary
independently:

- **T** — the TIER each holds (8 options each)
- **O** — the ORDER they onboard (A first, B first, or simultaneously)
- **S** — the STATE the job is in when the second one arrives (empty / partly
  staffed / fully staffed / staffed then someone removed)

The full cross-product is not worth walking. What IS worth walking is every
case where the ORDER could change the OUTCOME — and that is exactly the set
below.

### 4.2 The ordering cases — all of them

For each: run it, then run it again with the order reversed, and the end state
must be IDENTICAL. **Order must not change the destination, only the route.**
Any difference is a finding.

| # | First | Then | The question |
|---|---|---|---|
| **O1** | Superintendent assigns a Foreman | PM onboards later | Does the PM see the foreman already there? Can the PM re-place or remove them? |
| **O2** | Superintendent assigns a Foreman | Director onboards later | Same, from above. The director is an ancestor of foreman — is the existing row editable by them? |
| **O3** | Director claims + staffs everyone | Superintendent logs in FIRST TIME | What does the superintendent see on their first screen? Their crew already present, or an empty wizard asking them to build it? |
| **O4** | Director claims + staffs everyone | Foreman logs in first time | Foreman's `onboarding_kind` is `none` — they should skip the wizard entirely. Do they? And do they still see their tools and crew? |
| **O5** | PM onboards first, staffs the job | Superintendent arrives later | The PM CAN place foremen (Set by). Does the superintendent inherit or conflict? |
| **O6** | Area In-charge staffs a job | General Superintendent arrives later | Both can place PM and superintendent. Overlapping authority — does the second one see the first's work? |
| **O7** | Two people claim the SAME job simultaneously | — | Only director / area_in_charge / general_superintendent can claim. Who wins? Is the loser told, or silently dropped? |
| **O8** | Person placed on a job | Then their LOGIN ROLE is changed | Does their tier survive? Should it? |
| **O9** | Person placed on a job | Then removed from the job | Do they still see it? Do the tools they held follow them or stay? |
| **O10** | Foreman onboards, holds tools | Then is moved to another job | Do the tools follow? (They should — tools follow the foreman.) |
| **O11** | Nobody has onboarded | A foreman is handed a tool anyway | Custody without a roster — legal or refused? |
| **O12** | Job fully staffed | The job is closed/completed | What happens to the roster and the custody? |
| **O13** | Person onboards | Same person invited AGAIN | Duplicate identity, or recognised as existing? |
| **O14** | Superintendent placed on job A | Tries to act on job B | Tier is PER PROJECT — authority must not leak across jobs. |
| **O15** | Person deferred (`defer`) | Later undeferred | Do they resume where they were, or restart? |

**O14 deserves extra attention.** It is the per-project property doing real
work: a superintendent with authority on job A must have NONE on job B. Test it
for at least three tiers, not just one.

### 4.3 For every ordering case, check all four

1. **What do they SEE?** Which jobs, which people, which tools. Compare against
   the visibility ladder (§5).
2. **What can they DO?** Which buttons are offered — and does the server agree?
3. **What can they NOT do?** Is the forbidden action absent from the UI, or
   present and then refused? Both are acceptable; a button that appears to work
   and silently does nothing is not.
4. **Were they TOLD?** A refusal with no message is a defect even when the
   refusal is correct.

---

## 5. Visibility — what each tier should see

`assets.view.all` > `.project` > `.crew` > `.own`, resolved server-side in
`scope.ts` and applied TO THE QUERY, never as a post-filter.

For each of the 8 tiers, on a job they are on and a job they are not:

| Check | Expect |
|---|---|
| The register (`/tools`) | only tools within their scope |
| Jobsites (`/jobsites`) | only their jobs, with real crews |
| People (`/people`) | scoped, and no account controls they lack |
| Reports | the same numbers as the register — a report that disagrees is a scoping leak |
| Dashboard tiles | same again |

**The job-scope selector is NOT access control.** It narrows what the server
already returned. Do not report it as a leak — check the server response.

---

## 6. Onboarding variants — all four

`onboarding_kind` on the ROLE decides which wizard a person gets:

| Kind | Who has it (seeded) | Expect |
|---|---|---|
| `equipment` | director, area_in_charge, general_superintendent, project_manager, engineer, superintendent, mechanic, crew | the full equipment wizard |
| `people` | hr | people-only; NO tools, NO custody |
| `office` | (none seeded) | verify what happens if a role is set to it |
| `none` | foreman, finance, read_only | skips the wizard entirely |

For each: does the person land somewhere useful, and does the wizard ask only
for things that role can actually answer?

**`none` is the interesting one.** A foreman skips onboarding (decided
2026-09-11) — verify they are not left in limbo, and that whoever manages them
can still see and maintain their assignments.

---

## 7. Things that will waste your time

- **`pnpm test` with no `DATABASE_URL` skips 453 tests and reports success.**
  Always: `DATABASE_URL=postgres://postgres:optix@localhost:5433/optix_ci pnpm test`
- **Check you are on the right database.** Volume must be
  `optix_postgres_data`; the compose project is pinned to `optix`.
- **Tiers are DATA.** If `/settings/team-roles` has been edited, §3 is stale —
  regenerate per §3.1.
- **A person can hold more than one tier on one job.** `canAssignIntoTier`
  takes a SET of the caller's tiers, so test someone who is both.
- **Do not import `docs/import/*.csv`.** Recovered from the deleted seed and
  explicitly unverified.
- **BambooHR is READ-ONLY.** GET only. It is the client's production HR system.
- **`docs/assessment/*.md` is a dated snapshot**, not current state.

---

## 8. Reporting

For each finding:

1. **The click path** — as a user does it, with which login.
2. **What happened** — error, wrong number, screenshot.
3. **What should happen**, and why. Cite the file or the matrix row.
4. **CONFIRMED or SUSPECTED.** Confirmed means you watched it fail.

For §3, report as a table of the pairs you tested and their outcome, so an
untested pair is visibly untested rather than assumed.

**Do not fix anything.** If a defect is one character, still do not fix it —
write it down. And do not report a test you did not run as passing: say which
of the 64 pairs and 15 ordering cases you actually executed.

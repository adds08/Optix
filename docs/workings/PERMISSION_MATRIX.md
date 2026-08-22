# Permission matrix — draft proposal for Urban's confirmation

**Status:** Draft proposal, 2026-08-15 · corrected 2026-08-22 · **awaiting Urban**
**Confirms:** STI-301 · **Blocks:** STI-302, STI-304, STI-307, STI-308, STI-501 — 11 units

> **Correction, 2026-08-22.** The first version of this document said it was "drafted from
> Urban's answers on the three questions that were open." **No record of those answers
> exists** — not in this repository, not in any meeting note, and `docs/tickets/STI-301`
> (written the day *after* this file) still carries **`Status: BLOCKED on Urban`** with the
> same questions listed as unanswered. The role definitions in §1 are **Bodhi Labs'
> proposals**, not decisions Urban has taken. They are presented here so Urban confirms or
> corrects a concrete document rather than inventing one in a meeting — which was always the
> intent — but nothing below is agreed until Urban says so.
>
> Also corrected in this pass: a permission that no longer exists, a row that contradicted
> shipped code, and ticket references using an obsolete numbering scheme. See §4.

`packages/db/src/seed.ts` `ROLE_PERMS` and `packages/types/src/index.ts` `PERMISSIONS` must
match this table exactly once it is confirmed. **They do not match it today** — see §4.
STI-308 generates its test from this table so the two cannot drift again.

---

## 1. The roles — proposed definitions, each needing confirmation

### "Admin" is three distinct roles

The most dangerous ambiguity in Urban's vocabulary. **Proposed resolution:**

| Role | Who they are | Scope |
|---|---|---|
| **System Administrator** | Programmers and developers who build the system — Bodhi Labs | Platform, schema, releases. Not a business role |
| **Equipment Administrator** | Owns the small tools programme | Every asset, every custody move, the desk queue |
| **Office Administrator** | Operations, accounts and general business administration | Business records; **not** custody, **not** platform |

None of these three may be collapsed into a single `admin` role in code, and no procedure
may branch on the name `admin`.

**Today `owner` is doing System Administrator's job, and Office Administrator has no
representation at all.**

### Engineer

**Proposed: an Engineer is a Project Manager with a different operational purpose —
identical where small tools are concerned.** They run work on a project rather than owning
it commercially, but their relationship to tools is the same: they see their projects'
tools, they place people on their projects, they do not run the yard.

**Consequence if confirmed:** `engineer` takes the same permission set as
`project_manager`. It exists as a separate role so reporting can tell them apart and so the
two can diverge later without a migration — not because they differ today.

### Mechanic

**Proposed: a mechanic is an Equipment department employee who holds and uses tools, like a
foreman — but for repair and maintenance rather than construction.** The distinction that
matters:

| | Foreman | Mechanic |
|---|---|---|
| Assigned to | A job | The Equipment department |
| Uses tools for | Building the work | Repairing and maintaining equipment |
| Their tools charge to | The **project** | The **department** (Equipment Yard) |

So a mechanic is a **custodian** (already true — `CUSTODIAN_ROLES` includes `mechanic`) and
would also become a **login role**. Their cost target is `department`, not `project`, which
the schema already supports: `docs/built/11-department-cost-targets.md` shipped exactly this.

**Consequence if confirmed:** STI-304 adds `mechanic` as a login role. The cost-target
behaviour needs no new work — only wiring the default so a mechanic's custody defaults to
charging the Equipment department.

### What confirming §1 costs

**Four login roles that do not exist today** — `system_admin`, `office_admin`, `engineer`
and `mechanic`. The system currently has ten (`packages/types/src/index.ts`): `owner`,
`equipment_admin`, `warehouse`, `procurement`, `project_manager`, `superintendent`,
`foreman`, `hr`, `finance`, `read_only`. Building the four is STI-304, already scoped. This
is not an objection — it is the price tag attached to the answer, and Urban should see it
before answering.

---

## 2. The matrix

`●` granted · `—` not granted · `▲` granted but scoped (see §3) · `?` open decision (see §5)

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
| `custody.reassign` | ● | ● | — | ● | ? | ? | ? | — | — | — | ? | — | — |
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
| `user.manage` † | ● | ● | ● | — | — | — | — | — | — | — | — | — | — |
| `department.read` | ● | ● | ● | ● | — | — | — | — | ● | ● | — | ● | ● |
| `department.manage` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |
| `report.read` | ● | ● | ● | ● | ▲ | ▲ | ▲ | ▲ | ▲ | ● | — | ● | ● |
| `audit.read` | ● | ● | ● | — | — | — | — | — | — | — | — | ● | — |
| `notification.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `notification.manage` | ● | ● | — | ● | — | — | — | — | — | — | — | — | — |
| `config.manage` | ● | ● | — | — | — | — | — | — | — | — | — | — | — |

**† `user.manage` does not exist in the codebase.** User administration shipped in STI-303
gated on **`config.manage`** (`routers/user.ts` — `create`, `setRole`, `setActive`,
`resetPassword`). This table grants `user.manage` to Office Administrator but grants
`config.manage` only to System and Equipment Admin — so as drafted, an Office Administrator
would be *unable* to create a user or reset a password. Splitting the two is a real change,
not a rename: `config.manage` also controls the LLM configuration and the high-value
threshold, and "may add a user" and "may change the approval threshold" are not obviously
the same authority. **This is open decision 4 in §5.**

---

## 3. Scope permissions — what `▲` resolves to

A grant says *may see*; a scope says *how much*. These are the new permissions STI-302 adds,
and they are what replaces every `actor.role == '...'` comparison.

| Scope permission | Held by | Resolves to |
|---|---|---|
| `assets.view.all` | System Admin, Equipment Admin, Office Admin, Warehouse, Procurement, Finance, Read-only | Everything in the tenant |
| `assets.view.project` | PM, **Engineer** | Assets on the projects they are on the team of |
| `assets.view.crew` | Superintendent | Assets held by foremen reporting to them |
| `assets.view.own` | Foreman, **Mechanic** | Assets they personally hold |

Resolution is first-match in that order, so a role holding two scopes gets the wider one.

**None of these four permissions exists yet** — building them is STI-302, which this
document blocks.

---

## 4. Where this table and the shipped system disagree today

The header claims `ROLE_PERMS` "must match this table exactly". It does not, and this table
has never been reconciled against the seed. Reconciling it — and pinning it with a test so
it cannot drift again — is **STI-308**.

**Corrected in this document on 2026-08-22:**

| Was | Now | Why |
|---|---|---|
| A `custody.verify` row | **Removed** | The permission is in neither `PERMISSIONS` nor anywhere else in the codebase. The `verify` custody outcome was removed on 2026-08-09 and its remnants swept by STI-111. Asking Urban to sign off a control for a deleted feature is how a stale document becomes a wrong ticket. |
| `custody.reassign` granted to PM, Engineer, Super and HR | **Marked `?`** | STI-306 **shipped** on 2026-08-19 granting it to `owner`, `equipment_admin` and `warehouse` only. `seed.ts` carries a comment saying precisely why it stopped there: widening it "would put a bulk custody move in more hands than Urban has agreed to." The code was honest; this table was not. |
| `STI-801`, `STI-102`, `STI-802`, `STI-804`, `STI-402` | `STI-301`, `STI-304`, `STI-302`, `STI-308`, `STI-306` | An obsolete numbering scheme from an earlier planning pass. The board in `docs/tickets/` is authoritative. |

**Not corrected here, and still true:** spot-checking this table against seeded `ROLE_PERMS`
found divergences in **both** directions beyond `custody.reassign` — the table is wider than
the seed for `finance`, `procurement` and `read_only` (it grants them `assignment.read`,
`transfer.read` and `department.read`, which they do not have), and narrower for `foreman`
(who holds `project.team.read`) and `hr` (who holds `report.read`). These are not decisions
for Urban; they are a reconciliation job for STI-308 once the table is confirmed. They are
recorded here so nobody reads this table as a description of the running system.

**The same claim was baked into the Jira import.** `docs/workings/gen-jira.js:78` carried
"Urban has now resolved the three open definitions" inside a ticket description, and
`jira-import.csv` / `.json` are generated from it. All three were corrected in place with the
same replacement text, so the generator and its artefacts stay in step without a full
regeneration. **If that import has already been run, the ticket text in the tracker is still
wrong in the way this document was** — it needs correcting there by hand.

---

## 5. What we need from Urban

### Tier 1 — confirm or correct the four definitions in §1

Engineer, Mechanic, the three-way Admin split, and the four new login roles that confirming
them requires. These are proposals with reasoning attached, not questions from a blank page.

### Tier 2 — four decisions, each with a default

If no answer is given, the default is what gets built, and changing it later is a migration
rather than a one-line change.

**1. Who may reassign everything a leaver holds?** Departure reassignment (STI-306, shipped)
moves every tool a departing person holds in one irreversible transaction. It is
deliberately a separate permission from `assignment.approve`, so it can be given to fewer
people.
- **Shipped today:** Equipment desk only — System Admin, Equipment Admin, Warehouse.
- **This table proposed widening it** to PM, Engineer, Superintendent and HR, on the
  reasoning that whoever *discovers* the departure should be able to act.
- **Default if unanswered:** leave it as shipped. Widening is a one-line change now.

**2. What does a mechanic see?** Drafted as `assets.view.own` — the tools in their own
custody, exactly as a foreman does. The alternative is a department-wide view of everything
the Equipment department holds, which is `assets.view.all` and belongs to the desk.
- **Default if unanswered:** own custody only. *This is the line in this document most
  likely to be wrong.*

**3. May an Office Administrator place a Project Manager on a job?** Drafted as granted,
because placing a PM on a job reads as an administrative act. If that is an Equipment
department decision at Urban, it moves.
- **Default if unanswered:** as drafted — Office Admin may.

**4. May an Office Administrator create users and reset passwords?** Today that power is
`config.manage`, which also controls the LLM configuration and the high-value approval
threshold. Granting it to Office Admin grants all three; keeping them separate means
splitting the permission.
- **Default if unanswered:** keep them together and do **not** grant Office Admin
  `config.manage` — so user administration stays with System and Equipment Admin.

Everything else in this table follows from the role definitions in §1 and needs a reason,
not a review, to change.

---

## 6. Answer sheet

Reply with eight lines. "OK" accepts the proposal or the default; anything else is the
correction, in whatever words are convenient.

| # | Question | Proposal / default | Your answer |
|---|---|---|---|
| 1 | Engineer = a Project Manager's permissions | as proposed | |
| 2 | Mechanic = holds tools like a foreman, charges to the Equipment department | as proposed | |
| 3 | "Admin" splits into System / Equipment / Office Administrator | as proposed | |
| 4 | Build the four new login roles this requires | yes | |
| 5 | Who may reassign everything a leaver holds | Equipment desk only (as shipped) | |
| 6 | What a mechanic sees | their own custody only | |
| 7 | May Office Admin place a PM on a job | yes | |
| 8 | May Office Admin create users and reset passwords | no — stays with System / Equipment Admin | |

**Silence is an answer.** Every default above is what gets built if this document is not
returned. Each is reversible cheaply *now* and expensively later — after the roles ship,
changing one is a migration against live permission rows, not an edit to a table.

**What unblocks on receipt:** STI-302 (the visibility ladder — who sees whose tools),
STI-304 (the four login roles), STI-307 (removing the last role-name branches from the
code), STI-308 (the test that pins this table so it cannot drift), STI-501 (role-based desk
views). Eleven units, all of Phase 3 and the start of Phase 5.

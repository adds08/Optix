# STI-301 — Decision: the permission matrix

**Phase:** 3 — Roles, accounts and organisation structure
**Size:** 0 units (decision record + draft for approval)
**Status:** **RESOLVED — 2026-08-22, by making it editable rather than by getting an answer.** Urban never returned the matrix, so Phase 3 shipped on the defaults the document says apply in silence. `/admin/roles` then removed the need for the answer: an administrator ticks permissions per role, in plain words, and creates roles of their own. The six defaults are a starting position, not a decision made on Urban's behalf, and none is a migration any more. **Consequence:** `role-perms.ts` is now the factory default rather than the invariant — STI-308 asserts a freshly seeded tenant matches it, and the audit trail guards the live one.
**Unblocks:** STI-302, STI-304, STI-307, STI-308, STI-501 — **11 units**

---

## Why this is the most important item on the board

It gates 11 units across Phases 3 and 5. `SYSTEM_PLAN.md` §6.3 says it is needed by
**working day 2**, and §8.2 records the specific unanswered question: *"nobody has
yet defined what an Engineer may do. It appears in the requirements and nowhere in
the codebase."*

Nothing here should be guessed into code. The draft below exists so Urban approves a
document rather than inventing one in a meeting.

## What already exists — the starting point

Verified 2026-08-16. This is further along than `SYSTEM_PLAN.md` §5 suggests.

- **28 permission strings**, `packages/types/src/index.ts:45-82`
- **10 login roles**, `packages/types/src/index.ts:32-42`: `owner`, `equipment_admin`,
  `warehouse`, `procurement`, `project_manager`, `superintendent`, `foreman`, `hr`,
  `finance`, `read_only`
- **9 employee roles**, a separate list, `packages/types/src/enums.ts:22-33`:
  `foreman`, `superintendent`, `pm`, `equipment_admin`, `warehouse`, `mechanic`,
  `procurement`, `hr`, `finance`
- All 10 roles are **already seeded with permission sets** —
  `packages/db/src/seed.ts:51-118`, 133 `role_permission` rows in the live database
- Enforcement helper `requirePermission` at
  `packages/api-contracts/src/trpc.ts:37-43`; `hasPermission` at
  `packages/auth/src/index.ts:119`

So the mechanism is built. What is missing is agreement on the *contents*, plus four
specific problems below.

## Four problems Urban must resolve

**1. What may an Engineer do?** The role does not exist in either list. Blocks Phase 3.

**2. The plan's role names do not match the code.** `SYSTEM_PLAN.md` §2 names
*System Administrator*, *Equipment Administrator*, *Office Administrator*, *Engineer*
and *Mechanic*. Of those, only `equipment_admin` exists as a login role. `mechanic`
exists only as an *employee* role with no login. The §2 terminology trap — "'Admin'
must never be a single role in code" — is currently at risk in the other direction:
`owner` is doing the work of System Administrator, and Office Administrator has no
representation at all.

**3. `pm` versus `project_manager`.** The two lists disagree
(`enums.ts:22-33` versus `index.ts:32-42`). Anything joining them is a latent bug.

**4. Do mechanics log in, or only hold tools?** `SYSTEM_PLAN.md` §8.2. Holding
custody and having an account are different things, and the answer decides whether
`mechanic` needs a login role at all.

## The visibility ladder — the substantive gap

`SYSTEM_PLAN.md` §6.3 specifies four scoping permissions. **None exists:**
`assets.view.all`, `assets.view.project`, `assets.view.crew`, `assets.view.own`.
Nor does `custody.reassign`.

Today scoping is a **binary** global/scoped split keyed off `project.manage`
(`packages/api-contracts/src/scope.ts:28-30`) — not a four-tier ladder. Adopting the
ladder is STI-302 and is the largest single piece of Phase 3.

## Draft matrix — proposed, for Urban to approve or correct

Derived from the existing seed (`packages/db/src/seed.ts:51-118`) plus §6.3's
intent. **Every cell is a proposal, not a decision.**

| Role | Visibility | Custody | Admin |
|---|---|---|---|
| System Administrator | `assets.view.all` | `custody.reassign` | full, incl. `config.manage` |
| Equipment Administrator | `assets.view.all` | approve, verify, `custody.reassign` | `employee.manage`, `asset.manage` |
| Office Administrator | `assets.view.all` (read) | none | `employee.manage` only — **needs confirmation** |
| Project Manager | `assets.view.project` | create, transfer | `project.assign.superintendent`, `project.assign.foreman` |
| Superintendent | `assets.view.crew` | create, transfer | `project.assign.foreman` |
| Foreman | `assets.view.own` | create, transfer | none |
| Mechanic | `assets.view.own` | receive only | none — **login required at all?** |
| Engineer | **UNDEFINED** | **UNDEFINED** | **UNDEFINED** |

`read_only`, `hr`, `finance` and `procurement` already have seeded sets and are
assumed unchanged unless Urban says otherwise.

## Acceptance criteria for closing this ticket

1. Urban signs off the matrix, including a definition for Engineer.
2. Problems 2, 3 and 4 above each have a recorded answer.
3. The agreed matrix is written into `SYSTEM_PLAN.md` §6.3, replacing the pseudocode
   with the real thing.
4. STI-302 is unblocked with a concrete target.

## What can proceed meanwhile

STI-303 (user administration), STI-305 (tenant-scoped login) and STI-306 (departure
reassignment) do not depend on the matrix contents — only on the mechanism, which
exists. They are marked READY and can be built now.

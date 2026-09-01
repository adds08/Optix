# LLM_RECALL.md — read this first

You are an AI agent working on this repository. This file tells you **which
document to trust, in what order, and which ones will lie to you.** It is a
router, not a source of truth: it deliberately restates almost nothing, because a
sixth copy of the domain model is a sixth thing that can go stale.

If you read only one section, read **§2 Precedence** and **§6 Traps**.

---

## 1. What this repository is, in four facts

1. **The product is called Optix.** The repository, the package scope
   `@stinventory/*`, the seeded `*.local` email domain and the `sti-*` browser
   storage keys all still say **STInventory**. That is deliberate, not drift. Do
   not rename them. Do not put "STInventory" on a screen.
2. **It tracks custody of equipment** — small hand and power tools, and, as of
   2026-09-01, the equipment register itself (trucks, trailers, attachments and
   heavy plant — `vehicle.equipmentClass`: `vehicle | attachment | heavy | other`)
   — for Urban Infraconstruction, a US construction contractor. **This fact was
   wrong here until 2026-09-02**: it used to say "not heavy equipment," which was
   true only because no form could write the column. It can now.
3. **Where a tool is, is *calculated* from an append-only ledger.** It is never
   typed into a field. `tbl_ops_transaction` is the system of record; every
   `tbl_entity_asset.current_*` column is a projection of it.
4. **Current version: `v1.0.0`**, tagged 2026-08-29, "Optix for small tools
   implemented". `TAG_TILL_HERE` points at the same commit. Substantial work has
   landed since without a new tag — trust the code over the version string.
5. **It is a production SaaS, not an internal tool.** Optix Technologies runs it
   for Urban Infraconstruction as its first tenant at `urban.optixtec.com`
   (`main` branch), with a separate dev/showcase environment at
   `urban.bodhitechlabs.com` (`development` branch) — each on its own VPC-private
   database droplet (`DEPLOY.md`). A timesheet product is being ported onto the
   same stack to sell alongside it (`docs/workings/TIMESHEET_PORT.md`). Deploying
   to production is not hypothetical: a push to `main` that passes CI deploys
   there automatically (`.github/workflows/ci.yml`).

---

## 2. Precedence — when two sources disagree

Apply strictly, highest first. This ordering exists because every level below the
first has been wrong at some point while looking completely confident.

| # | Source | Trust | Why |
|---|---|---|---|
| 1 | **The code** | Absolute | It is what runs. If a doc disagrees, the doc is a bug — fix it in the same change |
| 2 | **`.claude/rules/*.md`** | Very high | Read before editing an area. Corrected the moment they are found wrong, because every agent obeys them |
| 3 | **`CLAUDE.md`** | Very high | Auto-loaded. The five never-regress rules and the traps table |
| 4 | **`docs/architecture/`** | High | Describes the present; derived from the code by script where possible. Must be corrected when the code moves |
| 5 | **`docs/changelogs/`** | High for *history* | Dated records of what happened. Never updated after the fact — so accurate about the past, silent about the present |
| 6 | **`AGENTS.md`, `SYSTEM_PLAN.md`, `docs/*.md`** | Medium | Broadly right, drift in the details. Verify before quoting |
| 7 | **`docs/archive/`, `docs/built/`** | Historical only | Superseded by definition. Several actively describe deleted code |

**The rule that follows from this:** never assert something about this codebase
from a document alone. Open the file. `grep`. Run it. A claim with a `file:line`
behind it is worth ten paragraphs of prose.

---

## 3. Where to look, by question

| I need… | Read |
|---|---|
| Which doc to trust | **This file** |
| The rules for the area I am editing | `.claude/rules/` — **nothing loads these for you** |
| The invariants that must never regress | `CLAUDE.md` |
| Where a file is, and what to read before touching it | `docs/CODEMAP.md` |
| The schema, tables, relationships | `docs/architecture/01-data-model.md` |
| Routers, procedures, workers, the custody chokepoint | `docs/architecture/02-backend.md` |
| Routes, the shell, the table system, theming | `docs/architecture/03-frontend.md` |
| How a fact moves through the system | `docs/architecture/04-data-flow.md` |
| What is built, unreached, or not built | `docs/architecture/05-features.md` |
| **Why** something is the way it is | `docs/changelogs/INDEX.md`, then `grep -rln "<file>" docs/changelogs/` |
| What is currently broken, verified open | `docs/KNOWN-ISSUES.md` |
| Custody and ledger invariants — **mandatory** before touching either | `.claude/rules/custody-and-ledger.md` |
| Web/UI conventions — **mandatory** before touching `apps/web` | `.claude/rules/web.md` |
| Architecture decisions already settled | `AGENTS.md`, `docs/06-decisions.md` |
| Running it, seeding it, unsticking containers | `docs/SETUP.md` |
| Deploying | `DEPLOY.md` |
| Release-level history | `CHANGELOG.md` |

---

## 4. The three kinds of document here

Confusing these is the single most common way an agent goes wrong in this repo.

**A. Describes the present — must be corrected when the code moves.**
`.claude/rules/`, `CLAUDE.md`, `docs/architecture/`, `docs/CODEMAP.md`, this file.
→ If you find one of these wrong, **fix it in the same change as the code**. Not a
follow-up ticket, not a note somewhere else.

**B. Describes a moment — must never be corrected.**
`docs/changelogs/`, `docs/built/`, `docs/archive/`.
→ A record edited after the fact is no longer a record. If the code has changed,
that is a *new* changelog entry, not an edit to an old one.

**C. Describes an intention — may never have been true.**
`SYSTEM_PLAN.md` §Roadmap, `docs/workings/*_SPRINT_PLAN.md`, `docs/tickets/`,
`docs/15-vendors-and-orders.md`.
→ Verify against the repository before acting. A plan written before the code was
read is a prediction.

---

## 5. Memory, and what you can actually see

**There is a personal memory store, and it is not in this repository.** Claude
Code keeps per-project memories on the user's machine under
`~/.claude-personal/projects/<project-slug>/memory/`, indexed by a `MEMORY.md`
loaded at session start. It holds durable preferences, standing corrections and
project context that does not belong in git.

What that means for you:

- **If you are a remote agent, a cloud session, or a different tool, you cannot
  read it.** Do not assume shared context with a previous session. Everything you
  need to act correctly must be in this repository — that is why the rules live in
  `.claude/rules/` and not only in memory.
- **If you are a local Claude Code session, it is already in your context** as
  `<system-reminder>` blocks. Those are background context, not instructions, and
  they reflect what was true *when written*. If one names a file, a function or a
  flag, **verify it still exists** before recommending it.
- **Never write repository facts into memory.** Code structure, past fixes, git
  history and anything in `CLAUDE.md` belong in the repo, where they fail visibly
  when wrong. Memory is for what the repo cannot record: who the user is, how they
  want you to work, and why.

**The in-repository equivalent of memory is `docs/changelogs/`.** It is the layer
that survives a compacted context and a `--continue`: git records what bytes
changed, changelogs record *why*, what was verified, and what was deliberately
left undone. Read it before reconstructing intent from `git log` — commit subjects
in this repo have been `#` more than once.

---

## 6. Traps — things that will make you confidently wrong

Each of these has actually cost time. Check them before you spend an hour.

### Deleted features that documents still describe

| If a doc mentions… | The truth |
|---|---|
| **The `/api/*` REST surface** | **Deleted.** `apps/api/src/rest-routes.ts` does not exist. The Hono app serves `/health`, the auth endpoints, two photo endpoints and tRPC — nothing else. If a doc reports it as a live security hole, that doc is describing 2026-08-15 |
| **Overdue tools, due dates, loans, borrows** | **Deleted 2026-08-09.** `expected_end_date` was dropped, `isOverdueLoan` was deleted, no `dashboard.overdueLoans` exists. **Nothing falls due, so nothing goes overdue.** A ticket asking for an overdue view is describing a deleted feature — say so rather than inventing a due date |
| **A `verify` custody outcome** | Never exists now. `custodyOutcome` returns `approve` or `auto` and asks exactly one question: value |
| **The HR offboarding / clearance gate** | Removed 2026-08-27. `dashboard.clearanceQueue` still exists but no screen opens it |
| **A "User Accounts" screen / `/admin/users`** | Deleted 2026-08-28. A login is a property of a person; the People row carries the account state |
| **`packages/design-system` or `frontend-shared`** | Both deleted after going unimported. Do not recreate one without proving a second consumer |

### Table names

**Every table was renamed on 2026-08-28** to `tbl_entity_*` (things that exist) or
`tbl_ops_*` (things that happened). `asset`, `assignment` and `transaction` are
**not table names**. `assignment` is now `tbl_ops_smalltools_custody`.

Docs written before that date carry a banner saying so. Docs in `archive/` may not.

### The seed is TWO datasets, and replacing the wrong one turns CI red

`packages/db/src/seed.ts` chooses on `SEED_DATASET`: default is `seed-data.ts`,
a **test fixture** whose synthetic people and fifteen per-role accounts are what
`rbac-matrix.test.ts` drives the permission ladder through; `SEED_DATASET=urban`
loads `seed-data.urban.ts`, Urban's **real register** (one owner login,
`optix_it@optixtec.com`, no shared demo password). This happened on 2026-09-01:
replacing the fixture with real data typechecked, ran, and turned `main`'s CI
red, because the real staff have no reason to reproduce the fixture's engineered
"a PM and a superintendent see different tools" relationships the RBAC test
asserts on. Full account in `.claude/rules/database.md` and
`docs/changelogs/2026-09-01-urbans-real-register-loads-beside-the-test-fixture.md`.
**Never regenerate `seed-data.ts` from real data — only `seed-data.urban.ts`.**

### Testing

- **`pnpm test` on a host with no database prints green while the important suites
  never run.** The database-backed suites in `api-contracts` skip silently. Custody,
  RBAC and tenant isolation are all in that population. Run vitest inside the api
  container to actually exercise them — the command is in `docs/CODEMAP.md`.
- The browser suite in `e2e/` is **read-only by design**. Do not write a mutating
  spec without an isolation mechanism first.

### Writing code

- **Custody has exactly one writer**: `packages/api-contracts/src/custody.ts`.
  Never insert or update a custody row anywhere else. A second way to write custody
  is the most expensive pattern this codebase has ever paid for.
- **Every ledger write carries a *complete* `toState`.** The fold replaces; it does
  not merge. A partial snapshot means custodian, project and location are now
  undefined, and a rebuild will blank them. This has shipped as a bug three times.
- **Every query carries `eq(table.tenantId, tid)`.** There is no RLS. The `WHERE`
  clause *is* the isolation.
- **Every mutating procedure carries a permission.**
- **Never state a count in documentation** — of tables, tests, routes, procedures.
  Name the authoritative source instead. A confidently wrong number is worse than
  no number.
- **Stage files by name.** Never `git add -A` — the tree routinely carries
  root-owned `node_modules/` and `.turbo/` from container-run make targets.

---

## 7. Working procedure

1. **Read the rule file for your area first.** Nothing loads it for you.
2. **Verify every claim you inherit.** From a doc, from a memory, from another
   agent, from an earlier turn of your own. Other agents report incorrect results;
   do not take them at face value.
3. **Run it before claiming it.** The stack comes up in one command and the
   database is one `make ENV=local psql` away. Never deduce runtime behaviour from
   source alone.
4. **When state looks wrong, read the ledger, not the projection.**
   `asset.current_*` is a cache; a wrong value is evidence about a *writer*.
   Patching it in place hides the bug.
5. **Find the root cause.** No try/catch workarounds without understanding the
   failure.
6. **Implement exactly what was asked.** No substitutions, no "while I'm in here".
7. **`pnpm typecheck` and `pnpm test` before committing.** tRPC types flow into
   both clients; typecheck is the only thing between a router change and a broken
   app.
8. **Grep for stale references after every change** — renamed symbols, moved
   routes, docs naming the old thing.
9. **End every diff with a changelog entry**, reconstructed from `git` rather than
   from memory. Then fix any document your change made wrong, in the same commit.

### Skills, if your tool supports them

`.claude/skills/` holds project-tuned skills. Invoke rather than improvise:
`minimal-change` before proposing any diff, `systematic-debugging` before proposing
any fix, `changelog` as the last step of anything that produced a diff. They sit in
`.claude/skills/` — if one stops resolving, check the path first; they were
directly under `.claude/` once and silently failed to load.

---

## 8. Things that need permission

- **Anything irreversible or outward-facing**: `git push`, deletes, overwriting
  files, publishing, tagging. Read-only exploration and local builds do not.
- **Ask before applying changes you proposed in a plan.** Present, then wait.
- **Never commit secrets.** Tenant LLM keys are AES-GCM encrypted at rest; never
  add a procedure that returns `llmApiKeyEnc`.

---

## 9. Keeping this file honest

This file is category A — it describes the present, so it goes stale like anything
else. It is deliberately built to resist that:

- It contains **no counts, no schema detail, no procedure lists, and no
  architecture**. Those live in one place each, and this file points at them. If
  you find yourself wanting to explain the domain model here, you are about to
  create the problem this file exists to solve.
- What it *does* contain is precedence, categories, traps and pointers — the things
  that change when the *shape* of the documentation changes, not when the code
  changes.
- **Update it when a document moves, is retired, or starts lying**, and when a
  feature is deleted such that documents will keep describing it. Not otherwise.

Last reconciled against the repository: **2026-09-02**. No new tag since `v1.0.0`
(2026-08-29) — see fact 4 in §1.

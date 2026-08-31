# STInventory

Internal small-tools & equipment **custody** platform for Urban Infraconstruction.
pnpm + Turbo monorepo · Hono + tRPC API · Next.js 15 web · Expo mobile · Drizzle/Postgres.

**The product is called Optix** (Optix Technologies) in the interface, as of 2026-08-27.
STInventory is the repo, the package scope `@stinventory/*`, the seeded `*.local` email
domain and the `sti-*` storage keys — all of which stay. The rename is user-facing text and
the mark only, and `apps/web/components/optix-mark.tsx` is its single definition. Docs and
tickets written before that date still say STInventory and are not wrong about anything but
the name; don't rename the world to make them agree, and don't put "STInventory" back on a
screen.

**The one idea that explains the codebase:** where a tool is, is *calculated* from an
append-only ledger — never typed into a field. `transaction` is the system of record; every
`asset.current_*` column is a projection of it. Ownership (who paid) and custody (who holds
it now) are separate axes, and tools follow the person, not the site.

| I need… | Read |
|---|---|
| To run it, seed it, or unstick the containers | `docs/SETUP.md` |
| The domain model, roadmap, ADRs | `AGENTS.md` |
| Rules for the area I'm editing | `.claude/rules/` — **read the file covering your area; nothing loads it for you** |
| Which document to trust, and in what order | `LLM_RECALL.md` — **read this first if you are an agent** |
| The schema, the routers, the flows, what is built | `docs/architecture/` — derived from the code, corrected when the code moves |
| Where a file is, and what to read before editing it | `docs/CODEMAP.md` |
| Why something is the way it is | `docs/changelogs/INDEX.md` |

---

## Skills — invoke these, don't improvise

| Situation | Skill |
|---|---|
| Anything that will produce a diff — plan, implement, review | **`minimal-change`**, before proposing the diff |
| Any bug, test failure, wrong state, stuck message | **`systematic-debugging`**, before proposing a fix |
| "Explain this", "I want visuals", a subsystem too big for chat | **`visual-explainer`** |
| Delivering a whole ticket or feature end to end | **`/feature-delivery <TICKET-ID>`** — ticket, branch, implement, adversarial QA, correctness + security review, PR |
| A task that produced a diff, as the last step before you report done | **`changelog`** — reconstructs the entry from `git`, writes `docs/changelogs/YYYY-MM-DD-slug.md` |

`/feature-delivery` never fires on its own; it runs only when you invoke it. Tunables
and the off switch are in `.claude/workflow.config.json`. Agents review and comment —
**a human is the sole approver, and no agent merges.**

These live in `.claude/skills/` and are tuned to this repo. (They sat directly under
`.claude/` until 2026-08-18, which meant the `Skill` tool could not find them and every
subagent told to invoke one silently failed — if a skill stops resolving, check the path
first.) The `superpowers` plugin ships a generic
`systematic-debugging` too — **prefer the project one**; it names this codebase's real
evidence sources and traps.

---

## The five things that must never regress

If minimalism or convenience conflicts with any of these, they win — say so out loud.

1. **Every ledger write carries a complete `toState`.** The fold *replaces*, it does not
   merge. A partial snapshot does not mean "status changed" — it means custodian, project and
   location are now undefined, and a rebuild will blank them. This has shipped three
   times — most recently `assignment.return` (STI-113).
2. **All custody writes go through `packages/api-contracts/src/custody.ts`.** Since STI-103
   the partial unique index `assignment_one_active_uq` is a backstop, so a bypass now *fails
   loudly* instead of quietly producing two custodians — but it is still a bypass. The index
   cannot close the previous row; only this file knows that opening custody means closing what
   was active first. Treat it as the one legitimate writer, exactly as before.
3. **Every query carries `eq(table.tenantId, tid)`.** There is no RLS. The `WHERE` clause
   *is* the isolation.
4. **Every mutating procedure carries a permission.** A bare `protectedProcedure` that writes
   needs a reason in the diff.
5. **Tests for the behaviour you changed.** The domain packages are pure and need no
   fixtures — there is no excuse there.

---

## Behaviour rules

1. **Read the ledger, not the projection, when state looks wrong.** `asset.current_*` is a
   cache; a wrong value is evidence about a *writer*. Patching it in place hides the bug.
2. **Run it before claiming it.** The stack comes up in one command and the database is one
   `make ENV=local psql` away. Never deduce runtime behaviour from source alone.
3. **Verify a doc against the code before quoting it.** Prose docs in this repo have drifted
   from the schema and the routes before. The in-code rationale comments and `AGENTS.md` have
   held up best. When a doc and the code disagree, the code wins — and fix the doc in the same
   change rather than noting the discrepancy somewhere else.
4. **Implement exactly what was asked.** No substitutions, no "while I'm in here".
5. **Grep for stale references after every change** — renamed symbols, moved routes, docs
   naming the old thing.
6. **Run `pnpm typecheck` and `pnpm test` before committing.** tRPC types flow straight into
   both clients; typecheck is the only thing standing between a router change and a broken app.
7. **Find root causes.** No try/catch workarounds without understanding the failure.
8. **Every diff ends with a changelog entry.** Invoke the `changelog` skill before you
   report the task done — not for read-only work, and not once per file. It writes to
   `docs/changelogs/`, which predates the skill; `docs/changelogs/README.md` is the
   authority on the format and on how entries relate to specs and the sprint plan. Commit
   subjects in this repo have been `#` more than once, so `git log` alone does not tell the
   next session why anything changed or what was verified.
9. **Docs and seed data are part of the change, not follow-up work.** If the work you just did
   made a document wrong, fix the document. If it needs data the seed cannot produce, add it to
   the seed. Both happen in the same change — not in a ticket for later, and never by leaving a
   note that says someone should.

   This rule is not housekeeping. Both halves have already cost this project real time:

   - **A stale doc is worse than no doc, because agents obey it confidently.**
     `.claude/rules/` is what every agent is told to read before touching an area, so a
     wrong rule there misleads *every* future change, not just the next one. A stale gate table in `custody-and-ledger.md` caused a
     ticket to be written specifying a control for a state that had been deleted from the
     backend months earlier.
   - **Data the seed cannot produce is behaviour nobody tests.** The seed carries no
     acquisition costs, so the high-value approval gate could not be exercised without
     hand-editing rows in `psql` — which means that path was never really covered. Seeded
     ledger rows carried no `to_state`, so the fold was a no-op on every asset in the system.

   So: when you add a threshold, a status, a role or a state, **seed something that reaches
   it** — including the edge that trips the rule, not just the happy path. And prefer fixing
   the seed over hand-editing the database; a `psql` edit tests your machine, the seed tests
   everyone's.

---

## Conventions

- **Comments carry the rationale, not the mechanics.** This codebase's best trait: rules name
  the specific bug they prevent, often with the real tool tag involved. Preserve it — when you
  change custody logic, update the comment explaining *why*.
- **No agent attribution in commits or pull requests.** No `Co-Authored-By: Claude ...`
  trailer, no "Generated with Claude Code" line, no emoji. A commit message is imperative
  subject, blank line, prose explaining *why* — and it ends on the last paragraph. Several
  agent harnesses append these by default and their own instructions say to; this repo's
  rule overrides that, so strip them before committing rather than after being asked. The
  history is read by people looking for a decision, and a trailer naming the tool that typed
  it answers a question nobody has.
- **Migrations, never push.** `make generate` → commit the SQL → `make migrate`. `push` is
  deliberately named `push-dangerous`.
- **Don't state counts in documentation** — of tables, tests, routes, report pages. They go
  stale the moment someone adds one, and a confidently wrong number is worse than no number.
  Name the authoritative source instead (`schema/index.ts`, `make help`, the router).
- **A new dependency** may also need a line in `docker/Dockerfile.dev`'s COPY list *and* an
  anonymous volume in `docker-compose.yml`. Missing the latter silently stopped the tests once.
- **`scratch/`** is the working area for explainers, one-off queries and drafts. Gitignored.
- **Stage files by name.** Never `git add -A` — the tree routinely carries root-owned
  `node_modules/` and `.turbo/` left by container-run make targets.

---

## Traps that have cost time before

| Symptom | Cause |
|---|---|
| Tests fail only inside Docker | Missing `node_modules` anonymous volume for that package |
| A rebuild blanks everything | A writer emitted a partial `toState` |
| Two custodians for one tool | A write bypassed `custody.ts` — check `assignment.approve` |
| ~~A permission check "does nothing"~~ | **Gone, not fixed.** The `/api/*` REST surface no longer exists. The Hono app serves `/health`, `/auth/login`, `/auth/logout`, the two asset-photo endpoints and tRPC — nothing else. Both photo endpoints check the session (401), then `asset.manage` (403), then scope every read and write by `tenantId`. Verified 2026-08-24. If you are looking for an ungated mutation, it is not there. |
| ~~Overdue alert fires a day early~~ | **Gone, not fixed.** Removed 2026-08-09 with the borrow model: `assignment.expected_end_date` was DROPPED in migration `0012`, `isOverdueLoan` was deleted from `packages/domain`, and no `dashboard.overdueLoans` procedure exists. **Nothing falls due, so nothing goes overdue.** Verified 2026-08-22. If a doc, ticket or plan asks for an overdue view, it is describing a deleted feature — say so rather than inventing a due date. |
| Chat message stuck in `pending_manual` | No model configured, low confidence, or no asset resolved |
| Stale deps after a `package.json` change | Anonymous volumes survive rebuilds — `make ENV=local reset` |
| A migration exists but never runs, or `generate` re-emits the same SQL forever | Two branches generated the same idx; the merge dropped the entry from `meta/_journal.json`. `migrate` reads only the journal, `generate` diffs only the newest snapshot. Check both after any merge touching `packages/db/drizzle` |

---

## Constraints

- **Ask before applying changes you proposed in a plan.** Present, then wait.
- **Ask before anything irreversible or outward-facing** — `git push`, deletes, overwriting
  files, publishing. Read-only exploration and local builds need no permission.
- **Never commit secrets.** Tenant LLM keys are AES-GCM encrypted at rest; never add a
  procedure that returns `llmApiKeyEnc`.
- **Don't add a second way to write custody.** The most expensive pattern this codebase has
  paid for.
- **Don't update a projection directly** to make a screen look right. Write the event.
- **Don't commit local verification scripts** or seeded-data fixtures — they rot. Use `scratch/`.
- **Don't reintroduce a shared-frontend package.** `design-system` and `frontend-shared` were
  both deleted after going unimported by either client. Web theming lives in
  `apps/web/lib/themes`; if something genuinely needs sharing, prove a second consumer first.

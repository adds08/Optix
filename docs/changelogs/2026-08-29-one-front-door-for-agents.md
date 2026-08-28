# One front door for agents, and five that were competing for the job

Asked for: a file pointing other agents — local, remote, or a different tool
entirely — at the docs, the changelogs and the memory, so they do not get confused.

The confusion turned out to be structural rather than a missing signpost. **Six
root files each presented themselves as the AI starting point**, and most had
drifted. `SYSTEM_PLAN.md` said "the intended starting context" for AI assistants.
`AGENTS.md` called itself "Agent Memory". `CLAUDE.md` is auto-loaded.
`README.md` said "start here". `STINVENTORY-EXPLAINER.md` advertised itself as
verified against a commit. Adding a seventh voice would have made it worse.

## What changed

### `LLM_RECALL.md` — a router, not a seventh source of truth

At the repository root. It contains **no schema, no procedure list, no
architecture and no counts** — deliberately, and it says so in its last section.
What it carries is the part that goes stale when the *shape* of the documentation
changes rather than when the code does:

- **A precedence table.** Code, then `.claude/rules/`, then `CLAUDE.md`, then
  `docs/architecture/`, then changelogs, then the general docs, then the archive.
  Ordered because every level below the first has been confidently wrong at some
  point.
- **The three kinds of document here**, which is the distinction agents actually
  get wrong: describes-the-present (must be corrected), describes-a-moment (must
  never be), describes-an-intention (may never have been true).
- **What memory is and who can see it.** The personal store lives outside the
  repository on the user's machine; a remote agent cannot read it and must not
  assume shared context. The in-repository equivalent is `docs/changelogs/`.
- **A traps table** naming deleted features that documents still describe — the
  REST surface, borrows and overdue, the `verify` outcome, the clearance gate, the
  user-accounts screen, the two deleted frontend packages — and the table rename.

### Two root files archived, and their references repointed

- `STINVENTORY-EXPLAINER.md` → `docs/archive/`. It was accurate on 2026-08-15 and
  is now actively dangerous in one specific way: **§12.2 reports an ungated
  `/api/*` REST surface as a live finding and cites `apps/api/src/rest-routes.ts:14-21`.
  That file does not exist.** An agent acting on it goes hunting for a security
  hole that was closed.
- `HANDOFF.md` → `docs/archive/HANDOFF-tool-register-2026-07-27.md`. A July
  redesign note for a register that has been rebuilt several times since.

Both carry a banner naming what has gone stale. Every inbound reference was
repointed rather than left dangling — `CLAUDE.md`, `AGENTS.md` in four places, and
`.claude/rules/web.md`.

### `README.md` cut back to a quick start

It was describing the domain model, and describing it wrongly: "temporary loans
with overdue alerts" and "HR-triggered clearance", both deleted features, plus a
status paragraph dated 2026-07-25 claiming reports have no UI. It now says where to
go, the one idea, how to run it, how to test it, and how it deploys. The domain
model lives in one place and this is not it.

### `AGENTS.md`, `SYSTEM_PLAN.md`, ADR-2, and the rest

- `SYSTEM_PLAN.md`'s status header said "Release 1 in delivery, target 23 August
  2026". It now names `v1.0.0`.
- `AGENTS.md` listed "Two API surfaces" as a live known defect. Struck through and
  marked resolved, in the format that file already uses.
- **ADR-2 described `rest-routes.ts` as transitional debt "to be deleted once
  mobile is migrated", with "~352 lines to delete" in its consequences.** The
  decision it records is still correct and stays; a status note above it says the
  work is done and both files are gone. An ADR records a decision — you do not
  rewrite the decision because it succeeded.
- Five documents pointing at `docs/03-data-model.md` now point at
  `docs/architecture/01-data-model.md` or at the archived copy, whichever they
  meant.
- `docs/archive/README.md` gains the two new arrivals and two warnings: that
  archived findings may describe deleted code, and that relative links inside these
  files are broken because the files moved — not repaired, because a record edited
  after the fact stops being a record.

## What was found while building it

**I had broken a live workflow the day before.** Deleting `docs/features/` was
reported in the previous changelog as removing an unused convention. It was
unused — and `.claude/skills/feature-delivery/SKILL.md` instructs agents to write
feature records there, so deleting it broke `/feature-delivery` rather than tidying
anything. Restored, with a note at the top of the README saying it was deleted for
that reason and why that reasoning was wrong, so it is not deleted again on the
same argument. **Under-used is not the same as dead**, and the check that would
have caught it — grep for inbound references before deleting — is the one I skipped.

**There were two `SYSTEM_PLAN.md` files for a month**, and that was already caught
and handled before this session: `docs/workings/SYSTEM_PLAN.md` is a tombstone
pointing at the root copy. Noted here because `README.md` was still linking to the
tombstone rather than the document, which is the kind of indirection that survives
precisely because it technically resolves.

## Verified

- **Zero broken internal markdown links outside `docs/archive/`**, checked by
  script across every `.md` in the repository. The archive's are broken by design
  and are now documented as such.
- Every backticked file path asserted in `LLM_RECALL.md` was checked to exist. Two
  do not, both correctly: `MEMORY.md` lives outside the repository, and
  `apps/api/src/rest-routes.ts` is named precisely because it is gone.
- `apps/api/src/rest-routes.ts` confirmed absent before writing that it is; the
  comment in `index.ts` explaining its removal was read rather than assumed.
- The three codegen components deleted yesterday, and `docs/features/README.md`
  restored today, were each checked against git before acting.

**Not verified:** whether other tooling outside this repository points at
`STINVENTORY-EXPLAINER.md` or `HANDOFF.md` at their old root paths. Inbound
references *inside* the repository were all repointed; anything external will
404.

## Deliberately not done

- **`AGENTS.md` and `CLAUDE.md` were not restructured.** Both are current and both
  are loaded by tooling in ways that make moving them risky. `LLM_RECALL.md` points
  at them rather than absorbing them.
- **Archived documents were not corrected**, only bannered. A record edited after
  the fact is no longer a record.
- **`docs/tickets/` was left alone.** It is a live board with its own status
  discipline, and rewriting a board mid-flight is how you lose the state.
- **No counts in `LLM_RECALL.md`.** Not of routers, tables, tests or docs.

## Where it is

Branch `development`. `LLM_RECALL.md` is at the repository root and is now the
first thing `CLAUDE.md`, `README.md` and `AGENTS.md` point an agent at.

# A code leads every register now, and "job" stops meaning "project"

Phase 2 of the seven-phase plan tracked in
`/Users/adds08/.claude-personal/plans/imperative-beaming-puzzle.md`. Three
registers — tools, people, projects — each had their own idea of what the
human-facing identifier was called and where it sat in the table. This phase
settles on one word, "Code", one position (leading, right after the
row-selection checkbox), and reverts a naming drift on the Projects screen
that the user explicitly asked not to keep.

## What changed

### Tools get a real Code, distinct from the register's own number

`asset.serialNumber` is now surfaced as "Code" everywhere it's shown — the
tools register, the tool detail page, the chat draft preview, the audit
report. A new column, `isManualCode` (migration `0034_green_shaman.sql`),
records whether that value came off a manufacturer label or was typed in by
a person with nothing to scan; the register shows a small pencil mark next
to a manually-entered one so it doesn't read as a verified serial it isn't.

`assetNumber` — the system-issued sequential number that used to lead the
table as "ID" — is relabeled "Ref #" and moves to second position. It's
still the one value guaranteed unique and always present (Code can collide:
two hand-typed stand-ins, or a mis-copied serial), so it stays visible, just
no longer first.

### People get a Code column that didn't exist before

`employee.externalId` was shown as "Employee ID", baked into the same cell
as the person's name (`idName(externalId, name)`), with no way to see or
sort on it alone. It's now "Employee Code", split into its own leading
column on the People register — the same position Code holds on Tools.

### Projects: same relabel, plus a reversal

`project.externalId` moves from "Job ID" / "External ID" to "Project Code",
also split into its own leading column ahead of a name-only column (it had
been the reverse — name first, id second).

Separately: the Projects screen had drifted to calling the entity "Job" in
several places — the nav label, the page heading, empty-state copy, the
search placeholder. Asked directly, the answer was to keep "Project" as the
one word for this entity, not adopt "Job" — so all of that reverts.
`/jobsites` and `/job-groups` are untouched; they name a site and a grouping
respectively, not the project entity itself, and were never part of this
question.

## What was found while building it

**The project import spec's own CSV header was actively misleading**,
carried over from Phase 1: `externalId`'s header was `cost_code`, which reads
as a cost-accounting field and has nothing to do with the (now-removed)
`costCenter` column — it's just the project's code. Renamed to
`project_code` in Phase 1; this phase is the reason that rename mattered,
since "code" is now the name used everywhere else too.

**Not every field with "id" in its name deserved the same treatment.** The
employee and asset CSV import headers (`employee_id`, `serial`) were left
exactly as they were — neither was actually confusing anyone the way
`cost_code` was, and renaming a CSV header a spreadsheet-literate user
already knows costs real re-learning for no clarity gained. The rule applied
was "fix what's actually misleading", not "make every label say the same
word".

## Verified

- `pnpm typecheck` clean across `@stinventory/db`, `@stinventory/api-contracts`,
  `@stinventory/web`.
- `packages/api-contracts` suite: 254/254 passing — unchanged from Phase 1,
  confirming this phase's router changes (new `isManualCode` on `asset.list`/
  `asset.get`/`create`/`update`) didn't disturb anything.
- Migration `0034` generated as a single unambiguous `ADD COLUMN` (nothing
  else changed on the same table in this phase, so no rename-detection
  prompt this time) and applied with `make migrate`.
- Reseeded from scratch (`SEED_RESET=1`) and confirmed by direct query: two
  seeded tools (`TOOL-0001`, `TOOL-0002`) carry `is_manual_code = true`
  against their real seeded serials, so the flag is reachable from a clean
  database rather than only by hand-editing a row.

**Not verified this phase:** no browser session was available, so the
column reorder, the pencil icon, and the manual-code checkbox in the asset
form were checked by reading the rendered JSX and confirming the data layer
is correct — not by looking at the actual screen. That's real risk on a
column-ordering change specifically; worth a look before this ships.

## Deliberately not done

- **No CSV header renames for employee/asset.** See above — not the same
  problem `project_code` was solving.
- **No change to `.claude/rules/web.md`'s route list or nav documentation
  beyond the label itself** — the rule file's route table already just says
  `/projects`, which was never wrong.
- **`docs/workings/RELEASE_2_SPRINT_PLAN.md`** still says "Projects / Jobs"
  in one IA sketch. Left alone: it's a draft planning document, not a built
  spec or a rule file, and a single stale label there doesn't mislead the
  way a rules-file error would.

## Where it is

Branch `development`, uncommitted at the time of writing, on top of Phase 1's
diff in the same working tree.

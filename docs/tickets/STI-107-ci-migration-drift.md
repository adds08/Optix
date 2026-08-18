# STI-107 — Real migration drift detection in CI

**Phase:** 1 — Custody trail
**Size:** 1 unit
**Status:** DONE — QA PASS 2026-08-16 (round 2)
**Depends on:** nothing — run in parallel

---

## QA round 1 — FAIL

The first implementation detects **add-column** drift correctly but **not
rename-shaped** drift. Reproduced twice against the pinned in-container drizzle-kit
0.28.1:

Renaming a column in `schema.ts` with no migration makes `pnpm db:generate` print its
rename-disambiguation prompt and then **exit 0 in ~1.3 seconds, emitting no files**.
`git status --porcelain -- packages/db/drizzle` is therefore empty and the check
passes green on real drift.

The `< /dev/null` guard does not "fail fast" as the implementation claimed — it makes
the command **succeed silently**. Column and table renames both hit this path.

Root cause of the miss: the add-column path was proven and the result generalised to
the prompt path without testing it — even though this ticket's Approach section
explicitly said to verify the interactive-prompt behaviour of the pinned version.

**Confirmed correct and not to be churned in rework:** step wiring and gating,
`git status --porcelain` over `git diff --quiet`, absence of a `--check` flag in
0.28.1, clean-tree pass, add-column failure, tolerance of custom migrations
(`0005`/`0009`/`0013`), the migrate-step comment fix, and tree hygiene.

**Added acceptance criterion for rework:** rename-shaped drift must fail the check,
proven with verbatim output, alongside the existing add-column and clean-tree cases.

## QA round 2 — PASS

The exit code is not a usable signal at all: `bash -e` without `pipefail` takes the
pipeline's status from `tee`, which always succeeds. The rework therefore captures
generate's output and **fails unless it contains drizzle's drift-free sentinel**
(`No schema changes, nothing to migrate`, verified to occur exactly once in the
pinned `bin.cjs`), keeping the dirty-tree check as a second trigger.

Seven distinct drift shapes verified RED: column rename, table rename, dropped
column, changed column type, altered default, new index, and a changed FK
`onDelete`. Clean tree verified GREEN twice. A simulated crashed generate (exit 127,
masked by `tee`) also goes RED — fail-safe in both directions.

`drizzle-kit check` was evaluated and **rejected with evidence**: with the rename
drift present it printed `Everything's fine` and exited 0. It validates
migration-history collisions, not schema drift — it would have been a check that can
never fail.

Known and accepted limit: the check sees only what drizzle-kit's differ sees, so
content applied via custom migrations (triggers, grants) is invisible to it. That is
true of any generate-based mechanism and is the same property that makes custom
migrations not trip it.

Sentinel wording is coupled to drizzle-kit 0.28.1. The failure direction is safe — a
reworded upgrade turns every clean run red immediately, rather than passing silently
on drift — and the version is lockfile-pinned.

---

## Why this exists

`SYSTEM_PLAN.md` §5 item 5 and §9 — "migrations are committed with the code that
needs them, and CI fails on drift."

Half of this is already done. Verified 2026-08-16: **13 migrations (`0000`–`0012`)
are present and committed.** The plan's "two migrations are uncommitted" is stale.

The drift check is the half that is missing, and it is worse than missing — it is
*claimed*. `.github/workflows/ci.yml:97-99` carries a comment asserting that
migrating a fresh database catches drift between `schema.ts` and the migration
folder. The step at `ci.yml:100-101` runs `pnpm db:migrate` against a real Postgres
service, which proves only that the committed SQL **applies cleanly**. It never
diffs the result against `schema.ts`.

So if a developer edits `packages/db/src/schema/*.ts` and forgets to generate a
migration, CI passes green, and the drift is invisible until a fresh deploy. The
comment makes it *less* likely anyone checks, because it reads as though the problem
is handled.

`drizzle-kit generate` is available as `pnpm db:generate`
(`package.json:19` → `packages/db/package.json:14`) and is invoked nowhere in CI.

## Acceptance criteria

1. CI fails when `packages/db/src/schema/*.ts` has changed without a corresponding
   generated migration.
2. **Proven both ways.** A QA report that only shows CI green proves nothing. Show:
   - a deliberate uncommitted schema edit making the job **fail**, and
   - the clean tree making it **pass**.
   Do this on a scratch branch or locally; do not commit the deliberate break.
3. The failure message tells the developer to run `make generate`, not just that a
   diff exists.
4. The misleading comment at `ci.yml:97-99` is corrected in the same change. Per
   `CLAUDE.md`: when a doc and the code disagree, the code wins and the doc gets
   fixed in the same change.
5. Hand-written migrations (STI-101, STI-104) do not trip the check. Those have no
   `schema.ts` counterpart by design. Confirm the mechanism tolerates them — this is
   the most likely way this ticket ships broken.

## Approach

Run `drizzle-kit generate` in CI and fail if it produces a new file or leaves the
working tree dirty:

```yaml
- name: Check for uncommitted schema drift
  run: |
    pnpm db:generate
    if ! git diff --quiet -- packages/db/drizzle; then
      echo "::error::schema.ts has changed without a migration. Run 'make generate' and commit the SQL."
      git diff --stat -- packages/db/drizzle
      exit 1
    fi
```

Verify the real behaviour of the installed `drizzle-kit` version before settling on
this — some versions prompt interactively, and some emit a file even when nothing
changed, which would fail CI permanently. Check whether a `--check`-style flag
exists in the pinned version and prefer it if so.

## Files

- `.github/workflows/ci.yml:97-101` — the step and the comment
- `package.json:19` — `db:generate`
- `packages/db/drizzle/meta/_journal.json`

# STI-001 — Playwright E2E harness against the Docker stack

**Phase:** cross-cutting
**Size:** 2 units
**Status:** **DONE — 2026-08-22.** `e2e/` workspace package, `make ENV=local e2e`, root `pnpm e2e`, and a non-blocking CI job (**since removed — 2026-08-30, see STI-122**; criterion 8 was met when this shipped and the prediction in it came true). 27 specs across five roles. **Criterion 5, the isolation decision, is made explicitly and not deferred:** every spec is READ-ONLY, so no per-worker database is needed — building a template restore to protect reads would be machinery in place of a reason. The first MUTATING spec needs a mechanism chosen first, and that is written into STI-002 rather than left to be discovered when two workers fight over TOOL-0001.
**Blocks:** STI-002
**Depends on:** nothing

---

## Why this exists

Not in `SYSTEM_PLAN.md` §6 — §7 defers end-to-end tests to Release 2. It is proposed
here anyway because Release 1's central claim is *reachability*: §9 says a procedure
with no caller is not delivered. Nothing currently proves reachability automatically,
and STI-105 is about to add the most important reachable path in the product.

Verified 2026-08-16: **Playwright is not configured anywhere.** No
`playwright.config.*`, no `e2e/` directory, no `@playwright/test` in any
`package.json`, no `e2e` script or Makefile target. (The Playwright MCP tools in the
agent session are agent tooling, not repo configuration — they prove nothing about
CI.)

The wider testing picture: 8 test files, ~115 cases, all pure-function unit tests in
`packages/`. **Zero** tests in `apps/api`, `apps/web`, `apps/mobile` and
`packages/db` — none of which even declare a `test` script. There is no DB, HTTP or
router integration test anywhere. `pnpm test` in CI reaches only the 5 packages that
declare a test script, so no app-level behaviour gates a merge.

## Acceptance criteria

1. `@playwright/test` installed, `playwright.config.ts` at the repo root or in a
   dedicated `e2e/` workspace package, with the workspace wired up in
   `pnpm-workspace.yaml`.
2. `make ENV=local e2e` and a root `pnpm e2e` script both run the suite.
3. The suite runs against the **already-running Docker stack**
   (`http://localhost:3100` web, `http://localhost:4100` api) rather than booting its
   own server. The stack is the thing being tested; a separately-booted dev server
   would test something else.
4. Login state is captured once and reused via `storageState`, not repeated per test.
   Seeded credentials are in `packages/db/src/seed-data.ts:2485` — `owner`,
   `admin` (equipment_admin) and `warehouse` are the only three accounts that exist.
5. **Deterministic database state between runs.** This is the main design decision in
   the ticket and must be stated explicitly, not discovered later.
   Two constraints, both verified: per-test transaction rollback is unavailable
   because the server owns the connection across the HTTP boundary; and truncating
   `transaction` requires disabling the STI-104 trigger.
   The proposed mechanism is a template-database restore —
   `CREATE DATABASE ... TEMPLATE stinventory_seed`, one database per Playwright
   worker, passed through the API's `DATABASE_URL`. **Validate this before
   committing to it**; it is a design proposal from `STACK-NOTES.md`, not received
   wisdom, and a simpler per-run tenant may be enough for Release 1.
6. Use a `setup` project with `dependencies: ['setup']` and `storageState`, one file
   per role, rather than `globalSetup`. Project dependencies give retries and traces.
   Gitignore the auth state directory.
7. One real smoke test proving the harness works end to end: log in, land on the
   dashboard, assert a known seeded tool is visible.
8. A new CI job runs it. It may start non-blocking, but say so explicitly in the
   workflow and open a follow-up to make it blocking — a permanently non-blocking
   test job decays into noise. Note that CI lint is already blocking as of
   `ci.yml:40-46`, so the project's direction is toward gates, not away.
9. Artifacts on failure — trace, screenshot, video — or the job will be unusable
   when it goes red in CI.

## Non-goals

Do not write the custody flow specs here. That is STI-002. This ticket is the
harness and exactly one smoke test; keeping it that way is what makes it reviewable.

## Files

- `docker-compose.yml` — ports and service names
- `Makefile:39` — `.PHONY` list; add the `e2e` target
- `package.json:9-19` — add the `e2e` script
- `packages/db/src/seed-data.ts:2485` — the three login accounts
- `.github/workflows/ci.yml` — new job
- `pnpm-workspace.yaml` — if `e2e/` becomes a workspace package

## Note

A new dependency may also need a line in `docker/Dockerfile.dev`'s COPY list **and**
an anonymous volume in `docker-compose.yml`. Missing the latter has silently stopped
the tests in this repo before (`CLAUDE.md`, Traps).

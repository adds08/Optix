You are coding on STInventory, a construction tool-management system.

**Always start by reading AGENTS.md and CHANGELOG.md in the project root.** They contain the full memory context — architecture, conventions, what was built, and common traps to avoid.

**Key conventions:**
- Drizzle 0.36.4 — NO `.skipLocked()` or `.for("update")` on selects. Use plain query builder.
- All DB mutations: insert domain row → update asset projection → insert transaction → logEvent.
- Auth: session-table-based (Bearer token), NOT JWT.
- Engine at `engine/` — Python FastAPI, NOT part of pnpm/turbo workspace.
- Raw SQL returns snake_case; Drizzle `$inferSelect` returns camelCase. Do not mix in the same function.
- The `transaction` table is the system of record. Never create a parallel action-execution path.

**Commands:**
- `pnpm typecheck` — validate TypeScript across all packages
- `pnpm lint` — ESLint across all packages
- `pnpm dev` — run dev servers
- `pnpm --filter @stinventory/db seed` — reset + seed DB (add SEED_RESET=1 to wipe)

Always run `pnpm typecheck && pnpm lint` before marking work complete.

---
paths:
  - "apps/mobile/**"
---

# The mobile app

Expo Router (React Native). Flutter is dropped — see ADR-3. It is **more than the "shell"
the README describes**, but less than a field-ready app.

## What actually works

- tRPC client with `superjson`, deriving the LAN host so physical devices can reach a laptop
  API (`lib/trpc.ts:16-28`); bearer token from a cached session.
- **My Tools** (`(tabs)/index.tsx`) — `identity.me`, `asset.list` scoped by `custodianId`,
  pull-to-refresh, proper loading/error/empty states, rows linking to `/tool/[id]`.
  ~~`dashboard.overdueLoans` scoped by `employeeId`, overdue banner.~~ **That procedure does
  not exist.** Removed 2026-08-09 with the borrow model: `assignment.expected_end_date` was DROPPED in migration `0012`, `isOverdueLoan` was deleted from `packages/domain`, and no `dashboard.overdueLoans` procedure exists. **Nothing falls due, so nothing goes overdue.** Verified 2026-08-22.
- **Action screen** (`app/action/[type].tsx`) — all six types (assign, transfer, return,
  repair, lost, report) through a single `action.submit` mutation with cache invalidation.
- Tabs: my tools · hand-off · alerts · desk. Login, tool detail, @-mention input.

## What is absent

- **No camera or photo capture anywhere.** No `expo-image-picker`, no scan flow. "Scan the
  tag" does not exist.
- **No offline queue and no optimistic mutation.** Every action needs connectivity — a real
  constraint for a yard, and the open design question in AGENTS.md §14.
- `(tabs)/desk.tsx` pulls the **unscoped** full register and filters it in memory. Fine at the
  current fleet size, not fine as it grows.

## Conventions

- The client-side permission map in the action screen (`NEEDS`) only chooses **button
  wording**. The server decides and downgrades to a request on mismatch. Keep it that way —
  never gate the submit on it, or the field app and the desk will disagree about what happened.
- `EXPO_PUBLIC_API_URL` at build time; for a physical device it must be the laptop's LAN IP,
  not `localhost`.
- `apps/mobile` is **not** in `docker/Dockerfile.dev`'s COPY list and has no compose volume,
  so container-run `make typecheck` fails here (it also pins a different TypeScript major).
  Run mobile checks on the host.

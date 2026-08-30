# STI-204 — Typed `TRPCError` across the chat/action path

**Phase:** 2 — Assignment detail
**Size:** 2 units
**Status:** READY
**Depends on:** nothing

---

## Why this exists

`SYSTEM_PLAN.md` §6.2, second half: "typed `TRPCError` across routers".

Most routers already throw `TRPCError` — this is mostly done. What remains is a set of
plain `throw new Error` calls concentrated in exactly the wrong place: the chat and
action path, which is the surface a non-technical user touches.

**Re-count before you start** — the list below drifted between 2026-08-16 and
2026-08-18 (19 → 21). The authoritative source is the grep, not this table:

```
grep -rn 'throw new Error' packages/api-contracts/src --include='*.ts' | grep -v test
```

| File | Lines |
|---|---|
| `packages/api-contracts/src/apply-action.ts` | 130, 146, 179, 232, 267, 359, 398, 429, 436, 459, 524 |
| `packages/api-contracts/src/approve.ts` | 149, 151 |
| `packages/api-contracts/src/routers/task.ts` | 71, 137, 179 |
| `packages/api-contracts/src/routers/location.ts` | 505 |
| `packages/api-contracts/src/routers/messaging.ts` | 223 |
| `packages/api-contracts/src/routers/projectGroup.ts` | 143 |

These reach the client as `INTERNAL_SERVER_ERROR`. Several carry text written for a
user to read — `apply-action.ts:429` is "A new tool needs a tag…" — so the system is
currently rendering user guidance as a server crash.

## Acceptance criteria

1. Every listed `throw new Error` becomes a `TRPCError` with an accurate code.
   `BAD_REQUEST` and `NOT_FOUND` for the user-facing cases; keep
   `INTERNAL_SERVER_ERROR` only where it genuinely is one.
2. `cause` is preserved on every conversion. Never re-throw a bare `Error` out of a
   domain package and lose the original.
3. An `errorFormatter` at `initTRPC.create()` maps domain errors into `data` so both
   clients get them typed. Whatever goes in `data` is inferred on the client — that
   is the mechanism. See `STACK-NOTES.md`.
4. The chat path renders these as guidance, not as a crash. Verify at least
   `apply-action.ts:429` end to end in the browser: the user should see "A new tool
   needs a tag", not an error boundary.
5. Tests covering the conversion for at least the `apply-action.ts` cases —
   `apply-action.test.ts` already exists with 16 cases, so extend it.
6. `make ENV=local typecheck` and `make ENV=local test` pass.

## Explicitly out of scope

The 7 routers that throw nothing (`action`, `dashboard`, `entity`, `identity`,
`notification`, `preferences`, `report`, `transaction`) are not in scope. Do not add
error handling where none is needed to make a count look better.

*(The `/api/*` REST surface used to be named here as having no error formatter and no
permissions. It was **deleted entirely** on 2026-08-18 by STI-116, so that caveat no
longer applies.)*

## Files

- `packages/api-contracts/src/apply-action.ts` — the bulk of the work
- `packages/api-contracts/src/trpc.ts:33,40` — where `TRPCError` is already used, and
  where the formatter goes
- `packages/api-contracts/src/apply-action.test.ts` — extend

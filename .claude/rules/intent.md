---
paths:
  - "packages/intent/**"
  - "apps/api/src/messaging-worker.ts"
  - "apps/api/src/engine-client.ts"
  - "apps/api/src/entity-resolve.ts"
---

# The conversational layer

A foreman types a sentence; it becomes a **proposed** custody transaction a human confirms.
Nothing is parsed synchronously — `messaging.send` inserts `processing_status: "queued"` and
returns.

## The pipeline

```
send → queued → worker(4s) claims ≤5 → build context → resolve model
     → parseIntent → gate → pending_manual | action_proposed | auto-execute
     → human confirms → applyChatAction → ledger write
```

Gates, in order (`messaging-worker.ts`):
1. `intent === "task"` short-circuits into a `task` row, never a proposal.
2. `confidence >= 0.6 && intent !== "none"`, **and** a resolved asset unless the intent is
   `intake`/`request_purchase` or the author @-picked one. Otherwise → `pending_manual`.
3. `intake` additionally needs `tag && (make || description)`.
4. `AUTO_SAFE_INTENTS` = `{report, task}` only, and only when `!needsConfirmation`.

**Auto-execution runs `applyChatAction` with an empty permission set.** That is deliberate
belt-and-braces: any future auto-safe intent that tries to move custody is refused rather than
applied unattended. Do not "fix" it by passing real permissions.

Confidence is an input to the workflow, never authority over it (ADR-4).

## Adding an intent

The catalog is the single source: `packages/intent/src/catalog.ts`. Three cases, and the
tests pin the difference (`catalog.test.ts:53-59`):

| `apply` | Meaning |
|---|---|
| absent / `null` | No apply path at all — always files a task for the desk (`request_purchase`, `task`, `none`) |
| `{permission: "x"}` | Applied if the actor holds `x`, otherwise downgraded to a request |
| `{permission: null}` | Any authenticated member may apply (`report`) |

An `apply` intent **also** needs a `case` in the `apply-action.ts` switch, or it throws
`Cannot apply unsupported action type` at runtime. Adding to the catalog alone is a
half-change.

> `alwaysConfirm` and `CUSTODY_INTENTS` are **dead** — exported, asserted in tests, and
> consumed by no logic. The behaviour `docs/08` attributes to `alwaysConfirm` actually comes
> from `!autoSafe` in the worker. Don't rely on the field.

## Writing the prompt — target the small model

The parser runs on **whatever model the tenant configured** — `gpt-4o-mini` by default,
sometimes a 2B local MLX model. Claude Code writing the prompt is far larger than the model
that will execute it. Optimise the output for the small model, not for yourself.

1. Be explicit; enumerate edge cases. Don't rely on strong inference.
2. Keep reasoning chains short — 2–3 step decisions are reliable, longer ones drift.
3. Prefer structure it handles reliably: JSON with stable keys, numbered rules, tables.
4. Eliminate conflicting instructions. If the prompt forbids what the code then auto-corrects,
   the model gets mixed signals.
5. The system prompt is **generated** from the catalog (`prompt.ts:25-94`) — edit the catalog,
   not a hardcoded string. It deliberately names no seed projects or people, and
   `catalog.test.ts:97-104` asserts that. Keep it tenant-agnostic.
6. Only the last 5 recent messages go into the user prompt. Don't widen it without measuring.

## Transport quirks worth preserving

- The timeout signal is created **once, outside** the retry loop — the budget covers all
  attempts, deliberately.
- The retry ladder handles providers that 400: drop `response_format`, drop `temperature`,
  rename `max_tokens` → `max_completion_tokens`. One attempt per fixup.
- An empty reply with `finish_reason: "length"` retries once at 8192 tokens — this is the
  reasoning-model failure mode.
- Any intent not in the catalog is coerced to `none` with confidence 0.
- No model configured → logs a warning and returns `FALLBACK`; the message lands in
  `pending_manual` and is **never lost**. Preserve that property.

## Entity resolution

`entity-resolve.ts` tries tag patterns (`UIC-\d{3,4}`, `TR[AU]-\d{3}`) against `asset.tag` then
`vehicle.unit`, then token-by-token `ilike` across employee → project → location → asset.
Custodians are filtered to `CUSTODIAN_ROLES` and active employment. That list gained
`superintendent` on 2026-09-01 — a job is routinely rigged before its foreman is hired, and
the super holds the tools until then — so read the list from `packages/types/src/enums.ts`
rather than trusting a copy of it here or anywhere else. It must agree with `canHoldCustody`
in the role register, which `rbac-matrix.test.ts` now enforces in that direction.
Every query is tenant-scoped.

**An @-mention always beats a fuzzy match** — the worker skips resolution entirely for picked
slots. Keep that precedence.

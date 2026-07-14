# Plan: Patch AI Chat `transfer` Intent to Redirect to Form

## Goal

The AI chat widget (`apps/api/src/ai.ts`) natively handles `assign`, `return`, `repair`, `lost`, and `report` intents with no confirmation. The `transfer` intent is detected by regex (`inferIntent` line 74) but has **no execution handler** — it falls through to `return { ok: false, message: "Couldn't process that..." }`.

Patch it so foremen get a **helpful redirect** instead of a confusing dead end, keeping chat as the quick-entry convenience layer per Option A.

## Context

- AI Chat: `apps/api/src/ai.ts` — `handleAiChat()`. Regex-based, single-asset, no dates.
- Transfer form UI: `apps/web/components/transfer-form.tsx` — used in both `/(app)/` and `/d02/` pages.
- Messaging channel (out of scope): `messaging-worker.ts` already supports `transfer` with confirmation gating. Not touched.

## Changes

### 1. `apps/api/src/ai.ts` — add `transfer` intent handler

After `if (intent === "report")` block and before the final `return`, insert:

```ts
if (intent === "transfer") {
  const custodian = await resolveCustodian(db, tid, message);
  if (!custodian) {
    return {
      ok: true,
      message: `Please use the Transfer form to move ${tool.tag} (${tool.modelName}) to another foreman. Open the tool card → "Transfer".`,
    };
  }
  return {
    ok: true,
    message: `Please use the Transfer form to give ${tool.tag} (${tool.modelName}) to **${custodian.name}**. Open the tool card → "Transfer".`,
  };
}
```

Notes:
- We attempt to resolve the custodian name for a friendlier message, but still redirect to the form.
- `ok: true` so the UI does not show it as an error (red styling).
- No DB mutation. Chat remains a read-only helper for transfers.

### 2. Update chat bubble help / hint text (optional but recommended)

In `apps/web/components/ai-chat.tsx` line 10, update the welcome message:

```
"Hi! I can help you track tools. Try:\n• \"give UIC-1001 to Miguel\"\n• \"return UIC-1002\"\n• \"UIC-1008 is broken\"\n\nFor transfers between foremen, use the Transfer button on the tool card."
```

### 3. Verify no regressions

- Existing intents (`assign`, `return`, `repair`, `lost`, `report`) must remain unchanged.
- Typecheck clean (`pnpm typecheck`).

## Validation

1. Run web + api locally.
2. Log in as `foreman.miguel@stinventory.local`.
3. Open AI chat. Type `"transfer UIC-1001 to Sarah"` → expect a friendly redirect message, no error styling.
4. Type `"give UIC-1001 to Miguel"` → expect normal assignment as before.
5. `pnpm typecheck` passes.

## Risks / Open Questions

- None. This is a ~15-line patch inside one file. No DB schema or API contract changes.

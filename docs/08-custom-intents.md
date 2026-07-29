# Adding a custom intent

An intent is the unit of "what a foreman meant". `packages/intent/src/catalog.ts`
is the only place the list is written down; the LLM prompt, the permission
checks, the department routing and the approval-card headings are all generated
from it.

Before this file existed, adding one meant editing six places across three
packages and the failures were silent — a missing prompt entry meant the model
never emitted the intent at all, and a missing permission entry meant every
foreman's message became a request nobody could approve.

## The two kinds

**A classification-only intent** files something for a person: a note, a task, a
request. It changes nothing about where a tool is. This is a one-file change.

**A register-changing intent** moves custody or changes an asset's status. It
needs a second edit — the executor — because only that file knows how to write
a transaction that the projection can fold.

Prefer the first kind. Most of what the field says is information, and an
intent that files work is far cheaper to get wrong than one that moves a $12k
compactor.

## 1. Declare it

Add an entry to `INTENTS` in `packages/intent/src/catalog.ts`:

```ts
{
  name: "fuel",
  summary: "a tool or vehicle was fuelled, or needs fuel",
  examples: [
    "put 20 gallons in the generator at the yard",
    "the light tower is nearly out of diesel",
  ],
  apply: null,          // no register change — always a request
  alwaysConfirm: false,
  autoSafe: true,       // safe to file unattended
  aboutNewTool: false,
  department: "Maintenance",
}
```

What each field decides:

| Field | Decides |
|---|---|
| `name` | The wire value, stored on `message.intent_type`. Renaming one orphans history — treat it as permanent. |
| `summary`, `examples` | What goes into the generated system prompt. The examples do most of the classification work; write sentences a foreman would actually send, not schema descriptions. |
| `apply` | `null` means there is no execute path and every role's version becomes a request. `{ permission: "asset.manage" }` means holders of that permission apply it directly and everyone else raises a request. `{ permission: null }` means any authenticated member may apply it. |
| `alwaysConfirm` | Park for a human regardless of the model's confidence. True for anything that moves a tool between people. |
| `autoSafe` | Execute unattended. Only for things that annotate or file work. |
| `aboutNewTool` | The subject is not in the register yet, so "no matching asset" is expected rather than a parse failure. Without it, the worker sends every one of them to the manual queue. |
| `department` | Which desk the request lands on. |
| `requestTitle` | Heading on the approval card. Omit for intents that never become one. |

`pnpm --filter @stinventory/intent test` will fail if the entry is
self-contradictory — both `autoSafe` and `alwaysConfirm`, no examples, a
duplicate name. The permission assertions in that file are pinned to the exact
map, so a new entry with an `apply` block needs the expectation updated
deliberately; that is the point, not an obstacle.

## 2. Only if it changes the register

Add a `case` to the switch in `packages/api-contracts/src/apply-action.ts`. It
must set `after` to a **complete** state snapshot — the fold is
last-snapshot-wins, so a partial `toState` blanks every field it omits rather
than leaving it alone. This is a bug that has already been fixed once here.

```ts
case "fuel": {
  after = { ...before };            // custody unchanged
  eventType = "status_change";
  note = note || "Fuelled";
  break;
}
```

The invariant that file enforces: an action either appends a transaction and
moves the projection, or it throws. It never silently succeeds.

## 3. Only if it needs its own row

Intents that create something other than a transaction — `task` writes a `task`
row — are special-cased in `apps/api/src/messaging-worker.ts` before the
generic path. Follow the `task` branch.

## Testing it

There is no need to send a message through the field app to see whether the
model understood. **Settings → Chat parser → Test connection** runs the real
prompt over a real sentence and shows you the parse: the intent, the
confidence, and each entity it pulled out. Pass a different sentence via the
`message` input on `settings.testLlm` to check a new intent specifically.

A model that answers `none` to a worked example will answer `none` to the
field. The test reports that as a failure rather than as a successful
connection, because a live API key and a usable parser are different claims.

### Which model

Measured against DigitalOcean inference on 2026-07-30, parsing "gave the rotary
hammer UIC-1012 to Dave for the bridge job":

| Model | Result | Latency |
|---|---|---|
| `openai-gpt-4o-mini` | `assign`, all three entities correct | ~2s |
| `llama3.3-70b-instruct` | `assign`, all three entities correct | ~6s |
| `openai-gpt-5-nano` | `transfer` — wrong, at 0.95 confidence | ~16s |

`openai-gpt-4o-mini` is what the deployment uses. Avoid the reasoning models
(`gpt-5-nano` and relatives): they spend the whole token budget deliberating
and return empty content, which needed a dedicated retry to work around at all,
and then get the answer wrong anyway. Confidently wrong is worse here than
slow — a 0.95 on the wrong intent is above the auto-execute threshold.

**On timeouts:** `llmTimeoutMs` is a budget for the *whole* parse including any
parameter retries, not per attempt. That is deliberate — one message must not
be able to occupy a worker indefinitely — but it means a slow model can run out
of room mid-retry. 30s is the deployed value; 15s was tight enough that a
single slow provider response failed a parse that would otherwise have worked.

## What is deliberately not configurable

The intent list is code, not data. It could live in the database and be edited
from the settings page, and that would be worse: every intent needs either an
executor branch or a deliberate decision that it has none, and a row in a table
cannot carry that. An intent the model can emit but nothing can apply is a
message that fails after the foreman has been told it worked.

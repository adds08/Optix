# STInventory — Conversational Layer

Specification for the chat → intent → custody-action subsystem. This is the part of the
product a foreman actually touches, and it was built after the original planning corpus was
written, so it appears nowhere in `01-plan.md` §1-18.

Rationale for the approach is ADR-4 in `06-decisions.md`. Storage shape is
`03-data-model.md` §A7.

---

## 1. What problem this solves

`00-executive-summary.md` names WhatsApp as one of the three places tool custody currently
lives. The reason WhatsApp wins is that it costs one sentence. A form that asks a foreman to
select a tool, a custodian, a project, and a location costs a minute of fiddling on a phone
in a truck, so it does not get filled in, so the register goes stale, so nobody trusts it.

The conversational layer matches WhatsApp's cost. The foreman types the same sentence he
would have sent to the group chat:

> "gave the rotary hammer UIC-1012 to Dwayne for Trinity Bridge"

and the system turns it into a proposed custody transaction he confirms with one tap.

## 2. Components

| Component | Path | Role |
|---|---|---|
| Intent catalog | `packages/intent/src/catalog.ts` | Every intent declared once; the prompt and the permission / department / title maps are generated from it. See `docs/08-custom-intents.md` |
| Parser | `packages/intent/src/parse.ts`, `prompt.ts` | Builds the prompt, calls an OpenAI-compatible endpoint, normalises the reply |
| Engine client | `apps/api/src/engine-client.ts` | Resolves which model to use — tenant settings first, environment as a fallback — and turns a failure into the manual queue |
| Entity resolver | `apps/api/src/entity-resolve.ts` | Maps raw text spans to tenant-scoped DB rows |
| Worker | `apps/api/src/messaging-worker.ts` | Polls queued messages every 4s, orchestrates the pipeline |
| Router | `packages/api-contracts/src/routers/messaging.ts` | `listChannels`, `messages`, `send`, `confirmAction`, `manualEntry`, `pendingActions`, `feed` |
| Suggest | `packages/api-contracts/src/routers/entity.ts` | Typeahead across assets, employees, projects, locations, vehicles |
| Web UI | `apps/web/components/ai-chat.tsx`, `apps/web/app/d02/verification/page.tsx` | Chat surface and the admin review queue |

There is no separate parser process. There was one — a Python FastAPI sidecar on
port 4600 — and it was removed once it became clear nothing had called it in some
time: the API talks to the model directly. It had also grown its own copy of the
valid-intent list, so adding an intent meant editing two parsers, one of which
did nothing.

Model configuration is per tenant, in `tenant_settings`, editable at **Settings →
Chat parser** and encrypted at rest. The environment variables (`LLM_BASE_URL`,
`LLM_MODEL`, `LLM_API_KEY`) are a development fallback only.

## 3. Message state machine

`message.processing_status`, values from `PROCESSING_STATUSES`:

```
                      ┌──────────────────────────────► error
                      │                          (exception in worker)
  queued ──► processing ──┬──► action_executed        (task intent: task row created)
                          │
                          ├──► pending_manual         (low confidence / nothing resolved)
                          │         └──► manualEntry ──► action_executed
                          │
                          └──► action_proposed        (resolved, awaiting a human)
                                    └──► confirmAction ──► action_executed
```

`parsed` is defined in `PROCESSING_STATUSES` but never written by the current worker.

### Transitions in detail

1. **`send`** inserts the message with `processing_status = queued`.
2. The worker claims a batch of 5 (`BATCH_SIZE`), flips them to `processing`.
3. It builds **foreman context**: name, role, primary project, current location, every active
   assignment they hold, and the last 10 messages in the channel.
4. It looks the tenant's model configuration up and calls the parser with the message
   body plus that context.
5. Routing on the response:
   - **`task` intent** → insert a `task` row, status `action_executed`. No confirmation.
   - **confidence < 0.6, or intent `none`, or no assets named** → `pending_manual`.
   - **assets named but none resolve to a row** → `pending_manual`.
   - **otherwise** → resolve destination / custodian / project, build `proposed_action`,
     and either auto-execute or set `action_proposed`.

### Confidence thresholds

| Threshold | Effect | Where |
|---|---|---|
| `>= 0.6` and intent ≠ `none` | eligible to proceed | `messaging-worker.ts` |
| `needsConfirmation = false` **and** all entities resolved | eligible to auto-execute | `messaging-worker.ts` |
| `>= 0.9` with all entities present | the model sets `needsConfirmation = false` | `packages/intent/src/prompt.ts` |

## 4. Intents

Ten, declared in `packages/intent/src/catalog.ts`. To add one, see
`docs/08-custom-intents.md` — it is a single entry there, plus a `case` in the
executor only if the intent changes the register.

| Intent | Meaning | Execution today |
|---|---|---|
| `assign` | first hand-off / check-out to a foreman | on confirm: inserts `assignment`, updates projection, appends `assign` transaction |
| `return` | tool comes back to the yard | on confirm: closes the assignment, appends `return` transaction |
| `transfer` | move between foremen or projects | on confirm: inserts `transfer`, updates projection, appends `transfer` transaction |
| `lost` | tool is missing | on confirm: sets status `lost`, appends a `lost` transaction |
| `repair` | broken / needs maintenance | on confirm: closes custody, sets `in_maintenance`, appends `repair_start` |
| `intake` | register a tool the company already has | on confirm: inserts the asset and its opening `tag` transaction |
| `request_purchase` | "we need another one" | **not executed** — blocked on the procurement module |
| `report` | general note about a tool | auto-executes: appends a `status_change` transaction carrying the note |
| `task` | work item that is not a custody event | auto-executes: creates a `task` row |
| `none` | greeting, question, unclear | no action; `pending_manual` |

### Department routing

`departmentForAction` tags each proposed action with an owning desk — Maintenance (`repair`),
Warehouse (`return`), Procurement (`request_purchase`), Fleet (`assign`/`transfer` where the
asset label looks like a truck or trailer), otherwise Equipment Admin or Equipment Yard.

## 5. The entity-resolution contract

**The LLM never returns database IDs.** The generated prompt instructs it to emit only
raw text spans and best-guess labels:

```json
{
  "assets": [{"label": "Rotary Hammer", "raw": "the rotary hammer"}],
  "destination": {"kind": "employee", "raw": "Dwayne"},
  "custodian": {"raw": "Miguel"},
  "project": {"raw": "Trinity Bridge"}
}
```

Resolution from span to row happens in `apps/api/src/entity-resolve.ts`, always filtered by
`tenant_id`. This is the security boundary that makes the feature safe: **a hallucinated
identifier cannot address a real row**, because the model is not in the addressing path at
all. The worst case for a bad parse is a wrong proposal that a human declines — never a
silent write to someone else's data.

Corollary: never "optimize" this by letting the model emit IDs, and never widen a resolver
past its tenant filter.

## 6. Confirmation and the verification queue

- **`confirmAction`** — the foreman (or an admin) accepts an `action_proposed` message. The
  router re-reads the asset, writes the domain rows, updates the projection, appends
  transactions, records `executed_transaction_ids` on the message, and writes an `event_log`
  entry under category `messaging`.
- **`manualEntry`** — an admin resolves a `pending_manual` message by supplying the entities
  the parser could not.
- **`pendingActions` / verification page** (`/d02/verification`) — the admin queue of
  everything awaiting a human. Both procedures require `assignment.create`, so a foreman
  cannot approve their own low-confidence message into existence.

## 7. Known gaps and limitations

Behavioural gaps found during the 2026-07-25 documentation audit. These are **real defects**,
not design choices:

1. **`repair` and `lost` proposals are silent no-ops.** `confirmAction` handles only
   `assign`, `return`, and `transfer`. Confirming a `repair` or `lost` proposal falls through
   every branch, writes no transaction, and still marks the message `action_executed` — the
   foreman sees success and the asset never changes state. A tool reported lost via chat
   stays `available` in the register.
2. **The auto-execute path can mark work done that it never did.** In
   `messaging-worker.ts`, `allResolved` admits `return`, `repair`, and `lost` alongside
   `report`, but `autoExecuteAction` only writes transactions for `report`. The others reach
   `action_executed` with no effect.
3. **Chat-confirmed actions bypass the approval gate** (ADR-6): assignments are written
   `active` and transfers `completed`, skipping `pending_approval` regardless of asset value
   or whether the hand-off crosses people.
4. **No `FOR UPDATE SKIP LOCKED`** on the worker's claim query (Drizzle 0.36.4 limitation).
   Single-instance safe; multi-instance may double-process.
5. **No streaming and no caching** — every message is a fresh LLM call.
6. **Context window is the 10 most recent messages in the channel.** (Was the oldest ten,
   which meant channel context froze at whatever was said first.)
7. **`source_message_id` on `task` has no FK** to `message`.

## 8. Configuration

Model configuration is per tenant and lives in the database, not the environment:
**Settings → Chat parser** sets the base URL, model name, API key (encrypted at
rest, never returned to the browser) and timeout. **Test connection** there runs
the real prompt over a real sentence and shows the parse, because a live key and
a usable parser are different claims.

The environment variables below are a fallback for local development only, used
when a tenant has configured nothing:

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible endpoint, ending in `/v1` |
| `LLM_MODEL` | model name exactly as the provider names it |
| `LLM_API_KEY` | bearer token |
| `LLM_TIMEOUT_MS` | per-parse timeout |
| `LLM_API_KEY` | passed through to the OpenAI-compatible endpoint |
| `MOBILE_ORIGIN` | CORS origin for the Expo client |

> OBSOLETE: The engine is **not** a service in `docker-compose.yml` (which defines postgres, api, web
> only). In a containerized run the worker cannot reach the parser, so every message lands in
> `pending_manual` and chat degrades to a manual-entry queue with no error surfaced to the
> user. Add the service, or run the engine on the host, before demoing chat.

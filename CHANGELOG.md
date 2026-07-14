# Changelog

All notable changes to STInventory are documented in this file.

## v0.2.0 — 2026-07-13

### Added: Messaging System + AI Engine

**Schema & DB**
- `packages/db/src/schema/messaging.ts` — New `channel` and `message` tables with tenant isolation, processing status queue, jsonb intent storage, and audit trail.
- `packages/db/src/seed.ts` — Seeds "Equipment Department" channel for foreman messaging.

**Types & Env**
- `packages/types/src/index.ts` — Added `ChannelId`, `MessageId` branded IDs; `PROCESSING_STATUSES`, `MESSAGE_INTENTS`, `CHANNEL_KINDS` enums.
- `packages/env/src/server.ts` — Added `ENGINE_BASE_URL`, `ENGINE_TIMEOUT_MS`, `MOBILE_ORIGIN` env vars for engine connectivity and CORS.

**AI Engine (Python)**
- `engine/main.py` — FastAPI service with `POST /parse` endpoint. Calls local OMLX/Ollama (Gemma 3 4B IT) via OpenAI-compatible client. Returns structured intents with entity labels (no DB IDs). Retry-safe JSON extraction.
- `engine/prompts/system.md` — STInventory domain prompt encoding tool tags, foreman roles, projects, and 8 intent types.
- `engine/requirements.txt` — Python dependencies.
- `engine/README.md` — Run instructions and env reference.

**API Layer**
- `apps/api/src/engine-types.ts` — Shared TypeScript types matching engine JSON request/response.
- `apps/api/src/engine-client.ts` — HTTP client with configurable timeout, signal combiner, and fallback JSON parser.
- `apps/api/src/entity-resolve.ts` — Generalized entity resolution extracted from `ai.ts`. Functions: `matchEntity`, `resolveCustodian`, `resolveDestination`, `resolveProject`, `resolveLocation`, `resolveEngineAssets`.
- `apps/api/src/messaging-worker.ts` — Background poller (4s interval) that picks `queued` messages, builds foreman context, calls engine, resolves DB IDs, and sets status to `action_proposed` or `pending_manual`.
- `apps/api/src/index.ts` — Wired messaging worker poller alongside notification scheduler; added `MOBILE_ORIGIN` to CORS origin list.

**tRPC Routers**
- `packages/api-contracts/src/routers/messaging.ts` — 7 procedures: `listChannels`, `messages` (cursor-paginated), `send`, `confirmAction`, `manualEntry`, `pendingActions`, `feed`. All actions write to `transaction` table and update `asset.current_*` projections.
- `packages/api-contracts/src/routers/entity.ts` — `entity.suggest` procedure for typeahead search across assets, employees, projects, locations, and vehicles.
- `packages/api-contracts/src/audit.ts` — Added `"messaging"` audit category.

### Known Limitations
- Background poller uses plain Drizzle `select()` without `FOR UPDATE SKIP LOCKED` (Drizzle 0.36.4 limitation). Single-instance safe; multi-instance may double-process in edge cases.
- Engine auto-execute only handles the `report` intent. All other intents require foreman confirmation or admin manual entry.
- Engine has no streaming or caching. Each message triggers a fresh LLM call.

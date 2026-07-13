# STInventory AI Engine

Stateless FastAPI service that parses foreman chat messages into structured tool-management intents using a local LLM (Gemma 3 4B IT via OMLX/Ollama).

## Architecture

```
[apps/api] -- HTTP POST /parse --> [engine/] -- OpenAI-compatible --> [OMLX / Ollama]
```

- **Stateless**: no database, no auth, no tenant logic. Just AI.
- **Labels not IDs**: returns raw text spans (e.g. `"trailer 1001"`, `"Jose"`). The API resolves these to DB IDs.
- **Prompts in `prompts/`**: system prompt encodes the STInventory domain. Edit independently without code changes.

## Run

```bash
cd engine

# Install
pip install -r requirements.txt

# Start (default port 4600)
ENGINE_LLM_BASE_URL=http://localhost:11434/v1 \
ENGINE_MODEL=gemma3:4b-it \
uvicorn main:app --port 4600 --reload
```

Or set env in `.env` or your shell profile.

## Environment

| Variable | Default | Description |
|---|---|---|
| `ENGINE_LLM_BASE_URL` | `http://localhost:11434/v1` | OMLX/Ollama OpenAI-compatible endpoint |
| `ENGINE_MODEL` | `gemma3:4b-it` | Model name served by OMLX |
| `ENGINE_TIMEOUT_MS` | `15000` | LLM call timeout (ms) |
| `ENGINE_PORT` | `4600` | Engine HTTP port |

## API

### `POST /parse`

Request:
```json
{
  "message": "handing the Hilti to Jose at Trinity",
  "context": {
    "foremanName": "Miguel Torres",
    "foremanRole": "foreman",
    "currentAssignments": [
      {"tag": "UIC-1001", "model": "TE 60-ATC Rotary Hammer", "project": "Legacy West", "location": "Gang Box A"}
    ],
    "primaryProject": "Legacy West Phase 3",
    "currentLocation": "Gang Box A",
    "recentMessages": []
  }
}
```

Response:
```json
{
  "intent": "transfer",
  "confidence": 0.92,
  "entities": {
    "assets": [{"label": "Hilti TE 60-ATC", "raw": "Hilti"}],
    "destination": {"kind": "employee", "raw": "Jose"},
    "custodian": null,
    "project": {"label": "Trinity", "raw": "Trinity"}
  },
  "actionPayload": {},
  "needsConfirmation": false,
  "replyText": "Transfer UIC-1001 (TE 60-ATC Rotary Hammer) to Jose at Trinity?"
}
```

### `GET /health`

Returns `{"ok": true, "ts": <unix_timestamp>}`.

## Intent types

`transfer` | `assign` | `return` | `lost` | `repair` | `request_purchase` | `report` | `none`

## Development

```bash
# Lint
ruff check .

# Type check
mypy main.py
```

The engine is NOT part of the pnpm/turbo workspace. It has its own Python environment.

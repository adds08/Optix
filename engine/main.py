"""STInventory AI Engine — stateless intent parser for foreman messages.

Calls a local LLM (Gemma 3 4B IT via OMLX / Ollama) with an OpenAI-compatible
endpoint and returns structured intent.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from openai import OpenAI
from pydantic import BaseModel, Field

app = FastAPI(title="STInventory AI Engine", version="0.1.0")

LLM_BASE_URL = os.environ.get("ENGINE_LLM_BASE_URL", "http://localhost:8088/v1")
LLM_MODEL = os.environ.get("ENGINE_MODEL", "lmstudio-community/gemma-4-E2B-it-MLX-6bit")
LLM_API_KEY = os.environ.get("ENGINE_API_KEY", "1234")
LLM_TIMEOUT = int(os.environ.get("ENGINE_TIMEOUT_MS", "15000")) // 1000

PROMPT_DIR = os.path.join(os.path.dirname(__file__), "prompts")


def _load_prompt(name: str) -> str:
    path = os.path.join(PROMPT_DIR, name)
    with open(path) as f:
        return f.read()


SYSTEM_PROMPT = _load_prompt("system.md")


class EntityHint(BaseModel):
    label: str
    raw: str


class EngineContext(BaseModel):
    foremanName: str = ""
    foremanRole: str = ""
    currentAssignments: list[dict[str, Any]] = Field(default_factory=list)
    primaryProject: str = ""
    currentLocation: str = ""
    recentMessages: list[str] = Field(default_factory=list)


class ParseRequest(BaseModel):
    message: str
    context: EngineContext = Field(default_factory=EngineContext)


class ParseResponse(BaseModel):
    intent: str = "none"
    confidence: float = 0.0
    entities: dict[str, Any] = Field(default_factory=lambda: {
        "assets": [],
        "destination": None,
        "custodian": None,
        "project": None,
    })
    actionPayload: dict[str, Any] = Field(default_factory=dict)
    needsConfirmation: bool = True
    replyText: str = ""


def _build_user_prompt(req: ParseRequest) -> str:
    parts = [f"## Message\n{req.message}\n"]
    c = req.context
    ctx_lines = [f"- Foreman: {c.foremanName} ({c.foremanRole})"]
    if c.primaryProject:
        ctx_lines.append(f"- Primary project: {c.primaryProject}")
    if c.currentLocation:
        ctx_lines.append(f"- Current location: {c.currentLocation}")
    if c.currentAssignments:
        ctx_lines.append("- Current tools:")
        for a in c.currentAssignments:
            tag = a.get("tag", "")
            model = a.get("model", "")
            proj = a.get("project", "")
            loc = a.get("location", "")
            ctx_lines.append(f"  - {tag} ({model}) @ {proj} / {loc}")
    if c.recentMessages:
        ctx_lines.append("- Recent messages in channel:")
        for m in c.recentMessages[-5:]:
            ctx_lines.append(f"  - {m}")
    parts.append("## Context\n" + "\n".join(ctx_lines))
    return "\n\n".join(parts)


def _extract_json(text: str) -> dict[str, Any] | None:
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    raw = m.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    try:
        m2 = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
        if m2:
            return json.loads(m2.group(0))
    except json.JSONDecodeError:
        pass
    return None


_CLIENT: OpenAI | None = None


def _get_client() -> OpenAI:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    return _CLIENT


_DEFAULT_RESPONSE: dict[str, Any] = {
    "intent": "none",
    "confidence": 0.0,
    "entities": {"assets": [], "destination": None, "custodian": None, "project": None},
    "actionPayload": {},
    "needsConfirmation": True,
    "replyText": "",
}


def _call_llm(user_prompt: str) -> dict[str, Any]:
    client = _get_client()
    try:
        resp = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=1024,
            timeout=LLM_TIMEOUT,
        )
    except Exception as exc:
        raise ValueError(f"LLM call failed: {exc}") from exc
    content = resp.choices[0].message.content or ""
    parsed = _extract_json(content)
    if parsed is None:
        raise ValueError(f"Failed to parse LLM JSON output:\n{content}")
    return parsed


@app.get("/health")
def health():
    return {"ok": True, "ts": time.time()}


@app.post("/parse", response_model=ParseResponse)
def parse(req: ParseRequest, request: Request):
    user_prompt = _build_user_prompt(req)
    try:
        data = _call_llm(user_prompt)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    intent = data.get("intent", "none")
    valid_intents = {
        "transfer", "assign", "return", "lost", "repair",
        "request_purchase", "report", "task", "none",
    }
    if intent not in valid_intents:
        intent = "none"

    confidence = float(data.get("confidence", 0.0))
    needs_confirmation = bool(data.get("needsConfirmation", confidence < 0.8))

    raw_entities = data.get("entities", {})
    raw_action = data.get("actionPayload", {})

    return ParseResponse(
        intent=intent,
        confidence=min(max(confidence, 0.0), 1.0),
        entities={
            "assets": raw_entities.get("assets", []),
            "destination": raw_entities.get("destination"),
            "custodian": raw_entities.get("custodian"),
            "project": raw_entities.get("project"),
        },
        actionPayload=raw_action,
        needsConfirmation=needs_confirmation,
        replyText=data.get("replyText", ""),
    )

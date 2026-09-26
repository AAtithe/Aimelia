"""
Provider-agnostic LLM calls for the agent team.

Every agent asks for a JSON object back. Each agent config picks its own
provider and model, so the team can mix Claude and OpenAI models. When no API
key is configured the "mock" provider keeps the app usable for demos and tests.
"""
import json
import logging
import re
from typing import Any, Dict, Optional

from ..settings import settings

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "openai": "gpt-4o",
    "mock": "mock",
}


class LLMError(Exception):
    pass


def available_providers() -> Dict[str, bool]:
    return {
        "anthropic": bool(settings.ANTHROPIC_API_KEY),
        "openai": bool(settings.OPENAI_API_KEY),
        "mock": True,
    }


def resolve_provider(provider: Optional[str]) -> str:
    provider = (provider or "auto").lower()
    if provider != "auto":
        return provider
    if settings.ANTHROPIC_API_KEY:
        return "anthropic"
    if settings.OPENAI_API_KEY:
        return "openai"
    return "mock"


def parse_json(text: str) -> Dict[str, Any]:
    """Pull the first JSON object out of a model reply (tolerates code fences and preamble)."""
    text = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
    raise LLMError(f"Model did not return valid JSON: {text[:300]}")


def _call_anthropic(model: str, system: str, user: str, temperature: Optional[float]) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    kwargs = dict(model=model, max_tokens=4096, system=system,
                  messages=[{"role": "user", "content": user}])
    try:
        resp = client.messages.create(**kwargs, **({"temperature": temperature} if temperature is not None else {}))
    except anthropic.BadRequestError as e:
        # Some models reject sampling parameters; retry once without them.
        if temperature is not None and "temperature" in str(e).lower():
            resp = client.messages.create(**kwargs)
        else:
            raise
    return "".join(block.text for block in resp.content if getattr(block, "type", "") == "text")


def _call_openai(model: str, system: str, user: str, temperature: Optional[float]) -> str:
    import openai

    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    kwargs = dict(model=model, response_format={"type": "json_object"},
                  messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
    try:
        resp = client.chat.completions.create(**kwargs, **({"temperature": temperature} if temperature is not None else {}))
    except openai.BadRequestError as e:
        if temperature is not None and "temperature" in str(e).lower():
            resp = client.chat.completions.create(**kwargs)
        else:
            raise
    return resp.choices[0].message.content or ""


def _call_mock(role: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic stand-in so the full pipeline can run without API keys."""
    task = payload.get("task", {})
    if role == "capture":
        lines = [re.sub(r"^\s*(?:[-*\u2022]|\d+[.)])\s*", "", ln).strip()
                 for ln in str(payload.get("brain_dump", "")).splitlines()]
        return {"tasks": [{"title": ln, "notes": "", "priority": 2, "due_date": None} for ln in lines if ln]}
    if role == "reviewer":
        return {"verdict": "approve", "score": 8,
                "feedback": "Mock reviewer: no API key configured, so this was not genuinely reviewed.",
                "action_feedback": [], "questions": []}
    if payload.get("can_ask_questions") and not task.get("notes") and not payload.get("answered_questions"):
        return {"summary": "Need more context before starting.", "actions": None,
                "questions": [{"question": f"What does a good outcome look like for '{task.get('title')}'?",
                               "why": "The task has no notes, so the goal and constraints are unclear."}]}
    draft = payload.get("draft_actions") or []
    if draft:
        return {"summary": "Mock agent kept the existing draft.", "actions": None, "questions": []}
    return {"summary": f"Mock plan for: {task.get('title')}",
            "actions": [{"kind": "checklist", "title": f"Plan for {task.get('title')}",
                         "content": "1. Confirm the objective\n2. Gather the numbers\n3. Decide and communicate",
                         "details": {}}],
            "questions": []}


def complete_json(*, provider: str, model: Optional[str], system: str, payload: Dict[str, Any],
                  role: str, temperature: Optional[float] = 0.3) -> Dict[str, Any]:
    """Run one agent turn and return its parsed JSON reply."""
    provider = resolve_provider(provider)
    model = model or DEFAULT_MODELS.get(provider)
    if provider == "mock":
        return _call_mock(role, payload)

    user = json.dumps(payload, indent=2, default=str)
    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise LLMError("ANTHROPIC_API_KEY is not set")
        text = _call_anthropic(model, system, user, temperature)
    elif provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise LLMError("OPENAI_API_KEY is not set")
        text = _call_openai(model, system, user, temperature)
    else:
        raise LLMError(f"Unknown provider '{provider}'")
    return parse_json(text)

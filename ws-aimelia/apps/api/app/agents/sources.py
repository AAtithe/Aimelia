"""
Read-only facts from WSCIP (Client Operations) and Payroll Command Center.

Before the workers start, a lookup step shows the model a fixed catalogue of
GET endpoints and lets it pick up to MAX_CALLS that would answer the task. Only
catalogue entries can run, only as GET, only with their whitelisted parameters.
Results are trimmed and handed to every agent as "facts_from_ws_systems", so
the team stops asking Tom things the systems already know.

Access is a dedicated read-only user in each app (no code change needed there):
  WSCIP: a user with read on plan, compliance, clients, issues, tax and VAT, compliance scope "all".
  Payroll Command Center: role "viewer", scope "all".
Server settings: WSCIP_BASE_URL, WSCIP_EMAIL, WSCIP_PASSWORD (or WSCIP_TOKEN) and the
PCC_ equivalents. Nothing is ever written to either system.
"""
import json
import logging
import threading
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from ..settings import settings
from . import llm

logger = logging.getLogger(__name__)

MAX_CALLS = 4
MAX_LIST = 25  # items kept per list in a response
MAX_STR = 400  # characters kept per string
MAX_CHARS = 6000  # characters kept per call result

# name -> (path, allowed params, what it answers). Mirrors the read tools William and Nora already use.
CATALOGUE: Dict[str, Dict[str, Any]] = {
    "wscip": {
        "label": "WSCIP (Client Operations)",
        "tools": {
            "compliance_position": ("/api/compliance", [], "Compliance book: FC and MA status per client and month, what is late"),
            "work_ahead": ("/api/planner", [], "Compliance and tax deadlines coming up, with capacity"),
            "client_book": ("/api/clients", ["order"], "Ranked client book; order = margin|loss|revenue|late|name"),
            "client_summary": ("/api/client-summary", ["key"], "Summary of one client; key = the client key from client_book"),
            "service_issues": ("/api/issues", [], "Open service issues and escalations"),
            "tax_work": ("/api/tax", [], "Tax and statutory jobs, to-dos and deadlines"),
            "tax_cases": ("/api/tax-cases", [], "HMRC enquiries and tax cases"),
            "vat_returns": ("/api/vat", ["client"], "VAT returns; optional client filter"),
            "recent_changes": ("/api/digest", [], "What changed recently across the plan"),
        },
    },
    "pcc": {
        "label": "Payroll Command Center",
        "tools": {
            "todays_work": ("/api/today", ["horizon", "lead"], "Payroll work due, runs by RAG status; horizon = days ahead 0-28"),
            "pay_runs": ("/api/runs", ["client", "from", "to"], "Pay runs in a window, plus any unpaid; filter by client or dates"),
            "payroll_clients": ("/api/clients", [], "Payroll schedules, open runs, next pay dates"),
            "hmrc_payments": ("/api/hmrc", ["client", "from", "to"], "HMRC payments due"),
            "payroll_compliance": ("/api/compliance", ["months"], "The seven payroll measures and their failures"),
            "workload": ("/api/workload", [], "Workload index per payroll lead"),
            "tickets": ("/api/tickets", ["status", "client", "search"], "Support tickets; status = open|closed|all"),
        },
    },
}

LOOKUP_PROMPT = """You decide which read-only lookups would give the agent team the facts it needs for this task.
Pick at most {max_calls} calls from the catalogue, or none if the task does not concern clients, compliance,
tax, VAT or payroll. Use only the listed params. Respond with a single JSON object and nothing else:
{{"calls": [ {{"source": "wscip|pcc", "tool": "<name>", "params": {{}}, "why": "..."}} ]}}"""

_tokens: Dict[str, str] = {}
_lock = threading.Lock()


def _cfg(source: str) -> Dict[str, Optional[str]]:
    p = "WSCIP" if source == "wscip" else "PCC"
    return {"base": getattr(settings, f"{p}_BASE_URL"), "email": getattr(settings, f"{p}_EMAIL"),
            "password": getattr(settings, f"{p}_PASSWORD"), "token": getattr(settings, f"{p}_TOKEN")}


def configured() -> Dict[str, bool]:
    out = {}
    for source in CATALOGUE:
        c = _cfg(source)
        out[source] = bool(c["base"] and (c["token"] or (c["email"] and c["password"])))
    return out


def _token(source: str, refresh: bool = False) -> str:
    c = _cfg(source)
    if c["token"]:
        return c["token"]
    with _lock:
        if refresh or source not in _tokens:
            r = httpx.post(f"{c['base'].rstrip('/')}/api/auth?action=login",
                           json={"email": c["email"], "password": c["password"]}, timeout=20)
            if r.status_code >= 300:
                raise llm.LLMError(f"{CATALOGUE[source]['label']} sign-in failed: HTTP {r.status_code}")
            _tokens[source] = r.json()["token"]
        return _tokens[source]


def compact(value: Any, depth: int = 0) -> Any:
    """Keep responses small enough to hand to a model: clip lists, strings and nesting."""
    if depth > 5:
        return "..."
    if isinstance(value, dict):
        return {k: compact(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        items = [compact(v, depth + 1) for v in value[:MAX_LIST]]
        if len(value) > MAX_LIST:
            items.append(f"... {len(value) - MAX_LIST} more not shown")
        return items
    if isinstance(value, str) and len(value) > MAX_STR:
        return value[:MAX_STR] + " ..."
    return value


def call(source: str, tool: str, params: Optional[Dict[str, Any]] = None) -> Any:
    """Run one catalogue entry as a GET. Anything outside the catalogue is refused."""
    if source not in CATALOGUE or tool not in CATALOGUE[source]["tools"]:
        raise llm.LLMError(f"Unknown lookup {source}.{tool}")
    path, allowed, _ = CATALOGUE[source]["tools"][tool]
    query = {k: str(v) for k, v in (params or {}).items() if k in allowed and v not in (None, "")}
    base = _cfg(source)["base"].rstrip("/")
    for attempt in (0, 1):
        r = httpx.get(f"{base}{path}", params=query, timeout=30,
                      headers={"Authorization": f"Bearer {_token(source, refresh=attempt == 1)}"})
        if r.status_code == 401 and attempt == 0 and not _cfg(source)["token"]:
            continue  # session expired: sign in again once
        break
    if r.status_code >= 300:
        raise llm.LLMError(f"{CATALOGUE[source]['label']} {tool}: HTTP {r.status_code}")
    text = json.dumps(compact(r.json()), default=str)
    return json.loads(text) if len(text) <= MAX_CHARS else text[:MAX_CHARS] + " ... (trimmed)"


def gather_facts(db: Session, task) -> Optional[Dict[str, Any]]:
    """Pick and run the lookups for a task. Returns None when no system is connected or none apply."""
    from .orchestrator import get_pipeline, log_event

    live = [s for s, ok in configured().items() if ok]
    pipeline = get_pipeline(db)
    if not live or pipeline.use_ws_systems is False:
        return None
    catalogue = {s: {"system": CATALOGUE[s]["label"],
                     "tools": {n: {"answers": d, "params": p} for n, (_, p, d) in CATALOGUE[s]["tools"].items()}}
                 for s in live}
    try:
        plan = llm.complete_json(provider="auto", model=None, role="lookup",
                                 system=LOOKUP_PROMPT.format(max_calls=MAX_CALLS),
                                 payload={"task": {"title": task.title, "notes": task.notes or ""}, "catalogue": catalogue},
                                 temperature=0)
    except llm.LLMError as e:
        log_event(db, task, "lookup", "lookup", {"error": str(e)[:500]})
        return None
    facts, made = {}, []
    for c in (plan.get("calls") or [])[:MAX_CALLS]:
        if not isinstance(c, dict) or c.get("source") not in live:
            continue
        key = f"{c.get('source')}.{c.get('tool')}"
        try:
            facts[key] = call(c["source"], str(c.get("tool")), c.get("params") if isinstance(c.get("params"), dict) else {})
            made.append({"call": key, "params": c.get("params") or {}, "why": c.get("why") or ""})
        except (llm.LLMError, httpx.HTTPError, ValueError) as e:
            facts[key] = f"unavailable: {e}"
            made.append({"call": key, "error": str(e)[:300]})
    if made:
        log_event(db, task, "lookup", "lookup", {"calls": made})
    return facts or None

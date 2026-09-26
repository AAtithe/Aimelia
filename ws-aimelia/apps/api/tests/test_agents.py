"""
Tests for the agentic task list. Run from ws-aimelia/apps/api:
    pytest tests/test_agents.py
Uses SQLite and a scripted fake LLM, so no database or API keys are needed.
"""
import os
import tempfile

_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ.update({
    "DATABASE_URL": f"sqlite:///{_db.name}", "TENANT_ID": "t", "CLIENT_ID": "c", "CLIENT_SECRET": "s",
    "GRAPH_REDIRECT_URI": "http://x/cb", "APP_BASE_URL": "http://x", "AIMELIA_ACCESS_KEY": "secret",
    "AGENT_LOOP_IN_API": "false", "ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": "",
})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.agents import llm, models, orchestrator  # noqa: E402
from app.main import app  # noqa: E402

AGENT_TABLES = [m.__table__ for m in (models.AgentTask, models.AgentQuestion, models.AgentAction,
                                       models.AgentEvent, models.AgentConfig, models.AgentPipelineSettings)]
H = {"X-Aimelia-Key": "secret"}


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine, tables=AGENT_TABLES)
    Base.metadata.create_all(engine, tables=AGENT_TABLES)
    yield


@pytest.fixture
def client():
    return TestClient(app)


class ScriptedLLM:
    """Returns queued replies per role and records every call."""

    def __init__(self, worker=None, reviewer=None):
        self.replies = {"worker": list(worker or []), "reviewer": list(reviewer or [])}
        self.calls = []

    def __call__(self, *, provider, model, system, payload, role, temperature=0.3):
        self.calls.append({"role": role, "agent": payload.get("you_are"), "payload": payload, "system": system})
        queue = self.replies[role]
        return queue.pop(0) if len(queue) > 1 else queue[0]


def action(title="Email to supplier", kind="email_draft"):
    return {"kind": kind, "title": title, "content": "Body", "details": {"to": "a@b.com", "subject": "Hi"}}


def approve(score=9):
    return {"verdict": "approve", "score": score, "feedback": "", "action_feedback": [], "questions": []}


def revise(msg="Tighten it"):
    return {"verdict": "revise", "score": 4, "feedback": msg, "action_feedback": [{"index": 0, "note": msg}],
            "questions": []}


def create(client, **kw):
    r = client.post("/todo/tasks", json={"title": "Renegotiate linen contract", "notes": "Current 2.1k pm",
                                         "run_now": False, **kw}, headers=H)
    assert r.status_code == 201, r.text
    return r.json()


def test_requires_access_key(client):
    assert client.get("/todo/tasks").status_code == 401
    assert client.get("/todo/tasks", headers={"X-Aimelia-Key": "wrong"}).status_code == 401
    assert client.get("/todo/tasks", headers=H).status_code == 200


def test_default_team_is_seeded(client):
    data = client.get("/todo/agents", headers=H).json()
    names = {a["name"]: a for a in data["agents"]}
    assert {"Planner", "Chief of Staff", "Reviewer", "Hospitality Finance Specialist"} <= set(names)
    assert names["Reviewer"]["role"] == "reviewer"
    assert names["Hospitality Finance Specialist"]["enabled"] is False
    assert names["Planner"]["resolved_provider"] == "mock"  # no keys configured
    assert "No emojis" in data["pipeline"]["house_rules"]


def test_happy_path_workers_then_reviewer_approves(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "planned", "actions": [action("Plan", "checklist")], "questions": []},
                               {"summary": "done", "actions": [action()], "questions": []}],
                       reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client)
    orchestrator.process_queue()

    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "ready"
    assert [a["title"] for a in got["actions"]] == ["Email to supplier"]  # second worker replaced the draft
    assert got["actions"][0]["review_status"] == "approved"
    assert [c["role"] for c in fake.calls] == ["worker", "worker", "reviewer"]
    # the second worker saw the first worker's draft
    assert fake.calls[1]["payload"]["draft_actions"][0]["title"] == "Plan"
    # house rules and the JSON contract are always appended to the agent's instructions
    assert "House rules" in fake.calls[0]["system"] and '"actions"' in fake.calls[0]["system"]

    brief = client.get("/todo/briefing", headers=H).json()
    assert brief["counts"]["ready"] == 1
    assert brief["actions"][0]["task_title"] == "Renegotiate linen contract"


def test_reviewer_sends_work_back_with_feedback(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action()], "questions": []}],
                       reviewer=[revise("Add the notice period"), approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client)
    orchestrator.process_queue()

    roles = [c["role"] for c in fake.calls]
    assert roles == ["worker", "worker", "reviewer", "worker", "worker", "reviewer"]
    rework = fake.calls[3]["payload"]["reviewer_feedback"]
    assert rework["reviews"][0]["feedback"] == "Add the notice period"
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "ready" and got["review_flag"] is None


def test_flagged_when_reviewer_never_approves(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action()], "questions": []}], reviewer=[revise()])
    monkeypatch.setattr(llm, "complete_json", fake)
    client.patch("/todo/pipeline", json={"max_revisions": 1}, headers=H)
    task = create(client)
    orchestrator.process_queue()

    assert [c["role"] for c in fake.calls].count("reviewer") == 2
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "ready"
    assert got["review_flag"].startswith("Reviewer did not approve")
    assert got["actions"][0]["review_status"] == "flagged"


def test_low_score_is_not_an_approval(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action()], "questions": []}],
                       reviewer=[approve(score=5)])
    monkeypatch.setattr(llm, "complete_json", fake)
    client.patch("/todo/pipeline", json={"max_revisions": 0, "approval_threshold": 7}, headers=H)
    task = create(client)
    orchestrator.process_queue()
    assert client.get(f"/todo/tasks/{task['id']}", headers=H).json()["actions"][0]["review_status"] == "flagged"


def test_questions_pause_then_answers_resume(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "blocked", "actions": None,
                                "questions": [{"question": "Who is the supplier?", "why": "Need recipient"}]}],
                       reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client)
    orchestrator.process_queue()

    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "needs_input"
    assert len(fake.calls) == 1  # later agents did not run while blocked
    brief = client.get("/todo/briefing", headers=H).json()
    assert brief["questions"][0]["question"] == "Who is the supplier?"

    fake.replies["worker"] = [{"summary": "ok", "actions": [action()], "questions": []}]
    r = client.post(f"/todo/questions/{brief['questions'][0]['id']}/answer", json={"answer": "Johnsons"},
                    headers=H)
    assert r.json()["task_resumed"] is True
    orchestrator.process_queue()
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "ready"
    last_worker = [c for c in fake.calls if c["role"] == "worker"][-1]
    assert last_worker["payload"]["answered_questions"] == [{"question": "Who is the supplier?",
                                                             "answer": "Johnsons"}]


def test_repeated_question_does_not_loop(client, monkeypatch):
    q = {"summary": "", "actions": None, "questions": [{"question": "Who is the supplier?", "why": ""}]}
    monkeypatch.setattr(llm, "complete_json", ScriptedLLM(worker=[q], reviewer=[approve()]))
    task = create(client)
    orchestrator.process_queue()
    qid = client.get(f"/todo/tasks/{task['id']}", headers=H).json()["questions"][0]["id"]
    client.post(f"/todo/questions/{qid}/answer", json={"answer": "Johnsons"}, headers=H)
    orchestrator.process_queue()
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "failed"
    assert any(e["kind"] == "error" for e in got["events"])


def test_agent_without_question_permission_cannot_block(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action()],
                                "questions": [{"question": "Anything?", "why": ""}]}],
                       reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    for a in client.get("/todo/agents", headers=H).json()["agents"]:
        client.patch(f"/todo/agents/{a['id']}", json={"can_ask_questions": False}, headers=H)
    task = create(client)
    orchestrator.process_queue()
    assert client.get(f"/todo/tasks/{task['id']}", headers=H).json()["status"] == "ready"
    assert "You may not ask questions" in fake.calls[0]["system"]


def test_custom_team_order_and_new_agents(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action()], "questions": []}], reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    r = client.post("/todo/agents", json={"name": "Legal Checker", "role": "reviewer",
                                          "instructions": "Check contracts.", "provider": "anthropic",
                                          "model": "claude-opus-5-5"}, headers=H)
    assert r.status_code == 201 and r.json()["resolved_model"] == "claude-opus-5-5"
    agents = client.get("/todo/agents", headers=H).json()["agents"]
    workers = [a for a in agents if a["role"] == "worker"]
    # disable Planner, put Chief of Staff first
    planner = next(a for a in workers if a["name"] == "Planner")
    client.patch(f"/todo/agents/{planner['id']}", json={"enabled": False}, headers=H)
    create(client)
    orchestrator.process_queue()
    ran = [(c["role"], c["agent"]) for c in fake.calls]
    assert ran[0] == ("worker", "Chief of Staff")
    assert [r for r, _ in ran].count("reviewer") == 2  # Reviewer + Legal Checker


def test_approve_reject_and_feedback(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action("A"), action("B")], "questions": []}],
                       reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client)
    orchestrator.process_queue()
    a, b = client.get(f"/todo/tasks/{task['id']}", headers=H).json()["actions"]

    r = client.post(f"/todo/actions/{a['id']}/approve", json={}, headers=H)
    assert r.json()["task_status"] == "ready"  # B still waiting
    r = client.post(f"/todo/actions/{b['id']}/reject", json={"reason": "Too long", "rework": True}, headers=H)
    assert r.json()["task_status"] == "queued"
    orchestrator.process_queue()
    ctx = fake.calls[-2]["payload"]
    assert "Rejected 'B'. Too long" in ctx["tom_feedback"]
    assert {"title": "A", "kind": "email_draft", "status": "approved", "tom_feedback": None} in ctx["previous_actions"]

    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    live = [x for x in got["actions"] if x["status"] == "proposed"]
    assert len(live) == 2
    for x in live:
        client.post(f"/todo/actions/{x['id']}/done", headers=H)
    assert client.get(f"/todo/tasks/{task['id']}", headers=H).json()["status"] == "done"


def test_llm_failure_marks_task_failed(client, monkeypatch):
    def boom(**kw):
        raise llm.LLMError("rate limited")
    monkeypatch.setattr(llm, "complete_json", boom)
    task = create(client)
    orchestrator.process_queue()
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "failed"
    assert got["events"][-1]["content"]["error"] == "rate limited"
    assert client.post(f"/todo/tasks/{task['id']}/run", headers=H).json()["status"] == "queued"


def test_mock_provider_end_to_end(client):
    task = create(client, notes="")
    orchestrator.process_queue()
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "needs_input"
    client.post(f"/todo/questions/{got['questions'][0]['id']}/answer", json={"answer": "Save 15%"}, headers=H)
    orchestrator.process_queue()
    assert client.get(f"/todo/tasks/{task['id']}", headers=H).json()["status"] == "ready"


def test_parse_json_tolerates_fences():
    assert llm.parse_json('Sure:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert llm.parse_json('prefix {"a": {"b": 2}} suffix') == {"a": {"b": 2}}
    with pytest.raises(llm.LLMError):
        llm.parse_json("no json here")

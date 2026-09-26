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
                                       models.AgentEvent, models.AgentConfig, models.AgentPipelineSettings,
                                       models.AgentRoutine, models.AgentLesson)]
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
    assert {"Triage", "Planner", "Chief of Staff", "Reviewer", "Hospitality Finance Specialist"} <= set(names)
    assert names["Triage"]["can_ask_questions"] is False
    assert names["Reviewer"]["role"] == "reviewer"
    assert names["Hospitality Finance Specialist"]["enabled"] is False
    assert names["Planner"]["resolved_provider"] == "mock"  # no keys configured
    assert "No emojis" in data["pipeline"]["house_rules"]


def test_happy_path_workers_then_reviewer_approves(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "DO", "actions": None, "questions": []},
                               {"summary": "planned", "actions": [action("Plan", "checklist")], "questions": []},
                               {"summary": "done", "actions": [action()], "questions": []}],
                       reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client)
    orchestrator.process_queue()

    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "ready"
    assert [a["title"] for a in got["actions"]] == ["Email to supplier"]  # second worker replaced the draft
    assert got["actions"][0]["review_status"] == "approved"
    assert [c["agent"] for c in fake.calls[:3]] == ["Triage", "Planner", "Chief of Staff"]
    assert [c["role"] for c in fake.calls] == ["worker", "worker", "worker", "reviewer"]
    # the third worker saw the second worker's draft
    assert fake.calls[2]["payload"]["draft_actions"][0]["title"] == "Plan"
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
    assert roles == ["worker"] * 3 + ["reviewer"] + ["worker"] * 3 + ["reviewer"]
    rework = fake.calls[4]["payload"]["reviewer_feedback"]
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
    # Triage may not ask, so it carried on; the Planner asked and the rest did not run
    assert [c["agent"] for c in fake.calls] == ["Triage", "Planner"]
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
    assert ran[:2] == [("worker", "Triage"), ("worker", "Chief of Staff")]
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


def test_triage_delegation_uses_team_directory(client, monkeypatch):
    handover = {"kind": "delegate", "title": "Hand to Mandy: chase P60s",
                "content": "Mandy, please own this.", "details": {"owner": "Mandy", "due": "2026-10-02"}}
    fake = ScriptedLLM(worker=[{"summary": "DELEGATE to Mandy", "actions": [handover], "questions": []},
                               {"summary": "kept", "actions": None, "questions": []}],
                       reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    client.patch("/todo/pipeline", json={"team_directory": "Mandy, Payroll Manager, payroll runs"}, headers=H)
    task = create(client, title="Chase P60s")
    orchestrator.process_queue()
    assert fake.calls[0]["payload"]["team_directory"] == "Mandy, Payroll Manager, payroll runs"
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["actions"][0]["kind"] == "delegate"
    assert got["actions"][0]["details"]["owner"] == "Mandy"


def test_capture_splits_brain_dump(client, monkeypatch):
    def fake(**kw):
        assert kw["role"] == "capture"
        return {"tasks": [{"title": "Sign off Corrigans tronc", "notes": "Q3", "priority": 1, "due_date": "2026-10-01"},
                          {"title": "", "notes": "junk"},
                          {"title": "Book Bentleys review", "priority": "x", "due_date": "next week"}]}
    monkeypatch.setattr(llm, "complete_json", fake)
    r = client.post("/todo/capture", json={"text": "tronc corrigans, bentleys review", "run_now": False}, headers=H)
    assert r.status_code == 201, r.text
    out = r.json()
    assert [t["title"] for t in out] == ["Sign off Corrigans tronc", "Book Bentleys review"]
    assert out[0]["priority"] == 1 and out[0]["due_date"] == "2026-10-01"
    assert out[1]["priority"] == 2 and out[1]["due_date"] is None
    assert all(t["status"] == "queued" for t in out)


def test_capture_mock_splits_lines(client):
    r = client.post("/todo/capture", json={"text": "- one\n2. two\n\n* three", "run_now": False}, headers=H)
    assert [t["title"] for t in r.json()] == ["one", "two", "three"]


def test_existing_team_is_offered_new_default_agents_once(client):
    from app.db import SessionLocal
    from app.agents.defaults import DEFAULT_AGENTS
    db = SessionLocal()
    # an install from before Triage existed: version 0, no Triage, Planner deleted by Tom
    db.add(models.AgentPipelineSettings(id=1, house_rules="x", defaults_version=0))
    for spec in DEFAULT_AGENTS:
        if spec.get("since", 0) == 0 and spec["name"] != "Planner":
            db.add(models.AgentConfig(**{k: v for k, v in spec.items() if k != "since"}))
    db.commit()
    db.close()
    names = [a["name"] for a in client.get("/todo/agents", headers=H).json()["agents"]]
    assert "Triage" in names and "Planner" not in names  # deleted agents stay deleted
    workers = [a for a in client.get("/todo/agents", headers=H).json()["agents"] if a["role"] == "worker"]
    assert workers[0]["name"] == "Triage"  # joins at the front of the line
    triage = next(a for a in workers if a["name"] == "Triage")
    client.delete(f"/todo/agents/{triage['id']}", headers=H)
    names = [a["name"] for a in client.get("/todo/agents", headers=H).json()["agents"]]
    assert "Triage" not in names  # not offered again


def test_ensure_schema_adds_missing_columns():
    from sqlalchemy import inspect, text
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE agent_pipeline_settings DROP COLUMN team_directory"))
    assert "team_directory" not in {c["name"] for c in inspect(engine).get_columns("agent_pipeline_settings")}
    models.ensure_schema(engine)
    assert "team_directory" in {c["name"] for c in inspect(engine).get_columns("agent_pipeline_settings")}


def test_parse_json_tolerates_fences():
    assert llm.parse_json('Sure:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert llm.parse_json('prefix {"a": {"b": 2}} suffix') == {"a": {"b": 2}}
    with pytest.raises(llm.LLMError):
        llm.parse_json("no json here")


# ================================================================ follow-ups, defer, drop

import datetime as dt  # noqa: E402

from app.agents import calendar_blocks, lessons as lessons_mod, notify, schedule, sources  # noqa: E402
from app.db import SessionLocal  # noqa: E402


def _ready_task(client, monkeypatch, act, title="Chase P60s"):
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [act], "questions": []}], reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client, title=title)
    orchestrator.process_queue()
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "ready"
    return got, fake


def test_approved_handover_schedules_follow_up_then_delivered_closes_both(client, monkeypatch):
    handover = {"kind": "delegate", "title": "Hand to Mandy: chase P60s", "content": "Mandy, please own this.",
                "details": {"owner": "Mandy", "due": "2026-10-02"}}
    got, _ = _ready_task(client, monkeypatch, handover)
    r = client.post(f"/todo/actions/{got['actions'][0]['id']}/approve", json={}, headers=H).json()
    assert r["follow_up_on"] == "2026-10-02"

    follow = next(t for t in client.get("/todo/tasks", headers=H).json() if t["kind"] == "follow_up")
    assert follow["status"] == "scheduled" and follow["follow_up_owner"] == "Mandy"
    assert follow["parent_id"] == got["id"]

    db = SessionLocal()
    assert schedule.wake_scheduled(db, today=dt.date(2026, 10, 1)) == 0  # not yet
    assert schedule.wake_scheduled(db, today=dt.date(2026, 10, 2)) == 1
    db.close()
    brief = client.get("/todo/briefing", headers=H).json()
    assert brief["follow_ups"][0]["id"] == follow["id"]
    assert "Mandy, please own this." in brief["follow_ups"][0]["handover"]

    client.post(f"/todo/tasks/{follow['id']}/follow-up", json={"outcome": "delivered"}, headers=H)
    assert client.get(f"/todo/tasks/{follow['id']}", headers=H).json()["status"] == "done"
    assert client.get(f"/todo/tasks/{got['id']}", headers=H).json()["status"] == "done"


def test_follow_up_chase_gives_agents_the_handover_and_snooze_defers(client, monkeypatch):
    handover = {"kind": "delegate", "title": "Hand to Mandy", "content": "Original handover",
                "details": {"owner": "Mandy", "due": "2026-10-02"}}
    got, fake = _ready_task(client, monkeypatch, handover)
    client.post(f"/todo/actions/{got['actions'][0]['id']}/approve", json={}, headers=H)
    follow = next(t for t in client.get("/todo/tasks", headers=H).json() if t["kind"] == "follow_up")
    db = SessionLocal()
    schedule.wake_scheduled(db, today=dt.date(2026, 10, 2))
    db.close()

    r = client.post(f"/todo/tasks/{follow['id']}/follow-up", json={"outcome": "chase"}, headers=H)
    assert r.json()["status"] == "queued"
    orchestrator.process_queue()
    ctx = fake.calls[-2]["payload"]
    assert ctx["this_is_a_follow_up"]["owner"] == "Mandy"
    assert ctx["this_is_a_follow_up"]["handover_sent"] == "Original handover"

    r = client.post(f"/todo/tasks/{follow['id']}/follow-up", json={"outcome": "snooze", "days": 3}, headers=H).json()
    assert r["status"] == "scheduled"
    assert r["scheduled_for"] == (schedule.london_today() + dt.timedelta(days=3)).isoformat()


def test_approving_defer_parks_the_task_and_drop_closes_it(client, monkeypatch):
    defer_act = {"kind": "decision", "title": "Defer to November", "content": "Not now.",
                 "details": {"verdict": "defer", "revisit": "2026-11-02"}}
    got, _ = _ready_task(client, monkeypatch, defer_act, title="Refresh website copy")
    r = client.post(f"/todo/actions/{got['actions'][0]['id']}/approve", json={}, headers=H).json()
    assert r["task_status"] == "scheduled" and r["deferred_to"] == "2026-11-02"
    db = SessionLocal()
    schedule.wake_scheduled(db, today=dt.date(2026, 11, 2))
    db.close()
    assert client.get(f"/todo/tasks/{got['id']}", headers=H).json()["status"] == "queued"  # back to the team

    drop_act = {"kind": "decision", "title": "Drop it", "content": "Not worth it.", "details": {"verdict": "drop"}}
    got, _ = _ready_task(client, monkeypatch, drop_act, title="Rename the shared drive")
    r = client.post(f"/todo/actions/{got['actions'][0]['id']}/approve", json={}, headers=H).json()
    assert r["task_status"] == "done"


def test_manual_defer_endpoint(client):
    task = create(client)
    r = client.post(f"/todo/tasks/{task['id']}/defer", json={"until": "2026-12-01"}, headers=H).json()
    assert r["status"] == "scheduled" and r["scheduled_for"] == "2026-12-01"


# ================================================================ routines

def test_routine_date_maths():
    d = dt.date
    assert schedule.first_due("weekly", 0, 1, d(2026, 9, 26)) == d(2026, 9, 28)  # Saturday -> Monday
    assert schedule.first_due("weekly", 5, 1, d(2026, 9, 26)) == d(2026, 9, 26)  # today counts
    assert schedule.first_due("monthly", 10, 10, d(2026, 9, 26)) == d(2026, 10, 10)
    assert schedule.first_due("monthly", 0, -1, d(2026, 2, 3)) == d(2026, 2, 28)  # last day
    assert schedule.next_after("monthly", d(2026, 1, 31), -1) == d(2026, 2, 28)
    assert schedule.next_after("monthly", d(2026, 1, 28), 28) == d(2026, 2, 28)
    assert schedule.next_after("quarterly", d(2026, 11, 15), 15) == d(2027, 2, 15)
    assert schedule.next_after("fortnightly", d(2026, 9, 28), 1) == d(2026, 10, 12)


def test_routine_creates_task_within_lead_time_once(client):
    r = client.post("/todo/routines", json={"title": "Board pack", "cadence": "monthly", "day_of_month": 10,
                                            "lead_days": 5, "next_due": "2026-10-10"}, headers=H).json()
    db = SessionLocal()
    assert schedule.create_due_routines(db, today=dt.date(2026, 10, 4)) == []  # 6 days out
    made = schedule.create_due_routines(db, today=dt.date(2026, 10, 5))
    assert [(t.title, t.due_date, t.kind) for t in made] == [("Board pack", "2026-10-10", "routine")]
    assert schedule.create_due_routines(db, today=dt.date(2026, 10, 6)) == []  # not twice
    db.close()
    routines = client.get("/todo/routines", headers=H).json()["routines"]
    assert routines[0]["next_due"] == "2026-11-10" and routines[0]["created_count"] == 1
    assert r["id"] == routines[0]["id"]


def test_lapsed_routine_creates_one_task_not_a_backlog(client):
    client.post("/todo/routines", json={"title": "Weekly figures", "cadence": "weekly", "weekday": 0,
                                        "lead_days": 1, "next_due": "2026-08-03"}, headers=H)
    db = SessionLocal()
    made = schedule.create_due_routines(db, today=dt.date(2026, 9, 26))
    assert len(made) == 1
    db.close()
    assert client.get("/todo/routines", headers=H).json()["routines"][0]["next_due"] == "2026-09-28"


def test_suggested_routines_hide_once_added(client):
    sug = client.get("/todo/routines", headers=H).json()["suggested"]
    assert any(s["title"] == "Prepare the monthly board pack" for s in sug)
    client.post("/todo/routines", json=sug[0], headers=H)
    titles = [s["title"] for s in client.get("/todo/routines", headers=H).json()["suggested"]]
    assert sug[0]["title"] not in titles


# ================================================================ lessons

def test_edits_and_send_backs_become_lessons_the_agents_see(client, monkeypatch):
    got, fake = _ready_task(client, monkeypatch, action("Supplier email"))
    aid = got["actions"][0]["id"]
    client.patch(f"/todo/actions/{aid}", json={"content": "Tighter body, signed Tom"}, headers=H)
    client.post(f"/todo/actions/{aid}/reject", json={"reason": "Never open with 'I hope you are well'"}, headers=H)
    orchestrator.process_queue()
    seen = fake.calls[-1]["payload"]["lessons_from_tom"]
    assert seen[0]["from"] == "rejection" and "hope you are well" in seen[0]["tom_said"]
    assert seen[1]["from"] == "edit" and seen[1]["tom_changed_it_to"] == "Tighter body, signed Tom"
    assert seen[1]["agents_wrote"] == "Body"

    data = client.get("/todo/lessons", headers=H).json()
    assert len(data["lessons"]) == 2
    this_month = data["stats"][-1]
    assert this_month["sent_back"] == 1 and this_month["delivered"] >= 2
    client.patch(f"/todo/lessons/{data['lessons'][0]['id']}", json={"active": False}, headers=H)
    db = SessionLocal()
    assert len(lessons_mod.for_context(db, 8)) == 1
    assert lessons_mod.for_context(db, 0) == []
    db.close()


# ================================================================ old tasks

def test_untouched_tasks_go_back_through_triage_once(client, monkeypatch):
    fake = ScriptedLLM(worker=[{"summary": "blocked", "actions": None,
                                "questions": [{"question": "Which supplier?", "why": ""}]}], reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client)
    orchestrator.process_queue()
    db = SessionLocal()
    now = dt.datetime.now(dt.timezone.utc)
    assert schedule.nudge_stale(db, 14, now=now + dt.timedelta(days=13)) == 0
    assert schedule.nudge_stale(db, 14, now=now + dt.timedelta(days=15)) == 1
    db.close()
    got = client.get(f"/todo/tasks/{task['id']}", headers=H).json()
    assert got["status"] == "queued"
    assert got["questions"][0]["status"] == "dismissed"
    assert "DELEGATE or DROP" in got["events"][-1]["content"]["text"]
    db = SessionLocal()
    t = db.get(models.AgentTask, task["id"])
    t.status = "ready"
    db.commit()
    assert schedule.nudge_stale(db, 14, now=now + dt.timedelta(days=16)) == 0  # nudged recently
    assert schedule.nudge_stale(db, 0, now=now + dt.timedelta(days=100)) == 0  # rule switched off
    db.close()


# ================================================================ morning push

class _Resp:
    def __init__(self, code=200, body=None):
        self.status_code, self._body = code, body or {}

    def json(self):
        return self._body


def test_morning_push_goes_once_on_weekdays_after_the_set_time(monkeypatch):
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Europe/London")
    p = models.AgentPipelineSettings(brief_enabled=True, brief_time="07:30", brief_weekends=False)
    mon = dt.datetime(2026, 9, 28, 7, 45, tzinfo=tz)
    assert notify.due_now(p, mon)
    assert not notify.due_now(p, mon.replace(hour=7, minute=10))
    assert not notify.due_now(p, dt.datetime(2026, 9, 27, 9, 0, tzinfo=tz))  # Sunday
    p.last_brief_date = "2026-09-28"
    assert not notify.due_now(p, mon)
    p.brief_enabled = False
    p.last_brief_date = None
    assert not notify.due_now(p, mon)


def test_morning_push_payloads(client, monkeypatch):
    sent = []
    monkeypatch.setattr(notify.settings, "TEAMS_WEBHOOK_URL", "https://teams.example/hook")
    monkeypatch.setattr(notify.settings, "NTFY_URL", "https://ntfy.sh/tom-secret")
    monkeypatch.setattr(notify.settings, "NTFY_TOKEN", None)
    monkeypatch.setattr(notify.httpx, "post", lambda url, **kw: sent.append((url, kw)) or _Resp(200))
    fake = ScriptedLLM(worker=[{"summary": "v", "actions": [action()], "questions": []}], reviewer=[approve()])
    monkeypatch.setattr(llm, "complete_json", fake)
    create(client)
    orchestrator.process_queue()

    r = client.post("/todo/notify/test", headers=H).json()
    assert r["results"] == {"teams": "sent", "phone": "sent"}
    assert r["brief"]["headline"] == "1 ready to approve"
    teams_url, teams = sent[0]
    card = teams["json"]["attachments"][0]["content"]
    assert card["type"] == "AdaptiveCard" and "Approve: Email to supplier" in json_text(card)
    phone_url, phone = sent[1]
    assert phone_url == "https://ntfy.sh/tom-secret"
    assert phone["headers"]["Click"].endswith("/tasks")
    assert b"1 ready to approve" in phone["content"]
    assert client.get("/todo/briefing", headers=H).json()["channels"] == {"teams": True, "phone": True}


def json_text(obj):
    import json
    return json.dumps(obj)


def test_push_with_no_channel_says_so(client, monkeypatch):
    monkeypatch.setattr(notify.settings, "TEAMS_WEBHOOK_URL", None)
    monkeypatch.setattr(notify.settings, "NTFY_URL", None)
    r = client.post("/todo/notify/test", headers=H).json()
    assert "No channel" in r["results"]["none"]
    assert r["brief"]["empty"] is True


# ================================================================ calendar

def test_find_slot_skips_busy_time_weekends_and_after_hours():
    t = dt.time
    fri = dt.datetime(2026, 10, 2, 16, 50)  # Friday, 40 minutes of the day left
    slot = calendar_blocks.find_slot([], fri, 60, t(9), t(17, 30))
    assert slot[0] == dt.datetime(2026, 10, 5, 9, 0)  # Monday morning
    mon = dt.datetime(2026, 10, 5, 8, 0)
    busy = [(dt.datetime(2026, 10, 5, 9, 0), dt.datetime(2026, 10, 5, 10, 10)),
            (dt.datetime(2026, 10, 5, 10, 45), dt.datetime(2026, 10, 5, 12, 0))]
    slot = calendar_blocks.find_slot(busy, mon, 30, t(9), t(17, 30))
    assert slot == (dt.datetime(2026, 10, 5, 10, 15), dt.datetime(2026, 10, 5, 10, 45))
    slot = calendar_blocks.find_slot(busy, mon, 60, t(9), t(17, 30))
    assert slot[0] == dt.datetime(2026, 10, 5, 12, 0)
    whole_day = [(dt.datetime(2026, 10, 5, 0, 0), dt.datetime(2026, 10, 20, 0, 0))]
    assert calendar_blocks.find_slot(whole_day, mon, 60, t(9), t(17, 30), days=5) is None


def test_book_endpoint_records_event_and_reports_errors(client, monkeypatch):
    task = create(client)

    async def ok(db, **kw):
        assert kw["minutes"] == 60 and kw["work_start"] == "09:00"
        return {"id": "evt1", "start": "2026-10-05T09:00", "end": "2026-10-05T10:00", "link": "https://outlook/x"}
    monkeypatch.setattr(calendar_blocks, "book_focus", ok)
    r = client.post(f"/todo/tasks/{task['id']}/book", json={}, headers=H).json()
    assert r["task"]["calendar_event"]["id"] == "evt1"

    async def fail(db, **kw):
        raise calendar_blocks.CalendarError("Aimelia is not signed in to Microsoft 365.")
    monkeypatch.setattr(calendar_blocks, "book_focus", fail)
    r = client.post(f"/todo/tasks/{task['id']}/book", json={"minutes": 30}, headers=H)
    assert r.status_code == 409 and "not signed in" in r.json()["detail"]


# ================================================================ WSCIP and Payroll Command Center

def test_lookup_refuses_anything_outside_the_catalogue(monkeypatch):
    monkeypatch.setattr(sources.settings, "WSCIP_TOKEN", "t")
    with pytest.raises(llm.LLMError):
        sources.call("wscip", "delete_client")
    with pytest.raises(llm.LLMError):
        sources.call("other", "compliance_position")


def test_lookup_signs_in_filters_params_and_retries_once_on_expiry(monkeypatch):
    monkeypatch.setattr(sources.settings, "PCC_TOKEN", None)
    monkeypatch.setattr(sources.settings, "PCC_EMAIL", "assistant@williamsstanley.co")
    monkeypatch.setattr(sources.settings, "PCC_PASSWORD", "pw")
    sources._tokens.clear()
    logins, gets = [], []
    monkeypatch.setattr(sources.httpx, "post", lambda url, **kw: logins.append(url) or _Resp(200, {"token": f"tok{len(logins)}"}))

    def get(url, **kw):
        gets.append((url, kw["params"], kw["headers"]["Authorization"]))
        return _Resp(401) if len(gets) == 1 else _Resp(200, {"runs": list(range(40)), "note": "x" * 1000})
    monkeypatch.setattr(sources.httpx, "get", get)
    out = sources.call("pcc", "pay_runs", {"client": "Bentleys", "evil": "1", "from": ""})
    assert logins == ["https://payrollcc.vercel.app/api/auth?action=login"] * 2
    assert gets[0][1] == {"client": "Bentleys"}  # unknown and empty params dropped
    assert gets[1][2] == "Bearer tok2"
    assert len(out["runs"]) == 26 and out["runs"][-1] == "... 15 more not shown"
    assert out["note"].endswith(" ...") and len(out["note"]) < 420


def test_facts_reach_the_agents(client, monkeypatch):
    monkeypatch.setattr(sources.settings, "WSCIP_TOKEN", "svc")
    monkeypatch.setattr(sources.settings, "PCC_TOKEN", None)
    monkeypatch.setattr(sources.settings, "PCC_EMAIL", None)
    monkeypatch.setattr(sources.httpx, "get", lambda url, **kw: _Resp(200, {"late": ["Bentleys MA Aug"]}))
    worker = ScriptedLLM(worker=[{"summary": "v", "actions": [action()], "questions": []}], reviewer=[approve()])

    def fake(**kw):
        if kw["role"] == "lookup":
            assert list(kw["payload"]["catalogue"]) == ["wscip"]  # only connected systems are offered
            return {"calls": [{"source": "wscip", "tool": "compliance_position", "params": {}, "why": "late MAs"},
                              {"source": "pcc", "tool": "todays_work"}]}  # not connected: ignored
        return worker(**kw)
    monkeypatch.setattr(llm, "complete_json", fake)
    task = create(client, title="Chase late Bentleys MA")
    orchestrator.process_queue()
    ctx = worker.calls[0]["payload"]
    assert ctx["facts_from_ws_systems"] == {"wscip.compliance_position": {"late": ["Bentleys MA Aug"]}}
    events = client.get(f"/todo/tasks/{task['id']}", headers=H).json()["events"]
    assert any(e["kind"] == "lookup" and e["content"]["calls"][0]["call"] == "wscip.compliance_position" for e in events)

    client.patch("/todo/pipeline", json={"use_ws_systems": False}, headers=H)
    create(client, title="Second")
    orchestrator.process_queue()
    assert "facts_from_ws_systems" not in worker.calls[-2]["payload"]


def test_book_focus_queries_graph_with_offset_and_books_first_gap(monkeypatch):
    import asyncio
    from zoneinfo import ZoneInfo
    from app import token_manager as tm

    async def token(db, user):
        return "graph-token"
    monkeypatch.setattr(tm.token_manager, "get_valid_access_token", token)
    seen = {}

    class FakeClient:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            seen["params"] = params
            return _Resp(200, {"value": [
                {"start": {"dateTime": "2026-10-05T09:00:00.0000000"}, "end": {"dateTime": "2026-10-05T11:00:00.0000000"}, "showAs": "busy"},
                {"start": {"dateTime": "2026-10-05T11:00:00.0000000"}, "end": {"dateTime": "2026-10-05T12:00:00.0000000"}, "showAs": "free"},
            ]})

        async def post(self, url, headers=None, json=None):
            seen["event"] = json
            return _Resp(201, {"id": "evt", "webLink": "https://outlook/evt"})
    monkeypatch.setattr(calendar_blocks.httpx, "AsyncClient", FakeClient)
    now = dt.datetime(2026, 10, 5, 8, 30, tzinfo=ZoneInfo("Europe/London"))
    out = asyncio.run(calendar_blocks.book_focus(None, title="Pricing for Soho group", summary="Decide the fee",
                                                 minutes=60, work_start="09:00", work_end="17:30", now=now))
    assert seen["params"]["startDateTime"] == "2026-10-05T08:30:00+01:00"
    assert seen["params"]["$select"] == "start,end,showAs,isCancelled"  # never subjects or attendees
    assert out["start"] == "2026-10-05T11:00"  # the "free" event does not block
    assert seen["event"]["subject"] == "Focus: Pricing for Soho group"
    assert seen["event"]["start"] == {"dateTime": "2026-10-05T11:00:00", "timeZone": "Europe/London"}

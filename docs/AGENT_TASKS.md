# Aimelia Agent Tasks

A to-do list worked by a team of AI agents. Tom adds tasks; the team plans them, produces the finished work,
checks it, and asks questions only when blocked. On login, `/tasks` shows the briefing: questions to answer
and reviewed actions ready to approve.

## How a task flows

```
Tom adds task ──> queued
                    │  background loop (every N minutes) or "Run agents now"
                    v
               processing
   Workers run in order ──────────────> any agent blocked? ──> needs_input ──> Tom answers ──> queued
   (Planner -> Chief of Staff -> ...)                                          (or "Skip, use your judgement")
                    │
                    v
   Reviewers score the draft (0-10)
        │ below threshold: back to workers with feedback (up to "Reviewer send-backs")
        v
                  ready  ──> Tom approves / edits / sends back with feedback / marks done ──> done
```

- Each worker receives the task, Tom's notes and answers, earlier approved or rejected actions, the current
  draft, and any reviewer feedback. It returns the complete updated draft.
- If the reviewer never approves within the send-back limit, the actions are still delivered but flagged red,
  with the reviewer's notes.
- Emails are never sent. "Approve + Outlook draft" creates a draft in Outlook through Microsoft Graph.

## Changing the team (Agent team tab)

- Add, remove, enable or disable agents. Reorder with the arrows; workers run top to bottom.
- Role: `worker` produces or improves the work; `reviewer` checks it and can send it back. Several reviewers
  are allowed; all must approve.
- Instructions: the agent's full brief. Edit freely; the JSON output format is appended automatically, so a
  change to the instructions cannot break the pipeline.
- Provider and model per agent: Anthropic (Claude) or OpenAI, or `auto` (Anthropic if its key is set, then
  OpenAI). Mix them, for example a cheaper model for drafting and a stronger one for reviewing.
- "Can pause the task to ask you questions": switch off for agents that should always proceed on assumptions.
- How the team works: send-back limit, approval score, questions per run, background interval, and house
  rules shared with every agent.

The default team is Planner, Chief of Staff, Hospitality Finance Specialist (off by default) and Reviewer.
"Reset to default team" restores it.

## Deploying

Backend (Render, `aimelia-api`), set these environment variables:

| Variable | Purpose |
|---|---|
| `AIMELIA_ACCESS_KEY` | Required. Long random string; entered once in the browser to open `/tasks`. Every `/todo` call is refused until it is set. |
| `ANTHROPIC_API_KEY` | Claude models for the agents. |
| `OPENAI_API_KEY` | Optional alternative or addition. |
| `AGENT_LOOP_IN_API` | Default `true`: the API process works through the queue in the background. |

Without an AI key the agents run in mock mode so the flow can be tried end to end.

Tables are created automatically on startup. Frontend (Vercel) needs no new variables; open `/tasks`.

## API

All under `/todo`, header `X-Aimelia-Key` required. Main endpoints: `GET /briefing`, `GET|POST /tasks`,
`GET|PATCH|DELETE /tasks/{id}`, `POST /tasks/{id}/run`, `POST /tasks/{id}/feedback`,
`POST /questions/{id}/answer|dismiss`, `PATCH /actions/{id}`, `POST /actions/{id}/approve|reject|done`,
`GET|POST /agents`, `PATCH|DELETE /agents/{id}`, `POST /agents/reorder`, `POST /agents/reset`,
`PATCH /pipeline`, `POST /run`.

## Tests

```bash
cd ws-aimelia/apps/api
pip install -e . pytest
pytest tests/test_agents.py
```

Uses SQLite and a scripted fake model; no database or keys needed.

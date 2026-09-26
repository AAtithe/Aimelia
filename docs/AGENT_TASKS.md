# Aimelia Agent Tasks

A to-do list worked by a team of AI agents. Tom adds tasks; the team plans them, produces the finished work,
checks it, and asks questions only when blocked. On login, `/tasks` shows the briefing: questions to answer
and reviewed actions ready to approve.

## Getting the list in

- Brain dump: paste everything on your mind as one block. It is split into separate tasks, each queued for
  the team (`POST /todo/capture`).
- One task: a title plus a brief. The fuller the brief, the fewer questions come back.

## Triage: the agent that shrinks the list

Triage runs first on every task and gives one verdict:

- DO: only Tom can do it. The rest of the team prepares everything so Tom's part takes minutes.
- DELEGATE to a named person from the team directory: produces a "Hand over" action holding the message to
  send, the outcome wanted, the deadline, the authority given and when to report back. Tom approves it, copies
  it and sends it himself.
- DEFER to a date, or DROP with the reason and the risk of not doing it.

Fill in the team directory (Agent team tab, one person per line: name, role, what they own) or Triage can only
name roles. Triage never stops to ask questions; it states its assumptions.

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

The default team is Triage, Planner, Chief of Staff, Hospitality Finance Specialist (off by default) and
Reviewer. "Reset to the default team" restores it. When a release adds a new default agent, an existing team is
offered it once, at the front of the line; an agent Tom deleted is never brought back.

## House style

`/tasks` follows the Williams, Stanley & Co house style for internal apps. The source of truth is `BRANDING.md`
in payrollcommandcenter, applied as in WSCIP (`docs/style.md`, `build/parts/head.html`). The tokens and
components are copied into `frontend/app/tasks/house.css`; the logo and favicon are in `frontend/public/assets`.
Change the palette there first, then here. Status pills keep their house meanings: Ready to approve is On track
green, Needs your answer is At risk amber, Failed and past due are Overdue red, and due states are worked out from
the date rather than typed.

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

All under `/todo`, header `X-Aimelia-Key` required. Main endpoints: `GET /briefing`, `GET|POST /tasks`, `POST /capture`,
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

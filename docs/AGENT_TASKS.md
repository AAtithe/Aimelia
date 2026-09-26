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

## What takes work off the list

| Feature | What it does | Where |
|---|---|---|
| Facts from WSCIP and Payroll Command Center | Before the team starts, a lookup step picks up to four read-only calls (compliance position, work ahead, client book, service issues, tax, VAT, pay runs, HMRC payments, payroll compliance, tickets) and gives the results to every agent, so they stop asking what the systems already know. Every lookup is listed in the task's history. | `agents/sources.py` |
| Follow-up on delegated work | Approving a handover parks a check-in for its due date. On the day it appears under "Delegated work due back": Delivered (closes it and the original), Not yet (the team drafts a chaser for approval, which schedules the next check-in), or another week. | `agents/schedule.py` |
| Defer and Drop that act | Approving Triage's Defer parks the task until the date; approving Drop closes it. Any task can be parked by hand from its drawer. | `router.approve_action` |
| Routines | Recurring work (board pack, month-end, weekly figures, one-to-ones, quarterly client round) creates its task a set number of days before it is due. A lapsed routine creates the next one, not a backlog. | Routines tab |
| Learning from corrections | Every edit, send-back and piece of feedback is kept as a lesson; the latest (default 8) go to every agent. The Learning tab shows, per month, the share approved as it stood, edited and sent back. | Learning tab, `agents/lessons.py` |
| Old-task rule | A task nobody has touched for 14 days (configurable, 0 is off) goes back through Triage with an instruction to delegate or drop it, once per period. | `schedule.nudge_stale` |
| Morning push | At a set London time on weekdays: questions, approvals, follow-ups due and overdue items, to a Teams channel or chat and/or your phone. Never email. | Agent team, Automation |
| Focus time | "Book focus time" in a task finds the first free slot in working hours over the next three weeks and books a "Focus" block. It reads only start, end and busy state, never what meetings are. | `agents/calendar_blocks.py` |
| Voice capture | "Dictate" on the brain dump uses the browser's speech recognition in UK English. The page installs to a phone home screen (Share, Add to Home Screen). | Briefing |

## Setting up the connections

WSCIP and Payroll Command Center: no code change is needed in either app. In each, create a dedicated user, for
example `assistant@williamsstanley.co`:

- WSCIP: read (not write) on plan, compliance, clients, issues, tax and VAT; compliance scope "all". Password sign-in must
  be allowed for that address (`AUTH_ALLOW_PASSWORD`).
- Payroll Command Center: role `viewer`, scope `all`.

Then set `WSCIP_EMAIL`, `WSCIP_PASSWORD`, `PCC_EMAIL`, `PCC_PASSWORD` on Render. Base URLs default to
`https://operations.williamsstanley.co` and `https://payrollcc.vercel.app` (`WSCIP_BASE_URL`, `PCC_BASE_URL`). Use
"Check the connections" in Automation. Only a fixed list of GET endpoints can be called; anything else is refused.

Teams: in the channel or chat, add the Workflows template "Post to a channel when a webhook request is received",
copy its URL into `TEAMS_WEBHOOK_URL`.

Phone: install the ntfy app, subscribe to a long random topic name, and set `NTFY_URL=https://ntfy.sh/<that topic>`
(add `NTFY_TOKEN` if the topic is protected). Treat the topic name as a password.

Calendar: uses the Microsoft 365 sign-in Aimelia already has (Calendars.ReadWrite). Sign in once on the main dashboard.

iPhone shortcut for capture without opening the app: Shortcuts, new shortcut, "Dictate Text", then "Get Contents of
URL" with URL `https://aimelia-api.onrender.com/todo/capture`, method POST, header `X-Aimelia-Key: <your key>`, JSON
body field `text` set to the dictated text. Add it to the home screen or the Action Button.

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

## Security

- Every API route needs `X-Aimelia-Key` except `/`, `/health`, `/auth/login` and `/auth/callback`. A test walks every
  mounted route and fails if any other one answers without the key.
- No route returns a Microsoft token. The browser only learns whether Aimelia is connected.
- Sign-in is bound to the browser that started it (signed, ten-minute state plus a matching cookie), and the account
  that signs in must be `AIMELIA_OWNER_EMAIL`, so nobody else in the tenant can connect their mailbox in Tom's place.
- Tokens are encrypted at rest; there is no plain-text fallback.
- Secrets live only in Render's environment. `ws-aimelia/.env` is no longer tracked.

## Deploying

Backend (Render, `aimelia-api`), set these environment variables:

| Variable | Purpose |
|---|---|
| `AIMELIA_ACCESS_KEY` | Required. Long random string; entered once in the browser for `/tasks` and the dashboard. Every route except sign-in is refused until it is set. |
| `AIMELIA_OWNER_EMAIL` | Required. The only Microsoft 365 account allowed to connect (comma-separate to allow more). |
| `ENCRYPTION_KEY` | Required. Fernet key for tokens at rest (`python generate_encryption_key.py`). Without it Aimelia refuses to store a sign-in. |
| `ANTHROPIC_API_KEY` | Claude models for the agents. |
| `OPENAI_API_KEY` | Optional alternative or addition. |
| `AGENT_LOOP_IN_API` | Default `true`: the API process works through the queue in the background. |
| `AIMELIA_APP_URL` | The `/tasks` address linked from pushes and calendar blocks. |
| `TEAMS_WEBHOOK_URL`, `NTFY_URL`, `NTFY_TOKEN` | Morning push channels (optional). |
| `WSCIP_EMAIL`, `WSCIP_PASSWORD`, `PCC_EMAIL`, `PCC_PASSWORD` | Read-only users for lookups (optional; `WSCIP_TOKEN` / `PCC_TOKEN` also accepted). |

Without an AI key the agents run in mock mode so the flow can be tried end to end.

Tables are created automatically on startup. Frontend (Vercel) needs no new variables; open `/tasks`.

## API

All under `/todo`, header `X-Aimelia-Key` required. Main endpoints: `GET /briefing`, `GET|POST /tasks`, `POST /capture`,
`GET|PATCH|DELETE /tasks/{id}`, `POST /tasks/{id}/run`, `POST /tasks/{id}/feedback`,
`POST /questions/{id}/answer|dismiss`, `PATCH /actions/{id}`, `POST /actions/{id}/approve|reject|done`,
`GET|POST /agents`, `PATCH|DELETE /agents/{id}`, `POST /agents/reorder`, `POST /agents/reset`,
`PATCH /pipeline`, `POST /run`, `POST /tasks/{id}/follow-up|defer|book`, `GET|POST /routines`,
`PATCH|DELETE /routines/{id}`, `GET /lessons`, `PATCH|DELETE /lessons/{id}`, `POST /notify/test`, `POST /sources/test`.

## Tests

```bash
cd ws-aimelia/apps/api
pip install -e . pytest
pytest tests/test_agents.py
```

Uses SQLite and a scripted fake model; no database or keys needed.

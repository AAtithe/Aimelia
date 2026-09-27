# How Aimelia works

## Parts

| Area | Where |
|---|---|
| Pages (house style) | `src/app/(app)/*`, frame in `src/components/Shell.tsx`; the shared house style is `src/app/ws-house.css`, a stamped copy of AAtithe/house-style (sync it, never edit it), and Aimelia's own styles are `src/app/house.css` |
| Agent Tasks API | `/api/todo/*`, `src/lib/agents/api.ts` |
| Email and meetings API | `/api/mail/*`, `src/lib/email/api.ts` |
| Ask Aimelia (chat agent) API | `/api/chat/*`, `src/lib/chat/api.ts`, agent loop in `src/lib/chat/agent.ts` |
| Sign-in | `/api/setup` (first login), `/api/session` (email and password), `/api/account` (password, devices, keys, settings), `/api/auth/*` (Microsoft 365) |
| Background | Vercel Cron calls `/api/cron/tick` every 10 minutes (`src/lib/tick.ts`) |
| Database | Neon Postgres; schema in `src/lib/schema.ts`, applied automatically |

## The agent team

Triage, Planner, Chief of Staff, an optional Finance Specialist and a Reviewer work each task in turn. Workers share one
draft; reviewers score it and send it back until approved or the revision limit is reached. Agents ask Tom only what
blocks them. Triage decides Do, Delegate, Defer or Drop; approving a handover schedules a follow-up, approving Defer parks
the task, approving Drop closes it. Routines create recurring work ahead of time; tasks untouched for 14 days go back
through Triage; Tom's edits and send-backs become lessons every agent sees. Facts can come from WSCIP and Payroll Command
Center through a fixed list of read-only lookups.

## Ask Aimelia: the chat agent

A chatbot Tom can talk to about his work, as a page (`/chat`, first in My work) and as a drawer opened by the Ask Aimelia
button on every other page. It is an agent, not just a chat: each turn the model sees the conversation and a fixed list
of tools, and answers with JSON, either tool calls or the reply. Tools run on the server, their results go back to the
model, and it repeats up to six times (four calls a step) before it must answer. The protocol is plain JSON rather than a
provider's native tool use, so it behaves the same on Claude, OpenAI and the mock. The house rules from the agent team
apply to it too.

| Tool | What it does |
|---|---|
| briefing | What is waiting on Tom: counts, open questions, drafts to approve, follow-ups due |
| search_tasks, get_task | Find tasks by words or status; read one with its draft actions and questions |
| create_task | Adds a task for the agent team (source `chat`), as Add task does. Only when Tom asks |
| answer_question | Answers an open agent question; the task goes back to the team once none are left, as the button does |
| search_knowledge | The knowledge base, full-text |
| recent_emails | Sorted email from triage, as stored |
| upcoming_meetings | The calendar, read only. Offered only while Microsoft 365 is connected |
| ws_lookup | The same read-only WSCIP and Payroll Command Center catalogue the agents use. Offered only when one is connected |

It cannot send email or change the calendar; asked to, it offers to add a task so the team drafts it for approval. Each
reply lists the steps it took. Conversations are kept (`chats`, `chat_messages`), the last 20 messages go to the model,
Tom's message is saved before the model is called so a failure loses nothing, and conversations can be deleted.

## Importing tasks

Import tasks (`/import`, `src/lib/agents/imports.ts`, `src/lib/agents/importText.ts`) brings work in from elsewhere.
Everything imported is queued for Triage like any other task, and each task's notes say where it came from.

| Source | How |
|---|---|
| Microsoft To Do | Read through Graph (`Tasks.Read`) once Microsoft 365 is connected. Open tasks in the ticked lists, with due date, importance, notes and open steps. Nothing in To Do is changed. Running it again brings only new tasks. |
| Outlook tasks CSV | Outlook's Export to a file. Subject, Due Date (UK order), Priority and Notes are used; completed rows are skipped. The route to use before Microsoft 365 is connected. |
| Word (.docx), .txt, .md | Read by the AI, which keeps only the actions: agreed, asked for, or plainly next. Discussion and background are left out. |
| PDF | Sent whole to Claude as a document, so text, tables and scanned pages are all read. Needs the Claude (Anthropic) key; there is no fallback without it. A printed To Do list saved as PDF works too. |
| Meeting notes, transcripts (.vtt, .srt) | As documents. The owner named for each action is kept in the notes (`Owner named: Mandy`) so Triage can delegate it, using the team directory. |
| Fireflies | With the API key from Settings, recent meetings are listed; importing one reads its action items and overview. Read only. |
| A pasted list | One task per line, as written; no AI. |

Without an AI key, or if the AI fails, documents and notes (not PDFs) fall back to their bullets, numbered items and `Action:` lines,
so an import is never lost. Each import is recorded by source and a fingerprint of its text (or the To Do or Fireflies
id); the record is claimed before tasks are written, so the same thing is never imported twice by accident. Importing it
again is refused with the date it came in, unless confirmed. Old binary `.doc` files, and files named .pdf that are not PDFs, are refused with what to do
instead. Files are limited to 3 MB, Vercel's request limit after encoding.

## Email and meetings

- Triage: keyword rules (whole words), then AI. Results are stored; screens read from the database.
- Smart drafting: replies in Tom's voice, created as threaded reply drafts in Outlook with the category "Drafted by Aimelia".
- Meeting briefs and prep: a short brief or the six-section prep, from the invite and recent emails with the attendees.
  Stored in Aimelia; calendar events are never changed.
- Knowledge base: sorted emails, briefs and added documents, searched with Postgres full-text search.
- Jobs: triage hourly, briefs at 06:00 and 18:00 London. Optional auto-drafts for urgent mail.
- Focus time: books the first free slot using busy times only.

## Security

- Logins are email and password, hashed with scrypt. A new install asks for the owner's account on first visit (firm
  domain only, and only while no account exists; the insert is atomic). Five wrong passwords per address or per email
  in 15 minutes locks further tries.
- Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; only a hash is stored, so they can be listed and
  revoked. Changing the password signs out every other browser. Cookie-authenticated writes from another site are refused.
- Capture keys for the iPhone shortcut are shown once and stored hashed.
- Every API route needs a session or a capture key, except `/api/health`, sign-in, first-run setup and the Microsoft
  return. A test enumerates every endpoint and fails if one answers without access.
- Aimelia generates its own secret on first use and keeps it in the database (or uses `ENCRYPTION_KEY` if a developer
  pins one in Vercel). Microsoft tokens and every key entered in Settings are encrypted with AES-256-GCM using keys
  derived from it. Anyone holding a copy of the database could read them; pinning `ENCRYPTION_KEY` in Vercel removes that.
- The background timer needs no secret: without `CRON_SECRET` it runs at most once every four minutes and tells an
  unauthenticated caller nothing.
- Microsoft sign-in: sealed ten-minute state tied to the starting browser; the Microsoft account must match an Aimelia
  login; `Mail.Send` is not requested. Model output is shown as text, never as HTML.

## What changed from the old app

The Python API on Render and the separate Next.js frontend are replaced by this one app. The old email features were
rebuilt to do what they were meant to: in the old code every OpenAI call failed, several screens called addresses that did
not exist, thread summaries used a Graph endpoint that does not exist, and meeting prep overwrote calendar event
descriptions. Deliberate changes: drafts are threaded replies tagged with an Outlook category instead of a line in the body;
briefs are kept in Aimelia, not written into events or emailed to a fixed address; triage keywords match whole words;
analytics come from real records; the 08:00 digest is the morning push; the knowledge base uses full-text search instead
of OpenAI embeddings.

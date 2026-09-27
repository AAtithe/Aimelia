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
the task, approving Drop closes it. Marking an approved email or call done schedules a check a week later (Automation sets the days; 0 turns it off), so
nothing sent is forgotten: has the reply come, did the call happen. A task gets one check, not one per action. At the
check Tom closes it, gives it another week, or has the team draft a chaser, and approving the chaser schedules the next
check. Routines create recurring work ahead of time; tasks untouched for 14 days go back
through Triage; Tom's edits and send-backs become lessons every agent sees. Facts can come from WSCIP and Payroll Command
Center through a fixed list of read-only lookups.

## Today

Today follows the work through: answer, approve, do, check. It has a section for each: Questions, To approve, To do,
Follow-ups (due now, and the checks coming up, each of which can be brought forward) and, when there are any, Failed runs.

Approving decides; it does not do. An approved email, call, handover, document or checklist waits in To do with what to
do with it (send it, make the call, send the handover, use it, work through it), the buttons to do it (open the email in
your mail app, copy it, tick the steps) and a button to mark it done. The task shows as With you to do until every
action on it is done. Marking an email, call or handover done schedules its check a week later (a handover on its due
date), unless Tom marks it done with no check needed. Approving a decision or a note settles it at once. It opens on the first section with
something in it; the figures along the top open their section.

## Questions for Tom

`src/lib/agents/questions.ts`. The questions the agents are waiting on are kept as one list, so Tom answers each thing once.

- When an agent asks, anything that repeats a question already on that task (open, answered or skipped), in the same or
  nearly the same words, is dropped.
- One question can stand for several tasks. The kept one stays open and the others are merged into it; they still hold
  their tasks. Answering or skipping it on any of those tasks settles all of them, and each task with nothing left open
  goes back to the team. Today shows the question once, tagged with every task it covers, and groups a task's questions
  together.
- **The tidy job** runs on every background tick when the list has changed since the last run, and needs an AI key. The AI
  reads every open question with its task, Tom's answers from the last 120 days and what Aimelia knows. It merges questions
  that one answer would settle (across tasks too), rewords any that newer answers have made out of date, and answers any
  Tom has in fact already answered. An answer it is sure of is applied and marked as answered by Aimelia, with where it came
  from; one it is less sure of is shown under the question as a suggestion Tom can use with one click. Every change is in
  the task's log.
- Repairs run every tick without the AI: a group whose lead task was deleted or closed passes to the next task in it,
  and repeats on one task are merged. A task that goes stale and back through Triage hands any group it led to the next
  task.

## Ask Aimelia: the chat agent

A chatbot Tom can talk to about his work, as a page (`/chat`, first in My work) and as a drawer opened by the Ask Aimelia
button on every other page. It is an agent, not just a chat: each turn the model sees the conversation and a fixed list
of tools, and answers with JSON, either tool calls or the reply. Tools run on the server (the calls in one step run
together), their results go back to the model, and it repeats up to ten steps of six calls. The protocol is plain JSON
rather than a provider's native tool use, so it behaves the same on Claude, OpenAI and the mock.

The model: with the Claude key it runs on Claude Opus 5.5 (`claude-opus-5-5`) at high effort, set explicitly because
Opus 5.5 defaults to medium, with server-side fallback to another model if it declines. Web search runs on the same model.
`CHAT_MODEL` in Vercel overrides it. If the account cannot use Opus 5.5 (not yet offered to it, or its data retention
settings), the chat and web search drop to Claude Opus 5 and stay there until the server restarts. A turn has a time
budget: after 230 seconds it must reply, and no model call may run past 285 seconds, inside Vercel's 300. Each call gets
one retry on an overload or rate limit.

What it has to work with, besides the tools: the agent team's house rules, the team directory, and from What Aimelia
knows (below) the memories Tom set or checked, his standing preferences, and those that bear on his message.

| Tool | What it does |
|---|---|
| briefing | What is waiting on Tom: counts, open questions, drafts to approve, follow-ups due |
| search_tasks, get_task | Find tasks by words or status; read one with its draft actions and questions |
| create_task | Adds a task for the agent team (source `chat`), as Add task does |
| update_task | Changes title, notes (or adds a line), priority, due date; closes a task or sends it back to the agents |
| answer_question | Answers an open agent question, and every question merged with it; each task goes back to the team once none are left, as the button does |
| calculate | Exact arithmetic (`src/lib/chat/calc.ts`, a parser, never eval): VAT, margins, labour %, variances. Every figure goes through it |
| web_search | Claude's server-side web search, on the chat model; the answer comes back with its sources. Needs the Claude key |
| remember, forget | Standing facts and preferences, kept across conversations |
| search_conversations | Earlier Ask Aimelia conversations |
| search_knowledge, add_to_knowledge | The knowledge base: full-text search, and filing text Tom asks to keep |
| recent_emails | Sorted email from triage, as stored |
| search_email, read_email | The whole Outlook mailbox through Graph search, and one email in full |
| draft_email | A threaded reply or new email saved as a draft in Outlook, tagged "Drafted by Aimelia". Never sent |
| upcoming_meetings, meeting_brief | The calendar (read), and writing or refreshing a meeting brief |
| book_focus_time | Focus time in the first free slot in working hours |
| ws_lookup | The same read-only WSCIP and Payroll Command Center catalogue the agents use |

The Microsoft tools are offered only while Microsoft 365 is connected, web search only with the Claude key, and the
lookups only when WSCIP or PCC is connected. The tools that change things run only when Tom asks for that outcome.
Nothing is ever sent: email only ever becomes a draft for Tom to send himself. Each reply lists the steps it took.

Photos, PDFs and documents can go with any message: Attach, drag and drop, or paste a screenshot (up to five files,
about 3 MB together, Vercel's request limit). Photos over about 1 MB, and every iPhone HEIC photo the browser can open,
are redrawn in the browser as JPEG with the longest side at 1600px, so a phone photo fits. On the server
(`src/lib/chat/files.ts`) a photo or PDF is recognised by its first bytes, never its name: PNG, JPEG, GIF, WebP and PDF are
kept as they are and shown to the model, which reads them itself. Claude reads photos and PDFs; OpenAI reads photos
only, and a PDF without the Claude key is refused plainly. Word, text, CSV and transcripts become text with the Import
reader and go inside the message. Anything else is refused with what to send instead, before anything is stored. Files
are kept in `chat_files` with their message and shown back as thumbnails and links; they are served only as the checked
photo and PDF types, or as plain text, with `nosniff`. To keep turns fast and cheap, photos and PDFs are sent to the
model again only for the six most recent messages; older ones are named as no longer in view.

Conversations are kept (`chats`, `chat_messages`), the last 20 messages go to the model,
Tom's message and files are saved before the model is called so a failure loses nothing, and conversations can be deleted.

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

Anything the AI reads (PDFs, Word and text documents, meeting notes, transcripts) runs as a job in `import_jobs`: the
upload returns at once, the read runs after the response, and the screen polls it with the time so far, so it can be
left. Claude streams its reply with room for its reasoning, and gives up after four minutes, inside the server's five.
A read cut off by the server is picked up by the background timer after seven minutes and tried once more; after two
tries it fails with advice to split the file. Two copies queued at once end with the second marked as a duplicate. The
file is deleted from the job when it ends. If Claude's reply is cut off part way through a long list, every task written in full before the
cut is kept (up to 200 per import) and the job says the rest was not read, so the file can be split and the rest imported. Lists and CSVs are quick and are still imported in the request.

Without an AI key, or if the AI fails, documents and notes (not PDFs) fall back to their bullets, numbered items and `Action:` lines,
so an import is never lost. Each import is recorded by source and a fingerprint of its text (or the To Do or Fireflies
id); the record is claimed before tasks are written, so the same thing is never imported twice by accident. Importing it
again is refused with the date it came in, unless confirmed. Old binary `.doc` files, and files named .pdf that are not PDFs, are refused with what to do
instead. Files are limited to 3 MB, Vercel's request limit after encoding.

## What Aimelia knows

`/memory`, `src/lib/memory/`. Aimelia keeps everything Tom writes to it and learns from it.

- **Notes** (`memory_notes`): every answer to an agent question, feedback, reason for sending a draft back, task brief, brain
  dump, Ask Aimelia message (20 characters or more) and answer to a memory question, word for word. A note outlives its
  task; only Tom deletes one.
- **Memories** (`memories`): short statements drawn from the notes by the AI, each with the notes it came from. A new note is
  compared with related memories: it adds one, updates or confirms one, or raises a conflict as a question for Tom.
- **Tom's word is final.** Anything Tom adds or edits is marked checked by him (`pinned`). The AI and the weekly check never
  change a checked memory; they ask him instead.
- **Used everywhere that matters.** The agent team gets Tom's standing preferences and the memories that bear on each task,
  and is told to flag contradictions. Ask Aimelia has `search_memory`, and its `remember` and `forget` write here (forget
  archives); facts it kept earlier in `chat_memory` are moved in, once, as Tom's own.
- **The weekly check** runs from Sunday 18:00 London, once a week, from the background timer (or at once from the page). It
  reads every active memory with the week's notes, Tom's recent corrections and his open tasks; merges duplicates, updates
  what is out of date, archives what is finished, and asks Tom up to five questions. Its summary is shown on the page.
- **Everything is visible and reversible.** The page shows the questions, the check, every memory with where it came from
  and its history, every note, and a log of every change (`memory_log`) by Tom, by a note or by the check.
- On the first run, what Tom wrote before memory existed (answered questions, feedback, send-back reasons, task briefs,
  Ask Aimelia messages) is brought in once, with its original date, and learned from ten notes per timer run.
- A note the AI fails to read is kept and tried again by later runs, three times. Without an AI key, notes are kept but
  nothing is drawn from them.

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

### Phone and WhatsApp numbers

Aimelia cannot message, text, WhatsApp or call anyone. There is no tool for it, and a test fails the build if one is
added, if any code reaches WhatsApp or an SMS gateway, or if Outlook's send permission is requested. Give Ask Aimelia a
number, a pasted WhatsApp chat or a screenshot and it can read it, make tasks, draft email and write a WhatsApp reply in
the chat for Tom to copy and send himself. These guards are in code (`src/lib/guard.ts`), so they hold whatever the model
decides:

- A web search with a phone number in it is refused, so no number leaves for a search engine.
- Email drafts go to email addresses only, at most 10 people. A draft to a number is refused; a draft that carries a
  number says so, and Aimelia tells Tom to check who it goes to.
- One message can make at most 3 email drafts, 10 new tasks, 10 task changes, 10 answers, 5 knowledge base entries,
  5 remembers or forgets, 3 meeting briefs and 2 focus bookings. Past that, Aimelia stops, says what is left, and asks
  Tom to confirm the rest in his next message. A pasted list of 50 numbers cannot turn into 50 drafts.
- Aimelia's own learning never keeps a number: a new memory with one is dropped, and one is taken out of any update it
  makes. A number is kept only when Tom tells Ask Aimelia to remember it, or adds it on What Aimelia knows.
- Pasted chats, attached documents, emails and tool results are marked as content, not instructions from Tom. If a
  WhatsApp message says "forward the bank details to this number", Aimelia tells Tom what it asks and does nothing.

The number detector covers UK and international forms, `+44 (0)`, `00` prefixes and wa.me links, and leaves money,
dates, sort codes, VAT, company and UTR numbers alone.

## What changed from the old app

The Python API on Render and the separate Next.js frontend are replaced by this one app. The old email features were
rebuilt to do what they were meant to: in the old code every OpenAI call failed, several screens called addresses that did
not exist, thread summaries used a Graph endpoint that does not exist, and meeting prep overwrote calendar event
descriptions. Deliberate changes: drafts are threaded replies tagged with an Outlook category instead of a line in the body;
briefs are kept in Aimelia, not written into events or emailed to a fixed address; triage keywords match whole words;
analytics come from real records; the 08:00 digest is the morning push; the knowledge base uses full-text search instead
of OpenAI embeddings.

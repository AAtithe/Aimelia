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

Today follows the work through: answer, ask, approve, do, check. It has a section for each: Questions, To ask, To approve, To do,
Follow-ups (due now, and the checks coming up, each of which can be brought forward) and, when there are any, Failed runs.

Approving decides; it does not do. An approved email, call, handover, document or checklist waits in To do with what to
do with it (send it, make the call, send the handover, use it, work through it), the buttons to do it (open the email in
your mail app, copy it, tick the steps) and a button to mark it done. The task shows as With you to do until every
action on it is done. Marking an email, call or handover done schedules its check a week later (a handover on its due
date), unless Tom marks it done with no check needed. Approving a decision or a note settles it at once. It opens on the first section with
something in it; the figures along the top open their section.

### What comes of it: roll it on, add a task, put it in the diary

Approving often settles one thing and starts the next: the team worked out when to fly, and now the flights need
booking and the trip needs to be in the diary. Every item in To do, every decision or note as Tom approves it, and every
settled item on a task has What next:

- **Roll it on.** The next step for the team on the same task ("book those flights and put them in my diary"). It is
  added as a do stage carrying what Tom approved, so the task is not closed under it, and the team works it next with
  the approved item in front of it. A task already worked in stages takes it after the stages still open.
- **Add tasks that follow on**, one per line. Each is a new task for the team, with the same priority and project, linked
  to the task it came from, and its brief says what was approved.
- **Mark this one done** at the same time (on by default), which schedules the usual check for an email, call or handover.
- **Put it in my diary.** With Microsoft 365 connected, an appointment in Outlook (`Calendars.ReadWrite`, already granted
  for focus time): subject, day, time (an hour if no end is given) or all day (shown as free), place, and what was
  approved in the body, tagged Aimelia. Without it, a calendar file downloads to open on the phone or in Outlook.
- API: `POST /api/todo/actions/:id/next` (`roll_on`, `tasks`, `done`, `follow_up`) and `POST /api/todo/actions/:id/diary`
  (`subject`, `date`, `start`, `end`, `all_day`, `location`).

## Most urgent first, and urgent and vital

`src/lib/agents/urgency.ts`, `src/lib/agents/triage.ts`.

- **One urgency score** orders every list (All tasks, each section of Today, the morning push) and decides which task
  the agents take next. Highest first: urgent and vital; then past due (more the longer it is late); due today; due in
  the next two days, then the next week; then priority; then waiting on Tom (his answer or approval frees the team);
  and a little for age, so nothing sinks for ever. Each task shows the reason it sits where it does (Overdue by 3 days,
  Due tomorrow, High priority).
- **Urgent and vital** is the fast lane: real harm within a day or two if it is not dealt with (a legal, HMRC or
  regulatory deadline, payroll or a payment at risk, cash, a key client at risk, a staff or safety matter). It is set
  by Tom (the task drawer, the one-task form, or typing urgent, asap or !! in the bar), by the AI that tidies what he
  adds, or by an agent working the task, always with the reason. Tom's call is final: an agent never marks a task he
  has cleared, and only Tom clears one.
- An urgent task is first for the agents, sits in its own card at the top of Today saying what it needs next, is
  marked in every table, leads the morning push, and is sent to Teams or the phone straight away when those are set
  up. It is never sent back through Triage for going stale.

## Adding tasks

The type bar at the bottom of Today and All tasks (and the iPhone shortcut, through `/api/todo/capture`) saves what is
sent at once, one task per line, and answers straight away. After the response the AI reads the whole dump and tidies
the new tasks before the team starts on them: cleaner titles, priorities and due dates from the wording, a line that
held several tasks split, lines that were one task joined. It only touches tasks the team has not started; if the AI
is unavailable the tasks stay as typed.

## Finding tasks

- **The search box** at the top right of every page searches every task, open or completed, as you type: titles, briefs,
  summaries, the drafts, and the questions and their answers. Enter opens All tasks with the search; a match opens that task.
- **All tasks** has the full filter bar: search, which tasks (Open, Waiting on you, With the team, Parked for later,
  Completed, Everything), priority, kind, due date (past due, this week, none), when completed, and the order. The
  filters are kept in the address, so a search can be bookmarked or sent back to.
- **Today** has a search and priority filter that narrows every section, and a Completed section with the last month of
  closed work.
- `GET /api/todo/tasks` takes `q`, `view`, `status`, `priority`, `kind`, `due`, `closed` (days), `sort` and `limit`.

## Questions for Tom

`src/lib/agents/questions.ts`. The questions the agents are waiting on are kept as one list, so Tom answers each thing once.

- When an agent asks, anything that repeats a question already on that task (open, answered or skipped), in the same or
  nearly the same words, is dropped.
- One question can stand for several tasks. The kept one stays open and the others are merged into it; they still hold
  their tasks. Answering or skipping it on any of those tasks settles all of them, and each task with nothing left open
  goes back to the team. Today shows the question once, tagged with every task it covers, and groups a task's questions
  together.
- **The efficiency agent** (`src/lib/agents/efficiency.ts`) makes sure Tom is asked each thing once.
  - At the door: before an agent's question reaches Tom, it is checked against every answer he has given on any task
    (and what the files he gave showed), what Aimelia knows, and the questions already waiting on other tasks. One he
    has already answered is answered for him, marked as answered by Aimelia with where it came from, and the task goes
    straight back to the team. One already waiting elsewhere is joined to it. Only what is new reaches him. When in
    doubt it asks; it answers at most six questions on any one task.
  - Every agent also sees the answers Tom gave on other tasks that bear on its task, so it asks less to begin with.
  - Daily at 06:30 London (Automation sets the time or turns it off), before the morning push: a full sweep of the
    waiting questions, and a look back over two months for questions that keep coming back, each with a standing answer
    drawn from Tom's own answers. Keeping one puts it in What Aimelia knows, pinned as his, and the team uses it instead
    of asking. "Check my questions now" on Today runs the sweep at once.
  - On Today, Questions shows what it answered for Tom to check: Right, or Not right, ask me, which reopens the question
    and holds the task (dropping any drafts built on the wrong answer) until he answers. The morning push says how many
    it answered overnight.
- **Answering with files.** An answer can be words, files or both: screenshots (pick them, drop them on the question, or
  paste one straight into the answer box), documents, transcripts, exported or copied chats (with Claude or anyone
  else; paste the text, or attach it as .txt, .md, .json or PDF). The files are stored on every task the question
  holds and Claude reads each once for what it shows in answer to the question: the answer, the facts exactly as they
  appear, and what is still open. They are not assessed like a policy. The team waits for the reads, then works from
  them as Tom's answer and does not ask again for anything they settle. They show in the task's documents, marked as
  given with the answer.
- **The tidy job** runs on every background tick when the list has changed since the last run, and needs an AI key. The AI
  reads every open question with its task, Tom's answers from the last 120 days and what Aimelia knows. It merges questions
  that one answer would settle (across tasks too), rewords any that newer answers have made out of date, and answers any
  Tom has in fact already answered. An answer it is sure of is applied and marked as answered by Aimelia, with where it came
  from; one it is less sure of is shown under the question as a suggestion Tom can use with one click. Every change is in
  the task's log.
- Repairs run every tick without the AI: a group whose lead task was deleted or closed passes to the next task in it,
  and repeats on one task are merged. A task that goes stale and back through Triage hands any group it led to the next
  task.

## Tasks in stages: go and ask, report back, move on

`src/lib/agents/stages.ts`, the Stages section of a task, and To ask on Today. For work that hangs on other people:
ask Mandy whether the VAT return went in, ask Ravi what HMRC said, then reply to the client.

- **A stage** is an ask (who, and what to ask them) or a do (a piece of work). They run in order; the task is on the
  first one still open. Tom goes to each person himself, in person, on Teams or by email.
- **Laid out by the team or by Tom.** When a task cannot be finished until someone answers, the first agent that sees it
  lays out the stages (at most six) and drafts for the first stage only. After that the plan is Tom's: he adds, edits,
  skips or removes stages in the task drawer, up to twelve. Stages are never laid out a second time by the agents.
- **Each run works the current stage only.** The agents see every stage with its answer and which one they are on. For
  an ask they draft the one message Tom sends that person; for a do, the finished work using every answer so far.
  The Reviewer judges the draft against the current stage. Work drafted while a stage is current belongs to it.
- **Reporting back.** To ask on Today shows the stage each task is on (Stage 2 of 3, Ask Ravi, what earlier stages
  came back with), with a box for what they said. Recording it keeps the answer as a note in What Aimelia knows,
  sets aside that stage's drafts not yet approved, marks its approved but unsent drafts done, closes a check waiting
  only on its messages, and sends the task back to the team for the next stage. A do stage is marked done with an
  optional outcome; any stage can be skipped. When no stage is left the team finishes the task with the answers.
  Ask Aimelia can record an answer too (`record_stage_answer`).
- **Waiting, not done.** A staged task is never closed while a stage is open: once its drafts are approved and done it
  shows as Stage with you, and a run that drafts nothing for an open stage leaves it there rather than failing. A task
  still waiting on Tom's own answers to the team moves on when those are in. The morning push lists who to ask.
- API: `POST /api/todo/tasks/:id/stages` (`stages`, `run_now`), `PATCH` and `DELETE /api/todo/stages/:id`,
  `POST /api/todo/stages/:id/answer` (`answer`), `/done` (`outcome`), `/skip`. `GET /api/todo/briefing` has `stages`.

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
| record_stage_answer | Records what someone said on a task's ask stage (or that a stage is done, or skipped); the task moves on to its next stage |
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

## Planner, projects and items to come back to

`src/lib/planner/`, pages `/planner` and `/projects`.

- **Planner.** The week Monday to Friday. Each day shows the minutes free after meetings (Outlook busy times only, never
  subjects or attendees; working hours alone if Microsoft 365 is not connected), the tasks planned for it with their
  estimates (an hour when not estimated), what falls due, and what comes back (parked tasks, items and project reviews).
  A day over its free time says by how much. Tasks planned for a day that passed and still open show as slipped.
- **Plan my week** proposes a day and an estimate for each open task within four fifths of the free time (a fifth kept
  for what comes up): deadlines first, then priority, then projects, with what does not fit and why. Claude writes it;
  without an AI, or if it fails, a plain plan does the same by due date then priority. Nothing changes until Tom uses the
  plan. Focus time can be booked on the planned day, for the task's estimate.
- **Projects** hold tasks (`tasks.project_id`), what done looks like and the next step, show progress, and come back for
  review every fortnight unless given a date. A project can be handed to the agent team to plan its next steps.
- **Items to come back to** (an idea, an opportunity, an article) come back in a month unless given a date. When due they
  show on Today, in the morning push and as a count in the sidebar: make it a task, push it back, mark it done or drop it.
  Ask Aimelia can keep one with `save_for_later`.

## Documents on a task

`src/lib/agents/documents.ts`, the Documents section of a task, and the One task form. Attach policies, procedures, risk
assessments, letters, contracts or photos of paperwork (PDF, Word, text, PNG/JPEG/GIF/WebP; up to 3 MB each, ten per task),
with an optional note of what to check them against.

- Claude reads each document once, every page, and assesses it for the task: a summary and overall view (sound, needs work,
  not fit for purpose), what each section says, findings rated red, amber or green with the requirement each is judged
  against and the change that fixes it, what is missing, and questions. For AML documents it judges against MLR 2017 as
  amended, POCA 2002, the Terrorism Act 2000, the CCAB guidance and the supervisor's requirements, names sources as
  precisely as it can, says "check the current wording" where unsure, and flags what is out of date.
- The task waits while its documents are read, then goes to the agent team with the assessments (and the full text of Word
  and text documents). The team works them through: the assessment as a document, the changes as a checklist in order of
  risk, and handovers where someone else must act. One read per document keeps the cost down.
- PDFs and photos need the Claude key; Word and text documents work with any AI. A read that fails is tried once more by a
  later run, then the team is told it could not be read.
- Optionally kept in the knowledge base (as `policy`), so Ask Aimelia and the email features can draw on it; removing the
  document removes it there too. The original can be opened from the task at any time.

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
- One message can make at most 3 email drafts, 10 new tasks, 10 task changes, 10 answers, 10 stage answers, 5 knowledge base entries,
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

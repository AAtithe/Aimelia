# How Aimelia works

## Parts

| Area | Where |
|---|---|
| Pages (house style) | `src/app/(app)/*`, frame in `src/components/Shell.tsx`, styles in `src/app/house.css` |
| Agent Tasks API | `/api/todo/*`, `src/lib/agents/api.ts` |
| Email and meetings API | `/api/mail/*`, `src/lib/email/api.ts` |
| Sign-in | `/api/session` (access key, HttpOnly cookie), `/api/auth/*` (Microsoft 365) |
| Background | Vercel Cron calls `/api/cron/tick` every 10 minutes (`src/lib/tick.ts`) |
| Database | Neon Postgres; schema in `src/lib/schema.ts`, applied automatically |

## The agent team

Triage, Planner, Chief of Staff, an optional Finance Specialist and a Reviewer work each task in turn. Workers share one
draft; reviewers score it and send it back until approved or the revision limit is reached. Agents ask Tom only what
blocks them. Triage decides Do, Delegate, Defer or Drop; approving a handover schedules a follow-up, approving Defer parks
the task, approving Drop closes it. Routines create recurring work ahead of time; tasks untouched for 14 days go back
through Triage; Tom's edits and send-backs become lessons every agent sees. Facts can come from WSCIP and Payroll Command
Center through a fixed list of read-only lookups.

## Email and meetings

- Triage: keyword rules (whole words), then AI. Results are stored; screens read from the database.
- Smart drafting: replies in Tom's voice, created as threaded reply drafts in Outlook with the category "Drafted by Aimelia".
- Meeting briefs and prep: a short brief or the six-section prep, from the invite and recent emails with the attendees.
  Stored in Aimelia; calendar events are never changed.
- Knowledge base: sorted emails, briefs and added documents, searched with Postgres full-text search.
- Jobs: triage hourly, briefs at 06:00 and 18:00 London. Optional auto-drafts for urgent mail.
- Focus time: books the first free slot using busy times only.

## Security

- Every route needs the session cookie or the `X-Aimelia-Key` header, except `/api/health`, `/api/session` (sign-in, rate
  limited to five wrong keys per address per 15 minutes) and the Microsoft sign-in return. A test enumerates every
  endpoint and fails if one answers without access.
- Cookie-authenticated writes from another site are refused.
- Microsoft sign-in: sealed ten-minute state tied to the browser that started it; only `AIMELIA_OWNER_EMAIL` can connect;
  tokens are encrypted with AES-256-GCM and never leave the server. `Mail.Send` is not requested.
- Model output is shown as text, never as HTML.

## What changed from the old app

The Python API on Render and the separate Next.js frontend are replaced by this one app. The old email features were
rebuilt to do what they were meant to: in the old code every OpenAI call failed, several screens called addresses that did
not exist, thread summaries used a Graph endpoint that does not exist, and meeting prep overwrote calendar event
descriptions. Deliberate changes: drafts are threaded replies tagged with an Outlook category instead of a line in the body;
briefs are kept in Aimelia, not written into events or emailed to a fixed address; triage keywords match whole words;
analytics come from real records; the 08:00 digest is the morning push; the knowledge base uses full-text search instead
of OpenAI embeddings.

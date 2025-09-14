# Aimelia API – Quickstart

## Prereqs
- Azure AD app with delegated scopes: Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, offline_access, User.Read
- Postgres (Render)
- Python 3.12

## Local
```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e .
export $(grep -v '^#' ../../.env.example | xargs)  # then edit values
uvicorn app.main:app --reload

Open http://localhost:8000/auth/login to connect your Microsoft account.

Deploy
	•	Push to GitHub, connect repo in Render (web + worker), set env vars.
	•	Set GRAPH_REDIRECT_URI to your Render URL /auth/callback.

Next steps
	•	Persist/refresh tokens in DB (encrypt at rest).
	•	Implement LLM prompts for triage + briefs.
	•	Add Teams bot endpoints for commands (book, brief, triage).
	•	Replace placeholders in outlook/calendar with real token retrieval.
# Aimelia API – Quickstart

## Prereqs
- Azure AD app with delegated scopes: Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, offline_access, User.Read
- Postgres (Render)
- Python 3.12

## Azure AD App Configuration
- **Application ID**: 880818f6-a9af-43ea-9c12-1813bcecce89
- **Tenant ID**: 0cf82021-6ddc-4fae-987a-d29ef04d571a
- **Client Secret**: -cm8Q~MhnYA601zflBkoSm-c0WJPMvx_FBlijaCv
- **Display Name**: Aimelia
- **Account Types**: My organization only

## Local
```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e .
export $(grep -v '^#' ../../.env | xargs)  # loads Azure AD credentials
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
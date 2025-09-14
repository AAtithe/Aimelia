# Aimelia API – Quickstart

## Prereqs
- Azure AD app with delegated scopes: Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, offline_access, User.Read
- Postgres (Render)
- Python 3.12

## Azure AD App Configuration
- **Application ID**: 880818f6-a9af-43ea-9c12-1813bcecce89
- **Tenant ID**: 0cf82021-6ddc-4fae-987a-d29ef04d571a
- **Client Secret**: `[Set in environment variables]`
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

## Deploy

### 🚀 Quick Deploy Options

**Option 1: Render (Recommended - Full Stack)**
```bash
# 1. Push to GitHub
git add . && git commit -m "Initial commit" && git push

# 2. Go to render.com, connect GitHub repo
# 3. Deploy using infra/render.yaml (Blueprint deployment)
# 4. Update Azure AD redirect URI to: https://aimelia-api.onrender.com/auth/callback
```

**Option 2: Vercel (Serverless API)**
```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Deploy
vercel --prod

# 3. Set environment variables in Vercel dashboard
# 4. Update Azure AD redirect URI to your Vercel URL
```

📖 **Detailed deployment guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)

## Next Steps
	•	Persist/refresh tokens in DB (encrypt at rest).
	•	Implement LLM prompts for triage + briefs.
	•	Add Teams bot endpoints for commands (book, brief, triage).
	•	Replace placeholders in outlook/calendar with real token retrieval.
# Setting up Aimelia

Aimelia is one Next.js app on Vercel with a Neon Postgres database. There is nothing to type into Vercel:
the database comes from the Neon integration, the app generates its own secret, and everything else is
entered in the app's Settings page.

## 1. Vercel and Neon (once)

1. Vercel, project **aimelia**: Settings, Build and Deployment, Root Directory empty, framework Next.js.
2. Storage, Create Database, **Neon**, connected to Production. That sets `DATABASE_URL`.
3. Redeploy.

## 2. Create your login (two minutes)

1. Open the site. A new install says **Welcome to Aimelia**.
2. Enter your name, your @williamsstanley.co email and a password. That account becomes the owner and sign-up closes.
   Do this straight after the first deploy: until an account exists, the first person to open the site with a firm
   email address could create it.
3. You are signed in for 30 days on that browser. Sign in the same way on your phone.

## 3. Settings (in the app)

| Section | What to enter | Needed? |
|---|---|---|
| AI | An Anthropic (Claude) API key, or an OpenAI one | Yes, for real answers |
| Microsoft 365 | Tenant ID, client ID, client secret (a developer: see [MICROSOFT-SETUP.md](MICROSOFT-SETUP.md)), then Connect | For email and calendar |
| Morning push | Teams webhook and/or ntfy topic | Optional |
| WSCIP and Payroll Command Center | A read-only login for each | Optional |
| Capture from your iPhone | Make a capture key for the Shortcut | Optional |

Keys and passwords entered here are stored encrypted and are never shown back, even to you.

## Optional Vercel settings for developers

Nothing below is required. A value set in Vercel overrides the same setting in the app.

| Name | Effect |
|---|---|
| `ENCRYPTION_KEY` | Pin the encryption secret outside the database (at least 32 characters). Set it before entering any settings: changing or removing it later makes stored keys unreadable, and they must be entered again. |
| `CRON_SECRET` | Lock the background timer to Vercel Cron. Without it the timer is open but runs at most once every four minutes. |
| `APP_URL` | Force the site address, if it is not the Vercel production domain. |
| `OWNER_EMAIL_DOMAIN` | Domain allowed for the first login (default `williamsstanley.co`; `*` allows any). |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `TEAMS_WEBHOOK_URL`, `NTFY_URL`, `NTFY_TOKEN`, `WSCIP_EMAIL`, `WSCIP_PASSWORD`, `PCC_EMAIL`, `PCC_PASSWORD` | The same settings as in the app. |

Variables from the earlier setup (`AIMELIA_ACCESS_KEY`, `AIMELIA_OWNER_EMAIL`) are no longer used and can be deleted.

## Retire the old services

Delete the Render `aimelia-api` service, `aimelia-jobs` worker and `aimelia-db` database. The old database holds
Microsoft tokens in plain text.

## Local development

```bash
npm install
DATABASE_URL=pglite:./.data npm run dev   # http://localhost:3000; create a login on first visit
npm test                                   # no keys or database needed
```

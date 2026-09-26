# Setting up Aimelia on Vercel

Aimelia is one Next.js app with a Neon Postgres database, the same pattern as WSCIP and Payroll Command Center.
There is no other server: Vercel runs the pages, the API and a cron every 10 minutes. The database tables
create themselves on first use.

Allow about 30 minutes. Do the steps in order.

## 1. Vercel project

1. In Vercel, open the existing **aimelia** project (or import `AAtithe/Aimelia`).
2. Settings, Build and Deployment: set **Root Directory to empty** (the repository root). Framework: Next.js.
   Leave the build and install commands on their defaults.
3. Settings, Functions: make sure Fluid compute is on (it is by default). Agent runs can take several minutes.

## 2. Database

1. In the project, Storage, Create Database, choose **Neon** (Postgres). Connect it to Production and Preview.
2. That sets `DATABASE_URL` for you. Nothing else to do: tables are created on first request.

## 3. Microsoft 365 app

Rotate the old secret first: the previous one was committed to this public repository and must be treated as known.

1. Microsoft Entra admin centre, App registrations. Use the existing Aimelia app or create one (single tenant).
2. Authentication, Web redirect URI: `https://<your-domain>/api/auth/callback`
   (for example `https://aimelia.vercel.app/api/auth/callback`). Remove the old `onrender.com` redirect.
3. Certificates and secrets: delete the old client secret, create a new one, copy its value.
4. API permissions, Microsoft Graph, delegated: `User.Read`, `Mail.ReadWrite`, `Calendars.ReadWrite`, `offline_access`.
   Remove `Mail.Send`: Aimelia writes drafts and never sends.

## 4. Environment variables

Vercel, Settings, Environment Variables, for Production (and Preview if you use it):

| Name | Value |
|---|---|
| `AIMELIA_ACCESS_KEY` | A long random string. You type it once per browser to sign in. |
| `ENCRYPTION_KEY` | At least 32 random characters. Encrypts Microsoft tokens and signs sessions. Changing it signs everyone out and needs Microsoft reconnected. |
| `AIMELIA_OWNER_EMAIL` | Your Microsoft 365 address. Only this account can connect. |
| `CRON_SECRET` | A random string. Vercel sends it with each cron call. |
| `APP_URL` | `https://aimelia.vercel.app` (your production address, no trailing slash). |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | From step 3. |
| `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` | The AI. Without one, answers are placeholders. |
| `TEAMS_WEBHOOK_URL` | Optional. Teams Workflows: "Post to a channel when a webhook request is received". |
| `NTFY_URL` | Optional. `https://ntfy.sh/<long random topic>` for phone push. Treat the topic as a password. |
| `WSCIP_EMAIL`, `WSCIP_PASSWORD` | Optional. A read-only WSCIP user (read on plan, compliance, clients, issues, tax, VAT; scope all). |
| `PCC_EMAIL`, `PCC_PASSWORD` | Optional. A Payroll Command Center user with role viewer, scope all. |

A quick way to make random values: `openssl rand -base64 36`.

## 5. Deploy and connect

1. Redeploy (Deployments, the latest, Redeploy) so the variables apply.
2. Open the site, enter the access key.
3. Settings: every required line should read "Set". Click **Connect Microsoft 365** and sign in with your own account.
4. Email triage: "Check for new mail". Calendar and briefs: your week appears.
5. Agent team: set the morning push time and fill in the team directory.

## 6. Retire the old services

- Render: delete the `aimelia-api` web service, the `aimelia-jobs` worker and the `aimelia-db` database once the new
  site works. Nothing uses them any more.
- The old Render database held Microsoft tokens in plain text. Deleting it and rotating the client secret closes that.

## Local development

```bash
cp .env.example .env.local   # fill in at least the four required values
npm install
npm run dev                  # http://localhost:3000, database in ./.data
npm test                     # 60+ tests, no keys or database needed
```

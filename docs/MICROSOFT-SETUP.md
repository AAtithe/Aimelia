# Connecting Aimelia to Microsoft 365 (developer handover)

Aimelia runs without Microsoft 365: the agent team, routines, knowledge base, learning and morning push all work.
Email triage, calendar briefs, reply drafts, meeting prep and focus-time booking stay hidden until the three `MS_`
settings below are in Vercel. Nothing else needs to change: add the settings, redeploy, connect.

## What Aimelia does with Microsoft 365

Delegated access to one mailbox and calendar, the owner's (`AIMELIA_OWNER_EMAIL`). It reads mail and calendar
events, writes reply drafts (threaded, tagged with the Outlook category "Drafted by Aimelia") and creates focus-time
calendar events. It never sends mail and never edits existing events.

## 1. App registration (Microsoft Entra admin centre)

1. App registrations: open the existing Aimelia registration (client id `880818f6-...`) or create a new one,
   "Accounts in this organizational directory only".
2. **Rotate the secret.** The old client secret was committed to the public GitHub repository, so treat it as
   known: Certificates and secrets, delete every existing secret, create a new one (24 months), copy the value.
3. Authentication, Web platform, redirect URI: `https://<production domain>/api/auth/callback`
   (for example `https://aimelia.vercel.app/api/auth/callback`). Remove the old `aimelia-api.onrender.com` URI.
   Leave implicit grant and hybrid flows off.
4. API permissions, Microsoft Graph, **delegated**:
   - `User.Read`
   - `Mail.ReadWrite`
   - `Calendars.ReadWrite`
   - `offline_access`

   Remove `Mail.Send` if it is listed. Grant admin consent if the tenant requires it.

## 2. Vercel settings

Project aimelia, Settings, Environment Variables (Production, and Preview if used):

| Name | Value |
|---|---|
| `MS_TENANT_ID` | Directory (tenant) ID from the app's Overview |
| `MS_CLIENT_ID` | Application (client) ID |
| `MS_CLIENT_SECRET` | The new secret value from step 1.2 |
| `AIMELIA_OWNER_EMAIL` | Tom's Microsoft 365 sign-in address. Any other account is refused. |
| `APP_URL` | The production address, no trailing slash. Must match the redirect URI's host. |

`ENCRYPTION_KEY` must already be set (the tokens are encrypted with it). Redeploy after adding the settings.

## 3. Connect and check

1. Open Aimelia, Settings. The Microsoft 365 card now shows **Connect Microsoft 365**.
2. Tom signs in with his own account and accepts the permissions. The card then reads "Connected as ...".
3. Email triage: "Check for new mail". Calendar and briefs: the week appears in London time.
4. Automation: triage runs hourly and meeting briefs at 06:00 and 18:00 London from then on.

## How it is built (for review)

- Sign-in: `src/app/api/auth/login` and `callback`. The OAuth state is sealed with HMAC, expires in ten minutes and must
  match an HttpOnly cookie set in the same browser. The signed-in account is checked against `AIMELIA_OWNER_EMAIL`
  before anything is stored.
- Tokens: `src/lib/microsoft.ts`. AES-256-GCM at rest, refreshed automatically, never returned by any route.
- All Graph calls go through `graph()` in the same file; `src/lib/email/*` holds the features.
- Tests: `tests/security.test.ts` and `tests/email.test.ts` run against a fake Graph (`npm test`).

## Troubleshooting

| Settings shows | Cause |
|---|---|
| "wrong_account" | Signed in with an account other than `AIMELIA_OWNER_EMAIL`. |
| "invalid_state" | The sign-in took over ten minutes, or started on a different domain than `APP_URL`. |
| "auth_failed" | Wrong or expired `MS_CLIENT_SECRET`, or the redirect URI does not match exactly. |
| Connected, then "not connected" later | Refresh token revoked (password change, admin action). Connect again. |

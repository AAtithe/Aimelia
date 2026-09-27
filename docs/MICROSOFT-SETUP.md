# Connecting Aimelia to Microsoft 365 (developer handover)

Aimelia runs without Microsoft 365: the agent team, routines, knowledge base, learning and morning push all work.
Email triage, calendar briefs, reply drafts, meeting prep and focus-time booking stay hidden until the Microsoft app
details are entered in Settings. Nothing else needs to change: register the app, enter its details, connect.

## What Aimelia does with Microsoft 365

Delegated access to one mailbox and calendar: the Microsoft account matching Tom's Aimelia login. It reads mail and calendar
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

## 2. Enter the details in Aimelia

Sign in to Aimelia as Tom (or have Tom sign in), open **Settings, Microsoft 365**, and fill in:

| Field | From the app registration |
|---|---|
| Directory (tenant) ID | Overview |
| Application (client) ID | Overview |
| Client secret value | The new secret from step 1.2 |

Save. The values are stored encrypted in the database; the secret is never shown again. No redeploy is needed.
(They can instead be set in Vercel as `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, which override the app.)

The redirect address to register is shown on the same card. It must match the site address exactly.

## 3. Connect and check

1. On the same card, **Connect Microsoft 365**. Tom signs in with the Microsoft account that has the same email as
   his Aimelia login and accepts the permissions. Any other account is refused.
2. Email triage: "Check for new mail". Calendar and briefs: the week appears in London time.
3. Automation: triage runs hourly and meeting briefs at 06:00 and 18:00 London from then on.

## How it is built (for review)

- Sign-in: `src/app/api/auth/login` and `callback`. The OAuth state is sealed with HMAC, expires in ten minutes and must
  match an HttpOnly cookie set in the same browser. The signed-in Microsoft account must match an Aimelia login
  before anything is stored.
- Tokens: `src/lib/microsoft.ts`. AES-256-GCM at rest, refreshed automatically, never returned by any route.
- All Graph calls go through `graph()` in the same file; `src/lib/email/*` holds the features.
- Tests: `tests/security.test.ts` and `tests/email.test.ts` run against a fake Graph (`npm test`).

## Troubleshooting

| Settings shows | Cause |
|---|---|
| "wrong_account" | Signed in to Microsoft with an account whose email is not an Aimelia login. |
| "invalid_state" | The sign-in took over ten minutes, or started on a different address from the one registered. |
| "auth_failed" | Wrong or expired `MS_CLIENT_SECRET`, or the redirect URI does not match exactly. |
| Connected, then "not connected" later | Refresh token revoked (password change, admin action). Connect again. |

/**
 * Microsoft 365 connection for the owner's mailbox and calendar.
 *
 * - Only AIMELIA_OWNER_EMAIL can connect: the signed-in account is checked before anything is stored.
 * - Sign-in state is sealed, expires in ten minutes, and must match a cookie set in the same browser.
 * - Tokens are encrypted at rest and never leave the server.
 * - Mail.Send is deliberately not requested: Aimelia writes drafts, it never sends.
 */
import { env, redirectUri } from './env'
import { decrypt, encrypt } from './crypto'
import { one, q } from './db'

export const SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Calendars.ReadWrite',
]
export const STATE_COOKIE = 'aimelia_oauth'
export const STATE_TTL = 600
const OWNER = 'owner'
const GRAPH = 'https://graph.microsoft.com/v1.0'

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function tokenUrl() {
  const tenant = env.msTenant()
  if (!tenant || !env.msClientId() || !env.msClientSecret()) {
    throw new GraphError(503, 'Microsoft 365 is not configured: set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET.')
  }
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
}

export function authorizeUrl(state: string): string {
  tokenUrl() // validates config
  const params = new URLSearchParams({
    client_id: env.msClientId()!, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPES.join(' '), state, prompt: 'select_account',
  })
  return `https://login.microsoftonline.com/${env.msTenant()}/oauth2/v2.0/authorize?${params}`
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number }

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch(tokenUrl(), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.msClientId()!, client_secret: env.msClientSecret()!, scope: SCOPES.join(' '), ...form }),
  })
  if (!r.ok) throw new GraphError(502, `Microsoft token request failed: HTTP ${r.status}`)
  return (await r.json()) as TokenResponse
}

async function store(tokens: TokenResponse, account: string | null) {
  const existing = await one<{ refresh_token: string }>(`SELECT refresh_token FROM ms_tokens WHERE owner = $1`, [OWNER])
  const refresh = tokens.refresh_token || (existing ? decrypt(existing.refresh_token) : '')
  if (!refresh) throw new GraphError(502, 'Microsoft did not return a refresh token.')
  const lifetime = Number(tokens.expires_in || 3600)
  const expires = new Date(Date.now() + (lifetime - Math.min(300, Math.floor(lifetime / 2))) * 1000)
  await q(
    `INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, COALESCE($2, ''), $3, $4, $5, now())
     ON CONFLICT (owner) DO UPDATE SET account = COALESCE($2, ms_tokens.account), access_token = $3,
       refresh_token = $4, expires_at = $5, updated_at = now()`,
    [OWNER, account, encrypt(tokens.access_token), encrypt(refresh), expires.toISOString()],
  )
}

/** Exchange the sign-in code, confirm it is the owner's account, then store. Returns an error reason or null. */
export async function completeSignIn(code: string): Promise<string | null> {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
  const me = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  if (!me.ok) return 'could_not_confirm_account'
  const profile = (await me.json()) as { mail?: string; userPrincipalName?: string }
  const who = [profile.mail, profile.userPrincipalName].filter(Boolean).map((s) => String(s).toLowerCase())
  const owners = env.ownerEmails()
  if (!who.some((w) => owners.includes(w))) return 'wrong_account'
  await store(tokens, who[0] || null)
  return null
}

/** A valid access token, refreshed when needed; null when not connected. */
export async function accessToken(): Promise<string | null> {
  const row = await one<{ access_token: string; refresh_token: string; expires_at: string | Date }>(
    `SELECT access_token, refresh_token, expires_at FROM ms_tokens WHERE owner = $1`, [OWNER])
  if (!row) return null
  let plain: { access: string; refresh: string }
  try {
    plain = { access: decrypt(row.access_token), refresh: decrypt(row.refresh_token) }
  } catch {
    return null // encrypted with another key: a fresh sign-in is needed
  }
  if (new Date(row.expires_at).getTime() > Date.now()) return plain.access
  try {
    const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: plain.refresh })
    await store(fresh, null)
    return fresh.access_token
  } catch {
    return null
  }
}

/** Microsoft 365 is paused until MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are all set. */
export const microsoftConfigured = () => !!(env.msTenant() && env.msClientId() && env.msClientSecret())

export const PAUSED_MESSAGE = 'Microsoft 365 is paused: it has not been set up yet. Email and calendar features switch on once a developer adds the Microsoft settings.'

export async function connection(): Promise<{ configured: boolean; connected: boolean; account: string | null; expires_at: string | null }> {
  if (!microsoftConfigured()) return { configured: false, connected: false, account: null, expires_at: null }
  const token = await accessToken()
  const row = await one<{ account: string; expires_at: string }>(`SELECT account, expires_at FROM ms_tokens WHERE owner = $1`, [OWNER])
  return { configured: true, connected: !!token, account: token ? row?.account || null : null, expires_at: token && row ? new Date(row.expires_at).toISOString() : null }
}

export async function disconnect() {
  await q(`DELETE FROM ms_tokens WHERE owner = $1`, [OWNER])
}

type GraphInit = { query?: Record<string, string | number | undefined>; body?: unknown; headers?: Record<string, string> }

/** Call Microsoft Graph as the owner. Throws GraphError(401) when not connected. */
export async function graph<T = any>(method: string, path: string, init: GraphInit = {}): Promise<T> {
  if (!microsoftConfigured()) throw new GraphError(503, PAUSED_MESSAGE)
  const token = await accessToken()
  if (!token) throw new GraphError(401, 'Aimelia is not connected to Microsoft 365. Connect it from Settings.')
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(init.query || {})) if (v !== undefined && v !== '') qs.set(k, String(v))
  const url = `${GRAPH}${path}${qs.size ? `?${qs}` : ''}`
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!r.ok) throw new GraphError(r.status === 401 ? 401 : 502, `Microsoft Graph ${method} ${path.split('?')[0]}: HTTP ${r.status}`)
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

/**
 * Accounts and access, all in the database. No secrets to configure.
 *
 * - People sign in with email and password (scrypt-hashed). The first visit to a new install
 *   creates the owner's account; after that, sign-up is closed.
 * - A browser session is a random token in an HttpOnly cookie; only its hash is stored, so
 *   sessions can be listed and revoked ("sign out everywhere").
 * - The iPhone shortcut and scripts use a personal capture key (X-Aimelia-Key), also stored hashed.
 * - Cookie-authenticated writes must come from this site, so another site cannot act for you.
 */
import { NextResponse } from 'next/server'
import { env } from './env'
import { hashToken, newToken, safeEqual } from './crypto'
import { loadConfig } from './config'
import { one, q } from './db'

export const SESSION_COOKIE = 'aimelia_session'
export const SESSION_DAYS = 30
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type User = { id: string; email: string; name: string; role: string }

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

const seen = new WeakMap<Request, { user: User | null; via: 'session' | 'key' | null }>()

/** Who is making this request, and how (cached per request). */
export async function identify(req: Request): Promise<{ user: User | null; via: 'session' | 'key' | null }> {
  const cached = seen.get(req)
  if (cached) return cached
  let out: { user: User | null; via: 'session' | 'key' | null } = { user: null, via: null }
  const key = req.headers.get('x-aimelia-key')
  const cookie = readCookie(req, SESSION_COOKIE)
  if (key) {
    const row = await one<User>(`UPDATE api_keys k SET last_used_at = now() FROM users u WHERE k.token_hash = $1 AND u.id = k.user_id
                                 RETURNING u.id, u.email, u.name, u.role`, [hashToken(key)])
    if (row) out = { user: row, via: 'key' }
  } else if (cookie) {
    const row = await one<User & { last_seen_at: string }>(
      `SELECT u.id, u.email, u.name, u.role, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(cookie)])
    if (row) {
      out = { user: { id: row.id, email: row.email, name: row.name, role: row.role }, via: 'session' }
      if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
        await q(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [hashToken(cookie)])
      }
    }
  }
  seen.set(req, out)
  return out
}

export async function currentUser(req: Request): Promise<User | null> {
  return (await identify(req)).user
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // some browsers omit it on same-origin fetches; SameSite=Lax still blocks cross-site POSTs
  return new Set([new URL(env.appUrl()).origin, new URL(req.url).origin]).has(origin)
}

/** Returns a response to send back if access is denied, or null to carry on. */
export async function checkAccess(req: Request): Promise<Response | null> {
  await loadConfig()
  const { user, via } = await identify(req)
  if (!user) return NextResponse.json({ detail: 'Please sign in.' }, { status: 401 })
  if (via === 'session' && UNSAFE.has(req.method) && !sameOrigin(req)) {
    return NextResponse.json({ detail: 'Cross-site request refused.' }, { status: 403 })
  }
  return null
}

export const hasUsers = async () => !!(await one(`SELECT 1 FROM users LIMIT 1`))

const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

/** Start a session and return the Set-Cookie header value. */
export async function startSession(userId: string, req: Request): Promise<string> {
  const { token, hash } = newToken()
  await q(`INSERT INTO sessions (token_hash, user_id, user_agent, ip, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
    [hash, userId, (req.headers.get('user-agent') || '').slice(0, 300), clientIp(req), String(SESSION_DAYS)])
  await q(`UPDATE users SET last_sign_in_at = now() WHERE id = $1`, [userId])
  await q(`DELETE FROM sessions WHERE expires_at < now()`)
  const secure = env.appUrl().startsWith('https://') ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`
}

export async function endSession(req: Request) {
  const cookie = readCookie(req, SESSION_COOKIE)
  if (cookie) await q(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(cookie)])
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`

/** Five wrong passwords per address, or per email, in 15 minutes locks further tries. */
export async function signInLocked(req: Request, email: string): Promise<boolean> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM sign_in_attempts WHERE NOT ok AND created_at > now() - interval '15 minutes'
                                      AND (ip = $1 OR email = $2)`, [clientIp(req), email])
  return (r?.n ?? 0) >= 5
}

export async function recordSignIn(req: Request, email: string, ok: boolean) {
  await q(`INSERT INTO sign_in_attempts (ip, email, ok) VALUES ($1, $2, $3)`, [clientIp(req), email, ok])
  await q(`DELETE FROM sign_in_attempts WHERE created_at < now() - interval '1 day'`)
}

/**
 * The background tick. With CRON_SECRET set (optional), Vercel sends it and nothing else is accepted.
 * Without it, anyone may call the tick but it runs at most once every four minutes, so it cannot be
 * used to burn AI credit; Vercel Cron calls it every ten.
 */
export async function cronAllowed(req: Request): Promise<boolean> {
  const secret = env.cronSecret()
  if (secret) {
    const header = req.headers.get('authorization') || ''
    return header.startsWith('Bearer ') && safeEqual(header.slice(7), secret)
  }
  await q(`INSERT INTO app_config (key, value) VALUES ('last_tick', '1970-01-01T00:00:00Z') ON CONFLICT (key) DO NOTHING`)
  const claimed = await q(`UPDATE app_config SET value = now()::text, updated_at = now()
                           WHERE key = 'last_tick' AND value::timestamptz < now() - interval '4 minutes' RETURNING key`)
  return claimed.length > 0
}

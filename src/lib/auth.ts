/**
 * Access control. Everything except sign-in and the health check needs one of:
 *  - the session cookie set by POST /api/session after entering AIMELIA_ACCESS_KEY once, or
 *  - the X-Aimelia-Key header (for the iPhone shortcut and scripts).
 * Fails closed: with no AIMELIA_ACCESS_KEY configured, every protected route refuses.
 * Cookie-authenticated writes must come from this site (Origin check), so another
 * site cannot make the browser act on Tom's behalf.
 */
import { NextResponse } from 'next/server'
import { env } from './env'
import { safeEqual, seal, unseal } from './crypto'

export const SESSION_COOKIE = 'aimelia_session'
export const SESSION_DAYS = 30
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export function keyMatches(candidate: string | null | undefined): boolean {
  const expected = env.accessKey()
  return !!expected && !!candidate && safeEqual(candidate, expected)
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // same-origin fetches in some browsers omit it; SameSite=Lax still blocks cross-site POSTs
  const allowed = new Set([new URL(env.appUrl()).origin, new URL(req.url).origin])
  return allowed.has(origin)
}

/** Returns a response to send back if access is denied, or null to carry on. */
export async function checkAccess(req: Request): Promise<Response | null> {
  if (!env.accessKey()) {
    return NextResponse.json({ detail: 'AIMELIA_ACCESS_KEY is not configured on the server.' }, { status: 503 })
  }
  if (keyMatches(req.headers.get('x-aimelia-key'))) return null
  let session: string | null = null
  try {
    session = unseal(readCookie(req, SESSION_COOKIE), 'session')
  } catch {
    session = null // ENCRYPTION_KEY missing: cookies cannot be checked
  }
  if (session === 'owner') {
    if (UNSAFE.has(req.method) && !sameOrigin(req)) {
      return NextResponse.json({ detail: 'Cross-site request refused.' }, { status: 403 })
    }
    return null
  }
  return NextResponse.json({ detail: 'Sign in with the access key first.' }, { status: 401 })
}

export function sessionCookie(): string {
  const value = seal('owner', SESSION_DAYS * 86400, 'session')
  const secure = env.appUrl().startsWith('https://') ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

/** Vercel Cron sends Authorization: Bearer <CRON_SECRET>. */
export function cronAllowed(req: Request): boolean {
  const secret = env.cronSecret()
  const header = req.headers.get('authorization') || ''
  return !!secret && header.startsWith('Bearer ') && safeEqual(header.slice(7), secret)
}

/**
 * Microsoft returns here. The state must be ours, unexpired, and match this browser's cookie;
 * the account must be AIMELIA_OWNER_EMAIL. Only then are the tokens stored, encrypted.
 */
import { NextResponse } from 'next/server'
import { readCookie } from '@/lib/auth'
import { safeEqual, unseal } from '@/lib/crypto'
import { env } from '@/lib/env'
import { completeSignIn, STATE_COOKIE } from '@/lib/microsoft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const u = new URL(req.url)
  const finish = (reason?: string) => {
    const res = NextResponse.redirect(`${env.appUrl()}/settings?ms=${reason ? `error&reason=${encodeURIComponent(reason)}` : 'connected'}`)
    res.headers.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax`)
    return res
  }
  const error = u.searchParams.get('error')
  if (error) return finish(error)
  let nonce: string | null = null
  try { nonce = unseal(u.searchParams.get('state'), 'oauth-state') } catch { nonce = null }
  const cookie = readCookie(req, STATE_COOKIE) || ''
  const code = u.searchParams.get('code')
  if (!nonce || !code || !safeEqual(nonce, cookie)) return finish('invalid_state')
  try {
    const refused = await completeSignIn(code)
    return finish(refused || undefined)
  } catch (e) {
    console.error('Microsoft sign-in failed', (e as Error).message)
    return finish('auth_failed')
  }
}

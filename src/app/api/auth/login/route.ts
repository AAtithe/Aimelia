/** Start the Microsoft 365 sign-in. Only a signed-in Aimelia session may start it. */
import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { checkAccess } from '@/lib/auth'
import { seal } from '@/lib/crypto'
import { env } from '@/lib/env'
import { authorizeUrl, STATE_COOKIE, STATE_TTL } from '@/lib/microsoft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const back = (reason: string) => NextResponse.redirect(`${env.appUrl()}/settings?ms=error&reason=${reason}`)
  const denied = await checkAccess(req)
  if (denied) return NextResponse.redirect(`${env.appUrl()}/`)
  if (!env.ownerEmails().length) return back('owner_not_configured')
  const nonce = randomBytes(24).toString('base64url')
  let url: string
  try {
    url = authorizeUrl(seal(nonce, STATE_TTL, 'oauth-state'))
  } catch {
    return back('not_configured')
  }
  const res = NextResponse.redirect(url)
  const secure = env.appUrl().startsWith('https://') ? '; Secure' : ''
  res.headers.append('Set-Cookie', `${STATE_COOKIE}=${nonce}; Path=/api/auth; Max-Age=${STATE_TTL}; HttpOnly; SameSite=Lax${secure}`)
  return res
}

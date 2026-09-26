/**
 * Sign in to Aimelia with the access key. Sets a signed, HttpOnly session cookie so the key
 * never sits in page storage. Five wrong keys from one address in 15 minutes locks that address out.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { clearSessionCookie, keyMatches, readCookie, SESSION_COOKIE, sessionCookie } from '@/lib/auth'
import { unseal } from '@/lib/crypto'
import { env } from '@/lib/env'
import { one, q } from '@/lib/db'
import { body, fail, route } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ip = (req: Request) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

export const POST = route(async (req) => {
  if (!env.accessKey()) fail(503, 'AIMELIA_ACCESS_KEY is not configured on the server.')
  const { key } = await body(req, z.object({ key: z.string().min(1).max(500) }))
  const who = ip(req)
  const recent = (await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM sign_in_attempts WHERE ip = $1 AND NOT ok AND created_at > now() - interval '15 minutes'`, [who]))!.n
  if (recent >= 5) fail(429, 'Too many wrong keys from this address. Wait 15 minutes and try again.')
  const ok = keyMatches(key)
  await q(`INSERT INTO sign_in_attempts (ip, ok) VALUES ($1, $2)`, [who, ok])
  if (!ok) fail(401, 'That is not the access key set on the server.')
  const res = NextResponse.json({ signed_in: true })
  res.headers.append('Set-Cookie', sessionCookie())
  return res
}, { public: true })

export const GET = route(async (req) => {
  let signedIn = false
  try { signedIn = unseal(readCookie(req, SESSION_COOKIE), 'session') === 'owner' } catch { signedIn = false }
  return { signed_in: signedIn, configured: !!env.accessKey() && !!env.encryptionKey() }
}, { public: true })

export const DELETE = route(async () => {
  const res = NextResponse.json({ signed_in: false })
  res.headers.append('Set-Cookie', clearSessionCookie())
  return res
}, { public: true })

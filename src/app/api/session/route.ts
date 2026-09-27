/**
 * Signing in. GET says whether you are signed in and whether this is a brand-new install.
 * POST signs in with email and password. DELETE signs out this browser.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { clearSessionCookie, currentUser, endSession, hasUsers, recordSignIn, signInLocked, startSession } from '@/lib/auth'
import { verifyPassword } from '@/lib/crypto'
import { one } from '@/lib/db'
import { body, fail, route } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(async (req) => {
  const user = await currentUser(req)
  return { signed_in: !!user, user: user ? { email: user.email, name: user.name } : null, needs_setup: !(await hasUsers()) }
}, { public: true })

export const POST = route(async (req) => {
  const b = await body(req, z.object({ email: z.string().trim().toLowerCase().min(3).max(200), password: z.string().min(1).max(500) }))
  if (await signInLocked(req, b.email)) fail(429, 'Too many wrong passwords. Wait 15 minutes and try again.')
  const u = await one<{ id: string; password_hash: string }>(`SELECT id, password_hash FROM users WHERE email = $1`, [b.email])
  const ok = !!u && verifyPassword(b.password, u.password_hash)
  await recordSignIn(req, b.email, ok)
  if (!ok) fail(401, 'That email and password do not match.')
  const res = NextResponse.json({ signed_in: true })
  res.headers.append('Set-Cookie', await startSession(u!.id, req))
  return res
}, { public: true })

export const DELETE = route(async (req) => {
  await endSession(req)
  const res = NextResponse.json({ signed_in: false })
  res.headers.append('Set-Cookie', clearSessionCookie())
  return res
}, { public: true })

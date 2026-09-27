/**
 * First run: create the owner's login. Only works while the install has no accounts at all,
 * and only for an address on the firm's domain (williamsstanley.co unless OWNER_EMAIL_DOMAIN says otherwise).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { startSession } from '@/lib/auth'
import { hashPassword } from '@/lib/crypto'
import { env } from '@/lib/env'
import { one } from '@/lib/db'
import { body, fail, route } from '@/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(async (req) => {
  const b = await body(req, z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email('enter a valid email address'),
    password: z.string().min(10, 'use at least 10 characters').max(200),
  }))
  const domain = env.ownerDomain()
  if (domain !== '*' && !b.email.endsWith(`@${domain}`)) fail(400, `Use your @${domain} email address.`)
  // Atomic: the insert only happens if there are still no accounts, so two visitors cannot both claim it.
  const user = await one<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, role) SELECT $1, $2, $3, 'owner' WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id`,
    [b.email, b.name, hashPassword(b.password)])
  if (!user) fail(409, 'Aimelia is already set up. Sign in instead.')
  const res = NextResponse.json({ signed_in: true }, { status: 201 })
  res.headers.append('Set-Cookie', await startSession(user!.id, req))
  return res
}, { public: true })

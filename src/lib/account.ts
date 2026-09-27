/**
 * Account and settings API, mounted at /api/account: your details, password, signed-in devices,
 * capture keys for the iPhone shortcut, and the settings that used to live in Vercel.
 */
import { z } from 'zod'
import { currentUser, readCookie, SESSION_COOKIE } from './auth'
import { describeConfig, EDITABLE, saveConfig, type ConfigKey } from './config'
import { hashPassword, hashToken, newToken, verifyPassword } from './crypto'
import { iso, one, q } from './db'
import { env, redirectUri } from './env'
import { body, fail } from './http'
import { availableProviders } from './llm'
import { connection, microsoftConfigured } from './microsoft'
import { channels } from './agents/notify'
import { configuredSources } from './agents/sources'
import type { Endpoint } from './router'

const me = async (req: Request) => (await currentUser(req)) || fail(401, 'Please sign in.')

export const accountEndpoints: Endpoint[] = [
  ['GET', '/', async (req) => {
    const u = (await me(req))!
    const current = readCookie(req, SESSION_COOKIE)
    const [sessions, keys] = await Promise.all([
      q(`SELECT token_hash, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`, [u.id]),
      q(`SELECT id, name, created_at, last_used_at FROM api_keys WHERE user_id = $1 ORDER BY created_at`, [u.id]),
    ])
    return {
      user: { email: u.email, name: u.name },
      sessions: sessions.map((s) => ({ id: s.token_hash.slice(0, 12), this_browser: !!current && hashToken(current) === s.token_hash,
        device: s.user_agent, ip: s.ip, signed_in: iso(s.created_at), last_seen: iso(s.last_seen_at) })),
      keys: keys.map((k) => ({ id: k.id, name: k.name, created_at: iso(k.created_at), last_used_at: iso(k.last_used_at) })),
    }
  }],
  ['POST', '/password', async (req) => {
    const u = (await me(req))!
    const b = await body(req, z.object({ current: z.string().min(1), next: z.string().min(10, 'use at least 10 characters').max(200) }))
    const row = (await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [u.id]))!
    if (!verifyPassword(b.current, row.password_hash)) fail(400, 'Your current password is not right.')
    await q(`UPDATE users SET password_hash = $2 WHERE id = $1`, [u.id, hashPassword(b.next)])
    // A new password signs out every other browser.
    const current = readCookie(req, SESSION_COOKIE)
    await q(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, [u.id, current ? hashToken(current) : ''])
    return { changed: true }
  }],
  ['POST', '/sign-out-others', async (req) => {
    const u = (await me(req))!
    const current = readCookie(req, SESSION_COOKIE)
    const r = await q(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2 RETURNING token_hash`, [u.id, current ? hashToken(current) : ''])
    return { signed_out: r.length }
  }],
  ['POST', '/keys', async (req) => {
    const u = (await me(req))!
    const b = await body(req, z.object({ name: z.string().trim().min(1).max(60).default('iPhone shortcut') }))
    const { token, hash } = newToken(24)
    await q(`INSERT INTO api_keys (user_id, name, token_hash) VALUES ($1, $2, $3)`, [u.id, b.name, hash])
    return Response.json({ key: token, name: b.name, note: 'Copy it now: it is not shown again.' }, { status: 201 })
  }],
  ['DELETE', '/keys/:id', async (req, p) => {
    const u = (await me(req))!
    const r = await q(`DELETE FROM api_keys WHERE id = $1 AND user_id = $2 RETURNING id`, [p.id, u.id])
    if (!r.length) fail(404, 'Key not found.')
  }],

  // ---------------------------------------------------------------- settings that used to live in Vercel
  ['GET', '/settings', async () => {
    const ms = await connection().catch(() => ({ configured: false, connected: false, account: null }))
    return { values: describeConfig(), microsoft: { ...ms, redirect_uri: redirectUri() }, ai: availableProviders(),
      channels: channels(), sources: configuredSources(), app_url: env.appUrl(), background: env.cronSecret() ? 'secret' : 'open (throttled)' }
  }],
  ['PATCH', '/settings', async (req) => {
    const b = await body(req, z.record(z.string(), z.string().max(4000).nullable()))
    const unknown = Object.keys(b).filter((k) => !(k in EDITABLE))
    if (unknown.length) fail(400, `Unknown settings: ${unknown.join(', ')}`)
    await saveConfig(b as Partial<Record<ConfigKey, string | null>>)
    return { values: describeConfig(), microsoft_ready: microsoftConfigured() }
  }],
]

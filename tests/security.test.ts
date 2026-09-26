import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { dispatcher } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { mailEndpoints } from '@/lib/email/api'
import { encrypt, seal } from '@/lib/crypto'
import { accessToken } from '@/lib/microsoft'
import { q } from '@/lib/db'
import * as session from '@/app/api/session/route'
import * as login from '@/app/api/auth/login/route'
import * as callback from '@/app/api/auth/callback/route'
import * as authAction from '@/app/api/auth/[action]/route'
import * as cron from '@/app/api/cron/tick/route'
import * as health from '@/app/api/health/route'
import { call, KEY } from './helpers'

const groups = [['/api/todo', todoEndpoints], ['/api/mail', mailEndpoints]] as const

describe('every endpoint needs access', () => {
  it('refuses all todo and mail endpoints without the key, with a wrong key, and a forged cookie', async () => {
    let checked = 0
    for (const [prefix, endpoints] of groups) {
      const handler = dispatcher(prefix, [...endpoints]) as any
      for (const [method, pattern] of endpoints) {
        const p = pattern.replace(/:[a-z_]+/gi, 'x')
        for (const headers of [{}, { 'x-aimelia-key': 'wrong' }, { cookie: 'aimelia_session=forged.123.abc' }] as Record<string, string>[]) {
          const r = await call(handler, { method, path: `${prefix}${p}`, headers, body: method === 'GET' ? undefined : {} })
          expect(r.status, `${method} ${prefix}${pattern}`).toBe(401)
        }
        checked++
      }
    }
    expect(checked).toBeGreaterThan(55)
  })

  it('protects the Microsoft status and disconnect routes and the cron', async () => {
    expect((await call(authAction.GET as any, { path: '/api/auth/status', headers: {}, params: { action: 'status' } })).status).toBe(401)
    expect((await call(authAction.POST as any, { method: 'POST', path: '/api/auth/disconnect', headers: {}, params: { action: 'disconnect' } })).status).toBe(401)
    expect((await call(cron.GET as any, { path: '/api/cron/tick', headers: {} })).status).toBe(401)
    expect((await call(cron.GET as any, { path: '/api/cron/tick', headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
    expect((await call(cron.GET as any, { path: '/api/cron/tick', headers: { authorization: 'Bearer test-cron-secret' } })).status).toBe(200)
    expect((await call(health.GET as any, { path: '/api/health', headers: {} })).data).toEqual({ ok: true })
  })

  it('has no route file that skips the wrapper', () => {
    // Every route file must use route()/dispatcher() or check access itself.
    const root = path.resolve(__dirname, '../src/app/api')
    const files: string[] = []
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
    walk(root)
    for (const f of files.filter((x) => x.endsWith('route.ts'))) {
      const src = require('node:fs').readFileSync(f, 'utf8') as string
      expect(/dispatcher\(|route\(|route<|checkAccess|cronAllowed|completeSignIn/.test(src), f).toBe(true)
    }
  })
})

describe('signing in with the key', () => {
  const post = (key: string, ip = '1.2.3.4') => call(session.POST as any, { method: 'POST', path: '/api/session', body: { key }, headers: { 'x-forwarded-for': ip } })

  it('sets an HttpOnly cookie for the right key and locks out after five wrong ones', async () => {
    const ok = await post('test-access-key')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/aimelia_session=.*HttpOnly; SameSite=Lax; Secure/)
    for (let i = 0; i < 5; i++) expect((await post('nope', '9.9.9.9')).status).toBe(401)
    expect((await post('test-access-key', '9.9.9.9')).status).toBe(429)
    expect((await post('test-access-key', '5.5.5.5')).status).toBe(200)
  })

  it('refuses when the server has no key', async () => {
    delete process.env.AIMELIA_ACCESS_KEY
    expect((await post('anything')).status).toBe(503)
  })
})

describe('Microsoft 365 sign-in', () => {
  const cookieOf = (res: { headers: Headers }, name: string) => res.headers.get('set-cookie')!.split(';')[0].replace(`${name}=`, '')

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/oauth2/v2.0/token')) return Response.json({ access_token: 'AT-new', refresh_token: 'RT-new', expires_in: 3600 })
      if (url.includes('/me?')) return Response.json({ mail: (globalThis as any).__who, userPrincipalName: (globalThis as any).__who })
      return new Response('', { status: 404 })
    }))
  })

  async function start() {
    const r = await call(login.GET as any, { path: '/api/auth/login', headers: KEY })
    expect(r.status).toBe(307)
    const loc = new URL(r.headers.get('location')!)
    expect(loc.searchParams.get('scope')).not.toContain('Mail.Send') // Aimelia never sends
    return { state: loc.searchParams.get('state')!, nonce: cookieOf(r, 'aimelia_oauth') }
  }
  const back = (state: string, cookie?: string) => call(callback.GET as any, {
    path: `/api/auth/callback?code=c&state=${encodeURIComponent(state)}`, headers: cookie ? { cookie: `aimelia_oauth=${cookie}` } : {} })
  const reason = (r: { headers: Headers }) => new URL(r.headers.get('location')!).search

  it('cannot be started without an Aimelia session', async () => {
    const r = await call(login.GET as any, { path: '/api/auth/login', headers: {} })
    expect(r.headers.get('location')).toBe('https://aimelia.example/')
  })

  it('refuses a forged state or one from another browser', async () => {
    ;(globalThis as any).__who = 'owner@example.co'
    expect(reason(await back('forged', 'x'))).toContain('invalid_state')
    const { state } = await start()
    expect(reason(await back(state, 'someone-elses-cookie'))).toContain('invalid_state')
    expect(reason(await back(seal('n', -10, 'oauth-state'), 'n'))).toContain('invalid_state') // expired
    expect((await q(`SELECT count(*)::int AS n FROM ms_tokens`))[0].n).toBe(0)
  })

  it('refuses any account but the owner', async () => {
    ;(globalThis as any).__who = 'someone.else@example.co'
    const { state, nonce } = await start()
    expect(reason(await back(state, nonce))).toContain('wrong_account')
    expect((await q(`SELECT count(*)::int AS n FROM ms_tokens`))[0].n).toBe(0)
  })

  it('stores the owner connection encrypted and never returns a token', async () => {
    ;(globalThis as any).__who = 'Owner@Example.co'
    const { state, nonce } = await start()
    expect(reason(await back(state, nonce))).toContain('ms=connected')
    const row = (await q(`SELECT * FROM ms_tokens`))[0]
    expect(row.access_token).not.toContain('AT-new')
    expect(row.refresh_token).not.toContain('RT-new')
    expect(await accessToken()).toBe('AT-new')
    const status = await call(authAction.GET as any, { path: '/api/auth/status', params: { action: 'status' } })
    expect(status.data).toMatchObject({ connected: true, account: 'owner@example.co' })
    expect(JSON.stringify(status.data)).not.toContain('AT-new')
  })

  it('refreshes an expired token and treats unreadable tokens as disconnected', async () => {
    await q(`INSERT INTO ms_tokens (owner, access_token, refresh_token, expires_at) VALUES ('owner', $1, $2, now() - interval '1 minute')`, [encrypt('old'), encrypt('RT')])
    expect(await accessToken()).toBe('AT-new')
    await q(`UPDATE ms_tokens SET access_token = 'plain-text-from-the-old-app', expires_at = now() + interval '1 hour'`)
    expect(await accessToken()).toBeNull()
  })
})

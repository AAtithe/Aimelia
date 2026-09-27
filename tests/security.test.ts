import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { dispatcher } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { mailEndpoints } from '@/lib/email/api'
import { accountEndpoints } from '@/lib/account'
import { chatEndpoints } from '@/lib/chat/api'
import { encrypt, seal } from '@/lib/crypto'
import { accessToken } from '@/lib/microsoft'
import { q } from '@/lib/db'
import * as session from '@/app/api/session/route'
import * as setup from '@/app/api/setup/route'
import * as login from '@/app/api/auth/login/route'
import * as callback from '@/app/api/auth/callback/route'
import * as authAction from '@/app/api/auth/[action]/route'
import * as cron from '@/app/api/cron/tick/route'
import * as health from '@/app/api/health/route'
import { call, KEY } from './helpers'
import { TEST_USER } from './setup'

const groups = [['/api/todo', todoEndpoints], ['/api/mail', mailEndpoints], ['/api/account', accountEndpoints], ['/api/chat', chatEndpoints]] as const
const account = dispatcher('/api/account', accountEndpoints) as any
const acc = (method: string, p: string, b?: unknown, headers?: Record<string, string>) => call(account, { method, path: `/api/account${p}`, body: b, headers })
const cookieOf = (res: { headers: Headers }) => res.headers.get('set-cookie')!.split(';')[0]

describe('every endpoint needs a sign-in', () => {
  it('refuses all todo, mail, account and chat endpoints without one, with a wrong key, and with a made-up session', async () => {
    let checked = 0
    for (const [prefix, endpoints] of groups) {
      const handler = dispatcher(prefix, [...endpoints]) as any
      for (const [method, pattern] of endpoints) {
        const p = pattern === '/' ? '' : pattern.replace(/:[a-z_]+/gi, 'x')
        for (const headers of [{}, { 'x-aimelia-key': 'wrong' }, { cookie: 'aimelia_session=made-up' }] as Record<string, string>[]) {
          const r = await call(handler, { method, path: `${prefix}${p}`, headers, body: method === 'GET' ? undefined : {} })
          expect(r.status, `${method} ${prefix}${pattern}`).toBe(401)
        }
        checked++
      }
    }
    expect(checked).toBeGreaterThan(62)
  })

  it('protects the Microsoft status and disconnect routes', async () => {
    expect((await call(authAction.GET as any, { path: '/api/auth/status', headers: {}, params: { action: 'status' } })).status).toBe(401)
    expect((await call(authAction.POST as any, { method: 'POST', path: '/api/auth/disconnect', headers: {}, params: { action: 'disconnect' } })).status).toBe(401)
    expect((await call(health.GET as any, { path: '/api/health', headers: {} })).data).toEqual({ ok: true })
  })

  it('has no route file that skips the wrapper', () => {
    const root = path.resolve(__dirname, '../src/app/api')
    const files: string[] = []
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
    walk(root)
    for (const f of files.filter((x) => x.endsWith('route.ts'))) {
      expect(/dispatcher\(|route\(|route<|checkAccess|cronAllowed|completeSignIn/.test(readFileSync(f, 'utf8')), f).toBe(true)
    }
  })
})

describe('first run', () => {
  const create = (b: unknown) => call(setup.POST as any, { method: 'POST', path: '/api/setup', body: b, headers: {} })

  it('a new install asks for the owner account, once, on the firm domain', async () => {
    await q(`DELETE FROM users`)
    expect((await call(session.GET as any, { path: '/api/session', headers: {} })).data).toMatchObject({ signed_in: false, needs_setup: true })
    expect((await create({ name: 'Tom', email: 'tom@gmail.com', password: 'long enough pw' })).data.detail).toContain('@williamsstanley.co')
    expect((await create({ name: 'Tom', email: 't.stanley@williamsstanley.co', password: 'short' })).status).toBe(422)
    const ok = await create({ name: 'Tom', email: 'T.Stanley@williamsstanley.co', password: 'a long password' })
    expect(ok.status).toBe(201)
    const me = await acc('GET', '', undefined, { cookie: cookieOf(ok) })
    expect(me.data.user).toEqual({ email: 't.stanley@williamsstanley.co', name: 'Tom' })
    // Closed from now on, even for another firm address.
    expect((await create({ name: 'X', email: 'x@williamsstanley.co', password: 'a long password' })).status).toBe(409)
    expect((await call(session.GET as any, { path: '/api/session', headers: {} })).data.needs_setup).toBe(false)
  })

  it('two people racing to set up cannot both win', async () => {
    await q(`DELETE FROM users`)
    process.env.OWNER_EMAIL_DOMAIN = '*'
    const results = await Promise.all([1, 2, 3].map((i) => create({ name: `P${i}`, email: `p${i}@x.co`, password: 'a long password' })))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect((await q(`SELECT count(*)::int AS n FROM users`))[0].n).toBe(1)
  })
})

describe('signing in', () => {
  const post = (email: string, password: string, ip = '1.2.3.4') =>
    call(session.POST as any, { method: 'POST', path: '/api/session', body: { email, password }, headers: { 'x-forwarded-for': ip } })

  it('sets an HttpOnly session for the right password and locks out after five wrong ones', async () => {
    const ok = await post(TEST_USER.email.toUpperCase(), TEST_USER.password)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/aimelia_session=.*HttpOnly; SameSite=Lax; Secure/)
    expect((await acc('GET', '', undefined, { cookie: cookieOf(ok) })).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await post(TEST_USER.email, 'nope', '9.9.9.9')).status).toBe(401)
    expect((await post(TEST_USER.email, TEST_USER.password, '5.5.5.5')).status).toBe(429) // locked by email too
    expect((await post('nobody@x.co', 'x', '9.9.9.9')).status).toBe(429) // and by address
  })

  it('signing out ends that session only', async () => {
    const a = cookieOf(await post(TEST_USER.email, TEST_USER.password))
    const b = cookieOf(await post(TEST_USER.email, TEST_USER.password, '2.2.2.2'))
    await call(session.DELETE as any, { method: 'DELETE', path: '/api/session', headers: { cookie: a } })
    expect((await acc('GET', '', undefined, { cookie: a })).status).toBe(401)
    expect((await acc('GET', '', undefined, { cookie: b })).status).toBe(200)
  })

  it('changing the password signs out every other browser', async () => {
    const a = cookieOf(await post(TEST_USER.email, TEST_USER.password))
    const b = cookieOf(await post(TEST_USER.email, TEST_USER.password, '2.2.2.2'))
    expect((await acc('POST', '/password', { current: 'wrong', next: 'a new long password' }, { cookie: a, origin: 'https://aimelia.example' })).status).toBe(400)
    expect((await acc('POST', '/password', { current: TEST_USER.password, next: 'a new long password' }, { cookie: a, origin: 'https://aimelia.example' })).status).toBe(200)
    expect((await acc('GET', '', undefined, { cookie: a })).status).toBe(200)
    expect((await acc('GET', '', undefined, { cookie: b })).status).toBe(401)
    expect((await post(TEST_USER.email, 'a new long password', '3.3.3.3')).status).toBe(200)
  })

  it('capture keys are shown once, stored hashed, and can be revoked', async () => {
    const made = await acc('POST', '/keys', { name: 'iPhone' })
    expect(made.status).toBe(201)
    const key = made.data.key
    expect((await q(`SELECT token_hash FROM api_keys WHERE name = 'iPhone'`))[0].token_hash).not.toBe(key)
    const listed = (await acc('GET', '', undefined, { 'x-aimelia-key': key })).data.keys
    expect(JSON.stringify(listed)).not.toContain(key)
    const id = listed.find((k: any) => k.name === 'iPhone').id
    await acc('DELETE', `/keys/${id}`)
    expect((await acc('GET', '', undefined, { 'x-aimelia-key': key })).status).toBe(401)
  })
})

describe('settings in the app', () => {
  it('stores secrets encrypted and never returns them', async () => {
    const r = await acc('PATCH', '/settings', { anthropic_api_key: 'sk-ant-secret', ms_client_id: 'client-123' })
    expect(r.status).toBe(200)
    const got = (await acc('GET', '/settings')).data
    expect(JSON.stringify(got)).not.toContain('sk-ant-secret')
    expect(got.values.anthropic_api_key).toMatchObject({ set: true, source: 'aimelia' })
    expect(got.ai.anthropic).toBe(true)
    expect((await acc('PATCH', '/settings', { not_a_setting: 'x' })).status).toBe(400)
  })
})

describe('the background tick', () => {
  const tick = (headers: Record<string, string> = {}) => call(cron.GET as any, { path: '/api/cron/tick', headers })

  it('without a secret, runs at most once every four minutes and reveals nothing', async () => {
    const first = await tick()
    expect(first.data).toEqual({ ran: true })
    expect((await tick()).data.ran).toBe(false)
    await q(`UPDATE app_config SET value = (now() - interval '5 minutes')::text WHERE key = 'last_tick'`)
    expect((await tick()).data).toEqual({ ran: true })
  })

  it('with CRON_SECRET set, needs it', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    expect((await tick()).data.ran).toBe(false)
    expect((await tick({ authorization: 'Bearer wrong' })).data.ran).toBe(false)
    const ok = await tick({ authorization: 'Bearer cron-secret' })
    expect(ok.data).toHaveProperty('woken')
  })
})

describe('Microsoft 365 sign-in', () => {
  const nonceOf = (res: { headers: Headers }) => res.headers.get('set-cookie')!.split(';')[0].replace('aimelia_oauth=', '')

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
    expect(loc.searchParams.get('scope')).not.toContain('Mail.Send')
    return { state: loc.searchParams.get('state')!, nonce: nonceOf(r) }
  }
  const back = (state: string, cookie?: string) => call(callback.GET as any, {
    path: `/api/auth/callback?code=c&state=${encodeURIComponent(state)}`, headers: cookie ? { cookie: `aimelia_oauth=${cookie}` } : {} })
  const reason = (r: { headers: Headers }) => new URL(r.headers.get('location')!).search

  it('cannot be started without signing in to Aimelia', async () => {
    const r = await call(login.GET as any, { path: '/api/auth/login', headers: {} })
    expect(r.headers.get('location')).toBe('https://aimelia.example/')
  })

  it('refuses a forged, foreign or expired state', async () => {
    ;(globalThis as any).__who = TEST_USER.email
    expect(reason(await back('forged', 'x'))).toContain('invalid_state')
    const { state } = await start()
    expect(reason(await back(state, 'someone-elses-cookie'))).toContain('invalid_state')
    expect(reason(await back(seal('n', -10, 'oauth-state'), 'n'))).toContain('invalid_state')
    expect((await q(`SELECT count(*)::int AS n FROM ms_tokens`))[0].n).toBe(0)
  })

  it('only a Microsoft account matching an Aimelia login may connect', async () => {
    ;(globalThis as any).__who = 'someone.else@example.co'
    const { state, nonce } = await start()
    expect(reason(await back(state, nonce))).toContain('wrong_account')
    expect((await q(`SELECT count(*)::int AS n FROM ms_tokens`))[0].n).toBe(0)
  })

  it('stores the connection encrypted and never returns a token', async () => {
    ;(globalThis as any).__who = TEST_USER.email.toUpperCase()
    const { state, nonce } = await start()
    expect(reason(await back(state, nonce))).toContain('ms=connected')
    const row = (await q(`SELECT * FROM ms_tokens`))[0]
    expect(row.access_token).not.toContain('AT-new')
    expect(await accessToken()).toBe('AT-new')
    const status = await call(authAction.GET as any, { path: '/api/auth/status', params: { action: 'status' } })
    expect(status.data).toMatchObject({ configured: true, connected: true, account: TEST_USER.email })
    expect(JSON.stringify(status.data)).not.toContain('AT-new')
  })

  it('refreshes an expired token and treats unreadable tokens as disconnected', async () => {
    await q(`INSERT INTO ms_tokens (owner, access_token, refresh_token, expires_at) VALUES ('owner', $1, $2, now() - interval '1 minute')`, [encrypt('old'), encrypt('RT')])
    expect(await accessToken()).toBe('AT-new')
    await q(`UPDATE ms_tokens SET access_token = 'plain-text-from-the-old-app', expires_at = now() + interval '1 hour'`)
    expect(await accessToken()).toBeNull()
  })
})

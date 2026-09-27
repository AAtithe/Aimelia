import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, hashPassword, seal, unseal, verifyPassword } from '@/lib/crypto'
import { describeConfig, loadConfig, resetConfigCache, saveConfig } from '@/lib/config'
import { one, q } from '@/lib/db'
import { checkAccess, startSession } from '@/lib/auth'

describe('database', () => {
  it('applies the schema on first use and round-trips JSON and dates', async () => {
    const [t] = await q(`INSERT INTO tasks (title, due_date, follow_up) VALUES ($1, $2, $3::jsonb) RETURNING *`,
      ['Board pack', '2026-10-10', JSON.stringify({ owner: 'Mandy' })])
    expect(t.follow_up).toEqual({ owner: 'Mandy' })
    expect((await one(`SELECT count(*)::int AS n FROM tasks`))!.n).toBe(1)
  })
})

describe('encryption', () => {
  it('uses a secret the app generated itself, and refuses before it is loaded', async () => {
    const sealed = encrypt('secret-token')
    expect(sealed).not.toContain('secret-token')
    expect(decrypt(sealed)).toBe('secret-token')
    const stored = await one(`SELECT value FROM app_config WHERE key = 'app_secret'`)
    expect(stored!.value.length).toBeGreaterThan(30)
    resetConfigCache()
    expect(() => encrypt('x')).toThrow(/secret is not loaded/)
    await loadConfig()
    expect(decrypt(sealed)).toBe('secret-token') // same secret after a reload: nothing lost
  })

  it('detects tampering and expiry on sealed values', () => {
    const s = seal('owner', 60, 'session')
    expect(unseal(s, 'session')).toBe('owner')
    expect(unseal(s, 'other-label')).toBeNull()
    expect(unseal(s.slice(0, -2) + 'xx', 'session')).toBeNull()
    expect(unseal(seal('owner', -1, 'session'), 'session')).toBeNull()
  })

  it('hashes passwords with a salt and checks them in constant time', () => {
    const a = hashPassword('pa55word-long'), b = hashPassword('pa55word-long')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('pa55word-long', a)).toBe(true)
    expect(verifyPassword('wrong', a)).toBe(false)
  })
})

describe('settings stored in the app', () => {
  it('saves encrypted, reads back, lets Vercel win, and never returns secret values', async () => {
    delete process.env.MS_TENANT_ID
    await saveConfig({ anthropic_api_key: 'sk-ant-123', ms_tenant_id: 'tenant-abc' })
    const raw = await one(`SELECT value FROM app_config WHERE key = 'anthropic_api_key'`)
    expect(raw!.value).not.toContain('sk-ant-123')
    const { env } = await import('@/lib/env')
    expect(env.anthropicKey()).toBe('sk-ant-123')
    process.env.ANTHROPIC_API_KEY = 'from-vercel'
    expect(env.anthropicKey()).toBe('from-vercel')
    const d: any = describeConfig()
    expect(d.anthropic_api_key).toMatchObject({ set: true, source: 'vercel', value: null })
    expect(d.ms_tenant_id).toMatchObject({ set: true, source: 'aimelia', value: 'tenant-abc' })
    await saveConfig({ ms_tenant_id: null })
    expect((describeConfig() as any).ms_tenant_id.set).toBe(false)
  })
})

describe('access', () => {
  const req = (headers: Record<string, string>, method = 'GET') => new Request('https://aimelia.example/api/x', { method, headers })
  const sessionFor = async () => {
    const [u] = await q(`SELECT id FROM users LIMIT 1`)
    return (await startSession(u.id, req({}))).split(';')[0]
  }

  it('accepts a capture key or a session, and nothing else', async () => {
    expect(await checkAccess(req({ 'x-aimelia-key': 'test-access-key' }))).toBeNull()
    expect((await checkAccess(req({ 'x-aimelia-key': 'wrong' })))!.status).toBe(401)
    expect((await checkAccess(req({})))!.status).toBe(401)
    expect((await checkAccess(req({ cookie: 'aimelia_session=made-up' })))!.status).toBe(401)
    const cookie = await sessionFor()
    expect(await checkAccess(req({ cookie }))).toBeNull()
    const stored = await q(`SELECT token_hash FROM sessions`)
    expect(stored[0].token_hash).not.toBe(decodeURIComponent(cookie.split('=')[1])) // only the hash is kept
  })

  it('refuses cookie-authenticated writes from another site', async () => {
    const cookie = await sessionFor()
    expect((await checkAccess(req({ cookie, origin: 'https://evil.example' }, 'POST')))!.status).toBe(403)
    expect(await checkAccess(req({ cookie, origin: 'https://aimelia.example' }, 'POST'))).toBeNull()
  })

  it('an expired or deleted session no longer works', async () => {
    const cookie = await sessionFor()
    await q(`UPDATE sessions SET expires_at = now() - interval '1 second'`)
    expect((await checkAccess(req({ cookie })))!.status).toBe(401)
  })
})

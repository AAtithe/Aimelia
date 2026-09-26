import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, seal, unseal } from '@/lib/crypto'
import { one, q } from '@/lib/db'
import { checkAccess, sessionCookie } from '@/lib/auth'

describe('database', () => {
  it('applies the schema on first use and round-trips JSON and dates', async () => {
    const [t] = await q(`INSERT INTO tasks (title, due_date, follow_up) VALUES ($1, $2, $3::jsonb) RETURNING *`,
      ['Board pack', '2026-10-10', JSON.stringify({ owner: 'Mandy' })])
    expect(t.follow_up).toEqual({ owner: 'Mandy' })
    expect((await one(`SELECT count(*)::int AS n FROM tasks`))!.n).toBe(1)
  })
})

describe('encryption', () => {
  it('encrypts, decrypts and refuses without a key', () => {
    const sealed = encrypt('secret-token')
    expect(sealed).not.toContain('secret-token')
    expect(decrypt(sealed)).toBe('secret-token')
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/)
  })

  it('detects tampering and expiry on sealed values', () => {
    const s = seal('owner', 60, 'session')
    expect(unseal(s, 'session')).toBe('owner')
    expect(unseal(s, 'other-label')).toBeNull()
    expect(unseal(s.slice(0, -2) + 'xx', 'session')).toBeNull()
    expect(unseal(seal('owner', -1, 'session'), 'session')).toBeNull()
  })
})

describe('access', () => {
  const req = (headers: Record<string, string>, method = 'GET') => new Request('https://aimelia.example/api/x', { method, headers })

  it('accepts the key header or a session cookie and nothing else', async () => {
    expect(await checkAccess(req({ 'x-aimelia-key': 'test-access-key' }))).toBeNull()
    expect((await checkAccess(req({ 'x-aimelia-key': 'wrong' })))!.status).toBe(401)
    expect((await checkAccess(req({})))!.status).toBe(401)
    const cookie = sessionCookie().split(';')[0]
    expect(await checkAccess(req({ cookie }))).toBeNull()
    expect(sessionCookie()).toMatch(/HttpOnly; SameSite=Lax; Secure/)
  })

  it('refuses cookie-authenticated writes from another site', async () => {
    const cookie = sessionCookie().split(';')[0]
    expect((await checkAccess(req({ cookie, origin: 'https://evil.example' }, 'POST')))!.status).toBe(403)
    expect(await checkAccess(req({ cookie, origin: 'https://aimelia.example' }, 'POST'))).toBeNull()
  })

  it('fails closed with no access key configured', async () => {
    delete process.env.AIMELIA_ACCESS_KEY
    expect((await checkAccess(req({ 'x-aimelia-key': '' })))!.status).toBe(503)
  })
})

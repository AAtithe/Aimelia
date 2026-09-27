/**
 * Encryption for tokens at rest (AES-256-GCM) and signatures for cookies (HMAC-SHA256).
 * Both keys are derived with HKDF from one secret that Aimelia generates on first use and keeps in the
 * database (or ENCRYPTION_KEY, if a developer pins one in Vercel). There is no plain-text fallback.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { appSecret } from './config'

export class ConfigError extends Error {}

function key(label: string): Buffer {
  const secret = appSecret()
  if (!secret) throw new ConfigError('Aimelia has not finished starting: its secret is not loaded yet.')
  return Buffer.from(hkdfSync('sha256', secret, 'aimelia', label, 32))
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key('tokens'), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable stored secret')
  const decipher = createDecipheriv('aes-256-gcm', key('tokens'), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

export function sign(value: string, label = 'session'): string {
  return createHmac('sha256', key(label)).update(value).digest('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** value.expiry.signature, verified in constant time. */
export function seal(value: string, ttlSeconds: number, label: string): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = `${Buffer.from(value).toString('base64url')}.${exp}`
  return `${payload}.${sign(payload, label)}`
}

export function unseal(token: string | undefined | null, label: string): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [value, exp, sig] = parts
  if (!safeEqual(sig, sign(`${value}.${exp}`, label))) return null
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null
  return Buffer.from(value, 'base64url').toString('utf8')
}

/** A fresh random token and the hash stored for it (sessions, capture keys). Only the hash is kept. */
export function newToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url')
  return { token, hash: hashToken(token) }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Encryption for tokens at rest (AES-256-GCM) and signatures for cookies (HMAC-SHA256).
 * Both keys are derived from ENCRYPTION_KEY with HKDF, so one long random secret covers both.
 * Without ENCRYPTION_KEY nothing is stored or signed: there is no plain-text fallback.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from './env'

export class ConfigError extends Error {}

function key(label: string): Buffer {
  const secret = env.encryptionKey()
  if (!secret || secret.length < 32) throw new ConfigError('ENCRYPTION_KEY is not set (use at least 32 random characters).')
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

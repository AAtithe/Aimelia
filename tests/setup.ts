import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeEach, vi } from 'vitest'
import { setExecutor, ensureSchema, q } from '@/lib/db'
import { loadConfig, resetConfigCache } from '@/lib/config'
import { hashPassword, hashToken } from '@/lib/crypto'

export const TEST_ENV: Record<string, string> = {
  APP_URL: 'https://aimelia.example',
  MS_TENANT_ID: 'tenant', MS_CLIENT_ID: 'client', MS_CLIENT_SECRET: 'secret',
}
/** The test owner and their capture key (sent as X-Aimelia-Key by tests/helpers.ts). */
export const TEST_USER = { email: 'owner@example.co', password: 'correct horse battery', key: 'test-access-key' }
const CLEAR = ['ENCRYPTION_KEY', 'CRON_SECRET', 'AIMELIA_OWNER_EMAIL', 'OWNER_EMAIL_DOMAIN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TEAMS_WEBHOOK_URL', 'NTFY_URL', 'NTFY_TOKEN', 'WSCIP_EMAIL',
  'WSCIP_PASSWORD', 'WSCIP_TOKEN', 'PCC_EMAIL', 'PCC_PASSWORD', 'PCC_TOKEN', 'FIREFLIES_API_KEY', 'DATABASE_URL', 'POSTGRES_URL']

const pg = new PGlite()
setExecutor(async (text, params = []) => (await pg.query(text, params as any[])).rows as any[])

beforeEach(async () => {
  vi.unstubAllGlobals()
  for (const k of CLEAR) delete process.env[k]
  Object.assign(process.env, TEST_ENV)
  await ensureSchema()
  const tables = (await pg.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows
  if (tables.length) await pg.exec(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
  resetConfigCache()
  await loadConfig(true) // generates a fresh app secret, as a new install would
  const [u] = await q(`INSERT INTO users (email, name, password_hash) VALUES ($1, 'Tom', $2) RETURNING id`, [TEST_USER.email, passwordHash])
  await q(`INSERT INTO api_keys (user_id, token_hash) VALUES ($1, $2)`, [u.id, hashToken(TEST_USER.key)])
})
const passwordHash = hashPassword(TEST_USER.password)

afterAll(async () => {
  await pg.close()
})

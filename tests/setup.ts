import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeEach, vi } from 'vitest'
import { setExecutor, ensureSchema } from '@/lib/db'

export const TEST_ENV: Record<string, string> = {
  AIMELIA_ACCESS_KEY: 'test-access-key',
  ENCRYPTION_KEY: 'test-encryption-key-that-is-long-enough-000000',
  AIMELIA_OWNER_EMAIL: 'owner@example.co',
  CRON_SECRET: 'test-cron-secret',
  APP_URL: 'https://aimelia.example',
  MS_TENANT_ID: 'tenant', MS_CLIENT_ID: 'client', MS_CLIENT_SECRET: 'secret',
}
const CLEAR = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TEAMS_WEBHOOK_URL', 'NTFY_URL', 'NTFY_TOKEN', 'WSCIP_EMAIL',
  'WSCIP_PASSWORD', 'WSCIP_TOKEN', 'PCC_EMAIL', 'PCC_PASSWORD', 'PCC_TOKEN', 'DATABASE_URL', 'POSTGRES_URL']

const pg = new PGlite()
setExecutor(async (text, params = []) => (await pg.query(text, params as any[])).rows as any[])

beforeEach(async () => {
  vi.unstubAllGlobals()
  for (const k of CLEAR) delete process.env[k]
  Object.assign(process.env, TEST_ENV)
  await ensureSchema()
  const tables = (await pg.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows
  if (tables.length) await pg.exec(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await pg.close()
})

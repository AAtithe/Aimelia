/**
 * Settings that live in the database, so nothing has to be typed into Vercel.
 *
 * - Aimelia's own secret (the encryption key) is generated on first use and stored here.
 * - Everything Tom or a developer enters in Settings (AI key, Microsoft app, Teams, ntfy,
 *   WSCIP and Payroll Command Center logins, Fireflies) is stored here encrypted with that key.
 * - A value set in Vercel's environment always wins, so a developer can still pin anything.
 *
 * Reads are synchronous from an in-memory copy that loadConfig() refreshes every 30 seconds;
 * every request and the cron tick call loadConfig() first.
 */
import { randomBytes } from 'node:crypto'

export type ConfigKey =
  | 'anthropic_api_key' | 'openai_api_key'
  | 'ms_tenant_id' | 'ms_client_id' | 'ms_client_secret'
  | 'teams_webhook_url' | 'ntfy_url' | 'ntfy_token'
  | 'wscip_email' | 'wscip_password' | 'pcc_email' | 'pcc_password'
  | 'fireflies_api_key'

/** What Settings can edit, how it is labelled, and whether it is secret (never shown back). */
export const EDITABLE: Record<ConfigKey, { label: string; env: string; secret: boolean; group: string }> = {
  anthropic_api_key: { label: 'Anthropic (Claude) API key', env: 'ANTHROPIC_API_KEY', secret: true, group: 'ai' },
  openai_api_key: { label: 'OpenAI API key', env: 'OPENAI_API_KEY', secret: true, group: 'ai' },
  ms_tenant_id: { label: 'Directory (tenant) ID', env: 'MS_TENANT_ID', secret: false, group: 'microsoft' },
  ms_client_id: { label: 'Application (client) ID', env: 'MS_CLIENT_ID', secret: false, group: 'microsoft' },
  ms_client_secret: { label: 'Client secret value', env: 'MS_CLIENT_SECRET', secret: true, group: 'microsoft' },
  teams_webhook_url: { label: 'Teams webhook address', env: 'TEAMS_WEBHOOK_URL', secret: true, group: 'push' },
  ntfy_url: { label: 'ntfy topic address', env: 'NTFY_URL', secret: true, group: 'push' },
  ntfy_token: { label: 'ntfy access token (optional)', env: 'NTFY_TOKEN', secret: true, group: 'push' },
  wscip_email: { label: 'WSCIP read-only user email', env: 'WSCIP_EMAIL', secret: false, group: 'wscip' },
  wscip_password: { label: 'WSCIP read-only user password', env: 'WSCIP_PASSWORD', secret: true, group: 'wscip' },
  pcc_email: { label: 'Payroll Command Center viewer email', env: 'PCC_EMAIL', secret: false, group: 'pcc' },
  pcc_password: { label: 'Payroll Command Center viewer password', env: 'PCC_PASSWORD', secret: true, group: 'pcc' },
  fireflies_api_key: { label: 'Fireflies API key', env: 'FIREFLIES_API_KEY', secret: true, group: 'fireflies' },
}

let cache: { loadedAt: number; secret: string | null; values: Partial<Record<ConfigKey, string>> } = { loadedAt: 0, secret: null, values: {} }
const TTL = 30_000

/** The generated secret (or ENCRYPTION_KEY if a developer set one). */
export function appSecret(): string | null {
  const pinned = process.env.ENCRYPTION_KEY?.trim()
  return pinned && pinned.length >= 32 ? pinned : cache.secret
}

/** A stored setting, or undefined. Environment variables are checked by env.ts before this. */
export function stored(key: ConfigKey): string | undefined {
  return cache.values[key] || undefined
}

export function resetConfigCache() {
  cache = { loadedAt: 0, secret: null, values: {} }
}

export async function loadConfig(force = false): Promise<void> {
  if (!force && cache.secret && Date.now() - cache.loadedAt < TTL) return
  const { q } = await import('./db')
  const { decrypt } = await import('./crypto')
  // Generate the secret once; ON CONFLICT keeps the first one if two requests race.
  await q(`INSERT INTO app_config (key, value) VALUES ('app_secret', $1) ON CONFLICT (key) DO NOTHING`, [randomBytes(32).toString('base64url')])
  const rows = await q<{ key: string; value: string }>(`SELECT key, value FROM app_config`)
  const secret = rows.find((r) => r.key === 'app_secret')!.value
  cache = { loadedAt: Date.now(), secret, values: {} }
  for (const r of rows) {
    if (r.key === 'app_secret' || !(r.key in EDITABLE)) continue
    try {
      cache.values[r.key as ConfigKey] = decrypt(r.value)
    } catch {
      // Encrypted with a different key (ENCRYPTION_KEY changed): treat as not set.
    }
  }
}

export async function saveConfig(values: Partial<Record<ConfigKey, string | null>>) {
  const { q } = await import('./db')
  const { encrypt } = await import('./crypto')
  await loadConfig(true)
  for (const [key, value] of Object.entries(values) as [ConfigKey, string | null][]) {
    if (!(key in EDITABLE)) continue
    if (value === null || value.trim() === '') await q(`DELETE FROM app_config WHERE key = $1`, [key])
    else await q(`INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, now())
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, encrypt(value.trim())])
  }
  await loadConfig(true)
}

/** For Settings: which values are set and where from. Secret values are never returned. */
export function describeConfig() {
  return Object.fromEntries(Object.entries(EDITABLE).map(([key, meta]) => {
    const fromEnv = !!process.env[meta.env]?.trim()
    const value = fromEnv ? process.env[meta.env]!.trim() : stored(key as ConfigKey)
    return [key, { ...meta, set: !!value, source: fromEnv ? 'vercel' : value ? 'aimelia' : null, value: meta.secret ? null : value ?? null }]
  }))
}

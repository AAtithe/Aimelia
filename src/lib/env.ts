/**
 * Every setting in one place. Each one is read from Vercel's environment first, then from what
 * was saved in Aimelia's Settings (src/lib/config.ts). Nothing here has to be set by hand:
 * the database comes from the Neon integration and the app generates its own secret.
 */
import { stored, type ConfigKey } from './config'

const read = (name: string): string | undefined => {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : undefined
}
const setting = (envName: string, key: ConfigKey) => () => read(envName) ?? stored(key)

export const env = {
  /** Optional: Vercel Cron sends it as a bearer token when set. Without it the tick is throttled instead. */
  cronSecret: () => read('CRON_SECRET'),
  /** Optional: only Microsoft accounts on this domain may be used to create the first login. */
  ownerDomain: () => (read('OWNER_EMAIL_DOMAIN') ?? 'williamsstanley.co').toLowerCase(),
  appUrl: () => {
    const explicit = read('APP_URL')
    if (explicit) return explicit.replace(/\/$/, '')
    const vercel = read('VERCEL_PROJECT_PRODUCTION_URL')
    return vercel ? `https://${vercel}` : 'http://localhost:3000'
  },
  timezone: () => read('TIMEZONE') || 'Europe/London',
  // Microsoft 365
  msTenant: setting('MS_TENANT_ID', 'ms_tenant_id'),
  msClientId: setting('MS_CLIENT_ID', 'ms_client_id'),
  msClientSecret: setting('MS_CLIENT_SECRET', 'ms_client_secret'),
  // AI
  anthropicKey: setting('ANTHROPIC_API_KEY', 'anthropic_api_key'),
  openaiKey: setting('OPENAI_API_KEY', 'openai_api_key'),
  // Morning push
  teamsWebhook: setting('TEAMS_WEBHOOK_URL', 'teams_webhook_url'),
  ntfyUrl: setting('NTFY_URL', 'ntfy_url'),
  ntfyToken: setting('NTFY_TOKEN', 'ntfy_token'),
  // Meeting notes for the task import
  firefliesKey: setting('FIREFLIES_API_KEY', 'fireflies_api_key'),
  // Read-only lookups
  wscip: () => ({ base: read('WSCIP_BASE_URL') || 'https://operations.williamsstanley.co', email: read('WSCIP_EMAIL') ?? stored('wscip_email'),
    password: read('WSCIP_PASSWORD') ?? stored('wscip_password'), token: read('WSCIP_TOKEN') }),
  pcc: () => ({ base: read('PCC_BASE_URL') || 'https://payrollcc.vercel.app', email: read('PCC_EMAIL') ?? stored('pcc_email'),
    password: read('PCC_PASSWORD') ?? stored('pcc_password'), token: read('PCC_TOKEN') }),
}

export const redirectUri = () => `${env.appUrl()}/api/auth/callback`

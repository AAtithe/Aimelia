/**
 * Every setting in one place, read at call time (so tests can change them).
 * Secrets are set in the Vercel project, never in git. See docs/SETUP.md.
 */
const read = (name: string): string | undefined => {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : undefined
}

export const env = {
  accessKey: () => read('AIMELIA_ACCESS_KEY'),
  encryptionKey: () => read('ENCRYPTION_KEY'),
  ownerEmails: () => (read('AIMELIA_OWNER_EMAIL') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  cronSecret: () => read('CRON_SECRET'),
  appUrl: () => {
    const explicit = read('APP_URL')
    if (explicit) return explicit.replace(/\/$/, '')
    const vercel = read('VERCEL_PROJECT_PRODUCTION_URL')
    return vercel ? `https://${vercel}` : 'http://localhost:3000'
  },
  timezone: () => read('TIMEZONE') || 'Europe/London',
  // Microsoft 365
  msTenant: () => read('MS_TENANT_ID'),
  msClientId: () => read('MS_CLIENT_ID'),
  msClientSecret: () => read('MS_CLIENT_SECRET'),
  // AI
  anthropicKey: () => read('ANTHROPIC_API_KEY'),
  openaiKey: () => read('OPENAI_API_KEY'),
  // Morning push
  teamsWebhook: () => read('TEAMS_WEBHOOK_URL'),
  ntfyUrl: () => read('NTFY_URL'),
  ntfyToken: () => read('NTFY_TOKEN'),
  // Read-only lookups
  wscip: () => ({ base: read('WSCIP_BASE_URL') || 'https://operations.williamsstanley.co', email: read('WSCIP_EMAIL'),
    password: read('WSCIP_PASSWORD'), token: read('WSCIP_TOKEN') }),
  pcc: () => ({ base: read('PCC_BASE_URL') || 'https://payrollcc.vercel.app', email: read('PCC_EMAIL'),
    password: read('PCC_PASSWORD'), token: read('PCC_TOKEN') }),
}

export const redirectUri = () => `${env.appUrl()}/api/auth/callback`

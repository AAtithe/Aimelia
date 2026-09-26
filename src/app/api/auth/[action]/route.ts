/** Microsoft 365 connection status and disconnect. Never returns a token. */
import { route, fail } from '@/lib/http'
import { connection, disconnect } from '@/lib/microsoft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route<{ action: string }>(async (_req, p) => {
  if (p.action !== 'status') fail(404, 'Not found.')
  return connection()
})

export const POST = route<{ action: string }>(async (_req, p) => {
  if (p.action !== 'disconnect') fail(404, 'Not found.')
  await disconnect()
  return { connected: false }
})

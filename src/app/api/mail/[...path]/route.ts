import { dispatcher } from '@/lib/router'
import { mailEndpoints } from '@/lib/email/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // triage and brief preparation can take a while

const handler = dispatcher('/api/mail', mailEndpoints)
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }

import { dispatcher } from '@/lib/router'
import { chatEndpoints } from '@/lib/chat/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // a turn can make several model calls and lookups

const handler = dispatcher('/api/chat', chatEndpoints)
export { handler as GET, handler as POST, handler as DELETE }

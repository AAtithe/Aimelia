import { dispatcher } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // agent runs continue after the response via after()

const handler = dispatcher('/api/todo', todoEndpoints)
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }

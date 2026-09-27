import { dispatcher } from '@/lib/router'
import { accountEndpoints } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handler = dispatcher('/api/account', accountEndpoints)
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }

import { route } from '@/lib/http'

export const dynamic = 'force-dynamic'

/** Public: says the app is up and nothing more. */
export const GET = route(async () => ({ ok: true }), { public: true })

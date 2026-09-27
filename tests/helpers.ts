import { TEST_USER } from './setup'

export const KEY = { 'x-aimelia-key': TEST_USER.key }

type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>

/** Call a route handler directly, as Next.js would. */
export async function call(handler: Handler, opts: { method?: string; path?: string; body?: unknown; headers?: Record<string, string>; params?: Record<string, string> } = {}) {
  const req = new Request(`https://aimelia.example${opts.path || '/'}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? KEY) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const res = await handler(req, { params: Promise.resolve(opts.params || {}) })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

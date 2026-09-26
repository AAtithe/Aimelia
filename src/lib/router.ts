/**
 * A small path router behind one Next.js catch-all route, so every endpoint in a group shares
 * one access check and one error handler.
 */
import { after } from 'next/server'
import { HttpError, route } from './http'

type Params = Record<string, string>
export type Endpoint = [method: string, pattern: string, handler: (req: Request, params: Params) => Promise<unknown>]

export function dispatcher(prefix: string, endpoints: Endpoint[], opts: { public?: boolean } = {}) {
  const compiled = endpoints.map(([method, pattern, handler]) => {
    const names: string[] = []
    const re = new RegExp(`^${pattern.replace(/:[a-zA-Z_]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)' })}$`)
    return { method, re, names, handler }
  })
  return route<any>(async (req) => {
    const path = new URL(req.url).pathname.slice(prefix.length) || '/'
    let pathMatched = false
    for (const e of compiled) {
      const m = path.match(e.re)
      if (!m) continue
      pathMatched = true
      if (e.method !== req.method) continue
      const params = Object.fromEntries(e.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]))
      return e.handler(req, params)
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed.' : 'Not found.')
  }, opts)
}

let laterHook: ((fn: () => Promise<unknown>) => void) | null = null
/** Tests capture background work instead of letting it run after the response. */
export function setLaterHook(hook: typeof laterHook) {
  laterHook = hook
}

/** Run work after the response is sent (Vercel keeps the function alive for it). */
export function runLater(fn: () => Promise<unknown>) {
  if (laterHook) return laterHook(fn)
  try {
    after(() => fn().catch((e) => console.error('Background work failed', e)))
  } catch {
    // Outside a request (scripts): the next cron tick picks the work up.
  }
}

/**
 * Route handler plumbing: one wrapper that checks access, parses JSON bodies,
 * and turns thrown errors into JSON responses.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAccess } from './auth'
import { ConfigError } from './crypto'
import { GraphError } from './microsoft'
import { LLMError } from './llm'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message)
}

type Ctx<P> = { params: Promise<P> }
type Handler<P> = (req: Request, params: P) => Promise<unknown>

export function route<P = any>(fn: Handler<P>, opts: { public?: boolean } = {}) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      if (!opts.public) {
        const denied = await checkAccess(req)
        if (denied) return denied
      }
      const out = await fn(req, ctx?.params ? await ctx.params : ({} as P))
      if (out instanceof Response) return out
      if (out === undefined) return new NextResponse(null, { status: 204 })
      return NextResponse.json(out)
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ detail: e.message }, { status: e.status })
      if (e instanceof z.ZodError) {
        return NextResponse.json({ detail: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, { status: 422 })
      }
      if (e instanceof ConfigError) return NextResponse.json({ detail: e.message }, { status: 503 })
      if (e instanceof GraphError) return NextResponse.json({ detail: e.message }, { status: e.status })
      if (e instanceof LLMError) return NextResponse.json({ detail: e.message }, { status: 502 })
      console.error(e)
      return NextResponse.json({ detail: 'Something went wrong on the server.' }, { status: 500 })
    }
  }
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {}
  const text = await req.text()
  if (text) {
    try {
      raw = JSON.parse(text)
    } catch {
      fail(400, 'The request body is not valid JSON.')
    }
  }
  return schema.parse(raw)
}

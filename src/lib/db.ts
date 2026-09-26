/**
 * Postgres access. Production uses Neon over HTTP (the same driver as WSCIP and
 * Payroll Command Center); tests swap in PGlite, a real Postgres in-process.
 * The schema is applied on first use, idempotently, so a fresh database works
 * with no manual migration step.
 */
import { neon } from '@neondatabase/serverless'
import { SCHEMA } from './schema'

export type Row = Record<string, any>
type Executor = (text: string, params?: unknown[]) => Promise<Row[]>

let executor: Executor | null = null
let schemaReady: Promise<void> | null = null

/** Tests and scripts can supply their own executor (PGlite). */
export function setExecutor(exec: Executor | null) {
  executor = exec
  schemaReady = null
}

function exec(): Executor {
  if (executor) return executor
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new Error('DATABASE_URL is not set. Connect a Neon Postgres database to the Vercel project.')
  const sql = neon(url)
  executor = async (text, params = []) => (await sql.query(text, params as any[])) as Row[]
  return executor
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const run = exec()
    schemaReady = (async () => {
      for (const statement of SCHEMA) await run(statement)
    })().catch((e) => {
      schemaReady = null
      throw e
    })
  }
  return schemaReady
}

/** Run one parameterised statement ($1, $2 ...) and return its rows. */
export async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema()
  return (await exec()(text, params)) as T[]
}

export async function one<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params)
  return rows[0] ?? null
}

/** JSON parameter for a jsonb column. */
export const json = (value: unknown) => JSON.stringify(value ?? null)

/** Timestamps come back as Date (PGlite) or string (Neon); the API always speaks ISO strings. */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return isNaN(d.getTime()) ? String(value) : d.toISOString()
}

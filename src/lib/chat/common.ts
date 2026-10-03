/**
 * What every Ask Aimelia agent and tool shares: the tool shape, the context a tool runs in, and small helpers.
 * Kept apart from agent.ts so the calendar and travel tools can live in their own files.
 */
import { connection } from '../microsoft'

export type Args = Record<string, any>
/** One thing an agent did. by names the specialist that did it when Aimelia handed the work over. */
export type Step = { tool: string; args: Record<string, unknown>; ok: boolean; note: string; by?: string }
/** What a tool may need beyond its arguments: the turn's clock and change limits, and somewhere to put a specialist's steps. */
export type ToolCtx = { started: number; now: () => number; limit: (tool: string) => string | null; substeps: Step[] }
export type Tool = { about: string; args: string; available?: () => Promise<boolean> | boolean; run: (a: Args, ctx: ToolCtx) => Promise<unknown> }

export const clip = (t: unknown, n = 400) => { const s = String(t ?? ''); return s.length <= n ? s : `${s.slice(0, n)} ...` }

export const microsoftLive = async () => (await connection().catch(() => ({ connected: false }))).connected

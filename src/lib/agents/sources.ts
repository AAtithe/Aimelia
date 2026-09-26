/**
 * Read-only facts from WSCIP (Client Operations) and Payroll Command Center.
 *
 * Before the workers start, a lookup step shows the model a fixed catalogue of GET endpoints
 * (the same reads William and Nora use) and lets it pick up to MAX_CALLS. Only catalogue
 * entries run, only as GET, only with whitelisted parameters. Results are trimmed and given to
 * every agent as facts_from_ws_systems. Access is a dedicated read-only user in each app.
 */
import { env } from '../env'
import { completeJson, LLMError } from '../llm'
import { LOOKUP_PROMPT } from './defaults'
import type { Pipeline } from './orchestrator'

const MAX_CALLS = 4
const MAX_LIST = 25
const MAX_STR = 400
const MAX_CHARS = 6000

type Tool = [path: string, params: string[], answers: string]
export const CATALOGUE: Record<'wscip' | 'pcc', { label: string; tools: Record<string, Tool> }> = {
  wscip: {
    label: 'WSCIP (Client Operations)',
    tools: {
      compliance_position: ['/api/compliance', [], 'Compliance book: FC and MA status per client and month, what is late'],
      work_ahead: ['/api/planner', [], 'Compliance and tax deadlines coming up, with capacity'],
      client_book: ['/api/clients', ['order'], 'Ranked client book; order = margin|loss|revenue|late|name'],
      client_summary: ['/api/client-summary', ['key'], 'Summary of one client; key = the client key from client_book'],
      service_issues: ['/api/issues', [], 'Open service issues and escalations'],
      tax_work: ['/api/tax', [], 'Tax and statutory jobs, to-dos and deadlines'],
      tax_cases: ['/api/tax-cases', [], 'HMRC enquiries and tax cases'],
      vat_returns: ['/api/vat', ['client'], 'VAT returns; optional client filter'],
      recent_changes: ['/api/digest', [], 'What changed recently across the plan'],
    },
  },
  pcc: {
    label: 'Payroll Command Center',
    tools: {
      todays_work: ['/api/today', ['horizon', 'lead'], 'Payroll work due, runs by RAG status; horizon = days ahead 0-28'],
      pay_runs: ['/api/runs', ['client', 'from', 'to'], 'Pay runs in a window, plus any unpaid; filter by client or dates'],
      payroll_clients: ['/api/clients', [], 'Payroll schedules, open runs, next pay dates'],
      hmrc_payments: ['/api/hmrc', ['client', 'from', 'to'], 'HMRC payments due'],
      payroll_compliance: ['/api/compliance', ['months'], 'The seven payroll measures and their failures'],
      workload: ['/api/workload', [], 'Workload index per payroll lead'],
      tickets: ['/api/tickets', ['status', 'client', 'search'], 'Support tickets; status = open|closed|all'],
    },
  },
}
type Source = keyof typeof CATALOGUE

const cfg = (s: Source) => (s === 'wscip' ? env.wscip() : env.pcc())
const tokens = new Map<Source, string>()

export function configuredSources(): Record<Source, boolean> {
  const ok = (s: Source) => { const c = cfg(s); return !!(c.base && (c.token || (c.email && c.password))) }
  return { wscip: ok('wscip'), pcc: ok('pcc') }
}

async function token(s: Source, refresh = false): Promise<string> {
  const c = cfg(s)
  if (c.token) return c.token
  if (!refresh && tokens.has(s)) return tokens.get(s)!
  const r = await fetch(`${c.base.replace(/\/$/, '')}/api/auth?action=login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }),
  })
  if (!r.ok) throw new LLMError(`${CATALOGUE[s].label} sign-in failed: HTTP ${r.status}`)
  const t = String(((await r.json()) as any).token || '')
  tokens.set(s, t)
  return t
}

export function compact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '...'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_LIST).map((v) => compact(v, depth + 1))
    if (value.length > MAX_LIST) items.push(`... ${value.length - MAX_LIST} more not shown`)
    return items
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v, depth + 1)]))
  if (typeof value === 'string' && value.length > MAX_STR) return `${value.slice(0, MAX_STR)} ...`
  return value
}

/** Run one catalogue entry as a GET. Anything outside the catalogue is refused. */
export async function lookup(source: string, tool: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const s = source as Source
  const entry = CATALOGUE[s]?.tools[tool]
  if (!entry) throw new LLMError(`Unknown lookup ${source}.${tool}`)
  const [path, allowed] = entry
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (allowed.includes(k) && v !== null && v !== undefined && v !== '') qs.set(k, String(v))
  const url = `${cfg(s).base.replace(/\/$/, '')}${path}${qs.size ? `?${qs}` : ''}`
  let r = await fetch(url, { headers: { Authorization: `Bearer ${await token(s)}` } })
  if (r.status === 401 && !cfg(s).token) r = await fetch(url, { headers: { Authorization: `Bearer ${await token(s, true)}` } })
  if (!r.ok) throw new LLMError(`${CATALOGUE[s].label} ${tool}: HTTP ${r.status}`)
  const text = JSON.stringify(compact(await r.json()))
  return text.length <= MAX_CHARS ? JSON.parse(text) : `${text.slice(0, MAX_CHARS)} ... (trimmed)`
}

/** Pick and run lookups for a task. Null when nothing is connected or nothing applies. */
export async function gatherFacts(task: { id: string; title: string; notes: string } | Record<string, any>, pipeline: Pipeline) {
  const { logEvent } = await import('./orchestrator')
  const live = (Object.entries(configuredSources()) as [Source, boolean][]).filter(([, ok]) => ok).map(([s]) => s)
  if (!live.length || pipeline.use_ws_systems === false) return null
  const catalogue = Object.fromEntries(live.map((s) => [s, {
    system: CATALOGUE[s].label,
    tools: Object.fromEntries(Object.entries(CATALOGUE[s].tools).map(([n, [, p, d]]) => [n, { answers: d, params: p }])),
  }]))
  let plan: any
  try {
    plan = await completeJson({ provider: 'auto', role: 'lookup', temperature: 0, system: LOOKUP_PROMPT(MAX_CALLS),
      payload: { task: { title: task.title, notes: task.notes || '' }, catalogue } })
  } catch (e) {
    await logEvent(task.id, 'lookup', 'lookup', { error: String((e as Error).message).slice(0, 500) })
    return null
  }
  const facts: Record<string, unknown> = {}
  const made: unknown[] = []
  for (const c of (Array.isArray(plan.calls) ? plan.calls : []).slice(0, MAX_CALLS)) {
    if (!c || !live.includes(c.source)) continue
    const key = `${c.source}.${c.tool}`
    try {
      facts[key] = await lookup(c.source, String(c.tool), c.params && typeof c.params === 'object' ? c.params : {})
      made.push({ call: key, params: c.params || {}, why: c.why || '' })
    } catch (e) {
      facts[key] = `unavailable: ${(e as Error).message}`
      made.push({ call: key, error: String((e as Error).message).slice(0, 300) })
    }
  }
  if (made.length) await logEvent(task.id, 'lookup', 'lookup', { calls: made })
  return Object.keys(facts).length ? facts : null
}

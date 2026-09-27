/**
 * One way to call a model, whichever provider an agent uses.
 *
 * - "auto" picks Anthropic when ANTHROPIC_API_KEY is set, then OpenAI, then the mock.
 * - Temperature is not sent to Claude: models after Opus 4.6 reject it. It applies to OpenAI only.
 * - A PDF is sent to Claude as a document block, so Claude reads the pages itself (text, tables and scans).
 * - The mock gives deterministic answers so the whole app runs with no keys (demos, tests).
 * - Tests replace the transport with setModelTransport().
 */
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { env } from './env'
import { actionLines } from './agents/importText'

export type Provider = 'auto' | 'anthropic' | 'openai' | 'mock'
export const DEFAULT_MODELS: Record<Exclude<Provider, 'auto'>, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
  mock: 'mock',
}

export class LLMError extends Error {}

export type Message = { role: 'user' | 'assistant'; content: string }
export type ModelCall = {
  provider: Provider
  model?: string | null
  system: string
  messages: Message[]
  temperature?: number | null
  maxTokens?: number
  json?: boolean
  role: string // what the call is for: worker, reviewer, capture, lookup, triage, draft, brief ...
  payload?: unknown // structured input, for the mock and for tests
  pdf?: string // a base64 PDF, sent to Claude as a document block ahead of the first message; Claude only
}
export type Transport = (call: ModelCall & { provider: Exclude<Provider, 'auto'>; model: string }) => Promise<string>

export function availableProviders() {
  return { anthropic: !!env.anthropicKey(), openai: !!env.openaiKey(), mock: true }
}

export function resolveProvider(p?: string | null): Exclude<Provider, 'auto'> {
  const provider = (p || 'auto').toLowerCase()
  if (provider === 'anthropic' || provider === 'openai' || provider === 'mock') return provider
  if (env.anthropicKey()) return 'anthropic'
  if (env.openaiKey()) return 'openai'
  return 'mock'
}

export function resolveModel(provider: Exclude<Provider, 'auto'>, model?: string | null) {
  return model && model.trim() ? model.trim() : DEFAULT_MODELS[provider]
}

/** First JSON object in a reply, tolerating code fences and preamble. */
export function parseJson(text: string): any {
  let t = (text || '').trim()
  const fenced = t.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
  if (fenced) t = fenced[1]
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
  }
  throw new LLMError(`The model did not return valid JSON: ${t.slice(0, 200)}`)
}

const realTransport: Transport = async (call) => {
  if (call.provider === 'mock') return mockReply(call)
  if (call.provider === 'anthropic') {
    const key = env.anthropicKey()
    if (!key) throw new LLMError('ANTHROPIC_API_KEY is not set.')
    const client = new Anthropic({ apiKey: key })
    const messages: Anthropic.MessageParam[] = call.messages.map((m, i) => i === 0 && call.pdf
      ? { role: m.role, content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: call.pdf } }, { type: 'text', text: m.content }] }
      : m)
    const res = await client.messages.create({
      model: call.model,
      max_tokens: call.maxTokens ?? 4096,
      system: call.system,
      messages,
    })
    if (res.stop_reason === 'refusal') throw new LLMError('Claude declined to read this.')
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  }
  if (call.pdf) throw new LLMError('Reading PDFs needs the Claude (Anthropic) API key.')
  const key = env.openaiKey()
  if (!key) throw new LLMError('OPENAI_API_KEY is not set.')
  const client = new OpenAI({ apiKey: key })
  const base = {
    model: call.model,
    messages: [{ role: 'system' as const, content: call.system }, ...call.messages],
    ...(call.json ? { response_format: { type: 'json_object' as const } } : {}),
    ...(call.maxTokens ? { max_completion_tokens: call.maxTokens } : {}),
  }
  try {
    const res = await client.chat.completions.create({ ...base, ...(call.temperature != null ? { temperature: call.temperature } : {}) })
    return res.choices[0]?.message?.content || ''
  } catch (e) {
    // Some OpenAI models reject sampling settings; retry once without them.
    if (call.temperature != null && e instanceof OpenAI.BadRequestError && /temperature/i.test(e.message)) {
      const res = await client.chat.completions.create(base)
      return res.choices[0]?.message?.content || ''
    }
    throw e
  }
}

let transport: Transport = realTransport
export function setModelTransport(t: Transport | null) {
  transport = t || realTransport
}

export async function complete(call: ModelCall): Promise<string> {
  const provider = resolveProvider(call.provider)
  const model = resolveModel(provider, call.model)
  try {
    return await transport({ ...call, provider, model })
  } catch (e) {
    if (e instanceof LLMError) throw e
    throw new LLMError(`${provider} ${model}: ${(e as Error).message}`)
  }
}

export async function completeJson(call: Omit<ModelCall, 'json' | 'messages'> & { messages?: Message[] }): Promise<any> {
  const messages = call.messages ?? [{ role: 'user' as const, content: JSON.stringify(call.payload ?? {}, null, 2) }]
  return parseJson(await complete({ ...call, messages, json: true }))
}

// ---------------------------------------------------------------- mock

function mockReply(call: ModelCall): string {
  const p: any = call.payload || {}
  const task = p.task || {}
  const out = (v: unknown) => JSON.stringify(v)
  switch (call.role) {
    case 'reviewer':
      return out({ verdict: 'approve', score: 8, feedback: 'Placeholder reviewer: no AI key is set, so this was not genuinely reviewed.', action_feedback: [], questions: [] })
    case 'lookup':
      return out({ calls: [] })
    case 'capture': {
      const lines = String(p.brain_dump || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean)
      return out({ tasks: lines.map((title) => ({ title, notes: '', priority: 2, due_date: null })) })
    }
    case 'import':
      return out({ tasks: actionLines(String(p.text || '')).map((title) => ({ title, notes: '', owner: null, priority: 2, due_date: null })) })
    case 'triage':
      return out({ category: 'General', urgency: 3, confidence: 0, reasoning: 'Placeholder: no AI key is set.', action_required: 'Read and decide.' })
    case 'worker':
      if (p.can_ask_questions && !task.notes && !(p.answered_questions || []).length) {
        return out({ summary: 'Need more context before starting.', actions: null,
          questions: [{ question: `What does a good outcome look like for '${task.title}'?`, why: 'The task has no brief, so the goal and constraints are unclear.' }] })
      }
      if ((p.draft_actions || []).length) return out({ summary: 'Placeholder agent kept the existing draft.', actions: null, questions: [] })
      return out({ summary: `Placeholder plan for: ${task.title}`, questions: [],
        actions: [{ kind: 'checklist', title: `Plan for ${task.title}`, content: '1. Confirm the objective\n2. Gather the numbers\n3. Decide and communicate', details: {} }] })
    default:
      return call.json ? out({}) : 'Placeholder text: no AI key is set on the server, so nothing was generated.'
  }
}

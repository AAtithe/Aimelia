/**
 * One way to call a model, whichever provider an agent uses.
 *
 * - "auto" picks Anthropic when ANTHROPIC_API_KEY is set, then OpenAI, then the mock.
 * - Temperature is not sent to Claude: models after Opus 4.6 reject it. It applies to OpenAI only.
 * - A PDF is sent to Claude as a document block, so Claude reads the pages itself (text, tables and scans).
 * - A message can carry files (photos and PDFs). Claude reads both; OpenAI reads photos only.
 * - effort sets how hard Claude thinks (the current models always think; there is no budget to set).
 * - fallback: if Claude declines, the API re-runs the request on another model in the same call.
 * - webSearch: Claude searches the web itself (a server-side tool) and the answer comes back with its sources.
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

export type Attachment = { kind: 'image' | 'pdf'; media_type: string; data: string; name: string } // data is base64
export type Message = { role: 'user' | 'assistant'; content: string; files?: Attachment[] }
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
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' // Claude only
  fallback?: boolean // Claude only: server-side fallback if the model declines
  webSearch?: number // Claude only: allow up to this many web searches; the reply ends with its sources
  retries?: number // with timeoutMs: how many times the SDK may retry (429, 5xx); default none
  timeoutMs?: number // give up after this long (per attempt; no retries unless retries is set); for work inside a time-limited request
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
    const messages: Anthropic.MessageParam[] = call.messages.map((m, i) => {
      const files = [...(i === 0 && call.pdf ? [{ kind: 'pdf' as const, media_type: 'application/pdf', data: call.pdf, name: '' }] : []), ...(m.files || [])]
      if (!files.length) return { role: m.role, content: m.content }
      return { role: m.role, content: [...files.map((f): Anthropic.ContentBlockParam => f.kind === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
        : { type: 'image', source: { type: 'base64', media_type: f.media_type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: f.data } }),
      { type: 'text', text: m.content }] }
    })
    const params = {
      model: call.model, max_tokens: call.maxTokens ?? 4096, system: call.system, messages,
      ...(call.effort ? { output_config: { effort: call.effort } } : {}),
      ...(call.webSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: call.webSearch }] } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming
    const opts = call.timeoutMs ? { timeout: call.timeoutMs, maxRetries: call.retries ?? 0 } : undefined
    // Long reads stream, so a big reply is not held to the SDK's non-streaming limits.
    const stream = !!call.pdf || (call.maxTokens ?? 0) > 8000
    const send = async (p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
      if (call.fallback) {
        const withFallback = { ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any
        try {
          return (stream ? await client.beta.messages.stream(withFallback, opts).finalMessage() : await client.beta.messages.create(withFallback, opts)) as unknown as Anthropic.Message
        } catch (e) {
          // Where fallbacks are not offered (another platform, an older account), run the request as it is.
          if (!(e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message))) throw e
        }
      }
      return stream ? client.messages.stream(p, opts).finalMessage() : client.messages.create(p, opts)
    }
    let res = await send(params)
    const content: Anthropic.ContentBlock[] = [...res.content]
    // A long web search can pause part way; send it back to carry on, a few times at most.
    for (let i = 0; res.stop_reason === 'pause_turn' && i < 4; i++) {
      res = await send({ ...params, messages: [...messages, { role: 'assistant', content: res.content }] })
      content.push(...res.content)
    }
    if (res.stop_reason === 'refusal') throw new LLMError('Claude declined to read this.')
    const text = content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    if (!call.webSearch) return text
    const sources = new Map<string, string>()
    for (const b of content) {
      if (b.type !== 'text') continue
      for (const c of (b.citations || []) as any[]) if (c.type === 'web_search_result_location' && c.url) sources.set(c.url, c.title || c.url)
    }
    return sources.size ? `${text.trim()}\n\nSources:\n${[...sources].map(([url, title]) => `- ${title}: ${url}`).join('\n')}` : text
  }
  if (call.webSearch) throw new LLMError('Searching the web needs the Claude (Anthropic) API key.')
  if (call.pdf || call.messages.some((m) => m.files?.some((f) => f.kind === 'pdf'))) throw new LLMError('Reading PDFs needs the Claude (Anthropic) API key.')
  const key = env.openaiKey()
  if (!key) throw new LLMError('OPENAI_API_KEY is not set.')
  const client = new OpenAI({ apiKey: key })
  const base = {
    model: call.model,
    messages: [{ role: 'system' as const, content: call.system }, ...call.messages.map((m): OpenAI.ChatCompletionMessageParam => m.role === 'user' && m.files?.length
      ? { role: 'user', content: [...m.files.map((f) => ({ type: 'image_url' as const, image_url: { url: `data:${f.media_type};base64,${f.data}` } })), { type: 'text' as const, text: m.content }] }
      : { role: m.role, content: m.content })],
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

/** Whether a call would reach a model that can judge meaning: a key is set, or a test has put in its own transport. */
export function canJudge() {
  return resolveProvider('auto') !== 'mock' || transport !== realTransport
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
    case 'web':
      return 'Placeholder: no AI key is set, so nothing was searched.'
    case 'chat': {
      const got = (p.files || []).length ? ` I received ${p.files.join(', ')}, but cannot read it without a key.` : ''
      return out({ reply: `Placeholder reply: no AI key is set on the server, so I cannot read or answer yet.${got} Add the Claude (Anthropic) key in Settings.` })
    }
    case 'one_to_one': {
      const lines = [...(p.focus_points || []).map((t: string) => `- ${t}`), ...(p.open_tasks || []).map((t: any) => `- ${t.title} (${t.status})`)]
      return `Placeholder prep: no AI key is set, so this is the list as it stands.\n${p.person?.name || ''}, ${p.person?.area || ''}\n${lines.join('\n') || 'Nothing on the list yet.'}`
    }
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

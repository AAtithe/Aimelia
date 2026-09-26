/**
 * Email triage: fast keyword rules first, then the model for anything the rules do not catch.
 * Same categories and keywords as the original, fixed to match whole words (the old substring
 * match filed "clinic" under Tax because it contains "nic", and "private" because of "vat").
 */
import { completeJson } from '../llm'
import { buildMessages } from './context'

export const CATEGORIES = ['Urgent', 'Important', 'Payroll', 'Tax', 'Scheduling', 'General', 'Automated', 'Spam'] as const

const RULES: [category: string, field: 'subject' | 'sender', words: string[]][] = [
  ['Payroll', 'subject', ['payslip', 'payslips', 'timesheet', 'timesheets', 'payroll']],
  ['Tax', 'subject', ['vat', 'paye', 'nic', 'nics', 'hmrc']],
  ['Scheduling', 'subject', ['meeting', 'calendar']],
  ['Urgent', 'subject', ['urgent', 'asap', 'immediately']],
  ['Automated', 'sender', ['noreply', 'no-reply', 'automated', 'donotreply', 'do-not-reply']],
]

const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[-]/g, '\\-')}([^a-z0-9]|$)`, 'i').test(text)

export type Triage = { category: string; urgency: number; confidence: number; method: 'rules' | 'ai' | 'fallback'; reasoning: string; action_required?: string | null }

export function quickRules(subject: string, sender: string): Triage | null {
  for (const [category, field, words] of RULES) {
    const text = field === 'subject' ? subject : sender
    if (words.some((w) => hasWord(text || '', w))) {
      // Urgent mail is urgency 4; everything else a rule catches is 3, as before.
      return { category, urgency: category === 'Urgent' ? 4 : 3, confidence: 0.9, method: 'rules', reasoning: 'Matched rule-based patterns' }
    }
  }
  return null
}

const CLASSIFY = `Classify the email for Tom.
Categories: Urgent (needs immediate attention: deadlines, emergencies), Important (business critical, not urgent), Payroll (salary, timesheets, payment), Tax (VAT, PAYE, HMRC), Scheduling (meetings, calendar, appointments), General (other business), Spam (unwanted or promotional).
Assess urgency 1-5, 5 most urgent.
Respond with a single JSON object and nothing else:
{"category": "...", "urgency": 1-5, "confidence": 0-1, "reasoning": "brief explanation", "action_required": "what should be done"}`

export async function triageEmail(subject: string, sender: string, body: string): Promise<Triage> {
  const ruled = quickRules(subject, sender)
  if (ruled) return ruled
  try {
    const built = await buildMessages('triage', { subject, sender, body_preview: body.slice(0, 500) }, `${sender} ${subject}`)
    const r = await completeJson({ provider: 'auto', role: 'triage', system: `${built.system}\n\n${CLASSIFY}`, messages: built.messages, maxTokens: 300, temperature: 0.3,
      payload: { subject, sender, body } })
    const category = CATEGORIES.includes(r.category) ? r.category : 'General'
    const urgency = Math.min(Math.max(Math.round(Number(r.urgency) || 3), 1), 5)
    return { category, urgency, confidence: Math.min(Math.max(Number(r.confidence) || 0, 0), 1), method: 'ai',
      reasoning: String(r.reasoning || ''), action_required: r.action_required ? String(r.action_required) : null }
  } catch (e) {
    return { category: 'General', urgency: 3, confidence: 0, method: 'fallback', reasoning: `Classification failed: ${(e as Error).message}` }
  }
}

export function urgencyLevel(u: number) {
  return u >= 5 ? 'Critical' : u >= 4 ? 'High' : u >= 3 ? 'Medium' : u >= 2 ? 'Low' : 'Very Low'
}

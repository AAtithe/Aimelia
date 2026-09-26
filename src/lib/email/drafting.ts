/**
 * Smart drafting: replies in Tom's voice, created as threaded reply drafts in Outlook.
 * Never sent (Mail.Send is not even requested). The draft carries an Outlook category,
 * "Drafted by Aimelia", instead of a line in the body that could be sent by mistake.
 */
import { graph } from '../microsoft'
import { complete } from '../llm'
import { buildMessages, withInstruction } from './context'

export const REPLY_INSTRUCTION = `You are drafting an email reply as Tom Stanley from Williams, Stanley & Co.

Requirements:
- Use UK English spelling and terminology
- Be decisive and professional but friendly
- Keep response between 120-180 words
- Address the sender's specific points
- Include clear next steps or actions
- Use hospitality industry expertise when relevant
- Be concise but comprehensive
- Sign off "Best regards,\\nTom"
- No emojis and no em dashes

Format as a professional email reply (no headers, just body content).`

// Whole words only; the original substring scan flagged "feedback" for "fee" and "accountants" for "account".
export const SENSITIVE = ['bank', 'banking', 'account', 'payment', 'money', 'cost', 'price', 'fee', 'fees', 'salary', 'wage', 'wages', 'payroll',
  'vat', 'tax', 'hmrc', 'revenue', 'contract', 'agreement', 'legal', 'terms', 'conditions', 'confidential', 'private', 'sensitive', 'personal']

export function sensitiveTopics(text: string): string[] {
  const lower = (text || '').toLowerCase()
  return SENSITIVE.filter((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(lower))
}

export const wordCount = (t: string) => (t || '').split(/\s+/).filter(Boolean).length

export const GUIDELINES = {
  tone: 'Tom Stanley - decisive, professional, hospitality-savvy', language: 'UK English spelling and terminology', length: '120-180 words',
  format: 'Professional email reply', marker: 'Outlook category "Drafted by Aimelia" (not text in the email)', safety: 'Never auto-send, always create drafts',
  flagging: 'Flag sensitive topics (banking, money, legal)', sensitive_words: SENSITIVE,
  examples: { uk_spelling: 'organisation, colour, centre', hospitality_terms: 'tronc, service charge, hospitality group' },
}

export async function generateReply(meta: { subject: string; sender: string; sender_name?: string; thread_summary?: string; original_body?: string }) {
  const built = await buildMessages('reply', { ...meta, original_body: (meta.original_body || '').slice(0, 1500), task: 'email_reply' },
    `${meta.sender} ${meta.subject} ${meta.thread_summary || ''} email reply`)
  const { system, messages } = withInstruction(built, REPLY_INSTRUCTION)
  const text = (await complete({ provider: 'auto', role: 'draft', system, messages, maxTokens: 600, temperature: 0.3, payload: meta })).trim()
  return { text, word_count: wordCount(text), sensitive_topics: sensitiveTopics(text), meets_requirements: wordCount(text) >= 120 && wordCount(text) <= 180 }
}

/** A reply draft in the original thread, with the text above the quoted message. */
export async function createReplyDraft(messageId: string, text: string) {
  const draft = await graph<{ id: string; webLink?: string; subject?: string }>('POST', `/me/messages/${encodeURIComponent(messageId)}/createReply`, { body: { comment: text } })
  await graph('PATCH', `/me/messages/${encodeURIComponent(draft.id)}`, { body: { categories: ['Drafted by Aimelia'] } })
  return { id: draft.id, link: draft.webLink || null, subject: draft.subject || null }
}

/** A new draft (not a reply). */
export async function createDraft(to: string, subject: string, text: string) {
  const recipients = to.split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } }))
  const draft = await graph<{ id: string; webLink?: string }>('POST', '/me/messages', { body: { subject, body: { contentType: 'Text', content: text }, toRecipients: recipients, categories: ['Drafted by Aimelia'] } })
  return { id: draft.id, link: draft.webLink || null }
}

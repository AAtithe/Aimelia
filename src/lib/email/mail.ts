/**
 * Reading mail through Microsoft Graph, storing triage results, and thread summaries.
 * Only the fields needed are requested ($select), never whole bodies for the list.
 */
import { graph } from '../microsoft'
import { complete } from '../llm'
import { iso, one, q, type Row } from '../db'
import { index } from './knowledge'
import { triageEmail } from './triage'

const LIST_FIELDS = 'id,subject,from,receivedDateTime,bodyPreview,conversationId,isRead'

export type GraphMessage = { id: string; subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; receivedDateTime?: string
  bodyPreview?: string; conversationId?: string; isRead?: boolean; body?: { content?: string; contentType?: string }; ccRecipients?: any[] }

export const addressOf = (m: GraphMessage) => m.from?.emailAddress?.address || ''

/** Fetch the latest messages, triage any not seen before, store all. */
export async function runTriage(top = 25) {
  const res = await graph<{ value: GraphMessage[] }>('GET', '/me/mailFolders/inbox/messages', { query: { $top: top, $orderby: 'receivedDateTime desc', $select: LIST_FIELDS } })
  const messages = res.value || []
  let fresh = 0
  for (const m of messages) {
    const known = await one(`SELECT graph_id FROM emails WHERE graph_id = $1`, [m.id])
    if (known) {
      await q(`UPDATE emails SET is_read = $2 WHERE graph_id = $1`, [m.id, !!m.isRead])
      continue
    }
    const t = await triageEmail(m.subject || '', addressOf(m), m.bodyPreview || '')
    await q(`INSERT INTO emails (graph_id, conversation_id, from_email, from_name, subject, preview, received_at, is_read, category, urgency, confidence, method, reasoning, action_required)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (graph_id) DO NOTHING`,
      [m.id, m.conversationId || null, addressOf(m), m.from?.emailAddress?.name || '', m.subject || '', m.bodyPreview || '', m.receivedDateTime || null,
        !!m.isRead, t.category, t.urgency, t.confidence, t.method, t.reasoning, t.action_required ?? null])
    await index('email', m.id, `Email: ${m.subject || '(no subject)'}`, `From ${addressOf(m)}. ${m.bodyPreview || ''}`)
    fresh++
  }
  return { fetched: messages.length, triaged: fresh, ids: messages.map((m) => m.id) }
}

export function emailOut(e: Row) {
  return { id: e.graph_id, subject: e.subject, from: e.from_email, from_name: e.from_name, received: iso(e.received_at), preview: e.preview, is_read: e.is_read,
    triage: { category: e.category, urgency: e.urgency, confidence: e.confidence, method: e.method, reasoning: e.reasoning, action_required: e.action_required },
    summary: e.summary, suggested_reply: e.suggested_reply, draft_id: e.draft_id, draft_link: e.draft_link }
}

export function summaryOf(rows: Row[]) {
  return { urgent: rows.filter((e) => e.urgency >= 4).length, important: rows.filter((e) => e.urgency === 3).length, low_priority: rows.filter((e) => e.urgency <= 2).length }
}

export async function getMessage(id: string) {
  return graph<GraphMessage>('GET', `/me/messages/${encodeURIComponent(id)}`, { query: { $select: `${LIST_FIELDS},body,ccRecipients` }, headers: { Prefer: 'outlook.body-content-type="text"' } })
}

/** Thread summary. The original called /messages/{id}/thread, which Graph does not have; the conversation id is the real key. */
export async function summariseThread(conversationId: string): Promise<{ message_count: number; summary: string }> {
  const res = await graph<{ value: GraphMessage[] }>('GET', '/me/messages', {
    query: { $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`, $select: 'subject,from,receivedDateTime,bodyPreview', $top: 25 } })
  const msgs = (res.value || []).sort((a, b) => String(a.receivedDateTime).localeCompare(String(b.receivedDateTime))).slice(-10)
  if (!msgs.length) return { message_count: 0, summary: 'No messages found in this thread.' }
  const thread = msgs.map((m) => `From: ${addressOf(m)}\nSubject: ${m.subject}\nDate: ${m.receivedDateTime}\nBody: ${(m.bodyPreview || '').slice(0, 300)}...`).join('\n\n')
  const summary = await complete({ provider: 'auto', role: 'summary', maxTokens: 400, temperature: 0.3,
    system: 'You summarise email threads for Tom Stanley, CEO of a UK hospitality accountancy firm. UK English, no emojis, no em dashes.',
    messages: [{ role: 'user', content: `Summarize this email thread:\n\n${thread}\n\nProvide a concise summary including:\n- Main topic/subject\n- Key points discussed\n- Decisions made\n- Action items or next steps\n- Current status\n\nKeep it under 200 words.` }] })
  return { message_count: msgs.length, summary: summary.trim() }
}

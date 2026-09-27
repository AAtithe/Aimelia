/**
 * Ask Aimelia API, mounted at /api/chat. Same access rules as everything else.
 */
import { z } from 'zod'
import { iso, json, one, q, type Row } from '../db'
import { body, fail } from '../http'
import type { Endpoint } from '../router'
import { availableTools, converse, TOOLS } from './agent'

const Send = z.object({ message: z.string().trim().min(1).max(8000), chat_id: z.string().uuid().nullable().optional() })

const chatOut = (c: Row) => ({ id: c.id, title: c.title, created_at: iso(c.created_at), updated_at: iso(c.updated_at) })
const messageOut = (m: Row) => ({ id: m.id, role: m.role, content: m.content, steps: m.steps || [], created_at: iso(m.created_at) })

async function getChat(id: string) {
  return (await one(`SELECT * FROM chats WHERE id::text = $1`, [id])) || fail(404, 'Conversation not found.')
}

export const chatEndpoints: Endpoint[] = [
  ['GET', '/chats', async () => {
    const tools = await availableTools()
    return { chats: (await q(`SELECT * FROM chats ORDER BY updated_at DESC LIMIT 50`)).map(chatOut), tools: tools.map((name) => ({ name, does: TOOLS[name].about })) }
  }],
  ['GET', '/chats/:id', async (_r, p) => {
    const c = await getChat(p.id)
    return { chat: chatOut(c!), messages: (await q(`SELECT * FROM chat_messages WHERE chat_id = $1 ORDER BY created_at`, [c!.id])).map(messageOut) }
  }],
  ['POST', '/chats', async (req) => {
    const b = await body(req, Send)
    const c = b.chat_id ? await getChat(b.chat_id)
      : (await one(`INSERT INTO chats (title) VALUES ($1) RETURNING *`, [b.message.replace(/\s+/g, ' ').slice(0, 80)]))!
    // Tom's message is kept even if the model then fails, so nothing he typed is lost.
    const mine = (await one(`INSERT INTO chat_messages (chat_id, role, content) VALUES ($1, 'user', $2) RETURNING *`, [c!.id, b.message]))!
    await q(`UPDATE chats SET updated_at = now() WHERE id = $1`, [c!.id])
    const rows = await q(`SELECT role, content FROM chat_messages WHERE chat_id = $1 ORDER BY created_at`, [c!.id])
    const { reply, steps } = await converse(rows as { role: string; content: string }[])
    const theirs = (await one(`INSERT INTO chat_messages (chat_id, role, content, steps) VALUES ($1, 'assistant', $2, $3) RETURNING *`, [c!.id, reply, json(steps)]))!
    const updated = (await one(`UPDATE chats SET updated_at = now() WHERE id = $1 RETURNING *`, [c!.id]))!
    return Response.json({ chat: chatOut(updated), messages: [messageOut(mine), messageOut(theirs)] }, { status: b.chat_id ? 200 : 201 })
  }],
  ['DELETE', '/chats/:id', async (_r, p) => {
    const r = await q(`DELETE FROM chats WHERE id::text = $1 RETURNING id`, [p.id])
    if (!r.length) fail(404, 'Conversation not found.')
  }],
]

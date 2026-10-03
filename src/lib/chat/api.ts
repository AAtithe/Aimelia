/**
 * Ask Aimelia API, mounted at /api/chat. Same access rules as everything else.
 */
import { z } from 'zod'
import { iso, json, one, q, type Row } from '../db'
import { body, fail } from '../http'
import type { Endpoint } from '../router'
import { AGENTS, availableTools, chatModel, converse, TOOLS, type AgentId, type Turn } from './agent'
import { listTrips } from './travel'
import { ACCEPT, MAX_BASE64, MAX_FILES, readChatFile } from './files'
import { keepNote } from '../memory/store'

const FileIn = z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(1) })
const Send = z.object({ message: z.string().trim().max(8000).default(''), chat_id: z.string().uuid().nullable().optional(),
  agent: z.enum(['aimelia', 'calendar', 'travel']).default('aimelia'), // who a new conversation is with; an existing one keeps its own
  files: z.array(FileIn).max(MAX_FILES, `send up to ${MAX_FILES} files at a time`).default([]) })
  .refine((b) => b.message || b.files.length, 'type a message or attach a file')
  .refine((b) => b.files.reduce((n, f) => n + f.data.length, 0) <= MAX_BASE64, 'those files are too big together: keep them under 3 MB')

const chatOut = (c: Row) => ({ id: c.id, title: c.title, agent: (c.agent || 'aimelia') as AgentId, created_at: iso(c.created_at), updated_at: iso(c.updated_at) })
const fileOut = (f: Row) => ({ id: f.id, name: f.name, kind: f.kind, media_type: f.media_type, size: f.size })
const messageOut = (m: Row, files: Row[] = []) => ({ id: m.id, role: m.role, content: m.content, steps: m.steps || [], created_at: iso(m.created_at),
  files: files.filter((f) => f.message_id === m.id).map(fileOut) })

async function getChat(id: string) {
  return (await one(`SELECT * FROM chats WHERE id::text = $1`, [id])) || fail(404, 'Conversation not found.')
}

export const chatEndpoints: Endpoint[] = [
  ['GET', '/chats', async () => {
    const agents = await Promise.all((Object.keys(AGENTS) as AgentId[]).map(async (id) => ({ id, label: AGENTS[id].label, intro: AGENTS[id].intro,
      tools: (await availableTools(id)).map((name) => ({ name, does: TOOLS[name].about })) })))
    return { chats: (await q(`SELECT * FROM chats ORDER BY updated_at DESC LIMIT 50`)).map(chatOut), agents, tools: agents[0].tools, accept: ACCEPT, model: chatModel() }
  }],
  ['GET', '/chats/:id', async (_r, p) => {
    const c = await getChat(p.id)
    const [messages, files] = await Promise.all([
      q(`SELECT * FROM chat_messages WHERE chat_id = $1 ORDER BY created_at`, [c!.id]),
      q(`SELECT f.id, f.message_id, f.name, f.kind, f.media_type, f.size FROM chat_files f JOIN chat_messages m ON m.id = f.message_id WHERE m.chat_id = $1 ORDER BY f.created_at`, [c!.id]),
    ])
    return { chat: chatOut(c!), messages: messages.map((m) => messageOut(m, files)) }
  }],
  ['POST', '/chats', async (req) => {
    const b = await body(req, Send)
    const read = b.files.map((f) => readChatFile(f.name, f.data)) // every file is checked before anything is stored
    const title = (b.message || `Sent ${read.map((f) => f.name).join(', ')}`).replace(/\s+/g, ' ').slice(0, 80)
    const c = b.chat_id ? await getChat(b.chat_id) : (await one(`INSERT INTO chats (title, agent) VALUES ($1, $2) RETURNING *`, [title, b.agent]))!
    // Tom's message and files are kept even if the model then fails, so nothing he sent is lost.
    const mine = (await one(`INSERT INTO chat_messages (chat_id, role, content) VALUES ($1, 'user', $2) RETURNING *`, [c!.id, b.message]))!
    // What Tom tells Ask Aimelia is kept and learned from, like his answers. Short replies ("thanks", "yes") are not.
    if (b.message.trim().length >= 20) await keepNote('chat', b.message, { conversation: c!.title }, `chat:${mine.id}`)
    const saved: Row[] = []
    for (const f of read) {
      saved.push((await one(`INSERT INTO chat_files (message_id, name, kind, media_type, size, data, text) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, message_id, name, kind, media_type, size`, [mine.id, f.name, f.kind, f.media_type, f.size, f.data, f.text]))!)
    }
    await q(`UPDATE chats SET updated_at = now() WHERE id = $1`, [c!.id])
    const [rows, files] = await Promise.all([
      q(`SELECT id, role, content FROM chat_messages WHERE chat_id = $1 ORDER BY created_at`, [c!.id]),
      q(`SELECT f.message_id, f.name, f.kind, f.media_type, f.data, f.text FROM chat_files f JOIN chat_messages m ON m.id = f.message_id WHERE m.chat_id = $1 ORDER BY f.created_at`, [c!.id]),
    ])
    const turns: Turn[] = rows.map((r) => ({ role: r.role, content: r.content, files: files.filter((f) => f.message_id === r.id) as Turn['files'] }))
    const { reply, steps } = await converse(turns, undefined, (c!.agent || 'aimelia') as AgentId)
    const theirs = (await one(`INSERT INTO chat_messages (chat_id, role, content, steps) VALUES ($1, 'assistant', $2, $3) RETURNING *`, [c!.id, reply, json(steps)]))!
    const updated = (await one(`UPDATE chats SET updated_at = now() WHERE id = $1 RETURNING *`, [c!.id]))!
    return Response.json({ chat: chatOut(updated), messages: [messageOut(mine, saved), messageOut(theirs)] }, { status: b.chat_id ? 200 : 201 })
  }],
  // The travel agent's trips, for the list beside its conversations.
  ['GET', '/trips', async (req) => ({ trips: await listTrips(new URL(req.url).searchParams.get('all') === 'true') })],
  ['DELETE', '/chats/:id', async (_r, p) => {
    const r = await q(`DELETE FROM chats WHERE id::text = $1 RETURNING id`, [p.id])
    if (!r.length) fail(404, 'Conversation not found.')
  }],
  // A file as sent, for the thumbnails and links in the conversation. Only checked photo and PDF types are ever served.
  ['GET', '/files/:id', async (_r, p) => {
    const f = (await one(`SELECT name, kind, media_type, data, text FROM chat_files WHERE id::text = $1`, [p.id])) || fail(404, 'File not found.')
    const bytes = f!.data ? Buffer.from(f!.data, 'base64') : Buffer.from(String(f!.text || ''), 'utf8')
    const type = f!.kind === 'text' ? 'text/plain; charset=utf-8' : f!.media_type
    const name = encodeURIComponent(f!.kind === 'text' ? `${f!.name}.txt` : f!.name)
    return new Response(bytes, { headers: { 'Content-Type': type, 'Content-Disposition': `${f!.kind === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
  }],
]

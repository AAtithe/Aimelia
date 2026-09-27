'use client'

import { useEffect, useState } from 'react'
import { chat } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { Conversation, type ChatSummary } from '@/components/chat/Chat'
import { londonTime } from '@/components/mail/common'

type Tool = { name: string; does: string }

export default function AskAimelia() {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [current, setCurrent] = useState<string | null>(null)

  const load = () => chat<{ chats: ChatSummary[]; tools: Tool[] }>('/chats').then((r) => { setChats(r.chats); setTools(r.tools) }).catch(() => {})
  useEffect(() => {
    load()
    const c = new URLSearchParams(window.location.search).get('c')
    if (c) setCurrent(c)
  }, [])

  const remove = async (id: string) => {
    await chat(`/chats/${id}`, { method: 'DELETE' }).catch(() => {})
    if (current === id) setCurrent(null)
    load()
  }

  return (
    <Shell title="Ask Aimelia" sub="A chat agent over your work: it looks up tasks, email, diary, the knowledge base and client figures before it answers, and adds tasks when you ask."
      actions={<button className="btn" onClick={() => setCurrent(null)}>New conversation</button>}>
      <div className="chatgrid">
        <div className="card chatlist"><h2>Conversations</h2>
          {chats.length === 0 ? <div className="emptyrow">None yet.</div> : chats.map((c) => (
            <div key={c.id} className={`item ${current === c.id ? 'on' : ''}`}>
              <button className="chatpick" onClick={() => setCurrent(c.id)}>
                <span className="t">{c.title || 'Conversation'}</span>
                <span className="meta">{londonTime(c.updated_at)}</span>
              </button>
              <button className="linkbtn" onClick={() => remove(c.id)} aria-label={`Delete ${c.title}`}>Delete</button>
            </div>
          ))}
          {tools.length > 0 && (
            <div className="body"><p className="cap">What it can use now:</p>
              <ul className="chat-tools">{tools.map((t) => <li key={t.name}>{t.does}</li>)}</ul></div>
          )}
        </div>
        <div className="card"><div className="body">
          <Conversation chatId={current} onChat={(c) => { setCurrent(c.id); load() }} />
        </div></div>
      </div>
    </Shell>
  )
}

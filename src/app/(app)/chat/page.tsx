'use client'

import { useEffect, useState } from 'react'
import { chat } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { AGENT_LABEL, Conversation, type AgentId, type ChatSummary } from '@/components/chat/Chat'
import { londonTime } from '@/components/mail/common'

type Tool = { name: string; does: string }
type Agent = { id: AgentId; label: string; intro: string; tools: Tool[] }
type Trip = { id: string; title: string; destination: string; depart_date: string | null; return_date: string | null; status: string; bookings: unknown[] }

const STATUS_PILL: Record<string, string> = { idea: 'Parked', planned: 'Unscheduled', requested: 'Atrisk', booked: 'Done', done: 'Done', cancelled: 'Parked' }
const dates = (t: Trip) => [t.depart_date, t.return_date && t.return_date !== t.depart_date ? t.return_date : null].filter(Boolean).join(' to ')

export default function AskAimelia() {
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [model, setModel] = useState('')
  const [current, setCurrent] = useState<string | null>(null)
  const [pick, setPick] = useState<AgentId>('aimelia') // who a new conversation is with
  const [trips, setTrips] = useState<Trip[]>([])

  const load = () => chat<{ chats: ChatSummary[]; agents: Agent[]; model: string }>('/chats').then((r) => { setChats(r.chats); setAgents(r.agents); setModel(r.model) }).catch(() => {})
  const loadTrips = () => chat<{ trips: Trip[] }>('/trips').then((r) => setTrips(r.trips)).catch(() => {})
  useEffect(() => {
    load()
    loadTrips()
    const u = new URLSearchParams(window.location.search)
    const c = u.get('c')
    const a = u.get('agent') as AgentId | null
    if (c) setCurrent(c)
    if (a && a in AGENT_LABEL) setPick(a)
  }, [])

  const open = chats.find((c) => c.id === current)
  const active: AgentId = open?.agent || pick
  const spec = agents.find((a) => a.id === active)

  const remove = async (id: string) => {
    await chat(`/chats/${id}`, { method: 'DELETE' }).catch(() => {})
    if (current === id) setCurrent(null)
    load()
  }
  const startWith = (id: AgentId) => { setPick(id); setCurrent(null) }

  return (
    <Shell title="Ask Aimelia" sub="Aimelia and her specialists. Aimelia looks things up, works out the figures, drafts in Outlook and adds tasks; the calendar agent keeps your diary in order; the travel agent plans your trips. Nothing is ever sent or paid for."
      actions={<button className="btn" onClick={() => setCurrent(null)}>New conversation</button>}>
      <div className="main-tabs agentpick" role="tablist" aria-label="Who to talk to">
        {(Object.keys(AGENT_LABEL) as AgentId[]).map((id) => (
          <button key={id} role="tab" aria-selected={active === id} className={`main-tab-btn ${active === id ? 'active' : ''}`} onClick={() => startWith(id)}>{AGENT_LABEL[id]}</button>
        ))}
      </div>
      <div className="chatgrid">
        <div className="card chatlist"><h2>Conversations</h2>
          {chats.length === 0 ? <div className="emptyrow">None yet.</div> : chats.map((c) => (
            <div key={c.id} className={`item ${current === c.id ? 'on' : ''}`}>
              <button className="chatpick" onClick={() => setCurrent(c.id)}>
                <span className="t">{c.title || 'Conversation'}</span>
                <span className="meta">{c.agent && c.agent !== 'aimelia' ? `${AGENT_LABEL[c.agent]}, ` : ''}{londonTime(c.updated_at)}</span>
              </button>
              <button className="linkbtn" onClick={() => remove(c.id)} aria-label={`Delete ${c.title}`}>Delete</button>
            </div>
          ))}
          {active === 'travel' && (
            <div className="body"><p className="cap">Trips</p>
              {trips.length === 0 ? <p className="cap">None yet. Ask the travel agent to plan one.</p> : (
                <ul className="chat-trips">{trips.map((t) => (
                  <li key={t.id}><span className="t">{t.title}</span> <span className={`pill ${STATUS_PILL[t.status] || 'Parked'}`}>{t.status}</span>
                    <div className="meta">{[t.destination, dates(t)].filter(Boolean).join(', ')}{t.bookings.length ? `, ${t.bookings.length} booking${t.bookings.length === 1 ? '' : 's'} confirmed` : ''}</div></li>
                ))}</ul>
              )}
            </div>
          )}
          {spec && (
            <div className="body"><p className="cap">{spec.intro} {model === 'mock' ? 'No AI key yet, so answers are placeholders.' : model ? `Runs on ${model}.` : ''}</p>
              {spec.tools.length ? <><p className="cap">What it can use now:</p><ul className="chat-tools">{spec.tools.map((t) => <li key={t.name}>{t.does}</li>)}</ul></>
                : <p className="cap">Nothing it needs is connected yet. Connect Microsoft 365 and add the Claude key in Settings.</p>}
            </div>
          )}
        </div>
        <div className="card"><div className="body">
          <Conversation key={current ? 'open' : `new-${pick}`} chatId={current} agent={active} onChat={(c) => { setCurrent(c.id); load(); if (c.agent === 'travel') loadTrips() }} />
        </div></div>
      </div>
    </Shell>
  )
}

'use client'

import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { BriefText, MsgLine, UrgencyPill, useLoad, type Msg } from '@/components/mail/common'

const TABS: [string, string][] = [['triage', 'Sort an email'], ['generate', 'Ask with context'], ['persona', 'The persona']]

export default function Workbench() {
  const [tab, setTab] = useState('triage')
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState({ subject: '', sender: '', body: '' })
  const [triage, setTriage] = useState<any>(null)
  const [gen, setGen] = useState({ task: 'analysis', query: '', meta: '{\n  "question": ""\n}' })
  const [out, setOut] = useState<any>(null)
  const persona = useLoad(() => mail<{ persona: string }>('/ai/persona'))

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  return (
    <Shell title="AI workbench" sub="Try the assistant directly: how it sorts an email, or what it says with your persona, examples and knowledge base behind it.">
      <div className="main-tabs">{TABS.map(([id, label]) => <button key={id} className={`main-tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'triage' && (
        <div className="card"><h2>Sort an email</h2><div className="body">
          <div className="row2">
            <label className="fld"><span>Subject</span><input value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></label>
            <label className="fld"><span>From</span><input value={email.sender} onChange={(e) => setEmail({ ...email, sender: e.target.value })} /></label>
          </div>
          <label className="fld"><span>Body</span><textarea rows={5} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} /></label>
          <button className="btn primary" disabled={busy || !email.subject.trim()} onClick={() => run(async () => setTriage((await mail('/ai/triage', { method: 'POST', body: email })).triage))}>Sort it</button>
          {triage && (
            <div className="item" style={{ padding: '12px 0 0' }}>
              <div className="o"><span className="tag">{triage.category}</span><UrgencyPill u={triage.urgency} /><span>{triage.method === 'rules' ? 'Keyword rules' : triage.method === 'ai' ? `AI, ${Math.round(triage.confidence * 100)}% sure` : 'Could not sort'}</span></div>
              <div className="meta" style={{ marginTop: 6 }}>{triage.reasoning}</div>
              {triage.action_required && <div className="meta"><b>Action:</b> {triage.action_required}</div>}
            </div>
          )}
        </div></div>
      )}
      {tab === 'generate' && (
        <div className="card"><h2>Ask with context</h2><div className="body">
          <div className="row2">
            <label className="fld"><span>Kind of task</span><select value={gen.task} onChange={(e) => setGen({ ...gen, task: e.target.value })}>
              {['analysis', 'reply', 'brief', 'digest', 'triage', 'default'].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="fld"><span>Search the knowledge base for (optional)</span><input value={gen.query} onChange={(e) => setGen({ ...gen, query: e.target.value })} /></label>
          </div>
          <label className="fld"><span>Details, as JSON</span><textarea className="mono" rows={6} value={gen.meta} onChange={(e) => setGen({ ...gen, meta: e.target.value })} /></label>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => {
            let meta: unknown
            try { meta = JSON.parse(gen.meta) } catch { throw new Error('The details are not valid JSON.') }
            setOut(await mail('/ai/generate', { method: 'POST', body: { task: gen.task, query: gen.query, meta } }))
          })}>{busy ? 'Thinking ...' : 'Ask'}</button>
          {out && (<><p className="cap" style={{ marginTop: 10 }}>Used {out.context_used.examples} example{out.context_used.examples === 1 ? '' : 's'}{out.context_used.knowledge ? ' and the knowledge base' : ''}.</p><BriefText text={out.content} /></>)}
        </div></div>
      )}
      {tab === 'persona' && (
        <div className="card"><h2>The persona every email feature uses</h2><div className="body"><BriefText text={persona.data?.persona || 'Reading ...'} /></div></div>
      )}
      <MsgLine msg={msg} />
    </Shell>
  )
}

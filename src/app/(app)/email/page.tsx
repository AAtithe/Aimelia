'use client'

import { useEffect, useState } from 'react'
import { api, mail } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { londonTime, MsgLine, NotConnected, UrgencyPill, useLoad, type Msg, MicrosoftPaused } from '@/components/mail/common'

type Email = { id: string; subject: string; from: string; from_name: string; received: string; preview: string
  triage: { category: string; urgency: number; confidence: number; method: string; reasoning: string; action_required: string | null }
  summary: string | null; suggested_reply: string | null; draft_id: string | null; draft_link: string | null }
type List = { message_count: number; triaged_emails: Email[]; summary: { urgent: number; important: number; low_priority: number } }
const FILTERS: [string, string][] = [['all', 'All'], ['urgent', 'Urgent'], ['ai', 'Sorted by AI'], ['rules', 'Sorted by rules']]

export default function EmailTriage() {
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<Email | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const { data, error, load } = useLoad(() => mail<List>(`/emails?filter=${filter}`), [filter])
  const { microsoft } = useShell()

  const check = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await mail<List & { fetched: number; newly_triaged: number }>('/triage/run', { method: 'POST' })
      setMsg({ ok: true, text: r.newly_triaged ? `${r.newly_triaged} new email${r.newly_triaged === 1 ? '' : 's'} sorted.` : 'Nothing new since the last check.' })
      load()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  const rows = data?.triaged_emails || []
  const paused = microsoft?.configured === false
  if (paused) return <Shell title="Email triage" sub="Paused until Microsoft 365 is set up."><MicrosoftPaused /></Shell>

  return (
    <Shell title="Email triage" sub="Your latest mail, sorted by category and urgency. Keyword rules first, AI for the rest. Nothing is ever sent."
      actions={<button className="btn ghost" disabled={busy} onClick={check}>{busy ? 'Checking ...' : 'Check for new mail'}</button>}>
      <NotConnected error={error || (msg && !msg.ok ? msg.text : '') || (microsoft && !microsoft.connected ? 'Microsoft 365' : '')} />
      <div className="kpis">
        <div className="kpi"><span className="n">{data ? data.message_count : '–'}</span><span className="l">Emails shown</span></div>
        <div className={`kpi ${data?.summary.urgent ? 'alert' : 'none'}`}><span className="n">{data ? data.summary.urgent : '–'}</span><span className="l">Urgent (4 or 5)</span></div>
        <div className="kpi"><span className="n">{data ? data.summary.important : '–'}</span><span className="l">Medium (3)</span></div>
        <div className="kpi"><span className="n">{data ? data.summary.low_priority : '–'}</span><span className="l">Low (1 or 2)</span></div>
      </div>
      {msg?.ok && <MsgLine msg={msg} />}
      <div className="main-tabs">
        {FILTERS.map(([id, label]) => <button key={id} className={`main-tab-btn ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      <div className="card">
        <h2>Inbox <span className="hcount">{rows.length}</span></h2>
        {!data ? <div className="emptyrow">{error ? 'Nothing to show yet.' : 'Reading ...'}</div> : rows.length === 0 ? (
          <div className="emptyrow">No emails {filter === 'all' ? 'sorted yet. Use "Check for new mail".' : 'match this filter.'}</div>
        ) : (
          <div className="tblwrap"><table>
            <thead><tr><th>Email</th><th className="nowrap">Category</th><th className="nowrap">Urgency</th><th className="nowrap hide-sm">How</th><th className="nowrap">Received</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="click" tabIndex={0} onClick={() => setOpen(e)} onKeyDown={(k) => k.key === 'Enter' && setOpen(e)}>
                <td><div className="t">{e.subject || '(no subject)'}</div><div className="d">{e.from_name ? `${e.from_name}, ` : ''}{e.from}</div></td>
                <td className="nowrap"><span className="tag">{e.triage.category}</span></td>
                <td className="nowrap"><UrgencyPill u={e.triage.urgency} /></td>
                <td className="nowrap hide-sm">{e.triage.method === 'ai' ? `AI, ${Math.round(e.triage.confidence * 100)}% sure` : e.triage.method === 'rules' ? 'Rules' : 'Not sorted'}</td>
                <td className="nowrap">{londonTime(e.received)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      {open && <EmailDrawer email={open} onClose={() => { setOpen(null); load() }} />}
    </Shell>
  )
}

function EmailDrawer({ email, onClose }: { email: Email; onClose: () => void }) {
  const [e, setE] = useState(email)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [sensitive, setSensitive] = useState<string[]>([])
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setMsg(null)
    try { await fn() } catch (err: any) { setMsg({ ok: false, text: err.message }) } finally { setBusy('') }
  }
  const analyse = () => run('analyse', async () => {
    const r = await mail(`/emails/${encodeURIComponent(e.id)}/analyze`, { method: 'POST' })
    setE({ ...e, triage: { ...e.triage, ...r.analysis.triage }, summary: r.analysis.summary, suggested_reply: r.analysis.suggested_response })
    setSensitive(r.analysis.sensitive_topics || [])
    setMsg({ ok: true, text: 'Analysed: sorted again, thread summarised and a reply suggested.' })
  })
  const summarise = () => run('summary', async () => {
    const r = await mail(`/emails/${encodeURIComponent(e.id)}/summary`, { method: 'POST' })
    setE({ ...e, summary: r.summary })
  })
  const draft = () => run('draft', async () => {
    const r = await mail('/draft/smart-reply', { method: 'POST', body: { email_id: e.id, thread_summary: e.summary || '' } })
    setE({ ...e, draft_id: r.draft_id, draft_link: r.draft_link, suggested_reply: r.draft_content })
    setSensitive(r.sensitive_topics || [])
    setMsg({ ok: true, text: r.message })
  })
  const toTask = () => run('task', async () => {
    await api('/tasks', { method: 'POST', body: { title: `Deal with: ${e.subject}`.slice(0, 500), priority: e.triage.urgency >= 4 ? 1 : 2,
      notes: `From ${e.from_name || ''} ${e.from}, received ${londonTime(e.received)}.\n\n${e.summary || e.preview}\n\nSuggested action: ${e.triage.action_required || 'decide'}` } })
    setMsg({ ok: true, text: 'Added to your tasks. The agent team is on it.' })
  })

  return (
    <>
      <div className="drawer-bg open" onClick={onClose} />
      <aside className="drawer open" role="dialog" aria-label="Email">
        <div className="dh"><button className="dclose" onClick={onClose} aria-label="Close">&times;</button>
          <div className="o">{e.from_name ? `${e.from_name}, ` : ''}{e.from}, {londonTime(e.received)}</div><div className="t">{e.subject || '(no subject)'}</div></div>
        <div className="db">
          <div className="o" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="tag">{e.triage.category}</span><UrgencyPill u={e.triage.urgency} /></div>
          <p className="cap" style={{ marginTop: 8 }}>{e.triage.method === 'rules' ? 'Sorted by keyword rules.' : e.triage.method === 'ai' ? `Sorted by AI, ${Math.round(e.triage.confidence * 100)}% sure.` : 'Could not be sorted.'} {e.triage.reasoning}</p>
          {e.triage.action_required && <div className="note info"><b>Suggested action:</b> {e.triage.action_required}</div>}
          <div className="toolbar">
            <button className="btn primary" disabled={!!busy} onClick={draft}>{busy === 'draft' ? 'Drafting ...' : e.draft_id ? 'Draft another reply' : 'Draft a reply in Outlook'}</button>
            <button className="btn" disabled={!!busy} onClick={analyse}>{busy === 'analyse' ? 'Analysing ...' : 'Analyse'}</button>
            <button className="btn" disabled={!!busy} onClick={summarise}>{busy === 'summary' ? 'Reading ...' : 'Summarise the thread'}</button>
            <button className="btn" disabled={!!busy} onClick={toTask}>Make it a task</button>
          </div>
          <MsgLine msg={msg} />
          {e.draft_link && <p className="cap">A reply draft is waiting in Outlook, in the same thread. <a href={e.draft_link} target="_blank" rel="noreferrer">Open it</a>. Nothing was sent.</p>}
          {sensitive.length > 0 && <div className="note warn"><b>Check before sending:</b> the draft mentions {sensitive.join(', ')}.</div>}
          <h3>Preview</h3>
          <div className="briefbody">{e.preview || 'No preview.'}</div>
          {e.summary && (<><h3>Thread summary</h3><div className="briefbody">{e.summary}</div></>)}
          {e.suggested_reply && (<><h3>Suggested reply</h3><div className="briefbody">{e.suggested_reply}</div></>)}
        </div>
      </aside>
    </>
  )
}

'use client'

import { useState } from 'react'
import { api, Action, Question, KIND_LABEL, STATUS_LABEL, STATUS_PILL, TaskStatus, fmtDate } from '@/lib/todoApi'

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>
}

type Msg = { ok: boolean; text: string } | null

function MsgLine({ msg }: { msg: Msg }) {
  return <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
}

export function QuestionItem({ q, onDone, showTask = true }: { q: Question; onDone: () => void; showTask?: boolean }) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const submit = async (dismiss = false) => {
    setBusy(true)
    setMsg(null)
    try {
      const res = dismiss
        ? await api(`/questions/${q.id}/dismiss`, { method: 'POST' })
        : await api(`/questions/${q.id}/answer`, { method: 'POST', body: { answer } })
      setMsg({ ok: true, text: res.task_resumed ? 'Answered. The team has picked it back up.' : 'Answered. Other questions on this task are still open.' })
      setTimeout(onDone, 900)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="item">
      <div className="o">
        {showTask && <span className="tag">{q.task_title}</span>}
        <span>Asked by {q.asked_by}</span>
      </div>
      <div className="t">{q.question}</div>
      {q.why && <div className="meta">Why it matters: {q.why}</div>}
      <textarea className="inp" style={{ marginTop: 8 }} rows={2} placeholder="Your answer" value={answer}
        aria-label="Your answer" onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) submit() }} />
      <div className="toolbar">
        <button className="btn primary" disabled={busy || !answer.trim()} onClick={() => submit()}>Answer</button>
        <button className="btn" disabled={busy} onClick={() => submit(true)}>Skip, use your judgement</button>
      </div>
      <MsgLine msg={msg} />
    </div>
  )
}

export function ActionItem({ a, onDone, showTask = true }: { a: Action; onDone: () => void; showTask?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(a.content)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const live = a.status === 'proposed'
  const flagged = a.review_status === 'flagged'
  const d = a.details || {}
  const canOutlook = a.kind === 'email_draft' && !!d.to

  const run = async (fn: () => Promise<any>, ok: string, refresh = true) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: ok })
      if (refresh) setTimeout(onDone, 900)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const copy = () => run(async () => {
    const head = a.kind === 'email_draft'
      ? [d.to && `To: ${d.to}`, d.cc && `Cc: ${d.cc}`, d.subject && `Subject: ${d.subject}`].filter(Boolean).join('\n')
      : ''
    await navigator.clipboard.writeText([head, content].filter(Boolean).join('\n\n'))
  }, 'Copied to the clipboard.', false)

  return (
    <div className={`item ${flagged && live ? 'flag' : ''}`}>
      <div className="o">
        {showTask && <span className="tag">{a.task_title}</span>}
        <span className="tag">{KIND_LABEL[a.kind] || a.kind}</span>
        {a.review_score !== null && (
          <span className={`pill ${flagged ? 'Overdue' : 'Ontrack'}`}>
            {flagged ? 'Reviewer not satisfied' : 'Reviewer approved'} {a.review_score}/10
          </span>
        )}
        {!live && <span className="pill Parked">{a.status === 'approved' ? 'Approved' : a.status === 'done' ? 'Done' : 'Sent back'}</span>}
      </div>
      <div className="t">{a.title}</div>
      {a.kind === 'email_draft' && (d.to || d.subject) && (
        <div className="meta">
          {d.to && <>To <b>{d.to}</b>{d.cc ? <> , cc <b>{d.cc}</b></> : null}. </>}
          {d.subject && <>Subject <b>{d.subject}</b></>}
        </div>
      )}
      {a.kind === 'delegate' && (d.owner || d.due) && (
        <div className="meta">
          {d.owner && <>Owner <b>{d.owner}</b>. </>}
          {d.due && <>Back by <b>{fmtDate(d.due)}</b></>}
        </div>
      )}
      {editing
        ? <textarea className="inp mono" style={{ marginTop: 8 }} rows={12} value={content} onChange={(e) => setContent(e.target.value)} aria-label="Edit content" />
        : <div className="content">{content}</div>}
      {a.review_notes && live && (
        <div className={`note ${flagged ? 'bad' : 'info'}`} style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{a.review_notes}</div>
      )}
      {a.user_feedback && <div className="meta" style={{ marginTop: 6 }}>Your feedback: {a.user_feedback}</div>}

      {live && (
        <div className="toolbar">
          {editing ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => run(() => api(`/actions/${a.id}`, { method: 'PATCH', body: { content } }).then(() => setEditing(false)), 'Saved.', false)}>Save</button>
              <button className="btn" onClick={() => { setContent(a.content); setEditing(false) }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn primary" disabled={busy} onClick={() => run(() => api(`/actions/${a.id}/approve`, { method: 'POST', body: {} }), a.kind === 'delegate' ? 'Approved. Copy the handover and send it.' : 'Approved.')}>
                {a.kind === 'delegate' ? 'Approve handover' : 'Approve'}
              </button>
              {canOutlook && (
                <button className="btn" disabled={busy} onClick={() => run(() => api(`/actions/${a.id}/approve`, { method: 'POST', body: { create_outlook_draft: true } }), 'Approved. The draft is in your Outlook drafts, not sent.')}>
                  Approve and put in Outlook drafts
                </button>
              )}
              <button className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn" onClick={copy}>Copy</button>
              <span className="spacer" />
              <button className="btn danger" onClick={() => setRejecting(!rejecting)}>Send back</button>
            </>
          )}
        </div>
      )}
      {a.status === 'approved' && (
        <div className="toolbar">
          <button className="btn" onClick={copy}>Copy</button>
          <button className="btn" disabled={busy} onClick={() => run(() => api(`/actions/${a.id}/done`, { method: 'POST' }), 'Marked done.')}>Mark done</button>
        </div>
      )}
      {rejecting && (
        <div style={{ marginTop: 10 }}>
          <label className="fld"><span>What should the team change?</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Firmer tone, mention the 30-day notice period" />
          </label>
          <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => run(() => api(`/actions/${a.id}/reject`, { method: 'POST', body: { reason, rework: true } }), 'Sent back. The team will rework it.')}>
            Send back with this note
          </button>
        </div>
      )}
      <MsgLine msg={msg} />
    </div>
  )
}

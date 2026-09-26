'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check, X, Copy, Mail, AlertTriangle, CheckCheck, Pencil } from 'lucide-react'
import { api, Action, Question, KIND_LABEL, STATUS_LABEL, STATUS_STYLE, TaskStatus } from '@/lib/todoApi'

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function QuestionCard({ q, onDone, showTask = true }: { q: Question; onDone: () => void; showTask?: boolean }) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (dismiss = false) => {
    setBusy(true)
    try {
      const res = dismiss
        ? await api(`/questions/${q.id}/dismiss`, { method: 'POST' })
        : await api(`/questions/${q.id}/answer`, { method: 'POST', body: { answer } })
      toast.success(res.task_resumed ? 'Answered. The team is back on it.' : 'Answered.')
      onDone()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white p-4">
      {showTask && <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{q.task_title}</div>}
      <div className="font-medium text-slate-900">{q.question}</div>
      {q.why && <div className="mt-1 text-sm text-slate-500">Why: {q.why}</div>}
      <div className="mt-1 text-xs text-slate-400">Asked by {q.asked_by}</div>
      <textarea
        className="mt-3 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-slate-500 focus:outline-none"
        rows={2}
        placeholder="Your answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) submit()
        }}
      />
      <div className="mt-2 flex gap-2">
        <button disabled={busy || !answer.trim()} onClick={() => submit()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          Answer
        </button>
        <button disabled={busy} onClick={() => submit(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          Skip, use your judgement
        </button>
      </div>
    </div>
  )
}

export function ActionCard({ a, onDone, showTask = true }: { a: Action; onDone: () => void; showTask?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(a.content)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const live = a.status === 'proposed'
  const canOutlook = a.kind === 'email_draft' && !!a.details?.to

  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(msg)
      onDone()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(() => api(`/actions/${a.id}`, { method: 'PATCH', body: { content } }).then(() => setEditing(false)), 'Saved')
  const approve = (outlook: boolean) =>
    run(() => api(`/actions/${a.id}/approve`, { method: 'POST', body: { create_outlook_draft: outlook } }),
      outlook ? 'Approved. Draft created in Outlook.' : 'Approved')
  const reject = () =>
    run(() => api(`/actions/${a.id}/reject`, { method: 'POST', body: { reason, rework: true } }), 'Sent back to the team')
  const done = () => run(() => api(`/actions/${a.id}/done`, { method: 'POST' }), 'Marked done')
  const copy = async () => {
    const d = a.details || {}
    const text = [d.to && `To: ${d.to}`, d.cc && `Cc: ${d.cc}`, d.subject && `Subject: ${d.subject}`, '', content]
      .filter((x) => x !== undefined && x !== false).join('\n')
    try {
      await navigator.clipboard.writeText(text.trim())
      toast.success('Copied')
    } catch {
      toast.error('Clipboard not available')
    }
  }

  return (
    <div className={`rounded-xl border bg-white p-4 ${a.review_status === 'flagged' && live ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {showTask && <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{a.task_title}</span>}
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{KIND_LABEL[a.kind] || a.kind}</span>
        {a.review_score !== null && (
          <span className={`rounded px-2 py-0.5 text-xs ${a.review_status === 'flagged' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
            Reviewer {a.review_status === 'flagged' ? 'not satisfied' : 'approved'} {a.review_score}/10
          </span>
        )}
        {!live && <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">{a.status}</span>}
      </div>
      <div className="mt-2 font-semibold text-slate-900">{a.title}</div>
      {a.kind === 'email_draft' && (a.details?.to || a.details?.subject) && (
        <div className="mt-1 text-sm text-slate-600">
          {a.details.to && <div>To: {a.details.to}{a.details.cc ? `  |  Cc: ${a.details.cc}` : ''}</div>}
          {a.details.subject && <div>Subject: {a.details.subject}</div>}
        </div>
      )}
      {editing ? (
        <textarea className="mt-2 w-full rounded-lg border border-slate-300 p-2 font-mono text-sm" rows={12}
          value={content} onChange={(e) => setContent(e.target.value)} />
      ) : (
        <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{content}</div>
      )}
      {a.review_notes && live && (
        <div className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap">{a.review_notes}</span>
        </div>
      )}
      {a.user_feedback && <div className="mt-2 text-xs text-slate-500">Your feedback: {a.user_feedback}</div>}

      {live && (
        <div className="mt-3 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Btn onClick={save} disabled={busy} primary><Check className="h-4 w-4" />Save</Btn>
              <Btn onClick={() => { setContent(a.content); setEditing(false) }}>Cancel</Btn>
            </>
          ) : (
            <>
              <Btn onClick={() => approve(false)} disabled={busy} primary><Check className="h-4 w-4" />Approve</Btn>
              {canOutlook && <Btn onClick={() => approve(true)} disabled={busy}><Mail className="h-4 w-4" />Approve + Outlook draft</Btn>}
              <Btn onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Btn>
              <Btn onClick={copy}><Copy className="h-4 w-4" />Copy</Btn>
              <Btn onClick={() => setRejecting(!rejecting)}><X className="h-4 w-4" />Send back</Btn>
            </>
          )}
        </div>
      )}
      {a.status === 'approved' && (
        <div className="mt-3"><Btn onClick={done} disabled={busy}><CheckCheck className="h-4 w-4" />Mark done</Btn></div>
      )}
      {rejecting && (
        <div className="mt-3">
          <textarea className="w-full rounded-lg border border-slate-300 p-2 text-sm" rows={2}
            placeholder="What should the team change?" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Btn onClick={reject} disabled={busy || !reason.trim()} primary>Send back with feedback</Btn>
        </div>
      )}
    </div>
  )
}

export function Btn({ children, onClick, disabled, primary }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
        primary ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

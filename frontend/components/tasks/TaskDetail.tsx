'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { X, Play, Trash2, CheckCheck } from 'lucide-react'
import { api, Task, AgentEvent } from '@/lib/todoApi'
import { ActionCard, Btn, QuestionCard, StatusBadge } from './Cards'

export function TaskDetail({ taskId, onClose, onChanged }: { taskId: string; onClose: () => void; onChanged: () => void }) {
  const [task, setTask] = useState<Task | null>(null)
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const t = await api<Task>(`/tasks/${taskId}`)
      setTask(t)
      setNotes(t.notes || '')
    } catch (e: any) {
      toast.error(e.message)
    }
  }, [taskId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!task || !['queued', 'processing'].includes(task.status)) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [task, load])

  const refresh = () => { load(); onChanged() }

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(msg)
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!task) return null
  const open = task.questions?.filter((q) => q.status === 'open') || []
  const answered = task.questions?.filter((q) => q.status !== 'open') || []
  const live = task.actions?.filter((a) => a.status === 'proposed') || []
  const history = task.actions?.filter((a) => a.status !== 'proposed') || []

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-slate-50 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <StatusBadge status={task.status} />
            <h2 className="mt-2 text-xl font-bold text-slate-900">{task.title}</h2>
            {task.summary && <p className="mt-1 text-sm text-slate-600">{task.summary}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-200"><X className="h-5 w-5" /></button>
        </div>

        {task.review_flag && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{task.review_flag}</div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Btn disabled={busy || task.status === 'processing'} onClick={() => act(() => api(`/tasks/${task.id}/run`, { method: 'POST' }), 'Queued for the team')}>
            <Play className="h-4 w-4" />Re-run agents
          </Btn>
          {task.status !== 'done' && (
            <Btn disabled={busy} onClick={() => act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'done' } }), 'Task closed')}>
              <CheckCheck className="h-4 w-4" />Mark task done
            </Btn>
          )}
          <Btn disabled={busy} onClick={() => {
            if (confirm('Delete this task and everything the agents produced for it?'))
              act(() => api(`/tasks/${task.id}`, { method: 'DELETE' }).then(onClose), 'Deleted')
          }}>
            <Trash2 className="h-4 w-4" />Delete
          </Btn>
        </div>

        <Section title="Brief for the team">
          <textarea className="w-full rounded-lg border border-slate-300 p-2 text-sm" rows={4} value={notes}
            onChange={(e) => setNotes(e.target.value)} placeholder="Context, constraints, who is involved, what good looks like" />
          {notes !== (task.notes || '') && (
            <Btn primary disabled={busy} onClick={() => act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { notes } }), 'Notes saved')}>Save notes</Btn>
          )}
        </Section>

        {open.length > 0 && (
          <Section title="Questions for you">
            <div className="space-y-3">{open.map((q) => <QuestionCard key={q.id} q={q} onDone={refresh} showTask={false} />)}</div>
          </Section>
        )}

        {live.length > 0 && (
          <Section title="Ready for approval">
            <div className="space-y-3">{live.map((a) => <ActionCard key={a.id} a={a} onDone={refresh} showTask={false} />)}</div>
          </Section>
        )}

        <Section title="Tell the team what to change">
          <textarea className="w-full rounded-lg border border-slate-300 p-2 text-sm" rows={2} value={feedback}
            onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Make the email firmer and mention the 30-day notice period" />
          <Btn primary disabled={busy || !feedback.trim()} onClick={() => act(() =>
            api(`/tasks/${task.id}/feedback`, { method: 'POST', body: { text: feedback } }).then(() => setFeedback('')), 'Sent. The team will rework it.')}>
            Send and rework
          </Btn>
        </Section>

        {answered.length > 0 && (
          <Section title="Answered questions">
            <ul className="space-y-2 text-sm">
              {answered.map((q) => (
                <li key={q.id} className="rounded-lg bg-white p-3">
                  <div className="text-slate-900">{q.question}</div>
                  <div className="text-slate-500">{q.status === 'dismissed' ? 'Skipped' : q.answer}</div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {history.length > 0 && (
          <Section title="Earlier actions">
            <div className="space-y-3">{history.map((a) => <ActionCard key={a.id} a={a} onDone={refresh} showTask={false} />)}</div>
          </Section>
        )}

        <Section title="How the team worked">
          <ol className="space-y-2">{task.events?.map((e) => <EventRow key={e.id} e={e} />)}</ol>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function EventRow({ e }: { e: AgentEvent }) {
  const c = e.content || {}
  let text = ''
  if (e.kind === 'worker') text = `${c.summary || 'Worked on the draft'}${c.actions ? ` (${c.actions.length} action${c.actions.length === 1 ? '' : 's'})` : ''}`
  else if (e.kind === 'review') text = `${c.approved ? 'Approved' : 'Sent back'} at ${c.score}/10. ${c.feedback || ''}`
  else if (e.kind === 'question') text = `Asked: ${(c.questions || []).map((q: any) => q.question).join(' | ')}`
  else if (e.kind === 'answer') text = `Answered "${c.question}": ${c.answer}`
  else if (e.kind === 'feedback') text = c.text
  else if (e.kind === 'error') text = c.error
  else if (e.kind === 'status') text = `Status: ${c.status}${c.reason ? ` (${c.reason})` : ''}${c.action ? ` - ${c.action}` : ''}`
  return (
    <li className={`rounded-lg p-2.5 text-sm ${e.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-white text-slate-700'}`}>
      <span className="font-medium text-slate-900">{e.actor}</span>
      {e.attempt > 0 && <span className="ml-1 text-xs text-slate-400">round {e.attempt + 1}</span>}
      <span className="ml-2 text-xs text-slate-400">{new Date(e.created_at).toLocaleString('en-GB')}</span>
      <div className="mt-0.5 whitespace-pre-wrap">{text}</div>
    </li>
  )
}

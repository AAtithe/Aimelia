'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Bot, Play, RefreshCw, LogOut, Plus } from 'lucide-react'
import { api, ApiError, Briefing, Task, getKey, setKey } from '@/lib/todoApi'
import { ActionCard, Btn, QuestionCard, StatusBadge } from '@/components/tasks/Cards'
import { TaskDetail } from '@/components/tasks/TaskDetail'
import { AgentTeam } from '@/components/tasks/AgentTeam'

type Tab = 'briefing' | 'tasks' | 'team'

export default function TasksPage() {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  useEffect(() => setHasKey(!!getKey()), [])

  if (hasKey === null) return null
  if (!hasKey) return <KeyGate onSaved={() => setHasKey(true)} />
  return <Workspace onSignOut={() => { setKey(''); setHasKey(false) }} />
}

function KeyGate({ onSaved }: { onSaved: () => void }) {
  const [key, setValue] = useState('')
  const [err, setErr] = useState('')

  const save = async () => {
    setKey(key.trim())
    try {
      await api('/tasks')
      onSaved()
    } catch (e: any) {
      setKey('')
      setErr(e instanceof ApiError && e.status === 401 ? 'That key is not right.' : e.message)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900"><Bot className="h-6 w-6 text-white" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Aimelia Tasks</h1>
            <p className="text-sm text-slate-500">Williams, Stanley &amp; Co</p>
          </div>
        </div>
        <label className="mt-6 block text-sm text-slate-600">Access key</label>
        <input type="password" autoFocus className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={key}
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key && save()} />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button onClick={save} disabled={!key}
          className="mt-4 w-full rounded-lg bg-slate-900 py-2.5 font-medium text-white disabled:opacity-40">Open</button>
      </div>
    </div>
  )
}

function Workspace({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('briefing')
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [showDone, setShowDone] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [b, t] = await Promise.all([
        api<Briefing>('/briefing'),
        api<Task[]>(`/tasks${showDone ? '?include_done=true' : ''}`),
      ])
      setBrief(b)
      setTasks(t)
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) onSignOut()
      else toast.error(e.message)
    }
  }, [showDone, onSignOut])

  useEffect(() => { load() }, [load])

  // Poll while the team is working so results appear without a refresh.
  const working = (brief?.counts.queued || 0) + (brief?.counts.processing || 0)
  useEffect(() => {
    const t = setInterval(load, working ? 8000 : 60000)
    return () => clearInterval(t)
  }, [working, load])

  const runAll = async () => {
    try {
      await api('/run', { method: 'POST' })
      toast.success('Team started on the queue')
      setTimeout(load, 1500)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const c = brief?.counts || {}
  const tabs: [Tab, string][] = [['briefing', 'Briefing'], ['tasks', 'Tasks'], ['team', 'Agent team']]

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900"><Bot className="h-5 w-5 text-white" /></div>
            <div>
              <h1 className="font-bold text-slate-900">Aimelia Tasks</h1>
              <p className="text-xs text-slate-500">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Btn onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Btn>
            <Btn onClick={runAll}><Play className="h-4 w-4" />Run agents now</Btn>
            <Btn onClick={onSignOut}><LogOut className="h-4 w-4" /></Btn>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-4">
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {label}
              {id === 'briefing' && brief && brief.questions.length + brief.actions.length > 0 && (
                <span className="ml-1.5 rounded-full bg-slate-900 px-1.5 text-xs text-white">{brief.questions.length + brief.actions.length}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {tab !== 'team' && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Questions for you" value={brief?.questions.length ?? 0} tone="text-amber-700" />
            <Stat label="Actions to approve" value={brief?.actions.length ?? 0} tone="text-emerald-700" />
            <Stat label="Agents working" value={(c.queued || 0) + (c.processing || 0)} tone="text-blue-700" />
            <Stat label="Failed" value={c.failed || 0} tone="text-red-700" />
          </div>
        )}

        {tab === 'briefing' && brief && (
          <div className="space-y-8">
            {!brief.providers.anthropic && !brief.providers.openai && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                No AI key is set on the server, so agents are in mock mode. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on Render.
              </div>
            )}
            <QuickAdd onAdded={load} />
            {brief.questions.length === 0 && brief.actions.length === 0 && brief.failed.length === 0 && (
              <div className="rounded-xl bg-white p-8 text-center text-slate-500">Nothing waiting for you. Add a task and the team will get to work.</div>
            )}
            {brief.questions.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Answer these so the team can finish</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {brief.questions.map((q) => <QuestionCard key={q.id} q={q} onDone={load} />)}
                </div>
              </section>
            )}
            {brief.actions.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Ready for your approval</h2>
                <div className="space-y-3">{brief.actions.map((a) => <ActionCard key={a.id} a={a} onDone={load} />)}</div>
              </section>
            )}
            {brief.failed.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Needs attention</h2>
                <div className="space-y-2">
                  {brief.failed.map((t) => <TaskRow key={t.id} t={t} onOpen={() => setOpenTask(t.id)} />)}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'tasks' && (
          <div className="space-y-4">
            <QuickAdd onAdded={load} expanded />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show completed
            </label>
            <div className="space-y-2">
              {tasks.length === 0 && <div className="rounded-xl bg-white p-6 text-center text-slate-500">No tasks yet.</div>}
              {tasks.map((t) => <TaskRow key={t.id} t={t} onOpen={() => setOpenTask(t.id)} />)}
            </div>
          </div>
        )}

        {tab === 'team' && <AgentTeam />}
      </main>

      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-white p-4">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function TaskRow({ t, onOpen }: { t: Task; onOpen: () => void }) {
  const priority = ['', 'High', 'Normal', 'Low'][t.priority]
  return (
    <button onClick={onOpen} className="flex w-full items-center justify-between gap-3 rounded-xl bg-white p-4 text-left hover:ring-2 hover:ring-slate-300">
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-900">{t.title}</div>
        <div className="mt-0.5 truncate text-sm text-slate-500">
          {t.summary || t.notes || 'No notes'}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {priority} priority{t.due_date ? ` / due ${new Date(t.due_date).toLocaleDateString('en-GB')}` : ''}
          {t.open_questions ? ` / ${t.open_questions} question${t.open_questions === 1 ? '' : 's'}` : ''}
          {t.ready_actions ? ` / ${t.ready_actions} ready` : ''}
        </div>
      </div>
      <StatusBadge status={t.status} />
    </button>
  )
}

function QuickAdd({ onAdded, expanded = false }: { onAdded: () => void; expanded?: boolean }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState(2)
  const [due, setDue] = useState('')
  const [more, setMore] = useState(expanded)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setBusy(true)
    try {
      await api('/tasks', { method: 'POST', body: { title, notes, priority, due_date: due || null } })
      toast.success('Added. The team is on it.')
      setTitle(''); setNotes(''); setDue(''); setPriority(2)
      onAdded()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-white p-4">
      <div className="flex gap-2">
        <input className="flex-1 rounded-lg border border-slate-300 p-2" placeholder="Add a task for the team, e.g. Chase Corrigans for Q3 tronc sign-off"
          value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => setMore(true)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && !busy && add()} />
        <Btn primary disabled={busy || !title.trim()} onClick={add}><Plus className="h-4 w-4" />Add</Btn>
      </div>
      {more && (
        <div className="mt-3 space-y-3">
          <textarea className="w-full rounded-lg border border-slate-300 p-2 text-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Brief the team: context, people involved, numbers, what good looks like. More detail means fewer questions." />
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2 text-slate-600">Priority
              <select className="rounded-lg border border-slate-300 p-1.5" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-slate-600">Due
              <input type="date" className="rounded-lg border border-slate-300 p-1.5" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

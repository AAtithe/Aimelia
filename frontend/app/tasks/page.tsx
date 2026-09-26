'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, Briefing, Task, PRIORITY_LABEL, dueState, fmtDate, getKey, setKey } from '@/lib/todoApi'
import { ActionItem, FollowUpItem, QuestionItem, StatusPill, VoiceButton } from '@/components/tasks/Cards'
import { Routines } from '@/components/tasks/Routines'
import { Learning } from '@/components/tasks/Learning'
import { TaskDetail } from '@/components/tasks/TaskDetail'
import { AgentTeam } from '@/components/tasks/AgentTeam'

type Tab = 'briefing' | 'tasks' | 'routines' | 'learning' | 'team'

export default function TasksPage() {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  useEffect(() => setHasKey(!!getKey()), [])

  return (
    <>
      <div className="topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="wslogo" src="/assets/ws-logo.png" alt="Williams, Stanley &amp; Co." width={281} height={19} />
        <span className="topbar-app">Agent Tasks</span>
        {hasKey && <button className="topbar-guide" onClick={() => { setKey(''); setHasKey(false) }}>Sign out</button>}
      </div>
      {hasKey === null ? null : hasKey ? <Workspace onSignOut={() => { setKey(''); setHasKey(false) }} /> : <SignIn onSaved={() => setHasKey(true)} />}
    </>
  )
}

function SignIn({ onSaved }: { onSaved: () => void }) {
  const [key, setValue] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setErr('')
    setKey(key.trim())
    try {
      await api('/tasks')
      onSaved()
    } catch (e: any) {
      setKey('')
      setErr(e instanceof ApiError && e.status === 401
        ? 'That key is not the one set on the server. Check AIMELIA_ACCESS_KEY on Render.'
        : e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <h2>Sign in to Agent Tasks</h2>
      <p className="sub">Enter the access key once. This browser will remember it.</p>
      <label className="fld"><span>Access key</span>
        <input type="password" autoFocus value={key} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key && save()} />
      </label>
      <button className="btn primary" style={{ width: '100%' }} disabled={!key || busy} onClick={save}>Sign in</button>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
    </div>
  )
}

function Workspace({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('briefing')
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
      else setMsg({ ok: false, text: e.message })
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
      setMsg({ ok: true, text: 'The team has started on everything queued.' })
      setTimeout(load, 1500)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }

  const c = brief?.counts || {}
  const waiting = brief ? brief.questions.length + brief.actions.length + brief.follow_ups.length : 0
  const overdue = (tasks || []).filter((t) => dueState(t.due_date, t.status)?.label === 'Overdue').length
  const noKeys = brief && !brief.providers.anthropic && !brief.providers.openai

  return (
    <>
      <header>
        <div className="ttl">
          <h1>Your agent team</h1>
          <div className="sub">Give the team your list. It triages each item, does the work, checks it, and brings back only what needs you.</div>
        </div>
        <div className="who">
          <button className="btn ghost" onClick={load}>Refresh</button>
          <button className="btn ghost" onClick={runAll}>Run the team now</button>
        </div>
      </header>

      <div className="wrap">
        {(tab === 'briefing' || tab === 'tasks') && (
          <div className="kpis">
            <button className={`kpi pick ${brief?.questions.length ? 'warn' : 'none'}`} onClick={() => setTab('briefing')}>
              <span className="n">{brief ? brief.questions.length : '–'}</span><span className="l">Questions for you</span>
            </button>
            <button className={`kpi pick ${brief?.actions.length ? '' : 'none'}`} onClick={() => setTab('briefing')}>
              <span className="n">{brief ? brief.actions.length : '–'}</span><span className="l">Ready to approve</span>
            </button>
            <button className={`kpi pick ${brief?.follow_ups.length ? 'warn' : 'none'}`} onClick={() => setTab('briefing')}>
              <span className="n">{brief ? brief.follow_ups.length : '–'}</span><span className="l">Follow-ups due</span>
            </button>
            <button className="kpi pick" onClick={() => setTab('tasks')}>
              <span className="n">{brief ? working : '–'}</span><span className="l">Team working on</span>
            </button>
            <button className="kpi pick" onClick={() => setTab('tasks')}>
              <span className="n">{tasks ? tasks.filter((t) => t.status !== 'done').length : '–'}</span><span className="l">Open tasks</span>
            </button>
            <button className={`kpi pick ${overdue ? 'alert' : ''}`} onClick={() => setTab('tasks')}>
              <span className="n">{tasks ? overdue : '–'}</span><span className="l">Past their due date</span>
            </button>
            <button className={`kpi pick ${c.failed ? 'alert' : ''}`} onClick={() => setTab('briefing')}>
              <span className="n">{brief ? c.failed || 0 : '–'}</span><span className="l">Runs that failed</span>
            </button>
          </div>
        )}

        <div className="main-tabs" role="tablist">
          {([['briefing', 'Briefing'], ['tasks', 'All tasks'], ['routines', 'Routines'], ['learning', 'Learning'], ['team', 'Agent team']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`main-tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}{id === 'briefing' && waiting > 0 && <span className="cnt">{waiting}</span>}
            </button>
          ))}
        </div>
        <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`} style={{ marginTop: -8, marginBottom: 6 }}>{msg?.text}</div>

        {noKeys && (tab === 'briefing' || tab === 'tasks') && (
          <div className="note warn">
            No AI key is set on the server, so the agents are giving placeholder answers. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on Render.
          </div>
        )}

        {tab === 'briefing' && (!brief ? <p className="cap">Reading your briefing ...</p> : (
          <>
            <BrainDump onAdded={load} />
            {brief.questions.length > 0 && (
              <div className="card">
                <h2>Answer these so the team can finish <span className="hcount">{brief.questions.length}</span></h2>
                {brief.questions.map((q) => <QuestionItem key={q.id} q={q} onDone={load} />)}
              </div>
            )}
            {brief.follow_ups.length > 0 && (
              <div className="card">
                <h2>Delegated work due back <span className="hcount">{brief.follow_ups.length}</span></h2>
                {brief.follow_ups.map((t) => <FollowUpItem key={t.id} t={t} onDone={load} />)}
              </div>
            )}
            {brief.actions.length > 0 && (
              <div className="card">
                <h2>Ready for your approval <span className="hcount">{brief.actions.length}</span></h2>
                {brief.actions.map((a) => <ActionItem key={a.id} a={a} onDone={load} />)}
              </div>
            )}
            {brief.failed.length > 0 && (
              <div className="card">
                <h2>Runs that failed <span className="hcount">{brief.failed.length}</span></h2>
                <TaskTable tasks={brief.failed} onOpen={setOpenTask} />
              </div>
            )}
            {waiting === 0 && brief.failed.length === 0 && (
              <div className="note info">
                <b>Nothing is waiting for you.</b> {working ? `The team is working on ${working} task${working === 1 ? '' : 's'}; results appear here when they are checked.` : 'Add to the list above and the team will start.'}
              </div>
            )}
          </>
        ))}

        {tab === 'tasks' && (
          <>
            <BrainDump onAdded={load} />
            <div className="card">
              <h2>All tasks <span className="hcount">{tasks ? tasks.length : ''}</span></h2>
              <div className="body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                <label className="chk"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Include closed tasks</label>
              </div>
              {!tasks ? <div className="emptyrow">Reading ...</div>
                : tasks.length === 0 ? <div className="emptyrow">No tasks {showDone ? 'at all' : 'open'} yet.</div>
                : <TaskTable tasks={tasks} onOpen={setOpenTask} />}
            </div>
          </>
        )}

        {tab === 'routines' && <Routines />}
        {tab === 'learning' && <Learning />}
        {tab === 'team' && <AgentTeam />}
      </div>

      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </>
  )
}

function TaskTable({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr><th>Task</th><th className="nowrap">Where it is</th><th className="nowrap hide-sm">Priority</th><th className="nowrap">Due</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const due = dueState(t.due_date, t.status)
            const waiting = [t.open_questions && `${t.open_questions} question${t.open_questions === 1 ? '' : 's'} for you`,
              t.ready_actions && `${t.ready_actions} ready to approve`,
              t.status === 'scheduled' && t.scheduled_for && `parked until ${fmtDate(t.scheduled_for)}`,
              t.kind === 'follow_up' && `checking ${t.follow_up_owner || 'the owner'} delivered`,
              t.kind === 'routine' && 'from a routine'].filter(Boolean).join(', ')
            return (
              <tr key={t.id} className="click" onClick={() => onOpen(t.id)} tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}>
                <td>
                  <div className="t">{t.title}</div>
                  <div className="d">{waiting || t.summary || t.notes || 'No brief yet'}</div>
                </td>
                <td className="nowrap"><StatusPill status={t.status} /></td>
                <td className="nowrap hide-sm">{PRIORITY_LABEL[t.priority]}</td>
                <td className="nowrap">
                  {t.due_date ? fmtDate(t.due_date) : <span className="cap">None set</span>}
                  {due && <div><span className={`pill ${due.pill}`}>{due.label}</span></div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BrainDump({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<'dump' | 'one'>('dump')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(2)
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'dump') {
        const made = await api<Task[]>('/capture', { method: 'POST', body: { text } })
        setMsg({ ok: true, text: `Split into ${made.length} task${made.length === 1 ? '' : 's'}: ${made.map((t) => t.title).join('; ')}. The team is on them.` })
        setText('')
      } else {
        await api('/tasks', { method: 'POST', body: { title, notes: text, priority, due_date: due || null } })
        setMsg({ ok: true, text: 'Added. The team is on it.' })
        setTitle(''); setText(''); setDue(''); setPriority(2)
      }
      onAdded()
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const ready = mode === 'dump' ? !!text.trim() : !!title.trim()

  return (
    <div className="card">
      <h2>Give the team your list</h2>
      <div className="body">
        <div className="main-tabs" style={{ marginBottom: 10 }}>
          <button className={`main-tab-btn ${mode === 'dump' ? 'active' : ''}`} onClick={() => setMode('dump')}>Brain dump</button>
          <button className={`main-tab-btn ${mode === 'one' ? 'active' : ''}`} onClick={() => setMode('one')}>One task</button>
        </div>
        {mode === 'dump' ? (
          <>
            <p className="cap">Paste or dictate everything on your mind, as messy as it comes. It is split into separate tasks, and Triage decides which ones you do, delegate, defer or drop.</p>
            <textarea className="inp" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Brain dump"
              placeholder={'Chase Corrigans for Q3 tronc sign-off before Friday\nBentleys want to talk about labour %, book a call\nReview Sam\'s pay rise case\nPrice for the new Soho group, 6 sites'} />
          </>
        ) : (
          <>
            <label className="fld"><span>Task</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chase Corrigans for Q3 tronc sign-off"
                onKeyDown={(e) => e.key === 'Enter' && title.trim() && !busy && submit()} />
            </label>
            <label className="fld"><span>Brief: context, people, numbers, what good looks like. More detail means fewer questions.</span>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="row2">
              <label className="fld"><span>Priority</span>
                <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                  <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
                </select>
              </label>
              <label className="fld"><span>Due</span>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
          </>
        )}
        <div className="toolbar">
          <button className="btn primary" disabled={busy || !ready} onClick={submit}>
            {busy ? 'Sending ...' : mode === 'dump' ? 'Split and hand to the team' : 'Hand to the team'}
          </button>
          <VoiceButton onText={(said) => setText((prev) => (prev ? `${prev.replace(/\s+$/, '')}\n${said}` : said))} />
        </div>
        <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
      </div>
    </div>
  )
}

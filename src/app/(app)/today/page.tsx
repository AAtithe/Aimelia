'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type Briefing, type Question, type Task, dueState } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { ActionItem, FollowUpItem, QuestionItem } from '@/components/tasks/Cards'
import { CaptureBar, TaskTable } from '@/components/tasks/Shared'
import { TaskDetail } from '@/components/tasks/TaskDetail'

/** Questions on the same task sit together, in the order the briefing gives them. */
function byTask(questions: Question[]) {
  const groups = new Map<string, Question[]>()
  for (const q of questions) groups.set(q.task_id, [...(groups.get(q.task_id) || []), q])
  return [...groups.values()]
}

export default function Today() {
  const { refreshBrief } = useShell()
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const [b, t] = await Promise.all([api<Briefing>('/briefing'), api<Task[]>('/tasks')])
      setBrief(b)
      setTasks(t)
      refreshBrief()
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }, [refreshBrief])
  useEffect(() => { load() }, [load])

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
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }

  const c = brief?.counts || {}
  const waiting = brief ? brief.questions.length + brief.actions.length + brief.follow_ups.length : 0
  const overdue = (tasks || []).filter((t) => dueState(t.due_date, t.status)?.label === 'Overdue').length
  const noKeys = brief && !brief.providers.anthropic && !brief.providers.openai
  const dash = '–'

  return (
    <Shell title="Today" sub="What needs you: questions from the team, work ready to approve, and delegated work due back."
      actions={<><button className="btn ghost" onClick={load}>Refresh</button><button className="btn ghost" onClick={runAll}>Run the team now</button></>}>
      <div className="kpis">
        <div className={`kpi ${brief?.questions.length ? 'warn' : 'none'}`}><span className="n">{brief ? brief.questions.length : dash}</span><span className="l">Questions for you</span></div>
        <div className={`kpi ${brief?.actions.length ? '' : 'none'}`}><span className="n">{brief ? brief.actions.length : dash}</span><span className="l">Ready to approve</span></div>
        <div className={`kpi ${brief?.follow_ups.length ? 'warn' : 'none'}`}><span className="n">{brief ? brief.follow_ups.length : dash}</span><span className="l">Follow-ups due</span></div>
        <div className="kpi"><span className="n">{brief ? working : dash}</span><span className="l">Team working on</span></div>
        <div className={`kpi ${overdue ? 'alert' : ''}`}><span className="n">{tasks ? overdue : dash}</span><span className="l">Past their due date</span></div>
        <div className={`kpi ${c.failed ? 'alert' : ''}`}><span className="n">{brief ? c.failed || 0 : dash}</span><span className="l">Runs that failed</span></div>
      </div>
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`} style={{ marginTop: -6 }}>{msg?.text}</div>
      {noKeys && <div className="note warn">No AI key is set on the server, so the agents are giving placeholder answers. Add an AI key in <a href="/settings">Settings</a>.</div>}
      {!brief ? <p className="cap">Reading your briefing ...</p> : (
        <>
          {brief.questions.length > 0 && (
            <div className="card"><h2>Answer these so the team can finish <span className="hcount">{brief.questions.length}</span></h2>
              {byTask(brief.questions).map((g) => g.length === 1 ? <QuestionItem key={g[0].id} q={g[0]} onDone={load} /> : (
                <div key={g[0].task_id} className="qgroup">
                  <div className="qgroup-h"><span className="tag">{g[0].task_title}</span><span className="cap">{g.length} questions on this task</span></div>
                  {g.map((q) => <QuestionItem key={q.id} q={q} onDone={load} showTask={false} />)}
                </div>
              ))}</div>
          )}
          {brief.follow_ups.length > 0 && (
            <div className="card"><h2>Delegated work due back <span className="hcount">{brief.follow_ups.length}</span></h2>
              {brief.follow_ups.map((t) => <FollowUpItem key={t.id} t={t} onDone={load} />)}</div>
          )}
          {brief.actions.length > 0 && (
            <div className="card"><h2>Ready for your approval <span className="hcount">{brief.actions.length}</span></h2>
              {brief.actions.map((a) => <ActionItem key={a.id} a={a} onDone={load} />)}</div>
          )}
          {brief.failed.length > 0 && (
            <div className="card"><h2>Runs that failed <span className="hcount">{brief.failed.length}</span></h2>
              <TaskTable tasks={brief.failed} onOpen={setOpenTask} /></div>
          )}
          {waiting === 0 && brief.failed.length === 0 && (
            <div className="note info"><b>Nothing is waiting for you.</b> {working ? `The team is working on ${working} task${working === 1 ? '' : 's'}; results appear here once they are checked.` : 'Type into the bar at the bottom and the team will start.'}</div>
          )}
        </>
      )}
      <CaptureBar onAdded={load} />
      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </Shell>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type Briefing, type Question, type Task, dueState, fmtDate } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { ActionItem, FollowUpItem, QuestionItem, StatusPill } from '@/components/tasks/Cards'
import { CaptureBar, TaskTable } from '@/components/tasks/Shared'
import { TaskDetail } from '@/components/tasks/TaskDetail'
import { BackActions, type Project } from '@/components/planner/Projects'
import { FilterBar, filterQuery, useSettled, NO_FILTERS, type Filters } from '@/components/tasks/Filters'
import Link from 'next/link'

/** What an urgent task needs next, by where it is. */
const URGENT_NEXT: Record<string, string> = {
  queued: 'The team starts on it first.', processing: 'The team is on it now.',
  needs_input: 'The team needs your answer: it is at the top of Questions.', ready: 'Ready: approve it now in To approve.',
  doing: 'Approved: do it now from To do.', due: 'Check it now in Follow-ups.', failed: 'The run failed: open it and run the team again.',
  scheduled: 'Parked: open it and bring it back if it cannot wait.',
}

/** Whether an item passes the filter bar: every word somewhere in its text, and the priority if one is picked. */
function passes(f: Filters, priority: number | undefined, ...text: (string | null | undefined)[]) {
  if (f.priority && String(priority ?? '') !== f.priority) return false
  const hay = text.filter(Boolean).join(' ').toLowerCase()
  return f.q.trim().toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

/** Questions on the same task sit together, in the order the briefing gives them. */
function byTask(questions: Question[]) {
  const groups = new Map<string, Question[]>()
  for (const q of questions) groups.set(q.task_id, [...(groups.get(q.task_id) || []), q])
  return [...groups.values()]
}

type Section = 'questions' | 'approve' | 'todo' | 'follow' | 'overdue' | 'failed' | 'done'
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'questions', label: 'Questions' }, { key: 'approve', label: 'To approve' }, { key: 'todo', label: 'To do' }, { key: 'follow', label: 'Follow-ups' }, { key: 'overdue', label: 'Past due' }, { key: 'failed', label: 'Failed runs' }, { key: 'done', label: 'Completed' },
]
const TAB_KEY = 'aimelia.today.tab'

export default function Today() {
  const { refreshBrief } = useShell()
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [chosen, setChosen] = useState<Section | null>(null)
  const [f, setF] = useState<Filters>({ ...NO_FILTERS })
  const [done, setDone] = useState<Task[] | null>(null)
  useEffect(() => { try { setChosen((sessionStorage.getItem(TAB_KEY) as Section) || null) } catch { /* private window */ } }, [])
  const pick = (t: Section) => { setChosen(t); try { sessionStorage.setItem(TAB_KEY, t) } catch { /* private window */ } }

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
  const overdueTasks = (tasks || []).filter((t) => dueState(t.due_date, t.status)?.label === 'Overdue')
  const overdue = overdueTasks.length
  const noKeys = brief && !brief.providers.anthropic && !brief.providers.openai
  const dash = '–'
  // The filter bar narrows every section; the figures along the top stay whole.
  const questions = (brief?.questions || []).filter((x) => passes(f, x.task_priority, x.question, x.why, x.task_title, ...(x.also_for || []).map((t) => t.title)))
  const approvals = (brief?.actions || []).filter((a) => passes(f, a.task_priority, a.title, a.content, a.task_title))
  const toDo = (brief?.to_do || []).filter((a) => passes(f, a.task_priority, a.title, a.content, a.task_title))
  const followUps = (brief?.follow_ups || []).filter((t) => passes(f, t.priority, t.title, t.notes))
  const upcoming = (brief?.upcoming_follow_ups || []).filter((t) => passes(f, t.priority, t.title, t.notes))
  const pastDue = overdueTasks.filter((t) => passes(f, t.priority, t.title, t.notes, t.summary))
  const failed = (brief?.failed || []).filter((t) => passes(f, t.priority, t.title, t.notes, t.summary))
  const sizes: Record<Section, number> = { questions: questions.length, approve: approvals.length, todo: toDo.length,
    follow: followUps.length, overdue: pastDue.length, failed: failed.length, done: done?.length || 0 }
  // Until Tom picks one, open the first section with something in it.
  // Past due and Failed runs are only offered while they have something in them.
  const shown = (k: Section) => (k !== 'failed' || !!brief?.failed.length) && (k !== 'overdue' || overdue > 0)
  const tab: Section = chosen && shown(chosen) ? chosen
    : (['questions', 'approve', 'todo', 'follow', 'failed'] as Section[]).find((k) => sizes[k]) || 'questions'
  // Completed work, the last month of it, searched on the server with the same filters.
  const settled = useSettled(f, 250)
  const doneQs = filterQuery({ ...settled, view: 'done', closed: '30' }, { limit: '100' })
  useEffect(() => {
    if (tab !== 'done') return
    let live = true
    api<Task[]>(`/tasks?${doneQs}`).then((r) => live && setDone(r)).catch((e) => live && setMsg({ ok: false, text: e.message }))
    return () => { live = false }
  }, [tab, doneQs, brief])

  const checkNow = async (id: string) => {
    try { await api(`/tasks/${id}/follow-up`, { method: 'POST', body: { outcome: 'now' } }); load() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }

  return (
    <Shell title="Today" sub="What needs you: questions from the team, work to approve, what you approved to do, and checks on it."
      actions={<><button className="btn ghost" onClick={load}>Refresh</button><button className="btn ghost" onClick={runAll}>Run the team now</button></>}>
      <div className="kpis">
        <div role="button" tabIndex={0} onClick={() => pick('questions')} onKeyDown={(e) => e.key === 'Enter' && pick('questions')} className={`kpi go ${brief?.questions.length ? 'warn' : 'none'}`}><span className="n">{brief ? brief.questions.length : dash}</span><span className="l">Questions for you</span></div>
        <div role="button" tabIndex={0} onClick={() => pick('approve')} onKeyDown={(e) => e.key === 'Enter' && pick('approve')} className={`kpi go ${brief?.actions.length ? '' : 'none'}`}><span className="n">{brief ? brief.actions.length : dash}</span><span className="l">Ready to approve</span></div>
        <div role="button" tabIndex={0} onClick={() => pick('follow')} onKeyDown={(e) => e.key === 'Enter' && pick('follow')} className={`kpi go ${brief?.follow_ups.length ? 'warn' : 'none'}`}><span className="n">{brief ? brief.follow_ups.length : dash}</span><span className="l">Follow-ups due</span></div>
        <div role="button" tabIndex={0} onClick={() => pick('todo')} onKeyDown={(e) => e.key === 'Enter' && pick('todo')} className={`kpi go ${toDo.length ? '' : 'none'}`}><span className="n">{brief ? toDo.length : dash}</span><span className="l">Approved, to do</span></div>
        <div role="button" tabIndex={0} onClick={() => overdue && pick('overdue')} onKeyDown={(e) => e.key === 'Enter' && overdue && pick('overdue')} className={`kpi go ${overdue ? 'alert' : ''}`}><span className="n">{tasks ? overdue : dash}</span><span className="l">Past their due date</span></div>
        <div role="button" tabIndex={0} onClick={() => c.failed && pick('failed')} onKeyDown={(e) => e.key === 'Enter' && c.failed && pick('failed')} className={`kpi go ${c.failed ? 'alert' : ''}`}><span className="n">{brief ? c.failed || 0 : dash}</span><span className="l">Runs that failed</span></div>
      </div>
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`} style={{ marginTop: -6 }}>{msg?.text}</div>
      {noKeys && <div className="note warn">No AI key is set on the server, so the agents are giving placeholder answers. Add an AI key in <a href="/settings">Settings</a>.</div>}
      {!brief ? <p className="cap">Reading your briefing ...</p> : (
        <>
          {(brief.urgent?.length ?? 0) > 0 && (
            <div className="card urgentcard"><h2>Urgent and vital <span className="hcount">{brief.urgent!.length}</span></h2>
              {brief.urgent!.map((t) => (
                <div className="item flag" key={t.id}>
                  <div className="o"><StatusPill status={t.status} />{t.urgency?.reason && <span>{t.urgency.reason}</span>}</div>
                  <div className="t">{t.title}</div>
                  <div className="meta">{URGENT_NEXT[t.status] || 'Open it to see where it is.'}</div>
                  <div className="toolbar">
                    <button className="btn primary" onClick={() => setOpenTask(t.id)}>Open</button>
                    <button className="btn" onClick={() => api(`/tasks/${t.id}/urgent`, { method: 'POST', body: { urgent: false } }).then(load).catch((e) => setMsg({ ok: false, text: e.message }))}>Not urgent</button>
                  </div>
                </div>
              ))}</div>
          )}
          {(brief.planned_today?.length ?? 0) > 0 && (
            <div className="card"><h2>Planned for today <span className="hcount"><Link href="/planner">Planner</Link></span></h2>
              <TaskTable tasks={brief.planned_today!} onOpen={setOpenTask} /></div>
          )}
          {(brief.due_back?.length ?? 0) > 0 && (
            <div className="card"><h2>Back on your desk <span className="hcount">{brief.due_back!.length}</span></h2>
              {brief.due_back!.map((p) => (
                <div className="item" key={p.id}>
                  <div className="o"><span className="tag">{p.kind === 'project' ? 'Project review' : 'You wanted to come back to this'}</span></div>
                  <div className="t"><Link href="/projects">{p.title}</Link></div>
                  {p.notes && <div className="d">{p.notes.length > 240 ? `${p.notes.slice(0, 240)} ...` : p.notes}</div>}
                  <BackActions p={p as unknown as Project} onDone={load} />
                </div>
              ))}</div>
          )}
          <p className="cap today-flow">Answer the questions, approve the work, do what you approved, then check it came back.{working ? ` The team is working on ${working} task${working === 1 ? '' : 's'}.` : ''}</p>
          <FilterBar f={f} set={setF} full={false} />
          <div className="main-tabs today-tabs" role="tablist">
            {SECTIONS.filter((x) => shown(x.key)).map((x) => (
              <button key={x.key} role="tab" aria-selected={tab === x.key} className={`main-tab-btn ${tab === x.key ? 'active' : ''}`} onClick={() => pick(x.key)}>
                {x.label}{x.key !== 'done' && <span className="hcount">{sizes[x.key]}</span>}
              </button>
            ))}
          </div>

          {tab === 'questions' && (
            <div className="card"><h2>Answer these so the team can finish <span className="hcount">{questions.length}</span></h2>
              {questions.length === 0 ? <div className="emptyrow">{brief.questions.length ? 'No question matches the filter.' : 'No questions for you.'}</div>
                : byTask(questions).map((g) => g.length === 1 ? <QuestionItem key={g[0].id} q={g[0]} onDone={load} /> : (
                  <div key={g[0].task_id} className="qgroup">
                    <div className="qgroup-h"><span className="tag">{g[0].task_title}</span><span className="cap">{g.length} questions on this task</span></div>
                    {g.map((q) => <QuestionItem key={q.id} q={q} onDone={load} showTask={false} />)}
                  </div>
                ))}</div>
          )}

          {tab === 'approve' && (
            <div className="card"><h2>Ready for your approval <span className="hcount">{approvals.length}</span></h2>
              {approvals.length === 0 ? <div className="emptyrow">{brief.actions.length ? 'Nothing matches the filter.' : 'Nothing to approve. Finished work appears here once the reviewer has checked it.'}</div>
                : approvals.map((a) => <ActionItem key={a.id} a={a} onDone={load} />)}</div>
          )}

          {tab === 'todo' && (
            <div className="card"><h2>Approved, for you to do <span className="hcount">{toDo.length}</span></h2>
              {toDo.length === 0 ? <div className="emptyrow">Nothing waiting on you. What you approve lands here until you have sent it, made the call or used it.</div>
                : toDo.map((a) => <ActionItem key={a.id} a={a} onDone={load} />)}</div>
          )}

          {tab === 'follow' && (<>
            <div className="card"><h2>Due for a check <span className="hcount">{followUps.length}</span></h2>
              {followUps.length === 0 ? <div className="emptyrow">Nothing due back today.</div>
                : followUps.map((t) => <FollowUpItem key={t.id} t={t} onDone={load} />)}</div>
            <div className="card"><h2>Coming up <span className="hcount">{upcoming.length}</span></h2>
              {upcoming.length === 0 ? <div className="emptyrow">Nothing scheduled. Approving an email, a call or a handover schedules a check a week later.</div>
                : <div className="tblwrap"><table>
                  <thead><tr><th>Check</th><th className="nowrap">On</th><th></th></tr></thead>
                  <tbody>{upcoming.map((t) => (
                    <tr key={t.id}>
                      <td><div className="t">{t.title}</div><div className="d">{t.follow_up_type === 'email' ? 'Reply to an email' : t.follow_up_type === 'call' ? 'A call' : 'Delegated work'}</div></td>
                      <td className="nowrap">{t.scheduled_for ? fmtDate(t.scheduled_for) : ''}</td>
                      <td className="nowrap numcell"><button className="btn" onClick={() => checkNow(t.id)}>Check now</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>}
            </div>
          </>)}

          {tab === 'overdue' && overdue > 0 && (
            <div className="card"><h2>Past their due date <span className="hcount">{pastDue.length}</span></h2>
              {pastDue.length ? <TaskTable tasks={pastDue} onOpen={setOpenTask} /> : <div className="emptyrow">Nothing matches the filter.</div>}
              <div className="body" style={{ paddingTop: 8, paddingBottom: 12 }}>
                <Link href="/tasks?due=overdue">See every past-due task, with more filters, in All tasks</Link>
              </div>
            </div>
          )}

          {tab === 'failed' && brief.failed.length > 0 && (
            <div className="card"><h2>Runs that failed <span className="hcount">{failed.length}</span></h2>
              {failed.length ? <TaskTable tasks={failed} onOpen={setOpenTask} /> : <div className="emptyrow">Nothing matches the filter.</div>}</div>
          )}

          {tab === 'done' && (
            <div className="card"><h2>Completed in the last month <span className="hcount">{done ? done.length : ''}</span></h2>
              {!done ? <div className="emptyrow">Reading ...</div>
                : done.length === 0 ? <div className="emptyrow">{f.q || f.priority ? 'Nothing completed in the last month matches the filter.' : 'Nothing completed in the last month.'}</div>
                : <TaskTable tasks={done} onOpen={setOpenTask} />}
              <div className="body" style={{ paddingTop: 8, paddingBottom: 12 }}>
                <Link href={`/tasks?${filterQuery({ ...settled, view: 'done' })}`}>See everything completed, with more filters, in All tasks</Link>
              </div>
            </div>
          )}
        </>
      )}
      <CaptureBar onAdded={load} />
      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </Shell>
  )
}

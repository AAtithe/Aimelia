'use client'

/**
 * Projects and ideas: projects with their tasks and progress, and items to come back to. What is due back sits at the top.
 * An item can become a task; a project can be handed to the agent team to plan its next steps.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, PRIORITY_LABEL } from '@/lib/client/todo'
import { StatusPill } from '@/components/tasks/Cards'
import { TaskDetail } from '@/components/tasks/TaskDetail'

export type Project = { id: string; kind: 'project' | 'item'; title: string; notes: string; outcome: string; next_step: string; link: string
  status: 'active' | 'someday' | 'done' | 'dropped'; review_on: string | null; reviewed_at: string | null; created_at: string; open_tasks?: number; done_tasks?: number }
type PTask = { id: string; title: string; status: any; priority: number; due_date: string | null; planned_for: string | null; summary: string }
type Tab = 'back' | 'project' | 'item' | 'closed'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const PUSH: [string, number][] = [['a week', 7], ['a fortnight', 14], ['a month', 30], ['three months', 91]]

/** The buttons for something due back: shared with Today. */
export function BackActions({ p, onDone }: { p: Project; onDone: () => void }) {
  const [err, setErr] = useState('')
  const act = async (path: string, body: unknown = {}) => { try { await api(`/projects/${p.id}/${path}`, { method: 'POST', body }); onDone() } catch (e: any) { setErr(e.message) } }
  const close = async (status: 'done' | 'dropped') => { try { await api(`/projects/${p.id}`, { method: 'PATCH', body: { status } }); onDone() } catch (e: any) { setErr(e.message) } }
  return (
    <>
      <div className="toolbar">
        {p.kind === 'item' ? <button className="btn primary sm" onClick={() => act('task')}>Make it a task</button>
          : <button className="btn primary sm" onClick={() => act('plan')}>Have the team plan next steps</button>}
        <select aria-label="Come back to it in" value="" onChange={(e) => e.target.value && act('reviewed', { days: Number(e.target.value) })}>
          <option value="">{p.kind === 'project' ? 'Reviewed: next in ...' : 'Come back in ...'}</option>
          {PUSH.map(([l, d]) => <option key={d} value={d}>{l}</option>)}
        </select>
        <button className="btn sm" onClick={() => close('done')}>Done</button>
        <button className="btn sm" onClick={() => close('dropped')}>Drop it</button>
      </div>
      {err && <div className="msg err">{err}</div>}
    </>
  )
}

function Editor({ p, onDone, onCancel }: { p?: Project; onDone: () => void; onCancel?: () => void }) {
  const [f, setF] = useState({ kind: p?.kind || 'item', title: p?.title || '', notes: p?.notes || '', outcome: p?.outcome || '', next_step: p?.next_step || '',
    link: p?.link || '', review_on: p?.review_on || '', status: p?.status === 'someday' ? 'someday' : 'active' })
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setF({ ...f, [k]: v })
  const save = async () => {
    try {
      const body = { ...f, review_on: f.review_on || null }
      if (p) await api(`/projects/${p.id}`, { method: 'PATCH', body }); else await api('/projects', { method: 'POST', body })
      if (!p) setF({ ...f, title: '', notes: '', outcome: '', next_step: '', link: '', review_on: '' })
      onDone()
    } catch (e: any) { setErr(e.message) }
  }
  return (
    <div className="body">
      <div className="row2">
        <label className="fld"><span>What is it?</span><select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
          <option value="item">Something to come back to</option><option value="project">A project</option></select></label>
        <label className="fld"><span>Come back to it on (a {f.kind === 'project' ? 'fortnight' : 'month'} if left empty)</span>
          <input type="date" min={today()} value={f.review_on} onChange={(e) => set('review_on', e.target.value)} /></label>
      </div>
      <label className="fld"><span>Title</span><input value={f.title} onChange={(e) => set('title', e.target.value)}
        placeholder={f.kind === 'project' ? 'Launch the payroll bureau service' : 'Look at buying a second practice in the South West'} /></label>
      <label className="fld"><span>Notes</span><textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      {f.kind === 'project' && (
        <div className="row2">
          <label className="fld"><span>What done looks like</span><input value={f.outcome} onChange={(e) => set('outcome', e.target.value)} placeholder="Ten clients live by March" /></label>
          <label className="fld"><span>Next step</span><input value={f.next_step} onChange={(e) => set('next_step', e.target.value)} placeholder="Price it with Mandy" /></label>
        </div>
      )}
      <div className="row2">
        <label className="fld"><span>Link (optional)</span><input value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" /></label>
        <label className="chk" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.status === 'someday'} onChange={(e) => set('status', e.target.checked ? 'someday' : 'active')} />Someday, not now</label>
      </div>
      <div className="toolbar">
        <button className="btn primary" disabled={!f.title.trim()} onClick={save}>{p ? 'Save' : 'Keep it'}</button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
      </div>
      {err && <div className="msg err">{err}</div>}
    </div>
  )
}

function ProjectCard({ p, due, onDone, onOpenTask }: { p: Project; due: boolean; onDone: () => void; onOpenTask: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tasks, setTasks] = useState<PTask[] | null>(null)
  const [newTask, setNewTask] = useState('')
  const [err, setErr] = useState('')
  const loadTasks = useCallback(() => api<{ tasks: PTask[] }>(`/projects/${p.id}`).then((r) => setTasks(r.tasks)).catch((e) => setErr(e.message)), [p.id])
  useEffect(() => { if (open && p.kind === 'project') loadTasks() }, [open, p.kind, loadTasks])
  const add = async () => {
    try { await api(`/projects/${p.id}/task`, { method: 'POST', body: { title: newTask } }); setNewTask(''); loadTasks(); onDone() } catch (e: any) { setErr(e.message) }
  }
  const remove = async () => {
    if (!confirm(p.kind === 'project' ? 'Delete this project? Its tasks stay, outside any project.' : 'Delete this?')) return
    try { await api(`/projects/${p.id}`, { method: 'DELETE' }); onDone() } catch (e: any) { setErr(e.message) }
  }
  const total = (p.open_tasks || 0) + (p.done_tasks || 0)
  return (
    <div className="item">
      <div className="o">
        <span className="tag">{p.kind === 'project' ? 'Project' : 'To come back to'}</span>
        {p.status === 'someday' && <span className="tag">Someday</span>}
        {p.status === 'done' && <span className="pill Done">Done</span>}
        {p.status === 'dropped' && <span className="pill Parked">Dropped</span>}
        {p.review_on && ['active', 'someday'].includes(p.status) && <span>{due ? <span className="pill Atrisk">Back today</span> : `back ${fmtDate(p.review_on)}`}</span>}
        {p.kind === 'project' && <span>{total ? `${p.done_tasks} of ${total} tasks done` : 'no tasks yet'}</span>}
      </div>
      {editing ? <Editor p={p} onDone={() => { setEditing(false); onDone() }} onCancel={() => setEditing(false)} /> : (
        <>
          <button className="linkbtn t" style={{ textAlign: 'left' }} onClick={() => setOpen(!open)}>{p.title}</button>
          {p.outcome && <div className="d">Done looks like: {p.outcome}</div>}
          {p.next_step && <div className="d">Next step: {p.next_step}</div>}
          {open && (
            <div className="body" style={{ padding: '6px 0 0' }}>
              {p.notes && <div className="content">{p.notes}</div>}
              {p.link && <p><a href={p.link} target="_blank" rel="noreferrer">{p.link}</a></p>}
              {p.kind === 'project' && (
                <>
                  <div className="meta">Tasks</div>
                  {!tasks ? <p className="cap">Reading ...</p> : tasks.length === 0 ? <p className="cap">None yet.</p> : (
                    <ul className="log">{tasks.map((t) => <li key={t.id}><button className="linkbtn" onClick={() => onOpenTask(t.id)}>{t.title}</button> <StatusPill status={t.status} />
                      <span className="when">{PRIORITY_LABEL[t.priority]}{t.due_date ? `, due ${fmtDate(t.due_date)}` : ''}{t.planned_for ? `, planned ${fmtDate(t.planned_for)}` : ''}</span></li>)}</ul>
                  )}
                  <div className="toolbar">
                    <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task to this project" aria-label="New task"
                      onKeyDown={(e) => e.key === 'Enter' && newTask.trim() && add()} />
                    <button className="btn sm" disabled={!newTask.trim()} onClick={add}>Add and hand to the team</button>
                  </div>
                </>
              )}
            </div>
          )}
          {['active', 'someday'].includes(p.status) && <BackActions p={p} onDone={onDone} />}
          <div className="toolbar">
            <button className="btn sm" onClick={() => setEditing(true)}>Change</button>
            {!['active', 'someday'].includes(p.status) && <button className="btn sm" onClick={() => api(`/projects/${p.id}`, { method: 'PATCH', body: { status: 'active' } }).then(onDone)}>Bring it back</button>}
            <button className="btn danger sm" onClick={remove}>Delete</button>
          </div>
        </>
      )}
      {err && <div className="msg err">{err}</div>}
    </div>
  )
}

export function Projects() {
  const [tab, setTab] = useState<Tab>('back')
  const [data, setData] = useState<{ projects: Project[]; due_back: string[] } | null>(null)
  const [err, setErr] = useState('')
  const [openTask, setOpenTask] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setData(await api(`/projects${tab === 'closed' ? '?all=true' : ''}`)) } catch (e: any) { setErr(e.message) }
  }, [tab])
  useEffect(() => { load() }, [load])
  const due = new Set(data?.due_back || [])
  const list = !data ? [] : tab === 'back' ? data.projects.filter((p) => due.has(p.id))
    : tab === 'closed' ? data.projects.filter((p) => ['done', 'dropped'].includes(p.status))
    : data.projects.filter((p) => p.kind === tab && ['active', 'someday'].includes(p.status))
  const tabs: [Tab, string][] = [['back', `Back on your desk${data ? ` (${due.size})` : ''}`], ['project', 'Projects'], ['item', 'To come back to'], ['closed', 'Done and dropped']]
  return (
    <>
      <div className="card">
        <h2>Keep something for later</h2>
        <Editor onDone={load} />
      </div>
      <div className="card">
        <div className="body"><div className="main-tabs" style={{ marginBottom: 0 }}>
          {tabs.map(([k, l]) => <button key={k} className={`main-tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        </div></div>
        {!data ? <div className="emptyrow">{err || 'Reading ...'}</div> : list.length === 0 ? (
          <div className="emptyrow">{tab === 'back' ? 'Nothing is due back today.' : tab === 'closed' ? 'Nothing closed yet.' : 'Nothing here yet.'}</div>
        ) : list.map((p) => <ProjectCard key={p.id} p={p} due={due.has(p.id)} onDone={load} onOpenTask={setOpenTask} />)}
      </div>
      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </>
  )
}

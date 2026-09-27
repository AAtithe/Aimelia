'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Task } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { CaptureBar, TaskTable } from '@/components/tasks/Shared'
import { TaskDetail } from '@/components/tasks/TaskDetail'
import { FilterBar, filterQuery, onSearch, readFilters, useSettled, NO_FILTERS, VIEWS, type Filters } from '@/components/tasks/Filters'

export default function AllTasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const [ready, setReady] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const seq = useRef(0)

  // The filters live in the address, so a search can be linked to, reloaded and gone back to.
  useEffect(() => {
    const fromUrl = () => {
      setF(readFilters(window.location.search))
      const open = new URLSearchParams(window.location.search).get('open')
      if (open) setOpenTask(open)
    }
    fromUrl()
    setReady(true)
    window.addEventListener('popstate', fromUrl)
    const off = onSearch((q, open) => { setF({ ...NO_FILTERS, q, view: 'all' }); if (open) setOpenTask(open) })
    return () => { window.removeEventListener('popstate', fromUrl); off() }
  }, [])

  const settled = useSettled(f, 250)
  const qs = filterQuery(settled)
  useEffect(() => {
    if (!ready) return
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', url)
  }, [qs, ready])

  const load = useCallback(async () => {
    if (!ready) return
    const n = ++seq.current
    try {
      const r = await api<Task[]>(`/tasks${qs ? `?${qs}` : ''}`)
      if (n === seq.current) { setTasks(r); setErr('') }
    } catch (e: any) { setErr(e.message) }
  }, [qs, ready])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const busy = (tasks || []).some((t) => t.status === 'queued' || t.status === 'processing')
    const t = setInterval(load, busy ? 8000 : 60000)
    return () => clearInterval(t)
  }, [tasks, load])

  const viewLabel = VIEWS.find(([v]) => v === settled.view)?.[1] || 'Open'
  const filtered = qs !== ''

  return (
    <Shell title="All tasks" sub="Everything on the list, open and completed: search it, filter it, and see where each task is.">
      <div className="card">
        <h2>{settled.q ? `Tasks matching "${settled.q}"` : `${viewLabel} tasks`} <span className="hcount">{tasks ? tasks.length : ''}</span></h2>
        <div className="body" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <FilterBar f={f} set={setF} />
        </div>
        {!tasks ? <div className="emptyrow">Reading ...</div>
          : tasks.length === 0 ? <div className="emptyrow">{filtered ? 'No task matches these filters. Try fewer words, or Everything instead of Open.' : 'No open tasks yet. Type into the bar at the bottom to add some.'}</div>
          : <TaskTable tasks={tasks} onOpen={setOpenTask} />}
        {tasks && tasks.length >= 300 && <div className="emptyrow">Showing the first 300. Narrow the filters to see the rest.</div>}
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
      <CaptureBar onAdded={load} />
      {openTask && <TaskDetail taskId={openTask} onClose={() => {
        setOpenTask(null)
        load()
      }} onChanged={load} />}
    </Shell>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type Task } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { CaptureBar, TaskTable } from '@/components/tasks/Shared'
import { TaskDetail } from '@/components/tasks/TaskDetail'

export default function AllTasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try { setTasks(await api<Task[]>(`/tasks${showDone ? '?include_done=true' : ''}`)) } catch (e: any) { setErr(e.message) }
  }, [showDone])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const busy = (tasks || []).some((t) => t.status === 'queued' || t.status === 'processing')
    const t = setInterval(load, busy ? 8000 : 60000)
    return () => clearInterval(t)
  }, [tasks, load])

  return (
    <Shell title="All tasks" sub="Everything on the list, where it is, and what it is waiting for.">
      <div className="card">
        <h2>All tasks <span className="hcount">{tasks ? tasks.length : ''}</span></h2>
        <div className="body" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <label className="chk"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Include closed tasks</label>
        </div>
        {!tasks ? <div className="emptyrow">Reading ...</div> : tasks.length === 0 ? <div className="emptyrow">No tasks {showDone ? 'at all' : 'open'} yet.</div> : <TaskTable tasks={tasks} onOpen={setOpenTask} />}
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
      <CaptureBar onAdded={load} />
      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </Shell>
  )
}

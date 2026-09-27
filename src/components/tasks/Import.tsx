'use client'

/**
 * Bring tasks in from elsewhere: Word documents and notes, meeting notes and transcripts, Fireflies,
 * and Microsoft To Do. Everything imported goes to Triage like any other task.
 * Reads by the AI (PDFs, documents, meeting notes) run as jobs on the server: the screen polls the job,
 * and the work carries on if the page is closed.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, type Task } from '@/lib/client/todo'
import { MsgLine, type Msg } from '@/components/mail/common'

type Status = {
  file_types: string[]
  microsoft_todo: { configured: boolean; connected: boolean }
  fireflies: boolean
  recent: { source: string; label: string; title: string; task_count: number; imported_at: string }[]
  microsoft_todo_imported: number
  microsoft_todo_last: string | null
  jobs: Job[]
}
type Job = { id: string; status: 'queued' | 'reading' | 'done' | 'failed' | 'duplicate'; title: string; error: string | null
  prior: { imported_at: string | null; task_count: number } | null; created_at: string; started_at: string | null; finished_at: string | null }
const active = (j: Job) => j.status === 'queued' || j.status === 'reading'
const seconds = (from: string | null) => (from ? Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 1000)) : 0)
const elapsed = (s: number) => (s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60} s`)
type Kind = 'document' | 'meeting' | 'list'
type Tab = 'file' | 'paste' | 'todo' | 'fireflies'

const MAX_BYTES = 3 * 1024 * 1024
const made = (tasks: Task[]) => `${tasks.length} task${tasks.length === 1 ? '' : 's'} added and handed to Triage: ${tasks.slice(0, 6).map((t) => t.title).join('; ')}${tasks.length > 6 ? ' ...' : ''}.`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send an import. Lists come back as tasks at once (201); anything the AI reads comes back as a job (202),
 * which is polled here with the time so far. On 409 (seen before) offer to import it again.
 */
function useImport(onAdded: () => void) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [again, setAgain] = useState<(() => void) | null>(null)
  const send = useCallback(async (path: string, body: Record<string, unknown>, after?: () => void) => {
    setBusy(true); setMsg(null); setAgain(null)
    const offerAgain = () => setAgain(() => () => send(path, { ...body, force: true }, after))
    try {
      const r = await api<Task[] | { job: Job }>(path, { method: 'POST', body })
      if (Array.isArray(r)) { setMsg({ ok: true, text: made(r) }); after?.(); onAdded(); return }
      after?.()
      onAdded()
      let job = r.job
      const started = Date.now()
      // Poll until the job ends. If this page is left, the job carries on and its tasks still arrive.
      while (active(job)) {
        const s = Math.round((Date.now() - started) / 1000)
        setMsg({ ok: true, text: `${job.status === 'queued' ? 'Queued' : 'Reading'} ${job.title}: ${elapsed(s)} so far. A long PDF can take two or three minutes. You can leave this page; the tasks will appear in All tasks when it is done.` })
        await sleep(3000)
        try { job = (await api<{ job: Job }>(`/import/jobs/${job.id}`)).job } catch { /* a missed poll is retried */ }
      }
      const final = await api<{ job: Job; tasks: Task[] }>(`/import/jobs/${job.id}`)
      if (final.job.status === 'done') setMsg({ ok: true, text: made(final.tasks) })
      else if (final.job.status === 'duplicate') {
        setMsg({ ok: false, text: `Already imported${final.job.prior?.imported_at ? ` on ${fmtDate(final.job.prior.imported_at)}` : ''} as ${final.job.prior?.task_count ?? 0} tasks.` })
        offerAgain()
      } else setMsg({ ok: false, text: final.job.error || 'The read failed.' })
      onAdded()
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
      if (e.status === 409) offerAgain()
    } finally {
      setBusy(false)
    }
  }, [onAdded])
  return { busy, msg, again, send, setMsg }
}

/** Reads still going, or ended in the last day, so a closed page or a second tab still shows where they are. */
function Jobs({ jobs }: { jobs: Job[] }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  if (!jobs.length) return null
  return (
    <div className="card">
      <h2>Reading now and today</h2>
      <ul className="log body">{jobs.map((j) => (
        <li key={j.id}><span className="who">{j.title}</span>{' '}
          {j.status === 'reading' ? `reading, ${elapsed(seconds(j.started_at))} so far`
            : j.status === 'queued' ? 'waiting to start'
            : j.status === 'done' ? 'done'
            : j.status === 'duplicate' ? 'already imported before'
            : `failed: ${j.error || 'the read did not finish'}`}
          <span className="when">{fmtDate(j.created_at)}</span></li>
      ))}</ul>
    </div>
  )
}

function Result({ msg, again }: { msg: Msg; again: (() => void) | null }) {
  return (
    <>
      <MsgLine msg={msg} />
      {again && <div className="toolbar"><button className="btn" onClick={again}>Import it again anyway</button></div>}
    </>
  )
}

function KindPicker({ kind, setKind }: { kind: Kind; setKind: (k: Kind) => void }) {
  return (
    <label className="fld"><span>What is it?</span>
      <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        <option value="meeting">Meeting notes or a transcript: pull out the actions</option>
        <option value="document">A document: pull out the actions</option>
        <option value="list">A list of tasks: one task per line, as written</option>
      </select>
    </label>
  )
}

function FileImport({ types, onAdded }: { types: string[]; onAdded: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<Kind | ''>('')
  const imp = useImport(onAdded)
  const go = async () => {
    if (!file) return
    if (file.size > MAX_BYTES) return imp.setMsg({ ok: false, text: 'That file is over 3 MB. Save a copy without images, or paste the text instead.' })
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    imp.send('/import/file', { filename: file.name, data: btoa(bin), ...(kind ? { kind } : {}) })
  }
  return (
    <>
      <p className="cap">A Word document or PDF, meeting minutes, a transcript (.vtt or .srt from Teams, Zoom or Fireflies), or a task list exported from Outlook
        as .csv. Documents and meetings are read for the actions only; discussion and background are left out. Anyone else named as owner is kept,
        so Triage can hand it to them. PDFs are read by Claude page by page, including tables and scanned pages, so they need the Claude key in Settings.</p>
      <div className="row2">
        <label className="fld"><span>File ({types.join(', ')})</span>
          <input type="file" accept={types.join(',')} onChange={(e) => { setFile(e.target.files?.[0] || null); imp.setMsg(null) }} />
        </label>
        <label className="fld"><span>Read it as</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')}>
            <option value="">Decide from the file type</option>
            <option value="meeting">Meeting notes or a transcript</option>
            <option value="document">A document</option>
            <option value="list">A list of tasks, as written</option>
          </select>
        </label>
      </div>
      <div className="toolbar"><button className="btn primary" disabled={!file || imp.busy} onClick={go}>{imp.busy ? 'Reading ...' : 'Import'}</button></div>
      <Result msg={imp.msg} again={imp.again} />
    </>
  )
}

function PasteImport({ onAdded }: { onAdded: () => void }) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Kind>('meeting')
  const imp = useImport(onAdded)
  return (
    <>
      <p className="cap">Paste meeting notes, a Fireflies or Teams recap email, Otter notes, or a list of tasks copied from anywhere.</p>
      <div className="row2">
        <KindPicker kind={kind} setKind={setKind} />
        <label className="fld"><span>Name it (optional, shown on each task)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bentleys monthly review, 24 Sept" />
        </label>
      </div>
      <textarea className="inp" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Notes to import"
        placeholder={kind === 'list' ? 'Chase Corrigans for Q3 tronc sign-off\nBook Bentleys labour call\nPrice the Soho group, 6 sites'
          : 'Action items\nMandy: chase the Bentleys P60s by Friday\nTom: send Corrigans the revised budget\nAgreed labour target of 30% from October'} />
      <div className="toolbar">
        <button className="btn primary" disabled={!text.trim() || imp.busy} onClick={() => imp.send('/import/text', { text, kind, title }, () => { setText(''); setTitle('') })}>
          {imp.busy ? 'Reading ...' : kind === 'list' ? 'Add these tasks' : 'Pull out the actions'}
        </button>
      </div>
      <Result msg={imp.msg} again={imp.again} />
    </>
  )
}

function TodoImport({ status, onAdded }: { status: Status; onAdded: () => void }) {
  const ms = status.microsoft_todo
  const [lists, setLists] = useState<{ id: string; name: string; kind: string }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  useEffect(() => {
    if (!ms.connected) return
    api<{ lists: { id: string; name: string; kind: string }[] }>('/import/todo/lists')
      .then((r) => { setLists(r.lists); setPicked(r.lists.filter((l) => l.kind === 'defaultList').map((l) => l.id)) })
      .catch((e) => setMsg({ ok: false, text: e.message }))
  }, [ms.connected])
  const go = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await api<{ tasks: Task[]; skipped: number }>('/import/todo', { method: 'POST', body: { list_ids: picked } })
      setMsg({ ok: true, text: `${r.tasks.length ? made(r.tasks) : 'No new tasks.'}${r.skipped ? ` ${r.skipped} already imported, left alone.` : ''}` })
      onAdded()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  if (!ms.connected) {
    return (
      <>
        <p>Aimelia reads your To Do lists directly once Microsoft 365 is connected{ms.configured ? '' : ' (it is paused until the Microsoft app is set up)'}. Until then, either of these works now:</p>
        <p className="cap">1. In To Do, open the list, choose the three dots, then Email list and paste the text into Paste notes as a list of tasks, or Print list, save as PDF, and upload the PDF under From a file.<br />
          2. In Outlook, File, Open and Export, Export to a file, Comma Separated Values, Tasks folder. Upload the .csv under From a file.
          Titles, due dates, priority and notes come across; completed tasks are skipped.</p>
        {ms.configured && <div className="toolbar"><Link className="btn" href="/settings">Connect Microsoft 365</Link></div>}
      </>
    )
  }
  return (
    <>
      <p className="cap">Every open task in the lists you tick comes across with its due date, importance, notes and open steps. Aimelia only reads To Do; nothing
        there is changed or ticked off. Run it again whenever you like: tasks already brought in are skipped.
        {status.microsoft_todo_imported > 0 && ` ${status.microsoft_todo_imported} imported so far, last on ${fmtDate(status.microsoft_todo_last)}.`}</p>
      {!lists ? <div className="emptyrow">Reading your lists ...</div> : lists.map((l) => (
        <label className="chk" key={l.id}><input type="checkbox" checked={picked.includes(l.id)}
          onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />{l.name}{l.kind === 'flaggedEmails' ? ' (flagged emails)' : ''}</label>
      ))}
      <div className="toolbar"><button className="btn primary" disabled={!picked.length || busy} onClick={go}>{busy ? 'Importing ...' : 'Import open tasks'}</button></div>
      <MsgLine msg={msg} />
    </>
  )
}

type Meeting = { id: string; title: string; date: string | null; minutes: number | null; has_actions: boolean; imported: boolean }

function FirefliesImport({ connected, onAdded }: { connected: boolean; onAdded: () => void }) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [err, setErr] = useState('')
  const imp = useImport(onAdded)
  const load = useCallback(() => { api<{ meetings: Meeting[] }>('/import/fireflies').then((r) => setMeetings(r.meetings)).catch((e) => setErr(e.message)) }, [])
  useEffect(() => { if (connected) load() }, [connected, load])

  if (!connected) {
    return (
      <p>Add your Fireflies API key in <Link href="/settings">Settings</Link> (in Fireflies: Settings, Developer settings, API key). Aimelia then lists your recent
        meetings and turns each one&apos;s action items into tasks. Until then, paste the Fireflies recap email into Paste notes.</p>
    )
  }
  return (
    <>
      <p className="cap">Recent meetings from Fireflies. Importing one reads its action items and overview, and keeps who owns each action.</p>
      {err ? <div className="msg err">{err}</div> : !meetings ? <div className="emptyrow">Reading Fireflies ...</div> : meetings.length === 0 ? <div className="emptyrow">No meetings in Fireflies yet.</div> : (
        <div className="tblwrap"><table>
          <thead><tr><th>Meeting</th><th className="nowrap">When</th><th className="nowrap"></th></tr></thead>
          <tbody>{meetings.map((m) => (
            <tr key={m.id}>
              <td><div className="t">{m.title}</div><div className="d">{m.minutes ? `${m.minutes} minutes` : ''}{!m.has_actions && ' No action items yet'}</div></td>
              <td className="nowrap">{fmtDate(m.date)}</td>
              <td className="nowrap">{m.imported ? <span className="pill Done">Imported</span>
                : <button className="btn" disabled={imp.busy || !m.has_actions} onClick={() => imp.send(`/import/fireflies/${encodeURIComponent(m.id)}`, {}, load)}>Import</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Result msg={imp.msg} again={imp.again} />
    </>
  )
}

export function ImportTasks() {
  const [tab, setTab] = useState<Tab>('todo')
  const [status, setStatus] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { api<Status>('/import').then(setStatus).catch((e) => setErr(e.message)) }, [])
  useEffect(() => { load() }, [load])
  const reading = !!status?.jobs.some(active)
  useEffect(() => {
    if (!reading) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [reading, load])

  const tabs: [Tab, string][] = [['todo', 'Microsoft To Do'], ['file', 'From a file'], ['paste', 'Paste notes'], ['fireflies', 'Fireflies']]
  return (
    <>
      <div className="card">
        <h2>Bring your tasks in</h2>
        <div className="body">
          <div className="main-tabs" style={{ marginBottom: 10 }}>
            {tabs.map(([k, label]) => <button key={k} className={`main-tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          {!status ? <div className="emptyrow">{err || 'Reading ...'}</div>
            : tab === 'file' ? <FileImport types={status.file_types} onAdded={load} />
            : tab === 'paste' ? <PasteImport onAdded={load} />
            : tab === 'todo' ? <TodoImport status={status} onAdded={load} />
            : <FirefliesImport connected={status.fireflies} onAdded={load} />}
        </div>
      </div>
      {status && <Jobs jobs={status.jobs} />}
      {status && status.recent.length > 0 && (
        <div className="card">
          <h2>Imported so far</h2>
          <ul className="log body">{status.recent.map((r, i) => (
            <li key={i}><span className="who">{r.title || r.label}</span> {r.task_count} task{r.task_count === 1 ? '' : 's'} from {r.label}<span className="when">{fmtDate(r.imported_at)}</span></li>
          ))}</ul>
        </div>
      )}
    </>
  )
}

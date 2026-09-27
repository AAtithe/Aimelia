'use client'

/**
 * Documents on a task: attach policies, procedures, risk assessments, letters or photos of paperwork; Claude reads and
 * assesses each one, and the agent team works the assessment through. Shows each assessment in full.
 */
import { useState } from 'react'
import { api, fmtDateTime, type TaskFile } from '@/lib/client/todo'

const MAX_BYTES = 3 * 1024 * 1024
const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.vtt,.srt,.png,.jpg,.jpeg,.gif,.webp'
const RATING: Record<string, [string, string]> = { red: ['Overdue', 'Red'], amber: ['Atrisk', 'Amber'], green: ['Done', 'Green'] }
const OVERALL: Record<string, string> = { sound: 'Done', 'needs work': 'Atrisk', 'not fit for purpose': 'Overdue' }

async function toBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Attach files to a task, in batches under the upload limit. Used here and when a task is first created. */
export async function attachToTask(taskId: string, files: File[], o: { purpose?: string; keep?: boolean } = {}) {
  const big = files.find((f) => f.size > MAX_BYTES)
  if (big) throw new Error(`${big.name} is over 3 MB. Save a smaller copy (without images, or fewer pages) and attach that.`)
  let batch: File[] = []
  let size = 0
  const send = async () => {
    if (!batch.length) return
    await api(`/tasks/${taskId}/files`, { method: 'POST', body: { files: await Promise.all(batch.map(async (f) => ({ name: f.name, data: await toBase64(f) }))),
      purpose: o.purpose || '', keep_in_knowledge: !!o.keep } })
    batch = []; size = 0
  }
  for (const f of files) {
    if (size + f.size > MAX_BYTES || batch.length === 5) await send()
    batch.push(f); size += f.size
  }
  await send()
}

function Reading({ f }: { f: TaskFile }) {
  const r = f.reading
  if (!r) return null
  const count = (x: string) => r.findings.filter((n) => n.rating === x).length
  return (
    <div className="body" style={{ padding: '6px 0 0' }}>
      {r.summary && <p>{r.summary}</p>}
      {r.findings.length > 0 && <p className="cap">{count('red')} red, {count('amber')} amber, {count('green')} green.</p>}
      {r.findings.length > 0 && (
        <div className="tblwrap"><table>
          <thead><tr><th className="nowrap">Section</th><th className="nowrap">Rating</th><th>Finding</th><th>Against</th><th>Change</th></tr></thead>
          <tbody>{[...r.findings].sort((a, b) => ['red', 'amber', 'green'].indexOf(a.rating) - ['red', 'amber', 'green'].indexOf(b.rating)).map((n, i) => (
            <tr key={i}><td className="nowrap">{n.ref}</td><td className="nowrap"><span className={`pill ${RATING[n.rating]?.[0] || 'Atrisk'}`}>{RATING[n.rating]?.[1] || n.rating}</span></td>
              <td>{n.finding}</td><td>{n.requirement}</td><td>{n.change}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {r.missing.length > 0 && (<><div className="meta">Missing</div><ul className="log">{r.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></>)}
      {r.questions.length > 0 && (<><div className="meta">Questions it raised</div><ul className="log">{r.questions.map((m, i) => <li key={i}>{m}</li>)}</ul></>)}
      {r.sections.length > 0 && (
        <details><summary className="cap">What each section says ({r.sections.length})</summary>
          <ul className="log">{r.sections.map((s, i) => <li key={i}><span className="who">{s.ref} {s.title}</span> {s.says}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

export function Documents({ taskId, files, onChanged }: { taskId: string; files: TaskFile[]; onChanged: () => void }) {
  const [picked, setPicked] = useState<File[]>([])
  const [purpose, setPurpose] = useState('')
  const [keep, setKeep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const attach = async () => {
    setBusy(true); setMsg(null)
    try {
      await attachToTask(taskId, picked, { purpose, keep })
      setPicked([]); setPurpose('')
      setMsg({ ok: true, text: 'Attached. Claude is reading them now (a long policy takes a minute or two); the team works them through when every one is read.' })
      onChanged()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  const remove = async (f: TaskFile) => {
    if (!confirm(`Remove ${f.name} from this task?`)) return
    try { await api(`/tasks/${taskId}/files/${f.id}`, { method: 'DELETE' }); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }

  return (
    <>
      <h3>Documents</h3>
      {files.length === 0 ? <p className="cap">Attach policies, procedures, risk assessments, letters or photos of paperwork. Each is read and assessed, and the team works it through.</p>
        : files.map((f) => (
          <div className="item" key={f.id}>
            <div className="o">
              <span className="tag">{f.kind === 'pdf' ? 'PDF' : f.kind === 'image' ? 'Photo' : 'Document'}</span>
              <a href={`/api/todo/tasks/${taskId}/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a>
              <span>{fmtDateTime(f.created_at)}</span>
              {f.status === 'reading' ? <span className="pill Active">Being read</span>
                : f.status === 'failed' ? <span className="pill Overdue">Could not be read</span>
                : f.reading?.overall ? <span className={`pill ${OVERALL[f.reading.overall] || 'Atrisk'}`}>{f.reading.overall.charAt(0).toUpperCase() + f.reading.overall.slice(1)}</span>
                : <span className="pill Done">Read</span>}
              {f.keep && <span className="tag">In the knowledge base</span>}
            </div>
            {f.purpose && <div className="d">Check against: {f.purpose}</div>}
            {f.status === 'failed' && <div className="d">{f.error}</div>}
            {f.status === 'reading' && f.error && <div className="d">First try failed ({f.error}); it will be tried once more.</div>}
            {open === f.id && <Reading f={f} />}
            <div className="toolbar">
              {f.status === 'ready' && <button className="btn sm" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? 'Hide the assessment' : 'Show the assessment'}</button>}
              <button className="btn danger sm" onClick={() => remove(f)}>Remove</button>
            </div>
          </div>
        ))}
      <label className="fld"><span>Attach (PDF, Word, text or photos; up to 3 MB each)</span>
        <input type="file" multiple accept={ACCEPT} onChange={(e) => { setPicked(Array.from(e.target.files || [])); setMsg(null) }} />
      </label>
      {picked.length > 0 && (
        <>
          <label className="fld"><span>What should it be checked against? (optional)</span>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="MLR 2017 and ICAEW's AML requirements; our last supervisory visit found gaps in CDD" /></label>
          <label className="chk"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Also keep it in the knowledge base, so Ask Aimelia can draw on it</label>
          <div className="toolbar"><button className="btn primary" disabled={busy} onClick={attach}>{busy ? 'Attaching ...' : `Attach and assess ${picked.length === 1 ? 'it' : `all ${picked.length}`}`}</button></div>
        </>
      )}
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </>
  )
}

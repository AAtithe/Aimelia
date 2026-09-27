'use client'

/**
 * What Aimelia knows: the questions from the checks, the weekly check itself, every memory (search, edit, pin,
 * archive, delete, and where each came from), everything Tom has told Aimelia, and the history of every change.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtDateTime } from '@/lib/client/todo'
import { MsgLine, type Msg } from '@/components/mail/common'

type Source = { note_id?: string; source: string; label: string; quote: string; at: string }
type Memory = { id: string; kind: string; subject: string; content: string; status: 'active' | 'archived'; pinned: boolean; created_by: string
  sources: Source[]; created_at: string; updated_at: string; confirmed_at: string | null }
type Question = { id: string; question: string; why: string; asked_by: string; created_at: string; memories: { id: string; subject: string; content: string }[] }
type Review = { status: string; summary: string; counts: Record<string, number>; error: string | null; started_at: string; finished_at: string | null; trigger: string }
type Data = { memories: Memory[]; counts: { active: number; archived: number }; questions: Question[]; review: Review | null; review_running: boolean
  next_check: string; notes_waiting: number }
type Note = { id: string; source: string; label: string; text: string; context: Record<string, any>; created_at: string; learned: boolean; error: string | null }
type Change = { id: number; action: string; actor: string; before: any; after: any; note: string; subject: string; at: string }

const KINDS: [string, string][] = [['fact', 'Fact'], ['client', 'Client'], ['person', 'Person'], ['preference', 'How you like it'], ['process', 'How we do it']]
const KIND = Object.fromEntries(KINDS)
const ACTOR: Record<string, string> = { tom: 'You', capture: 'Aimelia, from your note', weekly_check: 'The weekly check' }
type Tab = 'knows' | 'notes' | 'changes'

function QuestionCard({ x, onDone }: { x: Question; onDone: () => void }) {
  const [answer, setAnswer] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const act = async (path: string, body?: unknown) => {
    try { await api(`/memory/questions/${x.id}/${path}`, { method: 'POST', body }); onDone() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <div className="item">
      <div className="o"><span className="tag">{x.asked_by === 'weekly_check' ? 'Weekly check' : 'From your note'}</span><span>{fmtDate(x.created_at)}</span></div>
      <div className="t">{x.question}</div>
      {x.why && <div className="d">{x.why}</div>}
      {x.memories.length > 0 && <ul className="log">{x.memories.map((m) => <li key={m.id}><span className="who">{m.subject || 'Memory'}</span> {m.content}</li>)}</ul>}
      <textarea className="inp" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Your answer" placeholder="Your answer, in a line" />
      <div className="toolbar">
        <button className="btn primary sm" disabled={!answer.trim()} onClick={() => act('answer', { answer })}>Answer</button>
        <button className="btn sm" onClick={() => act('dismiss')}>Not needed</button>
      </div>
      <MsgLine msg={msg} />
    </div>
  )
}

function MemoryItem({ m, onDone }: { m: Memory; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ kind: m.kind, subject: m.subject, content: m.content })
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Change[] | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const patch = async (body: Record<string, unknown>) => {
    try { await api(`/memory/${m.id}`, { method: 'PATCH', body }); setEditing(false); onDone() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const remove = async () => {
    if (!confirm('Delete this memory? The agents stop using it. The record of it stays in Changes.')) return
    try { await api(`/memory/${m.id}`, { method: 'DELETE' }); onDone() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const showWhere = async () => {
    setOpen(!open)
    if (!history) api<{ history: Change[] }>(`/memory/${m.id}`).then((r) => setHistory(r.history)).catch(() => setHistory([]))
  }
  return (
    <div className="item" style={{ opacity: m.status === 'archived' ? 0.6 : 1 }}>
      <div className="o">
        <span className="tag">{KIND[m.kind] || m.kind}</span>
        {m.subject && <span>{m.subject}</span>}
        <span>{m.confirmed_at ? `confirmed ${fmtDate(m.confirmed_at)}` : `since ${fmtDate(m.created_at)}`}</span>
        {m.pinned && <span className="pill Done">Checked by you</span>}
        {m.status === 'archived' && <span className="pill Parked">Archived</span>}
      </div>
      {editing ? (
        <>
          <div className="row2">
            <label className="fld"><span>About</span><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
            <label className="fld"><span>Kind</span><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <textarea className="inp" rows={2} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} aria-label="What Aimelia should know" />
          <div className="toolbar">
            <button className="btn primary sm" disabled={!draft.content.trim()} onClick={() => patch(draft)}>Save</button>
            <button className="btn sm" onClick={() => { setEditing(false); setDraft({ kind: m.kind, subject: m.subject, content: m.content }) }}>Cancel</button>
          </div>
        </>
      ) : <div className="t" style={{ fontWeight: 400 }}>{m.content}</div>}
      {open && (
        <div className="body" style={{ padding: '6px 0 0' }}>
          <div className="meta">Where this came from</div>
          <ul className="log">{m.sources.length ? m.sources.map((s, i) => (
            <li key={i}><span className="who">{s.label}</span> {s.quote ? `"${s.quote}"` : ''}<span className="when">{fmtDate(s.at)}</span></li>
          )) : <li>{m.created_by === 'tom' ? 'You added it.' : 'No note recorded.'}</li>}</ul>
          <div className="meta">Changes</div>
          <ul className="log">{!history ? <li>Reading ...</li> : history.map((h, i) => (
            <li key={i}><span className="who">{ACTOR[h.actor] || h.actor}</span> {h.action}{h.note ? `: ${h.note}` : ''}
              {h.action === 'edited' && h.before?.content ? ` (was "${h.before.content}")` : ''}<span className="when">{fmtDateTime(h.at)}</span></li>
          ))}</ul>
        </div>
      )}
      {!editing && (
        <div className="toolbar">
          <button className="btn sm" onClick={() => setEditing(true)}>Change</button>
          <button className="btn sm" onClick={() => patch({ pinned: !m.pinned })}>{m.pinned ? 'Let the checks change it' : 'Mark as checked'}</button>
          <button className="btn sm" onClick={() => patch({ status: m.status === 'active' ? 'archived' : 'active' })}>{m.status === 'active' ? 'Archive' : 'Use again'}</button>
          <button className="btn sm" onClick={showWhere}>{open ? 'Hide where it came from' : 'Where it came from'}</button>
          <button className="btn danger sm" onClick={remove}>Delete</button>
        </div>
      )}
      <MsgLine msg={msg} />
    </div>
  )
}

function AddMemory({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ kind: 'fact', subject: '', content: '' })
  const [msg, setMsg] = useState<Msg>(null)
  const add = async () => {
    try { await api('/memory', { method: 'POST', body: f }); setF({ kind: f.kind, subject: '', content: '' }); setMsg({ ok: true, text: 'Kept. The agents use it from now on.' }); onDone() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <div className="body">
      <div className="row2">
        <label className="fld"><span>About (a client, a person, a topic)</span><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="Bentleys" /></label>
        <label className="fld"><span>Kind</span><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <label className="fld"><span>What Aimelia should know</span>
        <input value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Bentleys' year end is 31 March; Sam signs off the management accounts" /></label>
      <div className="toolbar"><button className="btn primary" disabled={!f.content.trim()} onClick={add}>Keep this</button></div>
      <MsgLine msg={msg} />
    </div>
  )
}

function Notes() {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [total, setTotal] = useState(0)
  const [more, setMore] = useState<string | null>(null)
  const load = useCallback(async (before?: string) => {
    const r = await api<{ notes: Note[]; total: number; more: string | null }>(`/memory/notes${before ? `?before=${encodeURIComponent(before)}` : ''}`)
    setNotes((prev) => (before ? [...(prev || []), ...r.notes] : r.notes)); setTotal(r.total); setMore(r.more)
  }, [])
  useEffect(() => { load() }, [load])
  const forget = async (n: Note) => {
    if (!confirm('Delete this note? Memories already drawn from it stay until you change them.')) return
    await api(`/memory/notes/${n.id}`, { method: 'DELETE' }); load()
  }
  return (
    <>
      <div className="body"><p className="cap" style={{ margin: 0 }}>Everything you have told Aimelia, word for word, newest first: {total} notes. They are kept when the task they came from is closed or deleted.</p></div>
      {!notes ? <div className="emptyrow">Reading ...</div> : notes.length === 0 ? <div className="emptyrow">Nothing yet. Notes appear as you answer questions, give feedback, write briefs and talk to Ask Aimelia.</div>
        : notes.map((n) => (
          <div className="item" key={n.id}>
            <div className="o"><span className="tag">{n.label}</span>{n.context?.task && <span>{n.context.task}</span>}<span>{fmtDateTime(n.created_at)}</span>
              {!n.learned && <span className="pill Parked">{n.error ? 'Not read yet: will try again' : 'Not read yet'}</span>}</div>
            {n.context?.question && <div className="d">Asked: {n.context.question}</div>}
            <div className="content">{n.text}</div>
            <div className="toolbar"><button className="btn danger sm" onClick={() => forget(n)}>Delete note</button></div>
          </div>
        ))}
      {more && <div className="toolbar body"><button className="btn" onClick={() => load(more)}>Show older notes</button></div>}
    </>
  )
}

function Changes() {
  const [log, setLog] = useState<Change[] | null>(null)
  useEffect(() => { api<{ log: Change[] }>('/memory/log').then((r) => setLog(r.log)).catch(() => setLog([])) }, [])
  return !log ? <div className="emptyrow">Reading ...</div> : log.length === 0 ? <div className="emptyrow">No changes yet.</div> : (
    <ul className="log body">{log.map((l) => (
      <li key={l.id}><span className="who">{ACTOR[l.actor] || l.actor}</span> {l.action} {l.subject ? `"${l.subject}"` : ''}: {l.after?.content || l.before?.content || ''}
        {l.note ? ` (${l.note})` : ''}<span className="when">{fmtDateTime(l.at)}</span></li>
    ))}</ul>
  )
}

export function WhatAimeliaKnows() {
  const [data, setData] = useState<Data | null>(null)
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [tab, setTab] = useState<Tab>('knows')
  const [msg, setMsg] = useState<Msg>(null)
  const load = useCallback(async () => {
    try { setData(await api<Data>(`/memory?${new URLSearchParams({ q: search, status: archived ? 'archived' : 'active' })}`)) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }, [search, archived])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  useEffect(() => { if (!data?.review_running) return; const t = setInterval(load, 5000); return () => clearInterval(t) }, [data?.review_running, load])

  const check = async () => {
    try { await api('/memory/check', { method: 'POST' }); setMsg({ ok: true, text: 'The check has started. It takes a minute or two; this page updates when it is done.' }); load() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const r = data?.review
  const tabs: [Tab, string][] = [['knows', `What it knows${data ? ` (${data.counts.active})` : ''}`], ['notes', 'Everything you have told it'], ['changes', 'Changes']]

  return (
    <>
      <div className="note">
        Everything you write to Aimelia is kept: answers to the agents&apos; questions, feedback, reasons for sending drafts back, task briefs, brain dumps and
        Ask Aimelia. Short facts are drawn from them and given to the agent team and Ask Aimelia, so you are not asked the same thing twice. Every Sunday evening
        a check cross-references them, tidies them and asks you about anything that does not add up. Change anything here; what you change is marked as
        checked by you, and the checks never change it without asking.
      </div>

      {data && data.questions.length > 0 && (
        <div className="card">
          <h2>Questions for you <span className="hcount">{data.questions.length}</span></h2>
          {data.questions.map((x) => <QuestionCard key={x.id} x={x} onDone={load} />)}
        </div>
      )}

      <div className="card">
        <h2>Weekly check <span className="hcount">{data ? `next ${fmtDate(data.next_check)}, 18:00` : ''}</span></h2>
        <div className="body">
          {!data ? <p className="cap">Reading ...</p> : data.review_running ? <p>The check is running now.</p> : !r ? <p className="cap">It has not run yet.</p> : r.status === 'failed' ? (
            <p>The last check, {fmtDateTime(r.started_at)}, did not finish: {r.error}</p>
          ) : (
            <>
              <p>{r.summary}</p>
              <p className="cap">{fmtDateTime(r.finished_at || r.started_at)}{r.trigger === 'manual' ? ', run by you' : ''}: {r.counts.memories ?? 0} memories and {r.counts.notes ?? 0} notes read;
                {' '}{r.counts.merged ?? 0} merged, {r.counts.updated ?? 0} updated, {r.counts.archived ?? 0} archived, {r.counts.questions ?? 0} questions asked.</p>
            </>
          )}
          {data && data.notes_waiting > 0 && <p className="cap">{data.notes_waiting} of your notes are waiting to be read; that happens within ten minutes.</p>}
          <div className="toolbar"><button className="btn" disabled={!data || data.review_running} onClick={check}>Run the check now</button></div>
          <MsgLine msg={msg} />
        </div>
      </div>

      <div className="card">
        <div className="body">
          <div className="main-tabs" style={{ marginBottom: 0 }}>
            {tabs.map(([k, label]) => <button key={k} className={`main-tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
          </div>
        </div>
        {tab === 'knows' && (
          <>
            <div className="body" style={{ paddingTop: 0 }}>
              <div className="row2">
                <label className="fld"><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="A client, a person, a topic" /></label>
                <label className="chk" style={{ alignSelf: 'end' }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
                  Show archived ({data?.counts.archived ?? 0})</label>
              </div>
            </div>
            {!data ? <div className="emptyrow">Reading ...</div> : data.memories.length === 0 ? (
              <div className="emptyrow">{search ? 'Nothing matches that.' : archived ? 'Nothing archived.' : 'Nothing yet. It fills up as you answer the agents and talk to Ask Aimelia, or add something below.'}</div>
            ) : data.memories.map((m) => <MemoryItem key={m.id} m={m} onDone={load} />)}
            <h2>Add something Aimelia should know</h2>
            <AddMemory onDone={load} />
          </>
        )}
        {tab === 'notes' && <Notes />}
        {tab === 'changes' && <Changes />}
      </div>
    </>
  )
}

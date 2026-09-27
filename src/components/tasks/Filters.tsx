'use client'

/**
 * Searching and filtering tasks: the filter bar on All tasks and Today, and the search box in the page band.
 * All tasks keeps its filters in the address (/tasks?q=tronc&view=done), so a search can be linked to and the
 * back button works.
 */
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { api, Task, fmtDate } from '@/lib/client/todo'
import { StatusPill } from './Cards'

export type Filters = { q: string; view: string; priority: string; urgent: string; kind: string; due: string; closed: string; sort: string }
export const NO_FILTERS: Filters = { q: '', view: 'open', priority: '', urgent: '', kind: '', due: '', closed: '', sort: '' }

export const VIEWS: [string, string][] = [
  ['open', 'Open'], ['waiting', 'Waiting on you'], ['team', 'With the team'], ['parked', 'Parked for later'], ['done', 'Completed'], ['all', 'Everything'],
]

/** The query string the task list takes, leaving out what is at its default. */
export function filterQuery(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v && !(k === 'view' && v === 'open')) p.set(k, v)
  return p.toString()
}

export function readFilters(search: string): Filters {
  const p = new URLSearchParams(search)
  const f = { ...NO_FILTERS }
  for (const k of Object.keys(f) as (keyof Filters)[]) f[k] = p.get(k) || NO_FILTERS[k]
  return f
}

const SEARCH_EVENT = 'aimelia:search'

/** Debounce a value: changes settle for ms before they count. */
export function useSettled<T>(value: T, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** The filter bar. full adds the view, kind, due and sort controls that All tasks needs. */
export function FilterBar({ f, set, full = true, count }: { f: Filters; set: (f: Filters) => void; full?: boolean; count?: number | null }) {
  const on = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set({ ...f, [k]: e.target.value })
  const active = (Object.keys(NO_FILTERS) as (keyof Filters)[]).some((k) => (full || k === 'q' || k === 'priority') && f[k] !== NO_FILTERS[k])
  return (
    <div className="filterbar" role="search">
      <input type="search" className="fb-q" value={f.q} onChange={on('q')} aria-label="Search tasks"
        placeholder={full ? 'Search titles, briefs, drafts, questions and answers' : 'Filter what is on this page'} />
      {full && (
        <select value={f.view} onChange={on('view')} aria-label="Which tasks">
          {VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
      <select value={f.priority} onChange={on('priority')} aria-label="Priority">
        <option value="">Any priority</option><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option>
      </select>
      {full && (<>
        <select value={f.urgent} onChange={on('urgent')} aria-label="Urgency">
          <option value="">Urgent or not</option><option value="1">Urgent and vital only</option>
        </select>
        <select value={f.kind} onChange={on('kind')} aria-label="Kind">
          <option value="">Any kind</option><option value="task">Tasks</option><option value="follow_up">Follow-ups</option><option value="routine">From routines</option>
        </select>
        <select value={f.due} onChange={on('due')} aria-label="Due">
          <option value="">Any due date</option><option value="overdue">Past due</option><option value="week">Due this week</option><option value="none">No due date</option>
        </select>
        {(f.view === 'done' || f.view === 'all') && (
          <select value={f.closed} onChange={on('closed')} aria-label="Completed">
            <option value="">Completed any time</option><option value="7">In the last week</option><option value="30">In the last month</option>
            <option value="90">In the last 3 months</option><option value="365">In the last year</option>
          </select>
        )}
        <select value={f.sort} onChange={on('sort')} aria-label="Sort">
          <option value="">{f.q ? 'Best match' : f.view === 'done' ? 'Latest completed' : 'Most urgent first'}</option>
          <option value="urgency">Most urgent first</option><option value="priority">Priority</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="due">Due date</option><option value="closed">Latest completed</option>
        </select>
      </>)}
      {active && <button type="button" className="btn" onClick={() => set({ ...NO_FILTERS })}>Clear</button>}
      {count != null && <span className="cap fb-count">{count} {count === 1 ? 'task' : 'tasks'}</span>}
    </div>
  )
}

/** Tell All tasks, if it is open, that the search in the band changed. */
export function announceSearch(q: string, open?: string) {
  window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: { q, open } }))
}
export function onSearch(fn: (q: string, open?: string) => void) {
  const h = (e: Event) => { const d = (e as CustomEvent).detail || {}; fn(String(d.q || ''), d.open) }
  window.addEventListener(SEARCH_EVENT, h)
  return () => window.removeEventListener(SEARCH_EVENT, h)
}

/**
 * The search box in the page band, on every page. It shows the best matches across every task, open or
 * completed, as you type; Enter opens All tasks with the search, a match opens that task.
 */
export function BandSearch() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<Task[] | null>(null)
  const [sel, setSel] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const settled = useSettled(q.trim(), 200)

  useEffect(() => {
    if (!settled) { setHits(null); return }
    let live = true
    api<Task[]>(`/tasks?${filterQuery({ ...NO_FILTERS, q: settled, view: 'all' }, { limit: '8' })}`)
      .then((r) => { if (live) { setHits(r); setSel(-1) } }).catch(() => live && setHits([]))
    return () => { live = false }
  }, [settled])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const go = (taskId?: string) => {
    const term = q.trim()
    setOpen(false)
    const qs = filterQuery({ ...NO_FILTERS, q: term, view: 'all' }, taskId ? { open: taskId } : {})
    router.push(`/tasks${qs ? `?${qs}` : ''}`)
    announceSearch(term, taskId)
  }

  return (
    <div className="bandsearch" ref={box}>
      <input type="search" value={q} placeholder="Search all tasks" aria-label="Search all tasks" aria-expanded={open && !!settled}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, (hits?.length || 0) - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, -1)) }
          else if (e.key === 'Enter') { e.preventDefault(); go(sel >= 0 && hits ? hits[sel].id : undefined) }
        }} />
      {open && settled && (
        <div className="bandsearch-list" role="listbox">
          {hits === null ? <div className="bs-empty">Searching ...</div> : hits.length === 0 ? <div className="bs-empty">No task matches "{settled}".</div> : (
            <>
              {hits.map((t, i) => (
                <button key={t.id} role="option" aria-selected={i === sel} className={`bs-hit ${i === sel ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => go(t.id)}>
                  <span className="bs-t">{t.title}</span>
                  <span className="bs-o"><StatusPill status={t.status} />{t.status === 'done' && t.closed_at ? <span>Completed {fmtDate(t.closed_at)}</span> : t.due_date ? <span>Due {fmtDate(t.due_date)}</span> : null}</span>
                </button>
              ))}
              <button className="bs-all" onMouseDown={(e) => e.preventDefault()} onClick={() => go()}>See every match in All tasks</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

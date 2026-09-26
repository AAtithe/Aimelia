'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, Agent, Pipeline } from '@/lib/todoApi'

interface TeamData {
  agents: Agent[]
  pipeline: Pipeline
  providers: Record<string, boolean>
  default_models: Record<string, string>
  channels: Record<string, boolean>
  sources: Record<string, boolean>
}

type Msg = { ok: boolean; text: string } | null

const BLANK: Partial<Agent> = {
  name: '', role: 'worker', description: '', instructions: '', provider: 'auto', model: '',
  temperature: 0.3, enabled: true, can_ask_questions: true,
}

export function AgentTeam() {
  const [data, setData] = useState<TeamData | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<TeamData>('/agents'))
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (!data) return <p className="cap">Reading the team ...</p>

  const workers = data.agents.filter((a) => a.role === 'worker')
  const reviewers = data.agents.filter((a) => a.role === 'reviewer')
  const noKeys = !data.providers.anthropic && !data.providers.openai

  const move = async (list: Agent[], i: number, dir: -1 | 1) => {
    const ids = list.map((a) => a.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    try {
      setData(await api<TeamData>('/agents/reorder', { method: 'POST', body: { ids } }))
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }

  return (
    <>
      <div className="note">
        Workers run in order, each improving the same draft. Reviewers then score it out of 10. Below the approval score the
        draft goes back to the workers with the reviewer&apos;s notes, up to the send-back limit. Work that is never approved still
        reaches you, marked in red with the reviewer&apos;s reasons.
      </div>
      {noKeys && (
        <div className="note warn">
          No AI key is set on the server, so every agent is giving placeholder answers. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on Render.
        </div>
      )}

      <PipelineCard pipeline={data.pipeline} onSaved={load} />
      <AutomationCard pipeline={data.pipeline} channels={data.channels} sources={data.sources} onSaved={load} />

      <div className="card">
        <h2>Workers <span className="hcount">{workers.filter((a) => a.enabled).length} of {workers.length} on</span></h2>
        {workers.map((a, i) => (
          <AgentRow key={a.id} seq={i + 1} agent={a} defaults={data.default_models} onChanged={load}
            onUp={() => move(workers, i, -1)} onDown={() => move(workers, i, 1)} />
        ))}
      </div>

      <div className="card">
        <h2>Reviewers <span className="hcount">{reviewers.filter((a) => a.enabled).length} of {reviewers.length} on</span></h2>
        {reviewers.length === 0 && <div className="emptyrow">No reviewers. Work will reach you without being checked.</div>}
        {reviewers.map((a, i) => (
          <AgentRow key={a.id} seq={i + 1} agent={a} defaults={data.default_models} onChanged={load}
            onUp={() => move(reviewers, i, -1)} onDown={() => move(reviewers, i, 1)} />
        ))}
      </div>

      {adding ? (
        <div className="card">
          <h2>New agent</h2>
          <div className="body">
            <AgentForm initial={BLANK} defaults={data.default_models} submitLabel="Add to the team"
              onCancel={() => setAdding(false)}
              onSubmit={async (body) => {
                await api('/agents', { method: 'POST', body })
                setAdding(false)
                setMsg({ ok: true, text: `${body.name} has joined the team.` })
                load()
              }} />
          </div>
        </div>
      ) : (
        <div className="toolbar">
          <button className="btn primary" onClick={() => setAdding(true)}>Add an agent</button>
          <span className="spacer" />
          <button className="btn danger" onClick={async () => {
            if (!confirm('Replace the whole team with the default Triage, Planner, Chief of Staff, Finance Specialist and Reviewer? Your changes to agents will be lost.')) return
            try {
              setData(await api<TeamData>('/agents/reset', { method: 'POST' }))
              setMsg({ ok: true, text: 'Team reset to the defaults.' })
            } catch (e: any) { setMsg({ ok: false, text: e.message }) }
          }}>Reset to the default team</button>
        </div>
      )}
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </>
  )
}

function PipelineCard({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: () => void }) {
  const [p, setP] = useState(pipeline)
  const [msg, setMsg] = useState<Msg>(null)
  useEffect(() => setP(pipeline), [pipeline])
  const dirty = JSON.stringify(p) !== JSON.stringify(pipeline)
  const num = (k: keyof Pipeline, label: string, min: number, max: number, step = 1) => (
    <label className="fld"><span>{label}</span>
      <input type="number" className="num" value={p[k] as number} min={min} max={max} step={step}
        onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
    </label>
  )

  return (
    <div className="card">
      <h2>How the team works</h2>
      <div className="body">
        <div className="row2">
          {num('max_revisions', 'Reviewer send-backs', 0, 5)}
          {num('approval_threshold', 'Score needed to approve (0 to 10)', 0, 10, 0.5)}
          {num('max_questions_per_run', 'Most questions per task', 1, 10)}
          {num('run_interval_minutes', 'Check the queue every (minutes)', 1, 1440)}
        </div>
        <label className="chk">
          <input type="checkbox" checked={p.auto_run} onChange={(e) => setP({ ...p, auto_run: e.target.checked })} />
          Work through the queue in the background, without waiting for me
        </label>
        <label className="fld" style={{ marginTop: 12 }}><span>Team directory: who owns what, so Triage can hand work to the right person</span>
          <textarea rows={6} value={p.team_directory} onChange={(e) => setP({ ...p, team_directory: e.target.value })}
            placeholder={'One person per line: name, role, what they own\nExample: Sam Patel, Payroll Manager, payroll runs, P60s, payroll queries'} />
        </label>
        <label className="fld"><span>House rules, given to every agent</span>
          <textarea rows={7} value={p.house_rules} onChange={(e) => setP({ ...p, house_rules: e.target.value })} />
        </label>
        {dirty && (
          <div className="toolbar">
            <button className="btn primary" onClick={async () => {
              try { await api('/pipeline', { method: 'PATCH', body: p }); setMsg({ ok: true, text: 'Saved.' }); onSaved() }
              catch (e: any) { setMsg({ ok: false, text: e.message }) }
            }}>Save</button>
            <button className="btn" onClick={() => setP(pipeline)}>Cancel</button>
          </div>
        )}
        <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
      </div>
    </div>
  )
}

function AutomationCard({ pipeline, channels, sources, onSaved }: {
  pipeline: Pipeline; channels: Record<string, boolean>; sources: Record<string, boolean>; onSaved: () => void
}) {
  const [p, setP] = useState(pipeline)
  const [msg, setMsg] = useState<Msg>(null)
  const [testing, setTesting] = useState('')
  useEffect(() => setP(pipeline), [pipeline])
  const keys: (keyof Pipeline)[] = ['stale_days', 'lessons_in_context', 'brief_enabled', 'brief_time', 'brief_weekends',
    'work_start', 'work_end', 'focus_minutes', 'use_ws_systems']
  const dirty = keys.some((k) => p[k] !== pipeline[k])
  const set = (k: keyof Pipeline, v: any) => setP({ ...p, [k]: v })

  const save = async () => {
    try {
      await api('/pipeline', { method: 'PATCH', body: Object.fromEntries(keys.map((k) => [k, p[k]])) })
      setMsg({ ok: true, text: 'Saved.' })
      onSaved()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }

  const test = async (what: 'notify' | 'sources') => {
    setTesting(what)
    setMsg(null)
    try {
      if (what === 'notify') {
        const r = await api<{ results: Record<string, string>; brief: { headline: string } }>('/notify/test', { method: 'POST' })
        setMsg({ ok: !r.results.none, text: r.results.none || `Sent "${r.brief.headline}". ${Object.entries(r.results).map(([k, v]) => `${k === 'phone' ? 'Phone' : 'Teams'}: ${v}`).join('. ')}.` })
      } else {
        const r = await api<Record<string, string>>('/sources/test', { method: 'POST' })
        setMsg({ ok: Object.values(r).every((v) => v === 'connected' || v === 'not set up'),
          text: `WSCIP: ${r.wscip}. Payroll Command Center: ${r.pcc}.` })
      }
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setTesting('') }
  }

  const on = (b: boolean) => (b ? 'set up' : 'not set up')

  return (
    <div className="card">
      <h2>Automation</h2>
      <div className="body">
        <h3 className="cap" style={{ fontWeight: 600, color: 'var(--navy)', margin: '0 0 6px' }}>Old tasks and learning</h3>
        <div className="row2">
          <label className="fld"><span>Back through Triage after this many untouched days (0 is off)</span>
            <input type="number" className="num" min={0} max={365} value={p.stale_days} onChange={(e) => set('stale_days', Number(e.target.value))} /></label>
          <label className="fld"><span>Your past corrections each agent sees (0 is off)</span>
            <input type="number" className="num" min={0} max={30} value={p.lessons_in_context} onChange={(e) => set('lessons_in_context', Number(e.target.value))} /></label>
        </div>
      </div>
      <div className="body">
        <h3 className="cap" style={{ fontWeight: 600, color: 'var(--navy)', margin: '0 0 6px' }}>Morning push to Teams and your phone</h3>
        <p className="cap">Teams is {on(channels.teams)}; phone is {on(channels.phone)}. They are set on the server with TEAMS_WEBHOOK_URL and NTFY_URL. Never email.</p>
        <label className="chk"><input type="checkbox" checked={p.brief_enabled} onChange={(e) => set('brief_enabled', e.target.checked)} />Send a morning brief</label>
        <div className="row2">
          <label className="fld"><span>At (London time)</span><input type="time" value={p.brief_time} onChange={(e) => set('brief_time', e.target.value)} /></label>
        </div>
        <label className="chk"><input type="checkbox" checked={p.brief_weekends} onChange={(e) => set('brief_weekends', e.target.checked)} />At weekends too</label>
        <div className="toolbar"><button className="btn" disabled={!!testing} onClick={() => test('notify')}>{testing === 'notify' ? 'Sending ...' : 'Send one now to test'}</button></div>
      </div>
      <div className="body">
        <h3 className="cap" style={{ fontWeight: 600, color: 'var(--navy)', margin: '0 0 6px' }}>Focus time in your calendar</h3>
        <p className="cap">For work only you can do. Aimelia reads only when you are busy, never what the meetings are, and books the first free slot.</p>
        <div className="row2">
          <label className="fld"><span>Working day starts</span><input type="time" value={p.work_start} onChange={(e) => set('work_start', e.target.value)} /></label>
          <label className="fld"><span>Working day ends</span><input type="time" value={p.work_end} onChange={(e) => set('work_end', e.target.value)} /></label>
          <label className="fld"><span>Block length (minutes)</span><input type="number" className="num" min={15} max={480} step={15} value={p.focus_minutes} onChange={(e) => set('focus_minutes', Number(e.target.value))} /></label>
        </div>
      </div>
      <div className="body">
        <h3 className="cap" style={{ fontWeight: 600, color: 'var(--navy)', margin: '0 0 6px' }}>WSCIP and Payroll Command Center</h3>
        <p className="cap">WSCIP is {on(sources.wscip)}; Payroll Command Center is {on(sources.pcc)}. The agents only read, through a read-only user in each system, and every lookup is listed in the task&apos;s history.</p>
        <label className="chk"><input type="checkbox" checked={p.use_ws_systems} onChange={(e) => set('use_ws_systems', e.target.checked)} />Let the agents look things up in these systems</label>
        <div className="toolbar"><button className="btn" disabled={!!testing} onClick={() => test('sources')}>{testing === 'sources' ? 'Checking ...' : 'Check the connections'}</button></div>
        {dirty && (
          <div className="toolbar">
            <button className="btn primary" onClick={save}>Save</button>
            <button className="btn" onClick={() => setP(pipeline)}>Cancel</button>
          </div>
        )}
        <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
      </div>
    </div>
  )
}

function AgentRow({ seq, agent, defaults, onChanged, onUp, onDown }: {
  seq: number; agent: Agent; defaults: Record<string, string>; onChanged: () => void; onUp: () => void; onDown: () => void
}) {
  const [open, setOpen] = useState(false)

  const toggle = async () => {
    await api(`/agents/${agent.id}`, { method: 'PATCH', body: { enabled: !agent.enabled } }).catch(() => undefined)
    onChanged()
  }

  return (
    <>
      <div className={`agent ${agent.enabled ? '' : 'off'}`}>
        <div className="seq">{seq}</div>
        <div className="main">
          <div className="nm">{agent.name}{!agent.enabled && <span className="pill Parked" style={{ marginLeft: 8 }}>Off</span>}</div>
          <div className="ds">{agent.description}</div>
          <div className="md">
            {agent.resolved_provider === 'mock' ? 'Placeholder answers (no AI key)' : `${agent.resolved_provider}, ${agent.resolved_model}`}
            {agent.can_ask_questions ? '. Can stop to ask you questions.' : '. Never stops to ask; states its assumptions.'}
          </div>
        </div>
        <div className="ctl">
          <button className="btn sm" onClick={onUp} aria-label={`Move ${agent.name} earlier`}>Earlier</button>
          <button className="btn sm" onClick={onDown} aria-label={`Move ${agent.name} later`}>Later</button>
          <button className="btn sm" onClick={toggle}>{agent.enabled ? 'Turn off' : 'Turn on'}</button>
          <button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</button>
        </div>
      </div>
      {open && (
        <div className="agent-edit">
          <AgentForm initial={agent} defaults={defaults} submitLabel="Save changes"
            onCancel={() => setOpen(false)}
            onSubmit={async (body) => {
              await api(`/agents/${agent.id}`, { method: 'PATCH', body })
              setOpen(false)
              onChanged()
            }}
            onDelete={async () => {
              if (!confirm(`Remove ${agent.name} from the team?`)) return
              await api(`/agents/${agent.id}`, { method: 'DELETE' })
              onChanged()
            }} />
        </div>
      )}
    </>
  )
}

function AgentForm({ initial, defaults, submitLabel, onSubmit, onCancel, onDelete }: {
  initial: Partial<Agent>; defaults: Record<string, string>; submitLabel: string
  onSubmit: (body: any) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>
}) {
  const [f, setF] = useState({ ...initial, model: initial.model || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: any) => setF({ ...f, [k]: v })

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      await onSubmit({
        name: f.name, role: f.role, description: f.description, instructions: f.instructions,
        provider: f.provider, model: f.model || null, temperature: f.temperature,
        enabled: f.enabled, can_ask_questions: f.can_ask_questions,
      })
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="row2">
        <label className="fld"><span>Name</span>
          <input value={f.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Client Relationship Lead" />
        </label>
        <label className="fld"><span>Role</span>
          <select value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="worker">Worker: does or improves the work</option>
            <option value="reviewer">Reviewer: checks it and can send it back</option>
          </select>
        </label>
      </div>
      <label className="fld"><span>One line on what it is for</span>
        <input value={f.description || ''} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label className="fld"><span>Instructions: who this agent is and exactly how it should work</span>
        <textarea className="mono" rows={10} value={f.instructions || ''} onChange={(e) => set('instructions', e.target.value)} />
      </label>
      <div className="row2">
        <label className="fld"><span>AI provider</span>
          <select value={f.provider} onChange={(e) => set('provider', e.target.value)}>
            <option value="auto">Automatic (Anthropic, then OpenAI)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="mock">Placeholder (no AI calls)</option>
          </select>
        </label>
        <label className="fld"><span>Model (blank for the default)</span>
          <input value={f.model || ''} onChange={(e) => set('model', e.target.value)}
            placeholder={f.provider === 'openai' ? defaults.openai : defaults.anthropic} />
        </label>
        <label className="fld"><span>Creativity: {Number(f.temperature).toFixed(1)} (0 is strict, 1 is loose)</span>
          <input type="range" min={0} max={1} step={0.1} value={f.temperature} style={{ width: '100%' }}
            onChange={(e) => set('temperature', Number(e.target.value))} />
        </label>
      </div>
      <label className="chk"><input type="checkbox" checked={!!f.enabled} onChange={(e) => set('enabled', e.target.checked)} />On</label>
      <label className="chk"><input type="checkbox" checked={!!f.can_ask_questions} onChange={(e) => set('can_ask_questions', e.target.checked)} />Can stop a task to ask you a question</label>
      <div className="toolbar">
        <button className="btn primary" disabled={busy || !f.name?.trim() || !f.instructions?.trim()} onClick={submit}>{submitLabel}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        {onDelete && <button className="btn danger" onClick={() => onDelete().catch((e) => setErr(e.message))}>Remove from the team</button>}
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
    </div>
  )
}

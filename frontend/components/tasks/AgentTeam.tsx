'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowUp, ArrowDown, Plus, Trash2, RotateCcw } from 'lucide-react'
import { api, Agent, Pipeline } from '@/lib/todoApi'
import { Btn } from './Cards'

interface TeamData {
  agents: Agent[]
  pipeline: Pipeline
  providers: Record<string, boolean>
  default_models: Record<string, string>
}

const BLANK: Partial<Agent> = {
  name: '', role: 'worker', description: '', instructions: '', provider: 'auto', model: '',
  temperature: 0.3, enabled: true, can_ask_questions: true,
}

export function AgentTeam() {
  const [data, setData] = useState<TeamData | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await api<TeamData>('/agents'))
    } catch (e: any) {
      toast.error(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (!data) return <div className="text-slate-500">Loading team...</div>

  const workers = data.agents.filter((a) => a.role === 'worker')
  const reviewers = data.agents.filter((a) => a.role === 'reviewer')

  const move = async (list: Agent[], i: number, dir: -1 | 1) => {
    const ids = list.map((a) => a.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    try {
      setData(await api<TeamData>('/agents/reorder', { method: 'POST', body: { ids } }))
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Workers run top to bottom, each improving the draft. Reviewers then score it. Below the approval score the draft goes back
        to the workers with the reviewer&apos;s feedback, up to the revision limit. Anything never approved reaches you flagged in red.
        <div className="mt-2 text-xs">
          API keys on server: Anthropic {data.providers.anthropic ? 'set' : 'not set'}, OpenAI {data.providers.openai ? 'set' : 'not set'}.
          {!data.providers.anthropic && !data.providers.openai && ' Agents are running in mock mode until a key is added.'}
        </div>
      </div>

      <PipelineForm pipeline={data.pipeline} onSaved={load} />

      <Group title="Workers" subtitle="Do the work, in this order">
        {workers.map((a, i) => (
          <AgentCard key={a.id} agent={a} defaults={data.default_models} onChanged={load}
            onUp={() => move(workers, i, -1)} onDown={() => move(workers, i, 1)} />
        ))}
      </Group>

      <Group title="Reviewers" subtitle="Check the work before it reaches you">
        {reviewers.map((a, i) => (
          <AgentCard key={a.id} agent={a} defaults={data.default_models} onChanged={load}
            onUp={() => move(reviewers, i, -1)} onDown={() => move(reviewers, i, 1)} />
        ))}
      </Group>

      <div className="flex flex-wrap gap-2">
        <Btn primary onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add agent</Btn>
        <Btn onClick={async () => {
          if (!confirm('Replace the whole team with the default Planner, Chief of Staff, Finance Specialist and Reviewer?')) return
          try { setData(await api<TeamData>('/agents/reset', { method: 'POST' })); toast.success('Team reset') } catch (e: any) { toast.error(e.message) }
        }}><RotateCcw className="h-4 w-4" />Reset to default team</Btn>
      </div>

      {adding && (
        <div className="rounded-xl border-2 border-slate-900 bg-white p-4">
          <AgentForm initial={BLANK} defaults={data.default_models} submitLabel="Create agent"
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              await api('/agents', { method: 'POST', body })
              toast.success('Agent added')
              setAdding(false)
              load()
            }} />
        </div>
      )}
    </div>
  )
}

function Group({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mb-3 text-sm text-slate-500">{subtitle}</p>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function PipelineForm({ pipeline, onSaved }: { pipeline: Pipeline; onSaved: () => void }) {
  const [p, setP] = useState(pipeline)
  const dirty = JSON.stringify(p) !== JSON.stringify(pipeline)
  useEffect(() => setP(pipeline), [pipeline])

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-semibold text-slate-900">How the team works</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Num label="Reviewer send-backs" value={p.max_revisions} min={0} max={5} onChange={(v) => setP({ ...p, max_revisions: v })} />
        <Num label="Approval score (0-10)" value={p.approval_threshold} min={0} max={10} step={0.5} onChange={(v) => setP({ ...p, approval_threshold: v })} />
        <Num label="Max questions per run" value={p.max_questions_per_run} min={1} max={10} onChange={(v) => setP({ ...p, max_questions_per_run: v })} />
        <Num label="Check queue every (min)" value={p.run_interval_minutes} min={1} max={1440} onChange={(v) => setP({ ...p, run_interval_minutes: v })} />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={p.auto_run} onChange={(e) => setP({ ...p, auto_run: e.target.checked })} />
        Work through the queue automatically in the background
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">House rules (given to every agent)</label>
      <textarea className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" rows={7} value={p.house_rules}
        onChange={(e) => setP({ ...p, house_rules: e.target.value })} />
      {dirty && (
        <div className="mt-2 flex gap-2">
          <Btn primary onClick={async () => {
            try { await api('/pipeline', { method: 'PATCH', body: p }); toast.success('Saved'); onSaved() } catch (e: any) { toast.error(e.message) }
          }}>Save</Btn>
          <Btn onClick={() => setP(pipeline)}>Cancel</Btn>
        </div>
      )}
    </section>
  )
}

function Num({ label, value, onChange, min, max, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input type="number" className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function AgentCard({ agent, defaults, onChanged, onUp, onDown }: {
  agent: Agent; defaults: Record<string, string>; onChanged: () => void; onUp: () => void; onDown: () => void
}) {
  const [open, setOpen] = useState(false)

  const toggle = async () => {
    try { await api(`/agents/${agent.id}`, { method: 'PATCH', body: { enabled: !agent.enabled } }); onChanged() } catch (e: any) { toast.error(e.message) }
  }

  return (
    <div className={`rounded-xl border bg-white p-4 ${agent.enabled ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{agent.name}</div>
          <div className="text-sm text-slate-600">{agent.description}</div>
          <div className="mt-1 text-xs text-slate-400">
            {agent.resolved_provider} / {agent.resolved_model}
            {agent.can_ask_questions ? ' / can ask you questions' : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onUp} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
          <button onClick={onDown} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
          <label className="ml-2 flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={agent.enabled} onChange={toggle} />On
          </label>
          <button onClick={() => setOpen(!open)} className="ml-2 rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <AgentForm initial={agent} defaults={defaults} submitLabel="Save changes"
            onCancel={() => setOpen(false)}
            onSubmit={async (body) => {
              await api(`/agents/${agent.id}`, { method: 'PATCH', body })
              toast.success('Saved')
              setOpen(false)
              onChanged()
            }}
            onDelete={async () => {
              if (!confirm(`Remove ${agent.name} from the team?`)) return
              await api(`/agents/${agent.id}`, { method: 'DELETE' })
              toast.success('Removed')
              onChanged()
            }} />
        </div>
      )}
    </div>
  )
}

function AgentForm({ initial, defaults, submitLabel, onSubmit, onCancel, onDelete }: {
  initial: Partial<Agent>; defaults: Record<string, string>; submitLabel: string
  onSubmit: (body: any) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>
}) {
  const [f, setF] = useState({ ...initial, model: initial.model || '' })
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const input = 'mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm'

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit({
        name: f.name, role: f.role, description: f.description, instructions: f.instructions,
        provider: f.provider, model: f.model || null, temperature: f.temperature,
        enabled: f.enabled, can_ask_questions: f.can_ask_questions,
      })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm"><span className="text-slate-600">Name</span>
          <input className={input} value={f.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Client Relationship Lead" />
        </label>
        <label className="block text-sm"><span className="text-slate-600">Role</span>
          <select className={input} value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="worker">Worker: produces or improves the work</option>
            <option value="reviewer">Reviewer: checks and can send work back</option>
          </select>
        </label>
      </div>
      <label className="block text-sm"><span className="text-slate-600">One-line description</span>
        <input className={input} value={f.description || ''} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label className="block text-sm"><span className="text-slate-600">Instructions: who this agent is and exactly how it should work</span>
        <textarea className={`${input} font-mono`} rows={10} value={f.instructions || ''} onChange={(e) => set('instructions', e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm"><span className="text-slate-600">Provider</span>
          <select className={input} value={f.provider} onChange={(e) => set('provider', e.target.value)}>
            <option value="auto">Auto (Anthropic, then OpenAI)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="mock">Mock (no API calls)</option>
          </select>
        </label>
        <label className="block text-sm"><span className="text-slate-600">Model (blank = default)</span>
          <input className={input} value={f.model || ''} onChange={(e) => set('model', e.target.value)}
            placeholder={f.provider === 'openai' ? defaults.openai : defaults.anthropic} />
        </label>
        <label className="block text-sm"><span className="text-slate-600">Creativity {Number(f.temperature).toFixed(1)}</span>
          <input type="range" min={0} max={1} step={0.1} className="mt-3 w-full" value={f.temperature}
            onChange={(e) => set('temperature', Number(e.target.value))} />
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.enabled} onChange={(e) => set('enabled', e.target.checked)} />Enabled</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.can_ask_questions} onChange={(e) => set('can_ask_questions', e.target.checked)} />Can pause the task to ask you questions</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn primary disabled={busy || !f.name?.trim() || !f.instructions?.trim()} onClick={submit}>{submitLabel}</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
        {onDelete && <Btn onClick={() => onDelete().catch((e) => toast.error(e.message))}><Trash2 className="h-4 w-4" />Remove agent</Btn>}
      </div>
    </div>
  )
}

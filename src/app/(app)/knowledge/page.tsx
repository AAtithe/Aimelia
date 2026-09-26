'use client'

import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { londonTime, MsgLine, useLoad, type Msg } from '@/components/mail/common'

const SOURCE: Record<string, string> = { email: 'Email', meeting: 'Meeting brief', document: 'Document', policy: 'Policy', manual: 'Note' }

export default function Knowledge() {
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const list = useLoad(() => mail(`/knowledge${asked ? `?q=${encodeURIComponent(asked)}` : ''}`), [asked])
  const [doc, setDoc] = useState({ title: '', text: '', source: 'document' })
  const [msg, setMsg] = useState<Msg>(null)

  const add = async () => {
    try {
      const r = await mail('/knowledge', { method: 'POST', body: doc })
      setMsg({ ok: true, text: `Added "${doc.title}" in ${r.stored_chunks} part${r.stored_chunks === 1 ? '' : 's'}.` })
      setDoc({ title: '', text: '', source: 'document' })
      list.load()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const remove = async (id: string) => { await mail(`/knowledge/${id}`, { method: 'DELETE' }).catch(() => {}); list.load() }

  const rows: any[] = (list.data as any)?.results || []
  const counts: Record<string, number> = (list.data as any)?.counts || {}
  return (
    <Shell title="Knowledge base" sub="Background the assistant draws on when it drafts and briefs: sorted emails, meeting briefs, and documents or policies you add.">
      <div className="kpis">{['email', 'meeting', 'document', 'policy'].map((k) => (
        <div key={k} className={`kpi ${counts[k] ? '' : 'none'}`}><span className="n">{asked ? '–' : counts[k] || 0}</span><span className="l">{SOURCE[k]} entries</span></div>))}</div>
      <div className="card"><h2>Search</h2><div className="body">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <input className="inp" style={{ flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setAsked(query)} placeholder="Tronc policy, Bentleys labour, HMRC enquiry ..." aria-label="Search" />
          <button className="btn primary" onClick={() => setAsked(query)}>Search</button>
          {asked && <button className="btn" onClick={() => { setQuery(''); setAsked('') }}>Clear</button>}
        </div>
      </div>
        {rows.length === 0 ? <div className="emptyrow">{asked ? 'Nothing matches that.' : 'Nothing stored yet. Sorted emails and meeting briefs are added as they happen.'}</div> : rows.map((r) => (
          <div className="item" key={r.id}>
            <div className="o"><span className="tag">{SOURCE[r.source] || r.source}</span>{r.created_at && <span>{londonTime(r.created_at)}</span>}</div>
            <div className="t">{r.title}</div>
            <div className="meta">{String(r.chunk).slice(0, 300)}{String(r.chunk).length > 300 ? ' ...' : ''}</div>
            <div className="toolbar"><button className="linkbtn" onClick={() => remove(r.id)}>Remove</button></div>
          </div>))}
      </div>
      <div className="card"><h2>Add a document or policy</h2><div className="body">
        <div className="row2">
          <label className="fld"><span>Title</span><input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} placeholder="Tronc policy 2026" /></label>
          <label className="fld"><span>Kind</span><select value={doc.source} onChange={(e) => setDoc({ ...doc, source: e.target.value })}>
            <option value="document">Document</option><option value="policy">Policy</option><option value="manual">Note</option></select></label>
        </div>
        <label className="fld"><span>Text (paste it in)</span><textarea rows={8} value={doc.text} onChange={(e) => setDoc({ ...doc, text: e.target.value })} /></label>
        <button className="btn primary" disabled={!doc.title.trim() || !doc.text.trim()} onClick={add}>Add to the knowledge base</button>
        <MsgLine msg={msg} />
      </div></div>
    </Shell>
  )
}

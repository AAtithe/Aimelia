/**
 * Knowledge base: background the assistant can draw on (emails, meeting briefs, documents,
 * policies). Postgres full-text search, so it needs no embeddings and no extra AI key.
 * Text is split into windows of 1,000 words with a 100-word overlap, as before.
 */
import { q } from '../db'

export function chunk(text: string, size = 1000, step = 900): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean)
  if (words.length <= size) return words.length ? [words.join(' ')] : []
  const out: string[] = []
  for (let i = 0; i < words.length; i += step) {
    out.push(words.slice(i, i + size).join(' '))
    if (i + size >= words.length) break
  }
  return out
}

/** Store (or replace) a source's chunks. Returns how many were stored. */
export async function index(source: string, sourceId: string | null, title: string, text: string): Promise<number> {
  const parts = chunk(text)
  if (sourceId) await q(`DELETE FROM kb_chunks WHERE source = $1 AND source_id = $2`, [source, sourceId])
  for (const [i, part] of parts.entries()) {
    const t = parts.length > 1 ? `${title} (Part ${i + 1})` : title
    await q(`INSERT INTO kb_chunks (source, source_id, title, chunk) VALUES ($1, $2, $3, $4)
             ON CONFLICT (source, source_id, title) DO UPDATE SET chunk = EXCLUDED.chunk, created_at = now()`,
      [source, sourceId ?? `doc-${Date.now()}-${i}`, t, part])
  }
  return parts.length
}

export async function search(query: string, topK = 6, source?: string) {
  if (!query.trim()) return []
  const rows = await q(
    `SELECT id, source, source_id, title, chunk, ts_rank(tsv, websearch_to_tsquery('english', $1)) AS rank
     FROM kb_chunks WHERE tsv @@ websearch_to_tsquery('english', $1) AND ($3::text IS NULL OR source = $3)
     ORDER BY rank DESC, created_at DESC LIMIT $2`, [query, topK, source ?? null])
  if (rows.length) return rows
  // Nothing matched every word: fall back to any word, so a long query still finds something.
  const any = query.toLowerCase().match(/[a-z0-9]{3,}/g)?.slice(0, 12).join(' | ')
  if (!any) return []
  return q(`SELECT id, source, source_id, title, chunk, ts_rank(tsv, to_tsquery('english', $1)) AS rank
            FROM kb_chunks WHERE tsv @@ to_tsquery('english', $1) AND ($3::text IS NULL OR source = $3)
            ORDER BY rank DESC LIMIT $2`, [any, topK, source ?? null])
}

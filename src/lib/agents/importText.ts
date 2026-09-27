/**
 * Turning files into plain text for the task import, with no extra packages.
 *
 * - Word (.docx) is a zip: the central directory is read, word/document.xml is inflated with zlib,
 *   and paragraphs, list items, line breaks and table cells are kept as lines.
 * - Transcripts (.vtt, .srt) lose their cue numbers and timings.
 * - .txt, .md and .csv are read as they are.
 * - The old binary .doc and PDF are refused with a message saying what to do instead.
 */
import { inflateRawSync } from 'node:zlib'

export class ImportError extends Error {}

export const IMPORT_TYPES = ['.docx', '.txt', '.md', '.csv', '.vtt', '.srt']

/** The files inside a zip, by name, inflated on request. */
function unzip(buf: Buffer): Map<string, () => Buffer> {
  // The end-of-central-directory record sits in the last 64 KB (plus its 22 fixed bytes).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new ImportError('That file is not a Word document (.docx). Save it from Word as .docx and try again.')
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const files = new Map<string, () => Buffer>()
  for (let n = 0; n < count && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    files.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      if (method === 0) return data
      // Capped, so a crafted file cannot expand to fill the server's memory.
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 })
      throw new ImportError('That Word document uses a compression Aimelia cannot read. Save it again from Word as .docx.')
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e.toLowerCase()] ?? m
  })

/** Word's document.xml as lines: one per paragraph, list items marked "- ", table cells joined with " | ". */
export function docxXmlToText(xml: string): string {
  const body = xml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, '') // deleted tracked changes, field codes
  const para = (p: string) => {
    let text = ''
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
      text += m[1] !== undefined ? decodeEntities(m[1]) : m[0].startsWith('<w:tab') ? '\t' : '\n'
    }
    text = text.trim()
    if (!text) return ''
    return /<w:numPr>/.test(p) ? `- ${text}` : text
  }
  const out: string[] = []
  // Tables first become one line per row, then the remaining paragraphs are read in order.
  const flat = body.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map((c) => (c.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(para).filter(Boolean).join(' '))
    return `<w:p><w:r><w:t>${cells.filter(Boolean).join(' | ').replace(/</g, '&lt;')}</w:t></w:r></w:p>`
  })
  for (const p of flat.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []) {
    const line = para(p)
    if (line) out.push(line)
  }
  return out.join('\n')
}

export function docxToText(buf: Buffer): string {
  const files = unzip(buf)
  const doc = files.get('word/document.xml')
  if (!doc) throw new ImportError('That zip file is not a Word document.')
  return docxXmlToText(doc().toString('utf8'))
}

/** WebVTT and SRT transcripts: drop headers, cue numbers and timings; keep "Speaker: words". */
export function transcriptToText(raw: string): string {
  const lines: string[] = []
  for (const l of raw.replace(/\r/g, '').split('\n')) {
    const t = l.trim()
    if (!t || t === 'WEBVTT' || /^(NOTE|STYLE|REGION)\b/.test(t) || /^\d+$/.test(t) || /-->/.test(t)) continue
    const speaker = t.match(/^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/)
    lines.push(speaker ? `${speaker[1].trim()}: ${speaker[2].trim()}` : t.replace(/<[^>]+>/g, ''))
  }
  return lines.join('\n')
}

/** Plain text from an uploaded file, by its extension. */
export function fileToText(filename: string, buf: Buffer): string {
  const ext = (filename.toLowerCase().match(/\.[a-z0-9]+$/) || [''])[0]
  if (ext === '.docx') return docxToText(buf)
  if (ext === '.doc') throw new ImportError('That is an old Word file (.doc). Open it in Word, save it as .docx, and try again.')
  if (ext === '.pdf') throw new ImportError('PDFs are not read yet. Copy the text out of the PDF and paste it in as meeting notes.')
  const text = buf.toString('utf8').replace(/^﻿/, '')
  if (ext === '.vtt' || ext === '.srt') return transcriptToText(text)
  if (IMPORT_TYPES.includes(ext) || !ext) return text
  throw new ImportError(`Aimelia cannot read ${ext} files. Use ${IMPORT_TYPES.join(', ')}, or paste the text.`)
}

const BULLET = /^\s*(?:[-*•▪●]|\d+[.)]|\[[ xX]?\]|(?:action|todo|to do|ai)\s*[:\-])\s*/i

/** Strip a list marker: "- ", "1.", "[ ]", "Action:". */
export const stripBullet = (l: string) => l.replace(BULLET, '').trim()

/**
 * Without an AI to read the document: the lines that look like actions. Bullets, numbered items,
 * checkboxes and lines starting "Action:" count; if there are none, every short line does. Capped.
 */
export function actionLines(text: string, cap = 60): string[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const marked = lines.filter((l) => BULLET.test(l)).map(stripBullet).filter(Boolean)
  const picked = marked.length ? marked : lines.map((l) => l.trim()).filter((l) => l.length <= 200)
  return [...new Set(picked)].slice(0, cap)
}

/** HTML (Outlook and To Do note bodies) to plain text. */
export const htmlToText = (html: string) =>
  decodeEntities(html.replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '- ').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

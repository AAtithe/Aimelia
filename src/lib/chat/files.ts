/**
 * Files Tom sends to Ask Aimelia.
 *
 * - Photos (PNG, JPEG, GIF, WebP) and PDFs are kept as they are and shown to the model, which reads them itself.
 *   The type is taken from the file's first bytes, never from its name, so nothing else is passed off as a photo.
 * - Word, text, CSV and transcripts are turned into text with the same reader as Import tasks.
 * - Anything else is refused with what to do instead.
 */
import { fail } from '../http'
import { fileToText, ImportError, IMPORT_TYPES } from '../agents/importText'

export const MAX_FILES = 5
export const MAX_BASE64 = 4_200_000 // Vercel takes request bodies up to 4.5 MB: about 3 MB of files once encoded
const MAX_TEXT = 200_000

export type ChatFile = { name: string; kind: 'image' | 'pdf' | 'text'; media_type: string; size: number; data: string | null; text: string | null }

export const TEXT_TYPES = IMPORT_TYPES.filter((t) => t !== '.pdf')
export const ACCEPT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', ...TEXT_TYPES]

export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

/** One uploaded file (base64) into what is stored and shown to the model. Refuses with 422. */
export function readChatFile(name: string, base64: string): ChatFile {
  const buf = Buffer.from(base64, 'base64')
  if (!buf.length) fail(422, `${name} is empty.`)
  const image = sniffImage(buf)
  if (image) return { name, kind: 'image', media_type: image, size: buf.length, data: base64, text: null }
  if (buf.subarray(0, 1024).indexOf('%PDF-') >= 0) return { name, kind: 'pdf', media_type: 'application/pdf', size: buf.length, data: base64, text: null }
  if (/\.pdf$/i.test(name)) fail(422, `${name} is named .pdf but is not a PDF.`)
  if (/\.(heic|heif)$/i.test(name)) fail(422, `${name} is an iPhone HEIC photo. Send it from Safari, which converts it, or set the camera to Most Compatible.`)
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?|svg)$/i.test(name)) fail(422, `${name} is not a photo Aimelia can read. Use PNG, JPEG, GIF or WebP.`)
  let text = ''
  try {
    text = fileToText(name, buf)
  } catch (e) {
    if (e instanceof ImportError) {
      fail(422, /cannot read/.test(e.message) ? `Aimelia cannot read ${name}. Send a photo (PNG, JPEG, GIF, WebP), a PDF, or ${TEXT_TYPES.join(', ')}.` : `${name}: ${e.message}`)
    }
    throw e
  }
  if (!text.trim()) fail(422, `There is no text in ${name}.`)
  return { name, kind: 'text', media_type: 'text/plain', size: buf.length, data: null, text: text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n... (the rest was cut off)` }
}

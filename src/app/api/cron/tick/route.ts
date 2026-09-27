/**
 * The background heartbeat, run by Vercel Cron every 10 minutes (vercel.json). Wakes scheduled
 * work, creates routine tasks, nudges old tasks, works the queue, runs the email jobs, and sends the
 * morning push when due. Needs no secret: see cronAllowed() for how it is protected.
 */
import { NextResponse } from 'next/server'
import { cronAllowed } from '@/lib/auth'
import { loadConfig } from '@/lib/config'
import { tick } from '@/lib/tick'
import '@/lib/email/jobs' // registers the email jobs with the tick

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  await loadConfig()
  if (!(await cronAllowed(req))) return NextResponse.json({ ran: false, detail: 'Ran recently; skipped.' }, { status: 200 })
  const report = await tick()
  // Only report details to a caller holding CRON_SECRET; anyone else just learns it ran.
  return NextResponse.json(process.env.CRON_SECRET ? report : { ran: true })
}

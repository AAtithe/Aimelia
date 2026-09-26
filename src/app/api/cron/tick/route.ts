/**
 * The background heartbeat, run by Vercel Cron every 10 minutes (vercel.json).
 * Wakes scheduled work, creates routine tasks, nudges old tasks, works the queue,
 * runs the email jobs, and sends the morning push when it is due.
 */
import { NextResponse } from 'next/server'
import { cronAllowed } from '@/lib/auth'
import { tick } from '@/lib/tick'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  if (!cronAllowed(req)) return NextResponse.json({ detail: 'Cron secret missing or wrong.' }, { status: 401 })
  return NextResponse.json(await tick())
}

/** One background cycle. Each step is isolated so one failure never stops the rest. */
import { getPipeline, processQueue, releaseStale, seedDefaults } from './agents/orchestrator'
import { createDueRoutines, nudgeStale, wakeScheduled } from './agents/schedule'
import { maybeSendMorning } from './agents/notify'
import { runImportJobs } from './agents/imports'
import { learnFromNotes, weeklyCheck, weeklyCheckDue } from './memory/learn'
import { keepEarlierNotes, moveChatMemory } from './memory/store'

type Step = [name: string, run: () => Promise<unknown>]
let extraSteps: Step[] = []
/** Other modules (email jobs) register their steps here. */
export function registerTickStep(step: Step) {
  if (!extraSteps.some(([n]) => n === step[0])) extraSteps.push(step)
}

export async function tick(now: Date = new Date()) {
  const report: Record<string, unknown> = {}
  const safe = async (name: string, fn: () => Promise<unknown>) => {
    try { report[name] = await fn() } catch (e) { report[name] = `failed: ${(e as Error).message}`; console.error(`tick ${name}`, e) }
  }
  await safe('seed', () => seedDefaults())
  await safe('released', () => releaseStale())
  await safe('woken', () => wakeScheduled())
  await safe('routines', async () => (await createDueRoutines()).length)
  // Imports cut off mid-read (or queued when the run after the request did not start) finish here.
  const started = Date.now()
  await safe('imports', async () => (await runImportJobs({ limit: 1 })).finished)
  // What Tom wrote since the last tick is learned from; on Sunday evening the weekly check runs, when there is time for it.
  await safe('memory_earlier', () => keepEarlierNotes())
  await safe('memory_moved', () => moveChatMemory())
  await safe('memory_notes', () => learnFromNotes({ startWithinMs: 20_000, limit: 10 }))
  if (Date.now() - started < 40_000 && (await weeklyCheckDue(now))) await safe('memory_check', async () => (await weeklyCheck('weekly', now))?.status)
  const pipeline = await getPipeline()
  await safe('stale', () => nudgeStale(pipeline.stale_days, now))
  // A long read above leaves less of the five minutes for the agents.
  const left = 260_000 - (Date.now() - started)
  if (pipeline.auto_run && left > 20_000) await safe('processed', () => processQueue({ limit: 20, budgetMs: Math.min(200_000, left - 20_000) }))
  for (const [name, run] of extraSteps) await safe(name, run)
  await safe('morning_brief', () => maybeSendMorning(pipeline, now))
  return report
}

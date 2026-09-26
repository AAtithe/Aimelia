/** One background cycle. Each step is isolated so one failure never stops the rest. */
import { getPipeline, processQueue, releaseStale, seedDefaults } from './agents/orchestrator'
import { createDueRoutines, nudgeStale, wakeScheduled } from './agents/schedule'
import { maybeSendMorning } from './agents/notify'

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
  const pipeline = await getPipeline()
  await safe('stale', () => nudgeStale(pipeline.stale_days, now))
  if (pipeline.auto_run) await safe('processed', () => processQueue({ limit: 20, budgetMs: 200_000 }))
  for (const [name, run] of extraSteps) await safe(name, run)
  await safe('morning_brief', () => maybeSendMorning(pipeline, now))
  return report
}

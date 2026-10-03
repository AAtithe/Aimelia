/**
 * Why a run failed, in plain words, and what Tom does about it.
 *
 * Every failure is sorted into one of the reasons below. Each says what happened, what to do, and where in the app
 * to do it. Passing problems (Claude busy, rate limits, a dropped connection, a garbled reply) are retried
 * automatically, a few minutes apart, before the task is marked failed; the rest need Tom, so they fail at once.
 */
import { LLMError } from '../llm'

export type FailureCode =
  | 'no_key' | 'bad_key' | 'no_credit' | 'rate_limit' | 'busy' | 'network' | 'bad_model' | 'too_long' | 'refused'
  | 'garbled' | 'needs_claude' | 'no_workers' | 'repeated_questions' | 'no_actions' | 'out_of_time' | 'unknown'

export type Failure = {
  code: FailureCode
  title: string // what happened, one line
  fix: string // what Tom does about it
  where: { label: string; href: string } | null // the page where the fix is made
  retry: boolean // a passing problem: Aimelia tries again by itself
  agent: string | null // the agent that was working when it failed
  detail: string // the raw error, for whoever maintains Aimelia
  at: string
}

const SETTINGS = { label: 'Open Settings', href: '/settings' }
const TEAM = { label: 'Open Agent team', href: '/team' }

type Reason = Omit<Failure, 'code' | 'agent' | 'detail' | 'at'>
const REASONS: Record<FailureCode, (agent: string | null) => Reason> = {
  no_key: () => ({ title: 'No AI key is saved, so the agents could not run.', retry: false, where: SETTINGS,
    fix: 'Go to Settings, AI, and paste the Claude (Anthropic) key. Then run the team again.' }),
  bad_key: () => ({ title: 'The AI key was refused: it is mistyped, expired or revoked.', retry: false, where: SETTINGS,
    fix: 'Create a new key at console.anthropic.com (API keys), paste it into Settings, AI, and run the team again.' }),
  no_credit: () => ({ title: 'The Anthropic account is out of credit.', retry: false, where: SETTINGS,
    fix: 'Top up at console.anthropic.com (Plans and billing), or switch on auto-reload so it does not happen at month end. Then run the team again.' }),
  rate_limit: () => ({ title: 'Too many requests went to Claude at once and it asked us to slow down.', retry: true, where: TEAM,
    fix: 'Nothing to do: Aimelia tries again by itself. If it keeps happening, lower Max revisions or turn off a reviewer in Agent team, or raise the usage tier at console.anthropic.com.' }),
  busy: () => ({ title: 'Claude was overloaded or had a fault at its end.', retry: true, where: null,
    fix: 'Nothing to do: Aimelia tries again by itself. If it is still failing after that, check status.anthropic.com and run the team again once it is clear.' }),
  network: () => ({ title: 'The connection to the AI dropped or took too long.', retry: true, where: null,
    fix: 'Nothing to do: Aimelia tries again by itself. If it keeps happening, the brief or documents may be too big to finish in time: shorten them and run again.' }),
  bad_model: (agent) => ({ title: `${agent ? `${agent} is` : 'An agent is'} set to a model name that does not exist or the key cannot use.`, retry: false, where: TEAM,
    fix: `In Agent team, open ${agent || 'the agent'} and clear the Model box (it then uses the default) or type a current model name. Then run the team again.` }),
  too_long: () => ({ title: 'The brief, documents and history together are too long for the model to read.', retry: false, where: null,
    fix: 'Remove documents the task does not need, shorten the brief, or split it into smaller tasks. Then run the team again.' }),
  refused: (agent) => ({ title: `Claude declined to work on this${agent ? ` (${agent})` : ''}.`, retry: false, where: null,
    fix: 'Read the brief and attached documents for anything that could read as harmful out of context, reword the brief to say plainly what the work is for, and run the team again.' }),
  garbled: (agent) => ({ title: `${agent || 'An agent'} sent back a reply Aimelia could not read.`, retry: true, where: TEAM,
    fix: `Usually a one-off: Aimelia tries again by itself. If it repeats, the instructions for ${agent || 'that agent'} in Agent team may have been edited to ask for prose: restore the defaults.` }),
  needs_claude: () => ({ title: 'This task needs Claude (reading PDFs or searching the web) but the agents are set to OpenAI.', retry: false, where: SETTINGS,
    fix: 'Add the Claude (Anthropic) key in Settings, AI, or set the agents to Anthropic in Agent team. Then run the team again.' }),
  no_workers: () => ({ title: 'Every worker agent is switched off, so nobody could do the work.', retry: false, where: TEAM,
    fix: 'In Agent team, switch on at least one worker (Triage, Chief of Staff or Planner). Then run the team again.' }),
  repeated_questions: () => ({ title: 'The agents kept asking questions you have already answered or skipped.', retry: false, where: null,
    fix: 'They are missing a fact. Add it to the brief for the team (who, what, the figures, what good looks like) and run the team again.' }),
  no_actions: () => ({ title: 'The team finished without proposing anything to do.', retry: false, where: null,
    fix: 'The brief is probably too thin to act on. Say the outcome you want and who is involved, then run the team again.' }),
  out_of_time: () => ({ title: 'The run kept being cut off before it finished (the five-minute server limit).', retry: false, where: TEAM,
    fix: 'Split the task into smaller ones, take off documents it does not need, or lower Max revisions in Agent team. Then run the team again.' }),
  unknown: () => ({ title: 'Something unexpected stopped the run.', retry: false, where: null,
    fix: 'Run the team again once. If it fails the same way, send the technical detail below to whoever maintains Aimelia.' }),
}

/** The HTTP status the AI provider sent back, from the error or its message ("anthropic claude-x: 429 {...}"). */
function statusOf(e: unknown, msg: string): number | null {
  const s = (e as any)?.status
  if (Number.isInteger(s)) return s
  const m = msg.match(/(?:^|:\s)(\d{3})\b/)
  return m ? Number(m[1]) : null
}

export function classify(e: unknown): FailureCode {
  const msg = String((e as Error)?.message ?? e ?? '')
  const lower = msg.toLowerCase()
  const status = statusOf(e, msg)
  if (/api_key is not set|no ai key/.test(lower)) return 'no_key'
  if (/credit balance|billing|insufficient_quota|exceeded your current quota/.test(lower)) return 'no_credit'
  if (status === 401 || status === 403 || /invalid x-api-key|authentication_error|incorrect api key|permission_error/.test(lower)) return 'bad_key'
  if (status === 429 || /rate.?limit/.test(lower)) return 'rate_limit'
  if (/prompt is too long|too many tokens|context.?length|context window|request too large/.test(lower) || status === 413) return 'too_long'
  if (status === 404 || /not_found_error|model_not_found|does not exist|unknown model/.test(lower)) return 'bad_model'
  if (status === 529 || (status !== null && status >= 500) || /overloaded|internal server error|api_error|service unavailable|bad gateway/.test(lower)) return 'busy'
  if (/timed? ?out|timeout|econnreset|econnrefused|enotfound|etimedout|socket hang up|fetch failed|network|connection error/.test(lower)) return 'network'
  if (/declined to read|refus/.test(lower)) return 'refused'
  if (/did not return valid json/.test(lower)) return 'garbled'
  if (/needs the claude/.test(lower)) return 'needs_claude'
  if (/no enabled worker/.test(lower)) return 'no_workers'
  return 'unknown'
}

export function explain(code: FailureCode, detail = '', agent: string | null = null): Failure {
  return { code, ...REASONS[code](agent), agent, detail: detail.slice(0, 2000), at: new Date().toISOString() }
}

/** The failure for an error thrown during a run. */
export function explainError(e: unknown, agent: string | null = null): Failure {
  const detail = String((e as Error)?.message ?? e ?? '')
  return explain(classify(e), detail, agent ?? ((e as AgentError)?.agent || null))
}

/** An error from one agent's call, carrying the agent's name so the fix can point at it. */
export class AgentError extends LLMError {
  status?: number
  constructor(public agent: string, original: unknown) {
    super(String((original as Error)?.message ?? original))
    this.status = (original as any)?.status
  }
}

/** How long to wait before each automatic try: two tries, two then ten minutes on. */
export const RETRY_MINUTES = [2, 10]

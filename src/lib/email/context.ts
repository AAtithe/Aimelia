/**
 * The context builder: persona as the system prompt, up to two few-shot examples, relevant
 * knowledge-base background, then the task. This is what the original always meant to send;
 * in the Python app an import error meant it silently fell back every time.
 */
import type { Message } from '../llm'
import { examplesFor, PERSONA, TASK_CONTEXT } from './persona'
import { search } from './knowledge'

export async function buildMessages(task: string, meta: Record<string, unknown>, query = '', topK = 6): Promise<{ system: string; messages: Message[] }> {
  const messages: Message[] = []
  for (const [user, assistant] of examplesFor(task, meta)) {
    messages.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
  }
  let knowledge = ''
  try {
    const hits = query ? await search(query, topK) : []
    if (hits.length) {
      knowledge = 'Relevant background information:\n' + hits.map((h, i) => `${i + 1}. [${h.source}] ${h.title}: ${String(h.chunk).slice(0, 200)}...`).join('\n')
    }
  } catch {
    knowledge = ''
  }
  messages.push({ role: 'user', content: [`Task: ${task}`, TASK_CONTEXT[task] || TASK_CONTEXT.default, knowledge,
    `Current context: ${JSON.stringify(meta, null, 2)}`, 'Please respond according to your persona and the context provided above.'].filter(Boolean).join('\n\n') })
  return { system: PERSONA, messages }
}

/** Add an extra instruction as the final user turn (smart drafting, meeting prep). */
export function withInstruction(built: { system: string; messages: Message[] }, instruction: string) {
  const messages = [...built.messages]
  const last = messages[messages.length - 1]
  messages[messages.length - 1] = { role: 'user', content: `${last.content}\n\n${instruction}` }
  return { system: built.system, messages }
}

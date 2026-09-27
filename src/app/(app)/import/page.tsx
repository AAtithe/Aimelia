'use client'

import { Shell } from '@/components/Shell'
import { ImportTasks } from '@/components/tasks/Import'

export default function Page() {
  return (
    <Shell title="Import tasks" sub="From Microsoft To Do, Word documents, meeting notes, transcripts and Fireflies. Everything goes to Triage.">
      <ImportTasks />
    </Shell>
  )
}

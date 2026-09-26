'use client'

import { Shell } from '@/components/Shell'
import { AgentTeam } from '@/components/tasks/AgentTeam'

export default function Page() {
  return (
    <Shell title="Agent team" sub="Who is on the team, how they work together, and the automation settings.">
      <AgentTeam />
    </Shell>
  )
}

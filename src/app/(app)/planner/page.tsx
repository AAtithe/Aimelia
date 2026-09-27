'use client'

import { Shell } from '@/components/Shell'
import { Planner } from '@/components/planner/Planner'

export default function Page() {
  return (
    <Shell title="Planner" sub="Your week: the time you have after meetings, what is planned each day, and what is still to plan.">
      <Planner />
    </Shell>
  )
}

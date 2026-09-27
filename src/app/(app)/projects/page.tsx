'use client'

import { Shell } from '@/components/Shell'
import { Projects } from '@/components/planner/Projects'

export default function Page() {
  return (
    <Shell title="Projects and ideas" sub="Projects and the things you want to come back to. Each one comes back to you on its date.">
      <Projects />
    </Shell>
  )
}

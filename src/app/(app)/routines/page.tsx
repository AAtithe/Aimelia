'use client'

import { Shell } from '@/components/Shell'
import { Routines } from '@/components/tasks/Routines'

export default function Page() {
  return (
    <Shell title="Routines" sub="Recurring work, created and prepared before it is due.">
      <Routines />
    </Shell>
  )
}

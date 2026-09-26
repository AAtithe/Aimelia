'use client'

import { Shell } from '@/components/Shell'
import { Learning } from '@/components/tasks/Learning'

export default function Page() {
  return (
    <Shell title="Learning" sub="What the team has learned from your corrections, and whether it is working.">
      <Learning />
    </Shell>
  )
}

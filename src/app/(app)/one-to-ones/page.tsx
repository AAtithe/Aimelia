'use client'

import { Shell } from '@/components/Shell'
import { OneToOnes } from '@/components/team/OneToOnes'

export default function Page() {
  return (
    <Shell title="1-2-1 prep" sub="Your direct reports: the focus points and tasks that have cropped up for each 1-2-1, the prep sheet, and what was agreed last time.">
      <OneToOnes />
    </Shell>
  )
}

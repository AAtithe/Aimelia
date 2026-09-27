'use client'

import { Shell } from '@/components/Shell'
import { WhatAimeliaKnows } from '@/components/memory/Memory'

export default function Page() {
  return (
    <Shell title="What Aimelia knows" sub="Everything you have told it, what it has learned, and the weekly check. Change anything that is wrong.">
      <WhatAimeliaKnows />
    </Shell>
  )
}

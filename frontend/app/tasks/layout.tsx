import type { Metadata } from 'next'
import './house.css'

export const metadata: Metadata = {
  title: 'Agent Tasks | Williams, Stanley & Co',
  description: 'Your to-do list, worked by a team of agents.',
  icons: { icon: '/assets/favicon.png' },
}

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return <div className="ws">{children}</div>
}

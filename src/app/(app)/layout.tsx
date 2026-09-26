import { AppFrame } from '@/components/Shell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppFrame>{children}</AppFrame>
}

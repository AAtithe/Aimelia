import type { Metadata, Viewport } from 'next'
import './ws-house.css'
import './house.css'

export const metadata: Metadata = {
  title: 'Aimelia | Williams, Stanley & Co',
  description: "Tom Stanley's assistant: agent tasks, email, meetings and briefings.",
  icons: { icon: '/assets/favicon.png', apple: '/assets/favicon.png' },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Aimelia', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#003359' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0 }}>
        <div className="ws">{children}</div>
      </body>
    </html>
  )
}

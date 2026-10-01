import './globals.css'

import type { ReactNode } from 'react'
import { WarmSync } from '@/components/WarmSync'

export const metadata = { title: 'CRDT Workspace' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WarmSync />
        {children}
      </body>
    </html>
  )
}

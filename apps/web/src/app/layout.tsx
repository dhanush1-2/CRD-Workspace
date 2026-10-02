import './globals.css'

import type { ReactNode } from 'react'
import { CanvasBackground } from '@/components/CanvasBackground'
import { WarmSync } from '@/components/WarmSync'

export const metadata = { title: 'CRDT Workspace' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CanvasBackground />
        <WarmSync />
        {/*
          The canvas is fixed at z-index 0, so everything else needs a stacking
          context above it. position:relative is what gives z-index meaning here.
        */}
        <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      </body>
    </html>
  )
}

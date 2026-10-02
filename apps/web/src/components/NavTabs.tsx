'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import type { NavDocument } from './AppShell'
import styles from './nav-tabs.module.css'

type Metrics = { x: number; w: number }

export function NavTabs({
  workspaceId,
  documents,
  activeDocumentId,
}: {
  workspaceId: string
  documents: NavDocument[]
  activeDocumentId?: string
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  // useLayoutEffect, not useEffect: measuring after paint makes the indicator
  // visibly jump from 0 to its position on first render.
  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return

    function measure() {
      const active = element!.querySelector<HTMLElement>(`[data-active="true"]`)
      if (!active) {
        setMetrics(null)
        return
      }
      setMetrics({ x: active.offsetLeft, w: active.offsetWidth })

      // Keep the active tab in view without scrollIntoView, which also scrolls
      // every ancestor and yanks the whole page sideways. Offsets and the
      // smooth behaviour are copied from the prototype.
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      if (left < element!.scrollLeft) {
        element!.scrollTo({ left: left - 12, behavior: 'smooth' })
      } else if (right > element!.scrollLeft + element!.clientWidth) {
        element!.scrollTo({ left: right - element!.clientWidth + 24, behavior: 'smooth' })
      }

      // The strip only overflows at some widths, so the fade is state, not style.
      // As in the prototype, the fade also drops once scrolled to the far end,
      // where there is nothing left to hint at.
      setOverflowing(
        element!.scrollWidth > element!.clientWidth + 2 &&
          element!.scrollLeft + element!.clientWidth < element!.scrollWidth - 2,
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [activeDocumentId, documents])

  return (
    <div
      className={styles.strip}
      ref={strip}
      role="tablist"
      aria-label="Documents"
      style={{
        maskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
        WebkitMaskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
      }}
    >
      <span
        className={styles.indicator}
        aria-hidden="true"
        style={{
          transform: `translateX(${metrics?.x ?? 0}px)`,
          width: metrics?.w ?? 0,
          opacity: metrics ? 1 : 0,
        }}
      />

      <Link
        className={`${styles.tab} ${!activeDocumentId ? styles.tabActive : ''}`}
        href={`/workspaces/${workspaceId}`}
        role="tab"
        aria-selected={!activeDocumentId}
        data-active={!activeDocumentId}
        data-testid="tab-overview"
      >
        Overview
      </Link>

      {documents.map((document) => (
        <Link
          key={document.id}
          className={`${styles.tab} ${document.id === activeDocumentId ? styles.tabActive : ''}`}
          href={`/documents/${document.id}`}
          role="tab"
          aria-selected={document.id === activeDocumentId}
          data-active={document.id === activeDocumentId}
          data-testid={`tab-${document.id}`}
        >
          {document.title}
        </Link>
      ))}
    </div>
  )
}

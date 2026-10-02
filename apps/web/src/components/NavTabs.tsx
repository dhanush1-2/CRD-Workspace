'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import type { NavDocument } from './AppShell'
import styles from './nav-tabs.module.css'

type Metrics = { x: number; w: number }

function isOverflowing(element: HTMLElement) {
  // The fade hints that there is more to scroll to, so it drops once the strip
  // is scrolled to the far end.
  return (
    element.scrollWidth > element.clientWidth + 2 &&
    element.scrollLeft + element.clientWidth < element.scrollWidth - 2
  )
}

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
  // The transition is withheld until the indicator has been placed and painted
  // once. The server renders the indicator at width 0 and it is only sized
  // during hydration, so animating from that first state would make the pill
  // visibly grow from nothing on every hard load.
  const [animated, setAnimated] = useState(false)
  const animatedOnce = useRef(false)

  function measureIndicator(element: HTMLElement) {
    const active = element.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) {
      setMetrics(null)
      return null
    }
    const next = { x: active.offsetLeft, w: active.offsetWidth }
    // offsetLeft is relative to the positioned strip, so it does not change as
    // the strip scrolls. Bail out when nothing moved to skip a re-render.
    setMetrics((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next))
    return active
  }

  // Runs when the active tab or the tab list changes. useLayoutEffect so the
  // indicator is positioned before the first client paint.
  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return

    const active = measureIndicator(element)

    // Keep the active tab in view without scrollIntoView, which also scrolls
    // every ancestor and yanks the whole page sideways. This runs only when the
    // active tab changes: running it on every scroll event would drag the strip
    // back whenever the user scrolled away from the active tab by hand.
    if (active) {
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
      if (left < element.scrollLeft) {
        element.scrollTo({ left: left - 12, behavior })
      } else if (right > element.scrollLeft + element.clientWidth) {
        element.scrollTo({ left: right - element.clientWidth + 24, behavior })
      }
    }
    setOverflowing(isOverflowing(element))

    if (animatedOnce.current) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        animatedOnce.current = true
        setAnimated(true)
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocumentId, documents])

  // Resize re-measures the indicator; scrolling only updates the edge fade.
  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return

    const observer = new ResizeObserver(() => {
      measureIndicator(element)
      setOverflowing(isOverflowing(element))
    })
    observer.observe(element)
    const onScroll = () => setOverflowing(isOverflowing(element))
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={styles.strip}
      ref={strip}
      style={{
        maskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
        WebkitMaskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
      }}
    >
      <span
        className={`${styles.indicator} ${animated ? styles.indicatorAnimated : ''}`}
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
        aria-current={!activeDocumentId ? 'page' : undefined}
        data-active={!activeDocumentId}
        data-testid="tab-overview"
      >
        Overview
      </Link>

      {documents.map((document) => {
        const isActive = document.id === activeDocumentId
        return (
          <Link
            key={document.id}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            href={`/documents/${document.id}`}
            aria-current={isActive ? 'page' : undefined}
            data-active={isActive}
            data-testid={`tab-${document.id}`}
          >
            {document.title}
          </Link>
        )
      })}
    </div>
  )
}

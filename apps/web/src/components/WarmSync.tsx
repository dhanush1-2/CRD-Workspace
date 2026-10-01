'use client'

import { useEffect } from 'react'
import { SYNC_URL, syncHealthUrl } from '@/lib/sync-url'

/**
 * On a free hosting tier the sync server sleeps after 15 idle minutes and takes
 * about a minute to wake. Pinging it as soon as any page loads starts that
 * wake-up while the person is still on the login page or dashboard, instead of
 * only once they open a document.
 *
 * mode 'no-cors': the response is opaque and deliberately ignored; the request
 * reaching the server is the whole point. A failure is expected (it may be
 * asleep) and harmless.
 */
export function WarmSync() {
  useEffect(() => {
    const url = syncHealthUrl(SYNC_URL)
    if (url) void fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
  }, [])
  return null
}

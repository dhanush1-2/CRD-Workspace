/** Where the browser opens its WebSocket. Next inlines NEXT_PUBLIC_ values at build time. */
export const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'

/** The sync server's health endpoint over plain HTTP(S), or null if the URL isn't ws/wss. */
export function syncHealthUrl(syncUrl: string): string | null {
  let url: URL
  try {
    url = new URL(syncUrl)
  } catch {
    return null
  }
  if (url.protocol === 'wss:') url.protocol = 'https:'
  else if (url.protocol === 'ws:') url.protocol = 'http:'
  else return null
  url.pathname = '/healthz'
  url.search = ''
  url.hash = ''
  return url.toString()
}

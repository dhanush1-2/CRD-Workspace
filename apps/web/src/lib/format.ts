/** "1 document", "2 documents". Keeps a bare "1 documents" from ever reaching the page. */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Relative time for a "last activity" line: "just now", "2 minutes ago", "yesterday",
 * "3 days ago". Elapsed-time based, not calendar based, so it reads the same wherever the
 * server's clock zone is. A week or more falls back to a short date. A timestamp slightly
 * in the future (clock skew between the app and the database) reads as "just now".
 */
export function formatRelativeTime(then: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - then.getTime()

  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${formatCount(Math.floor(elapsed / MINUTE), 'minute')} ago`
  if (elapsed < DAY) return `${formatCount(Math.floor(elapsed / HOUR), 'hour')} ago`

  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`

  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

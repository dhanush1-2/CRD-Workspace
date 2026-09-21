/**
 * Validate a `?next=` redirect target.
 *
 * The login page sends the user wherever `?next=` points after a successful
 * sign-in. Without a check, anyone can hand out a link to our own login page
 * that lands the user on a site they control — with our domain in the address
 * bar right up until the redirect fires. Only same-origin absolute paths are
 * allowed through; everything else falls back.
 *
 * Rejects, specifically:
 *   - anything not starting with '/' (absolute URLs, `javascript:`, bare paths)
 *   - '//host' and '/\host', which start with '/' but resolve to another origin
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback
  // Tab, LF and CR are stripped by the URL parser before it resolves, so
  // '/\t/evil.com' becomes '//evil.com' and lands off-origin while passing
  // every prefix check below. Reject all control characters up front.
  if (/[\x00-\x1f]/.test(next)) return fallback
  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

import { HttpError, requireUser } from './auth-guard.js'

export type SessionUser = { id: string; email: string; name: string }

/**
 * The page-facing counterpart to requireUser().
 *
 * requireUser() throws for an API route to turn into a 401. A page wants a
 * question answered instead: is anyone signed in? Returns the user, or null
 * when — and only when — the session is genuinely absent or invalid.
 *
 * Everything else is rethrown on purpose. Catching broadly here would report a
 * database outage as "signed out" and render a login form on top of a real
 * server fault, which is both a worse experience and a much harder bug to find.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    return await requireUser()
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null
    throw error
  }
}

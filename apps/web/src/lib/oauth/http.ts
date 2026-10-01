import type { OAuthErrorCode } from './errors.js'
import type { ProviderId } from './providers.js'

/**
 * A 302 that can set cookies. Not Response.redirect(): the Response it returns
 * has immutable headers, so it cannot carry Set-Cookie.
 */
export function redirectResponse(location: string | URL, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location: location.toString() })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/** Must match, character for character, the callback URL registered with the provider. */
export function callbackUrl(appUrl: string, provider: ProviderId): string {
  return `${appUrl}/api/auth/oauth/${provider}/callback`
}

/** `next` must already have been through safeNext. */
export function loginErrorUrl(appUrl: string, code: OAuthErrorCode, next: string): string {
  const url = new URL('/login', appUrl)
  url.searchParams.set('error', code)
  if (next !== '/') url.searchParams.set('next', next)
  return url.toString()
}

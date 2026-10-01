export type OAuthErrorCode =
  | 'access_denied'
  | 'state_mismatch'
  | 'no_verified_email'
  | 'provider_unavailable'
  | 'provider_error'

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

const MESSAGES: Record<OAuthErrorCode, string> = {
  access_denied: 'Sign-in was cancelled.',
  state_mismatch: 'That sign-in attempt expired or was started in another tab. Please try again.',
  no_verified_email:
    'We need a verified email address from your account. Verify one with the provider, then try again.',
  provider_unavailable: 'That sign-in option is not available right now.',
  provider_error: 'Something went wrong while signing you in. Please try again.',
}

export const GENERIC_SIGNIN_ERROR = 'Sign-in failed. Please try again.'

/**
 * The message for a `?error=` value on the login page, or null when there is none.
 *
 * The value only ever SELECTS one of the fixed strings above; it is never shown.
 * Rendering it would let anyone put text of their choosing on our real login page
 * ("call this number to verify your account") with our domain in the address bar.
 */
export function oauthErrorMessage(code: unknown): string | null {
  if (code === undefined || code === null || code === '') return null
  if (typeof code !== 'string') return GENERIC_SIGNIN_ERROR
  // Object.hasOwn rather than MESSAGES[code]: ?error=toString or ?error=__proto__
  // would otherwise read an inherited property off the object.
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code as OAuthErrorCode] : GENERIC_SIGNIN_ERROR
}

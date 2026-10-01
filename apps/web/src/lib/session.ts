import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'crdt_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export class SessionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SessionError'
  }
}

const encodeSecret = (secret: string) => new TextEncoder().encode(secret)

export async function signSession(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(encodeSecret(secret))
}

export async function verifySession(token: string, secret: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret), { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new SessionError('missing subject')
    }
    return payload.sub
  } catch (cause) {
    if (cause instanceof SessionError) throw cause
    throw new SessionError('session verification failed', { cause })
  }
}

/**
 * Ruling R4: this helper lives beside SESSION_COOKIE and SESSION_TTL_SECONDS rather
 * than inside a route module. Route modules importing helpers from sibling route
 * modules breaks the moment either gains module-level side effects.
 */
export function sessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

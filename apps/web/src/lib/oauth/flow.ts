import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isProviderId, type ProviderId } from './providers.js'

export const OAUTH_COOKIE = 'crdt_oauth'
export const FLOW_TTL_SECONDS = 600
// Scoped to the OAuth routes, so it is not sent with every request to the app.
const COOKIE_PATH = '/api/auth/oauth'

/** Everything the callback needs to finish a sign-in the start route began. */
export type FlowState = {
  provider: ProviderId
  /** Echoed back by the provider; must match, or the callback is a forgery. */
  state: string
  /** PKCE secret. The provider only ever saw its SHA-256 challenge. */
  verifier: string
  /** Already passed through safeNext by the start route. */
  next: string
  /** Seconds since the epoch. */
  issuedAt: number
}

const randomToken = () => randomBytes(32).toString('base64url')

export function newFlow(provider: ProviderId, next: string, now = Date.now()): FlowState {
  return {
    provider,
    next,
    state: randomToken(),
    // 32 random bytes become 43 base64url characters, the minimum PKCE verifier length.
    verifier: randomToken(),
    issuedAt: Math.floor(now / 1000),
  }
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function attributes(maxAge: number): string[] {
  // SameSite=Lax, not Strict: the provider sends the browser back with a
  // cross-site top-level GET. Browsers send Lax cookies on that navigation and
  // withhold Strict ones, which would fail every sign-in with state_mismatch.
  const parts = [`Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts
}

/**
 * The Set-Cookie value holding the flow. Signed with HMAC: on onrender.com the
 * Public Suffix List already stops sibling apps from planting cookies here, but
 * the signature keeps the flow safe on any future custom domain whose other
 * subdomains might not be trustworthy.
 */
export function flowCookie(flow: FlowState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url')
  return [`${OAUTH_COOKIE}=${payload}.${sign(payload, secret)}`, ...attributes(FLOW_TTL_SECONDS)].join('; ')
}

export function clearFlowCookie(): string {
  return [`${OAUTH_COOKIE}=`, ...attributes(0)].join('; ')
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1)
  }
  return null
}

function isFlowState(value: unknown): value is FlowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.provider === 'string' &&
    isProviderId(v.provider) &&
    typeof v.state === 'string' &&
    v.state.length > 0 &&
    typeof v.verifier === 'string' &&
    v.verifier.length >= 43 &&
    v.verifier.length <= 128 &&
    typeof v.next === 'string' &&
    typeof v.issuedAt === 'number' &&
    Number.isInteger(v.issuedAt)
  )
}

/** The flow from a Cookie request header, or null if absent, forged, malformed or expired. */
export function readFlowCookie(cookieHeader: string | null, secret: string, now = Date.now()): FlowState | null {
  const raw = cookieValue(cookieHeader, OAUTH_COOKIE)
  if (!raw) return null

  const [payload, signature, extra] = raw.split('.')
  if (!payload || !signature || extra !== undefined) return null
  if (!statesMatch(signature, sign(payload, secret))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isFlowState(parsed)) return null

  // The browser enforces Max-Age too; checking here as well means a cookie
  // copied out of a browser cannot be replayed later.
  const age = Math.floor(now / 1000) - parsed.issuedAt
  if (age < 0 || age > FLOW_TTL_SECONDS) return null
  return parsed
}

/** Constant-time string comparison. A length mismatch is simply "not equal". */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

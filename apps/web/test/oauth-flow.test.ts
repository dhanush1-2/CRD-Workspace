import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  FLOW_TTL_SECONDS,
  OAUTH_COOKIE,
  clearFlowCookie,
  flowCookie,
  newFlow,
  pkceChallenge,
  readFlowCookie,
  statesMatch,
} from '../src/lib/oauth/flow.js'
import { callbackUrl, loginErrorUrl, redirectResponse } from '../src/lib/oauth/http.js'

const SECRET = 'flow-cookie-test-secret-long-enough!!'
const NOW = 1_800_000_000_000

afterEach(() => {
  vi.unstubAllEnvs()
})

/** "crdt_oauth=<value>; Path=...; ..." -> "crdt_oauth=<value>", as a browser would send it back. */
const asRequestCookie = (setCookie: string) => setCookie.split(';')[0]!

describe('pkceChallenge', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('newFlow', () => {
  it('makes a fresh, URL-safe state and a verifier of legal PKCE length each time', () => {
    const a = newFlow('github', '/', NOW)
    const b = newFlow('github', '/', NOW)
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(a.state).not.toBe(b.state)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.issuedAt).toBe(Math.floor(NOW / 1000))
  })
})

describe('flow cookie', () => {
  it('round-trips', () => {
    const flow = newFlow('google', '/workspaces/abc', NOW)
    const cookie = asRequestCookie(flowCookie(flow, SECRET))
    expect(readFlowCookie(cookie, SECRET, NOW)).toEqual(flow)
  })

  it('is found among other cookies', () => {
    const flow = newFlow('github', '/', NOW)
    const header = `crdt_session=abc; ${asRequestCookie(flowCookie(flow, SECRET))}; theme=dark`
    expect(readFlowCookie(header, SECRET, NOW)).toEqual(flow)
  })

  it('is HttpOnly, SameSite=Lax, scoped to the OAuth routes, and short-lived', () => {
    const cookie = flowCookie(newFlow('github', '/', NOW), SECRET)
    expect(cookie).toContain('HttpOnly')
    // Lax, not Strict: the provider returns the browser with a cross-site
    // top-level GET, and a Strict cookie would be withheld from it.
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api/auth/oauth')
    expect(cookie).toContain(`Max-Age=${FLOW_TTL_SECONDS}`)
    expect(cookie).not.toContain('Secure')
  })

  it('is Secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(flowCookie(newFlow('github', '/', NOW), SECRET)).toContain('Secure')
  })

  it('rejects a cookie whose payload was edited', () => {
    const flow = newFlow('github', '/', NOW)
    const [name, value] = asRequestCookie(flowCookie(flow, SECRET)).split('=') as [string, string]
    const [, signature] = value.split('.')
    const forged = Buffer.from(JSON.stringify({ ...flow, next: '//evil.example' })).toString('base64url')
    expect(readFlowCookie(`${name}=${forged}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it('rejects a cookie signed with a different secret', () => {
    const cookie = asRequestCookie(flowCookie(newFlow('github', '/', NOW), 'another-secret-entirely-long-enough'))
    expect(readFlowCookie(cookie, SECRET, NOW)).toBeNull()
  })

  it('rejects a cookie older than its lifetime', () => {
    const cookie = asRequestCookie(flowCookie(newFlow('github', '/', NOW), SECRET))
    expect(readFlowCookie(cookie, SECRET, NOW + (FLOW_TTL_SECONDS + 1) * 1000)).toBeNull()
    expect(readFlowCookie(cookie, SECRET, NOW + FLOW_TTL_SECONDS * 1000)).not.toBeNull()
  })

  it('rejects a cookie issued in the future', () => {
    const cookie = asRequestCookie(flowCookie(newFlow('github', '/', NOW + 60_000), SECRET))
    expect(readFlowCookie(cookie, SECRET, NOW)).toBeNull()
  })

  it('returns null, never throws, on missing or garbage input', () => {
    expect(readFlowCookie(null, SECRET, NOW)).toBeNull()
    expect(readFlowCookie('', SECRET, NOW)).toBeNull()
    expect(readFlowCookie('theme=dark', SECRET, NOW)).toBeNull()
    expect(readFlowCookie(`${OAUTH_COOKIE}=%%%`, SECRET, NOW)).toBeNull()
    expect(readFlowCookie(`${OAUTH_COOKIE}=a.b.c`, SECRET, NOW)).toBeNull()
    expect(readFlowCookie(`${OAUTH_COOKIE}=onlyonepart`, SECRET, NOW)).toBeNull()
  })

  it('is cleared with the same Path, which is the only way a browser will remove it', () => {
    const cleared = clearFlowCookie()
    expect(cleared).toMatch(new RegExp(`^${OAUTH_COOKIE}=;`))
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('Path=/api/auth/oauth')
  })
})

describe('statesMatch', () => {
  it('compares exactly, and treats a length mismatch as unequal instead of throwing', () => {
    expect(statesMatch('abc', 'abc')).toBe(true)
    expect(statesMatch('abc', 'abd')).toBe(false)
    expect(statesMatch('abc', 'abcd')).toBe(false)
    expect(statesMatch('abc', '')).toBe(false)
  })
})

describe('http helpers', () => {
  it('builds a 302 that can carry more than one cookie', () => {
    const response = redirectResponse('http://localhost:3000/', ['a=1; Path=/', 'b=2; Path=/'])
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:3000/')
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it('builds the callback URL registered with the provider', () => {
    expect(callbackUrl('https://crdt-web.onrender.com', 'google')).toBe(
      'https://crdt-web.onrender.com/api/auth/oauth/google/callback',
    )
  })

  it('builds a login error URL, omitting next when it is just the default', () => {
    expect(loginErrorUrl('http://localhost:3000', 'access_denied', '/')).toBe(
      'http://localhost:3000/login?error=access_denied',
    )
    expect(loginErrorUrl('http://localhost:3000', 'state_mismatch', '/workspaces/abc')).toBe(
      'http://localhost:3000/login?error=state_mismatch&next=%2Fworkspaces%2Fabc',
    )
  })
})

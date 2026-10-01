import { describe, it, expect, afterEach, vi } from 'vitest'
import { OAuthError, oauthErrorMessage, GENERIC_SIGNIN_ERROR } from '../src/lib/oauth/errors.js'
import {
  availableProviders,
  exchangeCode,
  fetchProfile,
  githubProfile,
  googleProfile,
  isProviderId,
  oauthClient,
  NAME_MAX,
} from '../src/lib/oauth/providers.js'

const ENV_KEYS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(OAuthError)
    expect((error as OAuthError).code).toBe(code)
    return
  }
  throw new Error(`expected OAuthError(${code}) but nothing was thrown`)
}

describe('isProviderId', () => {
  it('accepts exactly the supported providers', () => {
    expect(isProviderId('github')).toBe(true)
    expect(isProviderId('google')).toBe(true)
    expect(isProviderId('facebook')).toBe(false)
    expect(isProviderId('GitHub')).toBe(false)
  })
})

describe('githubProfile', () => {
  const user = { id: 583231, login: 'octocat', name: 'The Octocat' }

  it('uses the primary, verified address, trimmed and lowercased', () => {
    const profile = githubProfile(user, [
      { email: 'old@example.com', primary: false, verified: true },
      { email: '  Octo@Example.COM ', primary: true, verified: true },
    ])
    expect(profile).toEqual({ providerAccountId: '583231', email: 'octo@example.com', name: 'The Octocat' })
  })

  it('refuses a primary address GitHub has not verified', () => {
    expectCode(
      () => githubProfile(user, [{ email: 'octo@example.com', primary: true, verified: false }]),
      'no_verified_email',
    )
  })

  it('does not fall back to a verified secondary address', () => {
    // The primary is the address the person chose; a verified secondary is not a substitute.
    expectCode(
      () =>
        githubProfile(user, [
          { email: 'primary@example.com', primary: true, verified: false },
          { email: 'secondary@example.com', primary: false, verified: true },
        ]),
      'no_verified_email',
    )
  })

  it('refuses an account with no email addresses at all', () => {
    expectCode(() => githubProfile(user, []), 'no_verified_email')
  })

  it('falls back to the login when the display name is null or blank', () => {
    const emails = [{ email: 'octo@example.com', primary: true, verified: true }]
    expect(githubProfile({ ...user, name: null }, emails).name).toBe('octocat')
    expect(githubProfile({ ...user, name: '   ' }, emails).name).toBe('octocat')
  })

  it('truncates an absurdly long display name', () => {
    const emails = [{ email: 'octo@example.com', primary: true, verified: true }]
    expect(githubProfile({ ...user, name: 'x'.repeat(500) }, emails).name).toHaveLength(NAME_MAX)
  })

  it('treats a malformed response as a provider error, not a crash', () => {
    expectCode(() => githubProfile(null, []), 'provider_error')
    expectCode(() => githubProfile({ login: 'no-id' }, []), 'provider_error')
    expectCode(() => githubProfile(user, { not: 'a list' }), 'provider_error')
  })
})

describe('googleProfile', () => {
  it('accepts a verified email and normalizes it', () => {
    expect(googleProfile({ sub: '1098', email: 'Ada@Gmail.com', email_verified: true, name: 'Ada' })).toEqual({
      providerAccountId: '1098',
      email: 'ada@gmail.com',
      name: 'Ada',
    })
  })

  it('refuses an unverified email', () => {
    expectCode(() => googleProfile({ sub: '1', email: 'a@b.com', email_verified: false }), 'no_verified_email')
  })

  it('refuses email_verified sent as the string "true"', () => {
    expectCode(() => googleProfile({ sub: '1', email: 'a@b.com', email_verified: 'true' }), 'no_verified_email')
  })

  it('falls back to the email local part when there is no name', () => {
    expect(googleProfile({ sub: '1', email: 'grace@example.com', email_verified: true }).name).toBe('grace')
  })

  it('treats a missing subject as a provider error', () => {
    expectCode(() => googleProfile({ email: 'a@b.com', email_verified: true }), 'provider_error')
  })
})

describe('oauthClient and availableProviders', () => {
  it('returns trimmed credentials only when both halves are present', () => {
    process.env.GITHUB_CLIENT_ID = '  gh-id  '
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
    delete process.env.GOOGLE_CLIENT_ID
    process.env.GOOGLE_CLIENT_SECRET = 'orphan-secret'

    expect(oauthClient('github')).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' })
    expect(oauthClient('google')).toBeNull()
    expect(availableProviders()).toEqual(['github'])
  })

  it('treats a blank value as missing', () => {
    process.env.GITHUB_CLIENT_ID = '   '
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
    expect(oauthClient('github')).toBeNull()
  })
})

describe('oauthErrorMessage', () => {
  it('returns null when there is no error', () => {
    expect(oauthErrorMessage(undefined)).toBeNull()
    expect(oauthErrorMessage('')).toBeNull()
  })

  it('maps a known code to its fixed message', () => {
    expect(oauthErrorMessage('access_denied')).toBe('Sign-in was cancelled.')
  })

  it('shows one generic message for anything else, never the raw value', () => {
    expect(oauthErrorMessage('Call 555-0100 to verify')).toBe(GENERIC_SIGNIN_ERROR)
    expect(oauthErrorMessage(['a', 'b'])).toBe(GENERIC_SIGNIN_ERROR)
  })

  it('is not fooled by keys inherited from Object.prototype', () => {
    // A naive MESSAGES[code] lookup returns a function for these.
    expect(oauthErrorMessage('toString')).toBe(GENERIC_SIGNIN_ERROR)
    expect(oauthErrorMessage('__proto__')).toBe(GENERIC_SIGNIN_ERROR)
    expect(oauthErrorMessage('constructor')).toBe(GENERIC_SIGNIN_ERROR)
  })
})

describe('exchangeCode', () => {
  const client = { clientId: 'cid', clientSecret: 'csecret' }

  it('posts the code, verifier and redirect URI and returns the access token', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'tok-123', token_type: 'bearer' }))
    vi.stubGlobal('fetch', fetchMock)

    const token = await exchangeCode('github', client, 'the-code', 'the-verifier', 'http://localhost:3000/cb')

    expect(token).toBe('tok-123')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://github.com/login/oauth/access_token')
    expect((init.headers as Record<string, string>).accept).toBe('application/json')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toBe('the-verifier')
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/cb')
    expect(body.get('client_id')).toBe('cid')
  })

  it("treats GitHub's HTTP-200-with-error response as a failure", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'bad_verification_code' })))
    await expect(exchangeCode('github', client, 'reused', 'v', 'http://x/cb')).rejects.toMatchObject({
      code: 'provider_error',
    })
  })

  it('treats a non-2xx response as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(exchangeCode('google', client, 'c', 'v', 'http://x/cb')).rejects.toMatchObject({
      code: 'provider_error',
    })
  })
})

describe('fetchProfile', () => {
  it('reads GitHub /user and /user/emails with a bearer token and a User-Agent', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/user/emails')
        ? Response.json([{ email: 'octo@example.com', primary: true, verified: true }])
        : Response.json({ id: 1, login: 'octocat', name: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const profile = await fetchProfile('github', 'tok')

    expect(profile).toEqual({ providerAccountId: '1', email: 'octo@example.com', name: 'octocat' })
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      const headers = call[1].headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer tok')
      // GitHub's REST API rejects requests with no User-Agent.
      expect(headers['user-agent']).toBeTruthy()
    }
  })

  it('reads the Google OpenID userinfo endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json({ sub: '77', email: 'g@example.com', email_verified: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchProfile('google', 'tok')).resolves.toEqual({
      providerAccountId: '77',
      email: 'g@example.com',
      name: 'g',
    })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://openidconnect.googleapis.com/v1/userinfo',
    )
  })
})

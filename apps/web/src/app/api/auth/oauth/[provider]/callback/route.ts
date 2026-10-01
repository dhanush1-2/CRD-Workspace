import { env } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { sessionCookie, signSession } from '@/lib/session'
import { OAuthError, type OAuthErrorCode } from '@/lib/oauth/errors'
import { exchangeCode, fetchProfile, isProviderId, oauthClient } from '@/lib/oauth/providers'
import { clearFlowCookie, readFlowCookie, statesMatch } from '@/lib/oauth/flow'
import { callbackUrl, loginErrorUrl, redirectResponse } from '@/lib/oauth/http'
import { resolveOAuthUser } from '@/lib/oauth/resolve-user'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params
  const appUrl = env.appUrl
  const secret = env.sessionSecret
  const url = new URL(request.url)

  const flow = readFlowCookie(request.headers.get('cookie'), secret)
  // Single use: whatever happens below, this flow is spent.
  const spent = clearFlowCookie()
  // Re-validated here even though the start route already did it: the callback
  // does not trust the cookie's copy of next blindly.
  const next = safeNext(flow?.next)
  const fail = (code: OAuthErrorCode) => redirectResponse(loginErrorUrl(appUrl, code, next), [spent])

  if (!isProviderId(provider)) return fail('provider_unavailable')

  const providerError = url.searchParams.get('error')
  if (providerError) return fail(providerError === 'access_denied' ? 'access_denied' : 'provider_error')

  // Checked before any network call, so a forged callback costs us nothing.
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!flow || !code || !state || flow.provider !== provider || !statesMatch(flow.state, state)) {
    return fail('state_mismatch')
  }

  const client = oauthClient(provider)
  if (!client) return fail('provider_unavailable')

  try {
    const accessToken = await exchangeCode(provider, client, code, flow.verifier, callbackUrl(appUrl, provider))
    const profile = await fetchProfile(provider, accessToken)
    const user = await resolveOAuthUser(provider, profile)
    const token = await signSession(user.id, secret)
    return redirectResponse(new URL(next, appUrl), [spent, sessionCookie(token)])
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.code)
    // Logged without the code, token, verifier or any secret.
    console.error(JSON.stringify({ level: 'error', msg: 'oauth callback failed', provider, error: String(error) }))
    return fail('provider_error')
  }
}

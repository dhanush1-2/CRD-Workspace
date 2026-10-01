import { env } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { PROVIDERS, isProviderId, oauthClient } from '@/lib/oauth/providers'
import { flowCookie, newFlow, pkceChallenge } from '@/lib/oauth/flow'
import { callbackUrl, loginErrorUrl, redirectResponse } from '@/lib/oauth/http'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params
  const next = safeNext(new URL(request.url).searchParams.get('next'))
  // From configuration, never from the request's Host header.
  const appUrl = env.appUrl

  if (!isProviderId(provider)) return redirectResponse(loginErrorUrl(appUrl, 'provider_unavailable', next))
  const client = oauthClient(provider)
  if (!client) return redirectResponse(loginErrorUrl(appUrl, 'provider_unavailable', next))

  const flow = newFlow(provider, next)
  const spec = PROVIDERS[provider]
  const authorize = new URL(spec.authorizeUrl)
  authorize.searchParams.set('client_id', client.clientId)
  authorize.searchParams.set('redirect_uri', callbackUrl(appUrl, provider))
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', spec.scope)
  authorize.searchParams.set('state', flow.state)
  authorize.searchParams.set('code_challenge', pkceChallenge(flow.verifier))
  authorize.searchParams.set('code_challenge_method', 'S256')
  for (const [key, value] of Object.entries(spec.extraAuthorizeParams)) authorize.searchParams.set(key, value)

  return redirectResponse(authorize, [flowCookie(flow, env.sessionSecret)])
}

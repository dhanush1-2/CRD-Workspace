import { SESSION_COOKIE } from '@/lib/session'

export async function POST(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0` },
  })
}

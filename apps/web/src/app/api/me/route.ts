import { requireUser, toResponse } from '@/lib/auth-guard'

export async function GET(): Promise<Response> {
  try {
    return Response.json(await requireUser())
  } catch (error) {
    return toResponse(error)
  }
}

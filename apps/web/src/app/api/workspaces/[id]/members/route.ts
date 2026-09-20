import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireUser, requireWorkspaceRole, toResponse, HttpError } from '@/lib/auth-guard'

const Body = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'editor', 'viewer']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const invitee = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    })
    if (!invitee) throw new HttpError(404, 'not found')

    const member = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: invitee.id } },
      create: { workspaceId, userId: invitee.id, role: parsed.data.role },
      update: { role: parsed.data.role },
      select: { userId: true, role: true },
    })
    return Response.json(member, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}

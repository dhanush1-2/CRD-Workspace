import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireUser, toResponse } from '@/lib/auth-guard'

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser()
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { role: true, workspace: { select: { id: true, name: true } } },
    })
    return Response.json(
      memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
    )
  } catch (error) {
    return toResponse(error)
  }
}

const CreateBody = z.object({ name: z.string().min(1).max(120) })

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser()
    const body = await request.json().catch(() => null)
    const parsed = CreateBody.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.name,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: { id: true, name: true },
    })
    return Response.json(workspace, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}

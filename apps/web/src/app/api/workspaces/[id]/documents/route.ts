import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'viewer')

    const documents = await prisma.document.findMany({
      where: { workspaceId },
      select: { id: true, title: true, type: true },
      orderBy: { createdAt: 'asc' },
    })
    return Response.json(documents)
  } catch (error) {
    return toResponse(error)
  }
}

const Body = z.object({ title: z.string().min(1).max(200), type: z.enum(['doc', 'board']) })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'editor')

    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const document = await prisma.document.create({
      data: { workspaceId, title: parsed.data.title, type: parsed.data.type },
      select: { id: true, title: true, type: true },
    })
    return Response.json(document, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}

import { prisma } from '@crdt/db'

/**
 * When each document last changed, keyed by document id. A document nobody has edited
 * has no entry; the caller falls back to its creation time.
 *
 * Two queries rather than a nested `updates: { take: 1 }`: Prisma applies a nested take
 * in memory, so that form reads the whole update log of every document. The groupBy is
 * answered from the (documentId, id) index, and the follow-up reads one row per document.
 * Ordering by id rather than createdAt is deliberate: id is in the index and increases
 * with every insert.
 */
export async function lastActivityByDocument(
  documentIds: string[],
  db: Pick<typeof prisma, 'documentUpdate'> = prisma,
): Promise<Map<string, Date>> {
  if (documentIds.length === 0) return new Map()

  const newest = await db.documentUpdate.groupBy({
    by: ['documentId'],
    where: { documentId: { in: documentIds } },
    _max: { id: true },
  })
  const newestIds = newest.flatMap((row) => (row._max.id === null ? [] : [row._max.id]))
  if (newestIds.length === 0) return new Map()

  const rows = await db.documentUpdate.findMany({
    where: { id: { in: newestIds } },
    select: { documentId: true, createdAt: true },
  })
  return new Map(rows.map((row) => [row.documentId, row.createdAt]))
}

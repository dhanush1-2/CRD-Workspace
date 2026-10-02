import { prisma } from '@crdt/db'

/**
 * When each document last changed, keyed by document id. A document nobody has edited
 * has no entry; the caller falls back to its creation time.
 *
 * One lateral join: for each requested document it seeks the (documentId, id) index
 * backwards and stops at the first entry, so the cost is one index seek per document
 * rather than a walk over every update row. The old alternatives both read the whole
 * log: a nested `updates: { take: 1 }` applies the take in memory, and a groupBy
 * MAX(id) cannot skip within a document because Postgres has no loose index scan.
 * Ordering by id rather than createdAt is deliberate: id is in the index and increases
 * with every insert.
 *
 * The seek assumes the planner picks the composite index. With very few documents and
 * heavily skewed update counts it can instead walk the primary key backwards with a
 * filter; with a realistic document count it uses (documentId, id).
 *
 * Parameterised: the id array is bound as a single text[] parameter.
 */
export async function lastActivityByDocument(documentIds: string[]): Promise<Map<string, Date>> {
  if (documentIds.length === 0) return new Map()

  const rows = await prisma.$queryRaw<{ documentId: string; createdAt: Date | null }[]>`
    SELECT d.id AS "documentId", u."createdAt"
    FROM unnest(${documentIds}::text[]) AS d(id)
    LEFT JOIN LATERAL (
      SELECT "createdAt" FROM "DocumentUpdate"
      WHERE "documentId" = d.id
      ORDER BY "id" DESC
      LIMIT 1
    ) u ON true
  `
  const activity = new Map<string, Date>()
  for (const row of rows) {
    if (row.createdAt !== null) activity.set(row.documentId, row.createdAt)
  }
  return activity
}

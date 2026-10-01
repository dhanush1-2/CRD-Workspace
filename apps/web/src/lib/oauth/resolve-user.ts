import { prisma } from '@crdt/db'
import type { OAuthProfile, ProviderId } from './providers.js'

/**
 * The user a verified provider identity signs into, creating one if needed.
 * `profile.email` must already be provider-verified and normalized (providers.ts).
 */
export async function resolveOAuthUser(provider: ProviderId, profile: OAuthProfile): Promise<{ id: string }> {
  try {
    return await attempt(provider, profile)
  } catch (error) {
    // Two first sign-ins for the same person can race (a double click, two tabs).
    // The loser trips a unique constraint on the email or on the identity; by the
    // time it does, the winner's rows are committed, so one re-run takes the
    // "already linked" path. A second failure is a real error and propagates.
    if (isUniqueViolation(error)) return attempt(provider, profile)
    throw error
  }
}

async function attempt(provider: ProviderId, profile: OAuthProfile): Promise<{ id: string }> {
  const identity = { provider, providerAccountId: profile.providerAccountId }

  // Rule 1: a known identity always maps to its user, even if the email the
  // provider reports has changed since. The identity id is stable; email is not.
  const linked = await prisma.account.findUnique({
    where: { provider_providerAccountId: identity },
    select: { userId: true },
  })
  if (linked) return { id: linked.userId }

  // Rule 2: link to the user who already has this email. Safe only because every
  // way a user row can exist is trusted: an earlier provider-verified sign-in, or
  // the operator's seed script. Password sign-up — which let someone create a row
  // for an address they did not own — no longer exists.
  const existing = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } })
  if (existing) {
    await prisma.account.create({ data: { ...identity, userId: existing.id } })
    return existing
  }

  // Rule 3: someone new. User, identity and personal workspace are created in one
  // transaction, so a failure part-way cannot leave a user with nowhere to land.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: profile.email, name: profile.name, accounts: { create: identity } },
      select: { id: true },
    })
    await tx.workspace.create({
      data: {
        name: `${profile.name}'s workspace`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    })
    return user
  })
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

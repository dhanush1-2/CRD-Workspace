import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { resolveOAuthUser } from '../src/lib/oauth/resolve-user.js'

const RUN = Date.now().toString(36)
const email = (label: string) => `resolve-${label}-${RUN}@example.com`
const id = (label: string) => `${label}-${RUN}`

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `-${RUN}@example.com` } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  // Workspace.ownerId is a plain string column, not a relation, so deleting a
  // user does not cascade to their workspace. Delete workspaces first.
  await prisma.workspace.deleteMany({ where: { ownerId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

async function footprint(userEmail: string) {
  const users = await prisma.user.findMany({ where: { email: userEmail }, select: { id: true } })
  const ids = users.map((user) => user.id)
  return {
    users: users.length,
    accounts: await prisma.account.count({ where: { userId: { in: ids } } }),
    workspaces: await prisma.workspace.count({ where: { ownerId: { in: ids } } }),
  }
}

describe('resolveOAuthUser', () => {
  it('creates a password-less user, links the identity, and gives them a workspace they own', async () => {
    const user = await resolveOAuthUser('github', { providerAccountId: id('new'), email: email('new'), name: 'Ada' })

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      include: { accounts: true, memberships: { include: { workspace: true } } },
    })
    expect(row?.email).toBe(email('new'))
    expect(row?.passwordHash).toBeNull()
    expect(row?.accounts).toEqual([
      expect.objectContaining({ provider: 'github', providerAccountId: id('new') }),
    ])
    expect(row?.memberships).toHaveLength(1)
    expect(row?.memberships[0]?.role).toBe('owner')
    expect(row?.memberships[0]?.workspace.name).toBe("Ada's workspace")
    expect(row?.memberships[0]?.workspace.ownerId).toBe(user.id)
  })

  it('signs a returning identity into the same user and creates nothing new', async () => {
    const profile = { providerAccountId: id('return'), email: email('return'), name: 'Grace' }
    const first = await resolveOAuthUser('google', profile)
    const before = await footprint(email('return'))

    const second = await resolveOAuthUser('google', profile)

    expect(second.id).toBe(first.id)
    expect(await footprint(email('return'))).toEqual(before)
  })

  it('links a second provider to the user who already has that verified email', async () => {
    const viaGithub = await resolveOAuthUser('github', {
      providerAccountId: id('gh-both'),
      email: email('both'),
      name: 'Both',
    })
    const viaGoogle = await resolveOAuthUser('google', {
      providerAccountId: id('gg-both'),
      email: email('both'),
      name: 'Both (Google)',
    })

    expect(viaGoogle.id).toBe(viaGithub.id)
    expect(await footprint(email('both'))).toEqual({ users: 1, accounts: 2, workspaces: 1 })
  })

  it('follows the identity, not the email, when the provider email has changed', async () => {
    const original = await resolveOAuthUser('github', {
      providerAccountId: id('moved'),
      email: email('moved-old'),
      name: 'Mover',
    })

    const after = await resolveOAuthUser('github', {
      providerAccountId: id('moved'),
      email: email('moved-new'),
      name: 'Mover',
    })

    expect(after.id).toBe(original.id)
    expect(await footprint(email('moved-new'))).toEqual({ users: 0, accounts: 0, workspaces: 0 })
  })

  it('links to a pre-existing user row with that email without giving them a second workspace', async () => {
    // How the operator's seed script creates the demo owner: a user row with no identity yet.
    const seeded = await prisma.user.create({ data: { email: email('seeded'), name: 'Seeded' } })

    const user = await resolveOAuthUser('google', {
      providerAccountId: id('seeded'),
      email: email('seeded'),
      name: 'Seeded Person',
    })

    expect(user.id).toBe(seeded.id)
    expect(await footprint(email('seeded'))).toEqual({ users: 1, accounts: 1, workspaces: 0 })
  })

  it('survives two simultaneous first sign-ins for the same identity', async () => {
    // A double click, or two tabs. Whichever loses the race hits a unique
    // constraint and must still end up signed into the winner's user.
    const profile = { providerAccountId: id('race'), email: email('race'), name: 'Racer' }

    const [a, b] = await Promise.all([resolveOAuthUser('github', profile), resolveOAuthUser('github', profile)])

    expect(a.id).toBe(b.id)
    expect(await footprint(email('race'))).toEqual({ users: 1, accounts: 1, workspaces: 1 })
  })
})

import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '../src/index.js'

// A per-run suffix keeps ids and emails unique, so a crashed earlier run that
// skipped cleanup cannot make this run fail on a unique constraint.
const RUN = Date.now().toString(36)
const email = (label: string) => `account-schema-${label}-${RUN}@example.com`
const id = (label: string) => `${label}-${RUN}`

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

describe('Account', () => {
  it('lets a user exist with no password at all', async () => {
    const user = await prisma.user.create({ data: { email: email('nopass'), name: 'No Password' } })
    expect(user.passwordHash).toBeNull()
  })

  it('links more than one provider identity to the same user', async () => {
    const user = await prisma.user.create({
      data: {
        email: email('both'),
        name: 'Both',
        accounts: {
          create: [
            { provider: 'github', providerAccountId: id('gh-both') },
            { provider: 'google', providerAccountId: id('gg-both') },
          ],
        },
      },
      include: { accounts: true },
    })
    expect(user.accounts.map((account) => account.provider).sort()).toEqual(['github', 'google'])
  })

  it('refuses to link the same provider identity twice', async () => {
    await prisma.user.create({
      data: {
        email: email('first'),
        name: 'First',
        accounts: { create: { provider: 'github', providerAccountId: id('gh-dup') } },
      },
    })
    await expect(
      prisma.user.create({
        data: {
          email: email('second'),
          name: 'Second',
          accounts: { create: { provider: 'github', providerAccountId: id('gh-dup') } },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('allows the same account id string under different providers', async () => {
    // Ids are stored as text. Nothing stops a GitHub id and a Google id from
    // being the same string, and they must not collide.
    await prisma.user.create({
      data: {
        email: email('gh-shared'),
        name: 'GH',
        accounts: { create: { provider: 'github', providerAccountId: id('shared') } },
      },
    })
    await expect(
      prisma.user.create({
        data: {
          email: email('gg-shared'),
          name: 'GG',
          accounts: { create: { provider: 'google', providerAccountId: id('shared') } },
        },
      }),
    ).resolves.toBeTruthy()
  })

  it('deletes linked identities when the user is deleted', async () => {
    const user = await prisma.user.create({
      data: {
        email: email('doomed'),
        name: 'Doomed',
        accounts: { create: { provider: 'google', providerAccountId: id('gg-doomed') } },
      },
    })
    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0)
  })
})

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url))
} catch {
  // No .env file present (e.g. production); rely on process.env being set already.
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export * from '@prisma/client'

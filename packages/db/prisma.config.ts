import { defineConfig, env } from 'prisma/config'

// .env is absent in production, where DATABASE_URL comes from the host —
// same reasoning as src/index.ts's identical guard.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  // intentional: fall through; Prisma's own env() resolution is the real guard
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})

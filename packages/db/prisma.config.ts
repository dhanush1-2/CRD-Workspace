import { defineConfig, env } from 'prisma/config'

process.loadEnvFile(new URL('../../.env', import.meta.url))

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})

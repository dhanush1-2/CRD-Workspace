function required(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`)
  }
  return value
}

export function loadConfig() {
  return {
    port: Number(process.env.SYNC_PORT ?? 1234),
    jwtSecret: required('SYNC_JWT_SECRET'),
    idleEvictMs: Number(process.env.SYNC_IDLE_EVICT_MS ?? 30_000),
  }
}

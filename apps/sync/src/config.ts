// The exact placeholder committed in .env.example. `cp .env.example .env` is Task 2's
// own documented setup step, so a length check alone isn't enough — this placeholder
// is 38 characters and would otherwise sail through it, letting a real deployment boot
// on a fully public, world-readable JWT signing secret.
const PLACEHOLDER_SYNC_JWT_SECRET = 'replace-me-with-a-different-32-bytes'

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`)
  }
  if (name === 'SYNC_JWT_SECRET' && value === PLACEHOLDER_SYNC_JWT_SECRET) {
    throw new Error(`${name} is still set to the placeholder value from .env.example; generate a real secret`)
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

// Reads and validates secrets from process.env. Next.js populates process.env
// before user code runs, and @crdt/db already handles .env loading at import
// time — this module must not attempt to load a .env file itself (CF7).
//
// The exact placeholders committed in .env.example. `cp .env.example .env` is Task
// 2's own documented setup step, so a length check alone isn't enough — both
// placeholders are well over 32 characters and would otherwise sail through it,
// letting a real deployment boot on a fully public, world-readable secret (for
// SYNC_JWT_SECRET, that means anyone who has read this repository can mint a token
// claiming `role: 'owner'` for any document).
const PLACEHOLDERS: Record<string, string> = {
  SESSION_SECRET: 'replace-me-with-32-bytes-of-random',
  SYNC_JWT_SECRET: 'replace-me-with-a-different-32-bytes',
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`)
  }
  if (value === PLACEHOLDERS[name]) {
    throw new Error(`${name} is still set to the placeholder value from .env.example; generate a real secret`)
  }
  return value
}

export const env = {
  get sessionSecret() {
    return required('SESSION_SECRET')
  },
  get syncJwtSecret() {
    return required('SYNC_JWT_SECRET')
  },
}

// Reads and validates secrets from process.env. Next.js populates process.env
// before user code runs, and @crdt/db already handles .env loading at import
// time — this module must not attempt to load a .env file itself (CF7).
function required(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`)
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

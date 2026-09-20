import { SignJWT, jwtVerify } from 'jose'
import { isRole, type Role } from './types.js'

export interface DocTokenClaims {
  sub: string
  docId: string
  role: Role
  name: string
  color: string
}

export class DocTokenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DocTokenError'
  }
}

const encodeSecret = (secret: string): Uint8Array => new TextEncoder().encode(secret)

export const DEFAULT_TTL_SECONDS = 900

export async function signDocToken(
  claims: DocTokenClaims,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({
    docId: claims.docId,
    role: claims.role,
    name: claims.name,
    color: claims.color,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(encodeSecret(secret))
}

export async function verifyDocToken(token: string, secret: string): Promise<DocTokenClaims> {
  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, encodeSecret(secret), { algorithms: ['HS256'] })
    payload = result.payload as Record<string, unknown>
  } catch (cause) {
    throw new DocTokenError('token verification failed', { cause })
  }

  const { sub, docId, role, name, color } = payload

  if (typeof sub !== 'string' || sub.length === 0) throw new DocTokenError('missing sub')
  if (typeof docId !== 'string' || docId.length === 0) throw new DocTokenError('missing docId')
  if (!isRole(role)) throw new DocTokenError('invalid role')
  if (typeof name !== 'string') throw new DocTokenError('missing name')
  if (typeof color !== 'string') throw new DocTokenError('missing color')

  return { sub, docId, role, name, color }
}

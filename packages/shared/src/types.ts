export type Role = 'owner' | 'editor' | 'viewer'

export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'] as const

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export type DocumentType = 'doc' | 'board'

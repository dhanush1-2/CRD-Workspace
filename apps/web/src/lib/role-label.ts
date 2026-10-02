import type { Role } from '@crdt/shared/types'

/** The handoff's wording for each role, shared by the member list, the invite select and the document header. */
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Can edit',
  viewer: 'Can view',
}

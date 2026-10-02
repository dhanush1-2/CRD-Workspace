import type { Role } from '@crdt/shared/types'

/** A workspace member as the client sees it: plain strings only, safe to pass from a server component. */
export type WorkspaceMemberView = { id: string; name: string; email: string; role: Role }

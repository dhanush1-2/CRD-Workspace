import type { Role } from '@crdt/shared/types'
import type { FrameKind } from './protocol.js'

export interface GuardDecision {
  /** Whether the frame may be applied to the room document and relayed to peers. */
  allow: boolean
  /** Whether to send this connection a permission-denied frame. */
  notify: boolean
  /** Metric label. */
  reason: string
}

const ALLOWED: GuardDecision = { allow: true, notify: false, reason: 'ok' }

/**
 * The authorization decision, as a pure function of role and frame kind.
 *
 * A viewer may send sync-step1 (asking what the server has) and awareness frames
 * (their cursor), but may not send sync-step2 or update frames, which are the only
 * two frames that carry document mutations.
 */
export function guard(role: Role, kind: FrameKind): GuardDecision {
  if (kind === 'unknown') {
    return { allow: false, notify: false, reason: 'malformed_frame' }
  }

  if (role !== 'viewer') return ALLOWED

  switch (kind) {
    case 'update':
      return { allow: false, notify: true, reason: 'viewer_update' }
    case 'sync-step2':
      return { allow: false, notify: false, reason: 'viewer_sync_step2' }
    default:
      return ALLOWED
  }
}

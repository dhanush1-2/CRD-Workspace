import type { Role } from '@crdt/shared/types'
import type { FrameKind } from './protocol.js'

export interface GuardDecision {
  /** Whether the frame may be applied to the room document and relayed to peers. */
  readonly allow: boolean
  /** Whether to send this connection a permission-denied frame. */
  readonly notify: boolean
  /** Metric label. */
  readonly reason: string
}

const ALLOWED: GuardDecision = Object.freeze({ allow: true, notify: false, reason: 'ok' })
const MALFORMED: GuardDecision = Object.freeze({ allow: false, notify: false, reason: 'malformed_frame' })
const VIEWER_UPDATE: GuardDecision = Object.freeze({ allow: false, notify: true, reason: 'viewer_update' })
const VIEWER_SYNC_STEP2: GuardDecision = Object.freeze({ allow: false, notify: false, reason: 'viewer_sync_step2' })
const UNHANDLED: GuardDecision = Object.freeze({ allow: false, notify: false, reason: 'unhandled_frame_kind' })

/**
 * The authorization decision, as a pure function of role and frame kind.
 *
 * A viewer may send sync-step1 (asking what the server has) and awareness frames
 * (their cursor), but may not send sync-step2 or update frames, which are the only
 * two frames that carry document mutations.
 */
export function guard(role: Role, kind: FrameKind): GuardDecision {
  switch (kind) {
    case 'unknown':
      return MALFORMED
    case 'sync-step1':
    case 'awareness':
    case 'query-awareness':
      return ALLOWED
    case 'sync-step2':
      return role === 'viewer' ? VIEWER_SYNC_STEP2 : ALLOWED
    case 'update':
      return role === 'viewer' ? VIEWER_UPDATE : ALLOWED
    default: {
      // Adding a FrameKind without handling it here is a compile error.
      // If one reaches this function at runtime regardless, deny it —
      // a guard must fail closed.
      const exhaustive: never = kind
      void exhaustive
      return UNHANDLED
    }
  }
}

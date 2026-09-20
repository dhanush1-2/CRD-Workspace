import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as authProtocol from 'y-protocols/auth'
import type * as Y from 'yjs'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_AUTH = 2
export const MESSAGE_QUERY_AWARENESS = 3

export type FrameKind =
  | 'sync-step1'
  | 'sync-step2'
  | 'update'
  | 'awareness'
  | 'query-awareness'
  | 'unknown'

/**
 * Classify a frame without consuming it. Creates its own decoder, so the caller's
 * buffer is untouched and can be decoded again afterwards.
 *
 * Never throws: a malformed frame from a hostile or buggy client must not be able to
 * take down the connection handler before the guard has had a chance to reject it.
 */
export function peekFrame(data: Uint8Array): FrameKind {
  try {
    const decoder = decoding.createDecoder(data)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case MESSAGE_SYNC: {
        const syncType = decoding.readVarUint(decoder)
        if (syncType === syncProtocol.messageYjsSyncStep1) return 'sync-step1'
        if (syncType === syncProtocol.messageYjsSyncStep2) return 'sync-step2'
        if (syncType === syncProtocol.messageYjsUpdate) return 'update'
        return 'unknown'
      }
      case MESSAGE_AWARENESS:
        return 'awareness'
      case MESSAGE_QUERY_AWARENESS:
        return 'query-awareness'
      default:
        return 'unknown'
    }
  } catch {
    return 'unknown'
  }
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

export function encodeSyncStep2(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep2(encoder, doc, stateVector)
  return encoding.toUint8Array(encoder)
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

export function encodeAwareness(
  awareness: awarenessProtocol.Awareness,
  clients: number[],
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
  )
  return encoding.toUint8Array(encoder)
}

export function encodePermissionDenied(reason: string): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AUTH)
  authProtocol.writePermissionDenied(encoder, reason)
  return encoding.toUint8Array(encoder)
}

/**
 * Apply a sync frame to `doc` and return the reply the protocol requires, or null.
 *
 * The `encoding.length(encoder) > 1` check is how the Yjs reference implementation
 * decides whether a reply exists: the encoder always holds the leading MESSAGE_SYNC
 * varUint, so a length of exactly 1 means readSyncMessage wrote nothing.
 */
export function handleSyncFrame(
  data: Uint8Array,
  doc: Y.Doc,
  origin: unknown,
): Uint8Array | null {
  const decoder = decoding.createDecoder(data)
  const encoder = encoding.createEncoder()

  decoding.readVarUint(decoder) // consume MESSAGE_SYNC
  encoding.writeVarUint(encoder, MESSAGE_SYNC)

  syncProtocol.readSyncMessage(decoder, encoder, doc, origin)

  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null
}

export function applyAwarenessFrame(
  data: Uint8Array,
  awareness: awarenessProtocol.Awareness,
  origin: unknown,
): void {
  const decoder = decoding.createDecoder(data)
  decoding.readVarUint(decoder) // consume MESSAGE_AWARENESS
  awarenessProtocol.applyAwarenessUpdate(
    awareness,
    decoding.readVarUint8Array(decoder),
    origin,
  )
}

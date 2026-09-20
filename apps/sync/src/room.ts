import * as Y from 'yjs'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import type { Role } from '@crdt/shared/types'
import {
  applyAwarenessFrame,
  encodeAwareness,
  encodePermissionDenied,
  encodeUpdate,
  handleSyncFrame,
  peekFrame,
} from './protocol.js'
import { guard } from './guard.js'

export interface Connection {
  readonly id: string
  readonly userId: string
  readonly role: Role
  send(data: Uint8Array): void
  close(code: number, reason: string): void
}

/** Origin used when applying persisted state, so the update observer skips re-persisting it. */
export const LOAD_ORIGIN = Symbol('load')

export interface RoomOptions {
  onPersist(update: Uint8Array, clientId: string): void
  onReject?(reason: string, conn: Connection): void
}

export class DocumentRoom {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)

  private readonly connections = new Set<Connection>()
  private readonly notified = new Set<string>()
  /** Awareness client ids owned by each connection, so they can be cleared on disconnect. */
  private readonly awarenessClients = new Map<Connection, Set<number>>()

  constructor(
    readonly documentId: string,
    private readonly options: RoomOptions,
  ) {
    this.awareness.setLocalState(null)

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== LOAD_ORIGIN) {
        const sender = origin as Connection | undefined
        this.broadcast(encodeUpdate(update), sender)
        this.options.onPersist(update, sender?.id ?? 'server')
      }
    })

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const sender = origin instanceof Object && this.awarenessClients.has(origin as Connection)
          ? (origin as Connection)
          : undefined

        if (sender) {
          const owned = this.awarenessClients.get(sender)
          for (const client of [...added, ...updated]) owned?.add(client)
        }

        const changed = [...added, ...updated, ...removed]
        if (changed.length === 0) return
        this.broadcast(encodeAwareness(this.awareness, changed), sender)
      },
    )
  }

  get size(): number {
    return this.connections.size
  }

  add(conn: Connection): void {
    this.connections.add(conn)
    this.awarenessClients.set(conn, new Set())
  }

  remove(conn: Connection): void {
    this.connections.delete(conn)
    this.notified.delete(conn.id)

    const clients = this.awarenessClients.get(conn)
    if (clients && clients.size > 0) {
      removeAwarenessStates(this.awareness, [...clients], null)
    }
    this.awarenessClients.delete(conn)
  }

  /** Apply state read from storage. Does not trigger persistence or broadcast to peers. */
  loadState(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, LOAD_ORIGIN)
  }

  handleFrame(conn: Connection, data: Uint8Array): void {
    const kind = peekFrame(data)
    const decision = guard(conn.role, kind)

    if (!decision.allow) {
      this.options.onReject?.(decision.reason, conn)
      if (decision.notify && !this.notified.has(conn.id)) {
        this.notified.add(conn.id)
        conn.send(encodePermissionDenied('your role is read-only for this document'))
      }
      return
    }

    try {
      if (kind === 'awareness') {
        applyAwarenessFrame(data, this.awareness, conn)
        return
      }

      if (kind === 'query-awareness') {
        const clients = [...this.awareness.getStates().keys()]
        if (clients.length > 0) conn.send(encodeAwareness(this.awareness, clients))
        return
      }

      // sync-step1 / sync-step2 / update. The doc's update observer handles relay
      // and persistence; the reply here goes only to the sender.
      const reply = handleSyncFrame(data, this.doc, conn)
      if (reply) conn.send(reply)
    } catch (error) {
      this.options.onReject?.('frame_error', conn)
      conn.close(4500, 'frame handling failed')
      void error
    }
  }

  destroy(): void {
    this.awareness.destroy()
    this.doc.destroy()
    this.connections.clear()
    this.awarenessClients.clear()
  }

  private broadcast(frame: Uint8Array, except?: Connection): void {
    for (const conn of this.connections) {
      if (conn === except) continue
      conn.send(frame)
    }
  }
}

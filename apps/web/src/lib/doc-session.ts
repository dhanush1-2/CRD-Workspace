import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export type DocStatus = 'connecting' | 'connected' | 'disconnected'

export interface DocSessionOptions {
  documentId: string
  syncUrl: string
  fetchToken(): Promise<string>
  /**
   * Cross-tab BroadcastChannel sync. Must be disabled in tests and automated browser
   * checks: with it on, two tabs of the same origin converge without the server, and
   * a "sync works" test passes with the server stopped.
   */
  disableBc?: boolean
  WebSocketImpl?: typeof WebSocket
}

export interface DocSession {
  doc: Y.Doc
  provider: WebsocketProvider
  onStatus(listener: (status: DocStatus) => void): () => void
  destroy(): void
}

export function createDocSession(options: DocSessionOptions): DocSession {
  const doc = new Y.Doc()

  const provider = new WebsocketProvider(options.syncUrl, options.documentId, doc, {
    connect: false,
    params: {},
    disableBc: options.disableBc ?? false,
    ...(options.WebSocketImpl ? { WebSocketPolyfill: options.WebSocketImpl } : {}),
  })

  let destroyed = false

  /**
   * Doc tokens are short-lived on purpose, so a reconnect after a long offline
   * period must not reuse the token it connected with originally. `provider.params`
   * is documented as safe to mutate; the new value is used for the next connection.
   */
  async function refreshToken(): Promise<void> {
    if (destroyed) return
    try {
      provider.params = { token: await options.fetchToken() }
    } catch {
      // Leave the previous token in place; the provider's backoff will try again.
    }
  }

  const statusListeners = new Set<(status: DocStatus) => void>()
  provider.on('status', ({ status }: { status: DocStatus }) => {
    for (const listener of statusListeners) listener(status)
  })

  provider.on('connection-close', () => {
    void refreshToken()
  })

  void refreshToken().then(() => {
    if (!destroyed) provider.connect()
  })

  return {
    doc,
    provider,
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    destroy() {
      destroyed = true
      statusListeners.clear()
      provider.destroy()
      doc.destroy()
    },
  }
}

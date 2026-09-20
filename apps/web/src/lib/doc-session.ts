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
  /**
   * Delay before retrying a failed token fetch that would otherwise gate the initial
   * connect or a post-fatal-close reconnect. Defaults to 1000ms; tests may shorten it.
   */
  tokenRetryDelayMs?: number
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
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const retryDelayMs = options.tokenRetryDelayMs ?? 1000

  /**
   * Doc tokens are short-lived on purpose, so a reconnect after a long offline
   * period must not reuse the token it connected with originally. `provider.params`
   * is documented as safe to mutate; the new value is used for the next connection.
   *
   * Best-effort only: used on a non-fatal close, where y-websocket keeps retrying on
   * its own backoff regardless of whether this particular refresh succeeded.
   */
  async function refreshToken(): Promise<void> {
    if (destroyed) return
    try {
      provider.params = { token: await options.fetchToken() }
    } catch {
      // Leave the previous token in place; the provider's backoff will try again.
    }
  }

  /**
   * Connects only once a token is genuinely in hand. Connecting with no (or a stale)
   * token earns a fatal 4400-4499 close from the server, which y-websocket never
   * retries on its own — so unlike `refreshToken`, a failed fetch here must not let
   * `connect()` run anyway. It retries the fetch itself on a timer instead.
   */
  async function connectWithToken(): Promise<void> {
    if (destroyed) return

    try {
      provider.params = { token: await options.fetchToken() }
    } catch {
      if (destroyed) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        void connectWithToken()
      }, retryDelayMs)
      retryTimer.unref?.()
      return
    }

    if (!destroyed) provider.connect()
  }

  const statusListeners = new Set<(status: DocStatus) => void>()
  provider.on('status', ({ status }: { status: DocStatus }) => {
    for (const listener of statusListeners) listener(status)
  })

  // A non-fatal close: y-websocket retries on its own schedule, so just make sure the
  // next attempt carries a fresh token.
  provider.on('connection-close', () => {
    void refreshToken()
  })

  // A fatal close (4400-4499): y-websocket has given up and will not retry on its own.
  // Re-acquire a token and reconnect explicitly, or the session is dead forever.
  provider.on('closed', () => {
    void connectWithToken()
  })

  void connectWithToken()

  return {
    doc,
    provider,
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    destroy() {
      destroyed = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      statusListeners.clear()
      provider.destroy()
      doc.destroy()
    },
  }
}

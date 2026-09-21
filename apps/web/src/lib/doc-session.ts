import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export type DocStatus = 'connecting' | 'connected' | 'disconnected' | 'fatal'

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
  /**
   * Base delay for the exponential backoff applied between reconnect attempts after a
   * fatal (4400-4499) close. Defaults to 1000ms; tests may shorten it.
   */
  fatalBackoffBaseMs?: number
  /** Ceiling on the fatal-close backoff delay. Defaults to 30000ms. */
  fatalMaxDelayMs?: number
  /**
   * Number of reconnect attempts to make after a fatal close before giving up and
   * reporting the 'fatal' status. Defaults to 5.
   */
  fatalMaxAttempts?: number
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

  // Tracks reconnect attempts made after a fatal close, so a server that keeps closing
  // fatally forever (a secret mismatch, clock skew past the token TTL, a rotated secret)
  // cannot turn into an unbackoffed hot loop hammering the token endpoint. Resets to 0
  // once a connection actually succeeds, so a later, unrelated fatal close gets its own
  // full run of attempts rather than inheriting an old count.
  let fatalAttempt = 0
  let fatalTimer: ReturnType<typeof setTimeout> | null = null
  const fatalBackoffBaseMs = options.fatalBackoffBaseMs ?? 1000
  const fatalMaxDelayMs = options.fatalMaxDelayMs ?? 30_000
  const fatalMaxAttempts = options.fatalMaxAttempts ?? 5

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

  function emitStatus(status: DocStatus): void {
    for (const listener of statusListeners) listener(status)
  }

  provider.on('status', ({ status }: { status: DocStatus }) => {
    emitStatus(status)
  })

  // y-websocket's 'status: connected' fires as soon as the raw WebSocket transport
  // opens — which happens even on a connection the server is about to close fatally,
  // since the close frame arrives slightly later over the same open socket. `sync`
  // only fires once a real sync-step exchange has completed, so it is the right
  // signal that the session has genuinely recovered: any earlier run of fatal-close
  // attempts is irrelevant now, and a future fatal close should get its own full
  // backoff run rather than inheriting today's count.
  provider.on('sync', (isSynced: boolean) => {
    if (isSynced) fatalAttempt = 0
  })

  // A non-fatal close: y-websocket retries on its own schedule, so just make sure the
  // next attempt carries a fresh token.
  provider.on('connection-close', () => {
    void refreshToken()
  })

  // A fatal close (4400-4499): y-websocket has given up and will not retry on its own.
  // Re-acquire a token and reconnect explicitly, or the session is dead forever. Left
  // unbackoffed, a server that keeps closing fatally (a secret mismatch between two
  // deployed processes, clock skew past the token TTL) turns this into a tight loop
  // against the app's own token-minting endpoint. Back off exponentially and give up
  // after a bounded number of attempts, reporting 'fatal' instead of looping silently.
  provider.on('closed', () => {
    if (destroyed) return

    fatalAttempt += 1
    if (fatalAttempt > fatalMaxAttempts) {
      emitStatus('fatal')
      return
    }

    const delay = Math.min(fatalBackoffBaseMs * 2 ** (fatalAttempt - 1), fatalMaxDelayMs)
    fatalTimer = setTimeout(() => {
      fatalTimer = null
      void connectWithToken()
    }, delay)
    fatalTimer.unref?.()
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
      if (fatalTimer) {
        clearTimeout(fatalTimer)
        fatalTimer = null
      }
      statusListeners.clear()
      provider.destroy()
      doc.destroy()
    },
  }
}

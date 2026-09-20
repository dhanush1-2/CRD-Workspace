export interface PendingUpdate {
  update: Uint8Array
  clientId: string
}

export interface UpdateSink {
  append(documentId: string, rows: PendingUpdate[]): Promise<void>
}

export interface UpdateQueueOptions {
  flushIntervalMs?: number
  maxBatch?: number
  retryBaseMs?: number
  maxRetryDelayMs?: number
  onError?(error: unknown, attempt: number): void
}

/**
 * Buffers updates in memory and writes them to the sink in batches.
 *
 * The point is that persistence never sits in the broadcast path: a slow or dead
 * database degrades durability, not collaboration. The cost is a bounded window
 * (flushIntervalMs) of updates that exist only in memory, which close() drains on
 * SIGTERM so planned restarts lose nothing.
 */
export class UpdateQueue {
  private readonly buffers = new Map<string, PendingUpdate[]>()
  private readonly flushIntervalMs: number
  private readonly maxBatch: number
  private readonly retryBaseMs: number
  private readonly maxRetryDelayMs: number

  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private attempt = 0
  private closed = false

  constructor(
    private readonly sink: UpdateSink,
    private readonly options: UpdateQueueOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 500
    this.maxBatch = options.maxBatch ?? 64
    this.retryBaseMs = options.retryBaseMs ?? 100
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000
  }

  get depth(): number {
    let total = 0
    for (const rows of this.buffers.values()) total += rows.length
    return total
  }

  enqueue(documentId: string, pending: PendingUpdate): void {
    if (this.closed) throw new Error('queue is closed')

    const rows = this.buffers.get(documentId)
    if (rows) rows.push(pending)
    else this.buffers.set(documentId, [pending])

    if (this.depth >= this.maxBatch) void this.flush()
    else this.schedule(this.flushIntervalMs)
  }

  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drain())
    return this.chain
  }

  async close(): Promise<void> {
    this.closed = true
    this.clearTimer()
    await this.flush()
  }

  private schedule(delayMs: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delayMs)
    // Do not hold the process open just because a flush is pending.
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async drain(): Promise<void> {
    while (this.buffers.size > 0) {
      const entry = this.buffers.entries().next()
      if (entry.done) return

      const [documentId, rows] = entry.value
      this.buffers.delete(documentId)

      try {
        await this.sink.append(documentId, rows)
        this.attempt = 0
      } catch (error) {
        // Put the batch back at the front so ordering within the document survives,
        // ahead of anything enqueued while the write was in flight.
        const arrived = this.buffers.get(documentId) ?? []
        this.buffers.set(documentId, [...rows, ...arrived])

        this.attempt += 1
        this.options.onError?.(error, this.attempt)

        if (!this.closed) {
          const delay = Math.min(
            this.retryBaseMs * 2 ** (this.attempt - 1),
            this.maxRetryDelayMs,
          )
          this.schedule(delay)
        }
        return
      }
    }
  }
}

import { describe, it, expect } from 'vitest'
import { Metrics } from '../src/metrics.js'

describe('Metrics', () => {
  it('renders a counter', () => {
    const metrics = new Metrics()
    metrics.inc('sync_updates_received_total')
    metrics.inc('sync_updates_received_total')

    expect(metrics.render()).toContain('sync_updates_received_total 2')
  })

  it('keeps label sets separate', () => {
    const metrics = new Metrics()
    metrics.inc('sync_updates_rejected_total', { reason: 'viewer_update' })
    metrics.inc('sync_updates_rejected_total', { reason: 'malformed_frame' })
    metrics.inc('sync_updates_rejected_total', { reason: 'viewer_update' })

    const output = metrics.render()
    expect(output).toContain('sync_updates_rejected_total{reason="viewer_update"} 2')
    expect(output).toContain('sync_updates_rejected_total{reason="malformed_frame"} 1')
  })

  it('renders a gauge that can go down', () => {
    const metrics = new Metrics()
    metrics.set('sync_connections_active', 5)
    metrics.set('sync_connections_active', 2)

    expect(metrics.render()).toContain('sync_connections_active 2')
  })

  it('renders a histogram as sum and count', () => {
    const metrics = new Metrics()
    metrics.observe('sync_flush_duration_seconds', 0.1)
    metrics.observe('sync_flush_duration_seconds', 0.3)

    const output = metrics.render()
    expect(output).toContain('sync_flush_duration_seconds_count 2')
    expect(output).toContain('sync_flush_duration_seconds_sum 0.4')
  })

  it('escapes label values', () => {
    const metrics = new Metrics()
    metrics.inc('sync_updates_rejected_total', { reason: 'a"b' })
    expect(metrics.render()).toContain('reason="a\\"b"')
  })
})

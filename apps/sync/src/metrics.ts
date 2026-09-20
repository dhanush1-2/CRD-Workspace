type Labels = Record<string, string>

function key(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return name
  const rendered = Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
  return `${name}{${rendered}}`
}

/**
 * A deliberately tiny Prometheus text-format registry. Bringing in prom-client for
 * eight series would be more dependency than value; the format is four lines of code.
 */
export class Metrics {
  private readonly counters = new Map<string, number>()
  private readonly gauges = new Map<string, number>()
  private readonly histograms = new Map<string, { sum: number; count: number }>()

  inc(name: string, labels?: Labels, by = 1): void {
    const k = key(name, labels)
    this.counters.set(k, (this.counters.get(k) ?? 0) + by)
  }

  set(name: string, value: number, labels?: Labels): void {
    this.gauges.set(key(name, labels), value)
  }

  observe(name: string, seconds: number, labels?: Labels): void {
    const k = key(name, labels)
    const current = this.histograms.get(k) ?? { sum: 0, count: 0 }
    this.histograms.set(k, { sum: current.sum + seconds, count: current.count + 1 })
  }

  render(): string {
    const lines: string[] = []
    for (const [k, value] of this.counters) lines.push(`${k} ${value}`)
    for (const [k, value] of this.gauges) lines.push(`${k} ${value}`)
    for (const [k, { sum, count }] of this.histograms) {
      const base = k.includes('{') ? k.slice(0, k.indexOf('{')) : k
      const labels = k.includes('{') ? k.slice(k.indexOf('{')) : ''
      lines.push(`${base}_sum${labels} ${Number(sum.toFixed(6))}`)
      lines.push(`${base}_count${labels} ${count}`)
    }
    return `${lines.join('\n')}\n`
  }
}

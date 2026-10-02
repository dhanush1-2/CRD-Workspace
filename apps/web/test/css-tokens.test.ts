import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return path.endsWith('.css') ? [path] : []
  })
}

// A missing custom property does not error: var(--gone) computes to the guaranteed-
// invalid value, so `gap`, `padding` or `background` silently fall back to their
// initial values. Typecheck, build and every unit test pass. This is the only guard.
describe('css custom properties', () => {
  it('every var(--x) used in app CSS is defined in globals.css', () => {
    const globals = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
    const defined = new Set([...globals.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    expect(defined.size).toBeGreaterThan(10)

    const dangling: string[] = []
    for (const file of cssFiles(SRC)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      // A reference with a fallback, var(--x, 1px), degrades on purpose; skip it.
      for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        if (!defined.has(match[1])) dangling.push(`${match[1]} in ${relative(SRC, file)}`)
      }
    }

    expect(
      dangling,
      `var() references with no definition in globals.css:\n  ${dangling.join('\n  ')}`,
    ).toEqual([])
  })
})

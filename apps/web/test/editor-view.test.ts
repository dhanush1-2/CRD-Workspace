import { describe, expect, it } from 'vitest'
import { stepZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../src/components/editor-view'

describe('stepZoom', () => {
  it('moves 10% at a time', () => {
    expect(stepZoom(100, 1)).toBe(110)
    expect(stepZoom(100, -1)).toBe(90)
    expect(stepZoom(ZOOM_DEFAULT, 1)).toBe(110)
  })

  it('holds at 70% and 150%', () => {
    expect(stepZoom(ZOOM_MIN, -1)).toBe(70)
    expect(stepZoom(ZOOM_MAX, 1)).toBe(150)
    expect(stepZoom(80, -1)).toBe(70)
    expect(stepZoom(140, 1)).toBe(150)
  })

  it('walks the whole range in 9 steps, landing on both ends', () => {
    let zoom = ZOOM_MIN
    const seen = [zoom]
    while (zoom < ZOOM_MAX) {
      zoom = stepZoom(zoom, 1)
      seen.push(zoom)
    }
    expect(seen).toEqual([70, 80, 90, 100, 110, 120, 130, 140, 150])
  })
})

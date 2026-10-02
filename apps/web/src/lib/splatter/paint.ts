import type { Ray, Splat } from './geometry'

// Rasterise one splat onto its own offscreen canvas.
//
// The canvas is sized to the splat (2 * radius square), never to the viewport:
// `splat.radius` is the furthest painted point plus a 1px antialiasing margin,
// so nothing here may paint beyond the furthest point. In particular a ray's drip is drawn no
// wider than that ray's `tipR`, which is the width the radius calculation in
// geometry.ts assumes.
//
// Coordinates are splat-local: origin at the centre, y pointing down. The
// caller owns the returned canvas and its lifetime; nothing is cached here.
export function paintSplat(splat: Splat, dpr: number): HTMLCanvasElement {
  const size = Math.max(1, Math.ceil(2 * splat.radius * dpr))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  // Scale by dpr and put the origin at the centre. Using the actual (ceiled)
  // pixel size keeps the centre exact in device pixels.
  ctx.setTransform(dpr, 0, 0, dpr, size / 2, size / 2)
  ctx.fillStyle = splat.color
  ctx.strokeStyle = splat.color
  ctx.lineCap = 'round'

  const disc = (x: number, y: number, r: number) => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // A streak tapering from `ray.width` at its start to a point just narrower
  // than the tip blob, then the blob itself. The tip end is never wider than
  // tipR, so it stays inside the blob and the blob inside the bound.
  const streak = (ray: Ray) => {
    const dx = Math.cos(ray.angle)
    const dy = Math.sin(ray.angle)
    const nx = -dy
    const ny = dx
    const tipX = ray.x + dx * ray.length
    const tipY = ray.y + dy * ray.length
    const baseHalf = ray.width / 2
    const tipHalf = ray.tipR * 0.6

    ctx.beginPath()
    ctx.moveTo(ray.x + nx * baseHalf, ray.y + ny * baseHalf)
    ctx.lineTo(tipX + nx * tipHalf, tipY + ny * tipHalf)
    ctx.lineTo(tipX - nx * tipHalf, tipY - ny * tipHalf)
    ctx.lineTo(ray.x - nx * baseHalf, ray.y - ny * baseHalf)
    ctx.closePath()
    ctx.fill()

    disc(tipX, tipY, ray.tipR)
    return { tipX, tipY }
  }

  // 1. Core: overlapping circles that read as one mass.
  for (const c of splat.core) disc(c.x, c.y, c.r)

  // 2. Rays: streak + tip blob, plus a drip hanging from the tip when set.
  //    The drip's stroke is tipR wide (round caps, so tipR / 2 past its end)
  //    and its end bulb is 0.75 * tipR, both within the tipR the bound allows.
  for (const ray of splat.rays) {
    const { tipX, tipY } = streak(ray)
    if (ray.drip > 0) {
      ctx.lineWidth = ray.tipR
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(tipX, tipY + ray.drip)
      ctx.stroke()
      disc(tipX, tipY + ray.drip, ray.tipR * 0.75)
    }
  }

  // 3. Core drips: straight down from the core, same streak + blob shape.
  for (const drip of splat.drips) streak(drip)

  // 4. Droplets: they are listed largest and nearest first, so fade them
  //    slightly along the list to thin the spray out at the edge.
  const last = Math.max(1, splat.droplets.length - 1)
  splat.droplets.forEach((d, i) => {
    ctx.globalAlpha = 1 - 0.3 * (i / last)
    disc(d.x, d.y, d.r)
  })
  ctx.globalAlpha = 1

  return canvas
}

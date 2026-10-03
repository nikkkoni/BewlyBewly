export interface GlassAtlasSlot { x: number, y: number, width: number, height: number }

/** Only send refracting rims through the GPU canvas; never allocate panel centers. */
export function glassRimTiles(width: number, height: number) {
  const band = Math.min(18, width / 2, height / 2)
  const strips = [
    { x: 0, y: 0, width, height: band },
    { x: 0, y: height - band, width, height: band },
    { x: 0, y: band, width: band, height: height - band * 2 },
    { x: width - band, y: band, width: band, height: height - band * 2 },
  ]
  const result: GlassAtlasSlot[] = []
  for (const strip of strips) {
    for (let y = 0; y < strip.height; y += 256) {
      for (let x = 0; x < strip.width; x += 256)
        result.push({ x: strip.x + x, y: strip.y + y, width: Math.min(256, strip.width - x), height: Math.min(256, strip.height - y) })
    }
  }
  return result
}

/** Bounded shelf atlas. Slots use CSS pixels; the canvas is scaled as a whole. */
export function packGlassAtlas(sizes: { width: number, height: number }[], limit = 4096) {
  if (!sizes.length || sizes.some(s => !Number.isFinite(s.width + s.height) || s.width <= 0 || s.height <= 0))
    throw new RangeError('Invalid glass dimensions')
  const width = Math.ceil(Math.max(...sizes.map(s => s.width)))
  let x = 0
  let y = 0
  let row = 0
  const slots = sizes.map((s) => {
    const w = Math.ceil(s.width)
    const h = Math.ceil(s.height)
    if (x + w > width) {
      x = 0
      y += row
      row = 0
    }
    const slot = { x, y, width: w, height: h }
    x += w
    row = Math.max(row, h)
    return slot
  })
  const height = y + row
  const scale = Math.min(1, limit / width, limit / height, Math.sqrt(4000000 / (width * height)))
  return { width, height, scale, slots }
}

export function glassCaptureRect(rect: { left: number, top: number, right: number, bottom: number }, width: number, height: number, margin = 256) {
  const left = Math.max(rect.left, -margin)
  const top = Math.max(rect.top, -margin)
  const right = Math.min(rect.right, width + margin)
  const bottom = Math.min(rect.bottom, height + margin)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

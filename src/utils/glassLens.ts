// Rounded-rectangle distance fields and SVG displacement follow the approach in
// shuding/liquid-glass and rdev/liquid-glass-react. See THIRD_PARTY_NOTICES.md.

export interface GlassLensMap {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

/** Encode a rounded lens's inward edge bend in R/G; its center stays neutral. */
export function createGlassLensMap(width: number, height: number, cornerRadius: number): GlassLensMap {
  if (![width, height, cornerRadius].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new RangeError('A glass lens needs finite positive dimensions')

  // Rasterize the lens geometry only. Never capture page content or remote images.
  const ratio = Math.min(1, 1536 / Math.max(width, height), Math.sqrt(180000 / (width * height)))
  const mapWidth = Math.max(1, Math.round(width * ratio))
  const mapHeight = Math.max(1, Math.round(height * ratio))
  const radius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2))
  const bevel = Math.max(1, Math.min(18, radius || 8, width / 2, height / 2))
  const pixels = new Uint8ClampedArray(mapWidth * mapHeight * 4)

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const px = (x + 0.5) * width / mapWidth - width / 2
      const py = (y + 0.5) * height / mapHeight - height / 2
      const qx = Math.abs(px) - width / 2 + radius
      const qy = Math.abs(py) - height / 2 + radius
      const ox = Math.max(qx, 0)
      const oy = Math.max(qy, 0)
      const length = Math.hypot(ox, oy)
      const distance = length + Math.min(Math.max(qx, qy), 0) - radius
      let nx = 0
      let ny = 0

      if (length > 0) {
        nx = ox / length * Math.sign(px)
        ny = oy / length * Math.sign(py)
      }
      else if (qx > qy) {
        nx = Math.sign(px)
      }
      else {
        ny = Math.sign(py)
      }

      const t = Math.max(0, Math.min(1, -distance / bevel))
      const bend = distance < 0 ? Math.sin(Math.PI * t) * (1 - t) ** 0.35 : 0
      const offset = (y * mapWidth + x) * 4
      pixels[offset] = 128 - nx * bend * 127
      pixels[offset + 1] = 128 - ny * bend * 127
      pixels[offset + 2] = 128
      pixels[offset + 3] = 255
    }
  }

  return { width: mapWidth, height: mapHeight, pixels }
}

const maps = new Map<string, string>()

export function glassLensDataUrl(width: number, height: number, radius: number): string | undefined {
  const key = `${width}:${height}:${radius}`
  const cached = maps.get(key)
  if (cached)
    return cached

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context)
    return undefined

  const map = createGlassLensMap(width, height, radius)
  canvas.width = map.width
  canvas.height = map.height
  // Create the buffer in the canvas's realm. Firefox content scripts cannot
  // pass an ImageData backed by their isolated world's typed array to the page.
  const image = context.createImageData(map.width, map.height)
  // Copy numbers individually; passing a foreign typed array to .set() also
  // crosses Firefox's Xray boundary and is rejected in a content script.
  const data = image.data
  for (let i = 0; i < map.pixels.length; i++)
    data[i] = map.pixels[i]
  context.putImageData(image, 0, 0)
  const url = canvas.toDataURL()
  // A resize must not accumulate an unbounded collection of raster maps.
  if (maps.size >= 12)
    maps.delete(maps.keys().next().value!)
  maps.set(key, url)
  return url
}

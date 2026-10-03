// Continuous circle bevel and B-channel glint adapted from Amir Abushanab's
// liquid-glass-js. SDF normals and a neutral reading area follow LiquidGlassJS.
// See THIRD_PARTY_NOTICES.md for the pinned sources and MIT licenses.
import type { GlassLensMap } from './glassLens'

export function createCurvedGlassLensMap(width: number, height: number, cornerRadius: number): GlassLensMap {
  if (![width, height, cornerRadius].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new RangeError('A glass lens needs finite positive dimensions')

  const ratio = Math.min(1, 1536 / Math.max(width, height), Math.sqrt(180000 / (width * height)))
  const mapWidth = Math.max(1, Math.round(width * ratio))
  const mapHeight = Math.max(1, Math.round(height * ratio))
  const radius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2))
  const band = Math.min(18, Math.max(8, radius * 0.65), width / 2, height / 2)
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
      const nx = length > 0 ? ox / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0
      const ny = length > 0 ? oy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py)
      const t = Math.max(0, Math.min(1, 1 + distance / band))
      // Quarter-circle compression peaks at the rim and fades continuously to
      // zero at the inside of the bevel, without bending the panel's center.
      const bend = distance < 0 ? 1 - Math.sqrt(1 - t * t) : 0
      const light = Math.abs((nx + ny) * Math.SQRT1_2) ** 1.5
      const rim = distance < 0 ? Math.max(0, 1 + distance / 3) ** 1.5 : 0
      const specular = (0.42 * rim + 0.06 * bend) * light
      const i = (y * mapWidth + x) * 4
      pixels[i] = 128 - nx * bend * 127
      pixels[i + 1] = 128 - ny * bend * 127
      pixels[i + 2] = 128 + specular * 127
      pixels[i + 3] = 255
    }
  }
  return { width: mapWidth, height: mapHeight, pixels }
}

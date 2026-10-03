import { describe, expect, it } from 'vitest'

import { createCurvedGlassLensMap } from '../utils/curvedGlassLens'

describe('continuous Firefox glass lens', () => {
  it('compresses the outer rim continuously and keeps the reading area neutral', () => {
    const map = createCurvedGlassLensMap(300, 100, 30)
    const pixel = (x: number, y: number) => Array.from(map.pixels.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4))
    expect(pixel(150, 50)).toEqual([128, 128, 128, 255])
    expect(pixel(0, 0)).toEqual([128, 128, 128, 255])
    expect(pixel(0, 50)[0]).toBeGreaterThan(210)
    expect(pixel(0, 50)[2]).toBeGreaterThan(128)
    expect(pixel(20, 50)).toEqual([128, 128, 128, 255])
    for (let x = 1; x < 18; x++) {
      expect(pixel(x, 50)[0]).toBeLessThanOrEqual(pixel(x - 1, 50)[0])
      expect(pixel(x - 1, 50)[0] - pixel(x, 50)[0]).toBeLessThan(35)
    }
  })

  it('keeps both axes symmetric on wide bars and rounded corners', () => {
    const map = createCurvedGlassLensMap(1400, 52, 24)
    const channel = (x: number, y: number, c: number) => map.pixels[(y * map.width + x) * 4 + c]
    for (const [x, y] of [[1, 26], [12, 5], [700, 1]]) {
      expect(channel(x, y, 0) + channel(map.width - x - 1, y, 0)).toBeCloseTo(256, 0)
      expect(channel(x, y, 1) + channel(x, map.height - y - 1, 1)).toBeCloseTo(256, 0)
    }
  })

  it('bounds map memory and handles small lenses without invalid channels', () => {
    for (const [w, h, r] of [[3840, 2160, 24], [1, 1, 50], [0.2, 0.5, 0]]) {
      const map = createCurvedGlassLensMap(w, h, r)
      expect(map.width).toBeLessThanOrEqual(1536)
      expect(map.width * map.height).toBeLessThan(181000)
      expect(map.pixels.length).toBe(map.width * map.height * 4)
      expect(map.pixels.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    }
    expect(() => createCurvedGlassLensMap(0, 10, 2)).toThrow(RangeError)
    expect(() => createCurvedGlassLensMap(10, 10, Number.NaN)).toThrow(RangeError)
  })
})

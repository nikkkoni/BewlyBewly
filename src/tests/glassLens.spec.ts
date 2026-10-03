import { describe, expect, it } from 'vitest'

import { createGlassLensMap } from '../utils/glassLens'

describe('glass lens geometry', () => {
  it('bends only the rim inward while leaving the reading area neutral', () => {
    const map = createGlassLensMap(300, 100, 30)
    const pixel = (x: number, y: number) => Array.from(map.pixels.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4))
    expect(pixel(150, 50)).toEqual([128, 128, 128, 255])
    expect(pixel(0, 0)).toEqual([128, 128, 128, 255])
    expect(pixel(6, 50)[0]).toBeGreaterThan(190)
    expect(pixel(293, 50)[0]).toBeLessThan(66)
    expect(pixel(150, 6)[1]).toBeGreaterThan(190)
    expect(pixel(150, 93)[1]).toBeLessThan(66)
  })

  it('keeps opposite edges symmetric, including very wide pills', () => {
    const map = createGlassLensMap(1400, 52, 24)
    const channel = (x: number, y: number, c: number) => map.pixels[(y * map.width + x) * 4 + c]
    for (const [x, y] of [[5, 26], [12, 9], [700, 7]]) {
      expect(channel(x, y, 0) + channel(map.width - x - 1, y, 0)).toBeCloseTo(256, 0)
      expect(channel(x, y, 1) + channel(x, map.height - y - 1, 1)).toBeCloseTo(256, 0)
    }
  })

  it('bounds memory for large panels and validates dimensions', () => {
    const map = createGlassLensMap(3840, 2160, 24)
    expect(map.width).toBeLessThanOrEqual(1536)
    expect(map.width * map.height).toBeLessThan(181000)
    expect(map.pixels.length).toBe(map.width * map.height * 4)
    expect(() => createGlassLensMap(0, 10, 2)).toThrow(RangeError)
    expect(() => createGlassLensMap(Number.NaN, 10, 2)).toThrow(RangeError)
  })
})

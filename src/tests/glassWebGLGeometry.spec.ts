import { describe, expect, it } from 'vitest'

import { glassCaptureRect, glassRimTiles, packGlassAtlas } from '../utils/glassWebGLGeometry'

describe('webGL glass texture bounds', () => {
  it('sends only compact edge tiles, leaving the panel center native', () => {
    const tiles = glassRimTiles(1000, 900)
    expect(tiles.reduce((n, t) => n + t.width * t.height, 0)).toBeLessThan(70000)
    expect(tiles.every(t => t.width <= 256 && t.height <= 256)).toBe(true)
    expect(tiles.some(t => t.x <= 500 && t.y <= 450 && t.x + t.width > 500 && t.y + t.height > 450)).toBe(false)
    for (const [i, a] of tiles.entries()) {
      for (const b of tiles.slice(i + 1))
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    }
  })
  it('packs independently clipped lenses without overlap', () => {
    const atlas = packGlassAtlas([{ width: 1440, height: 64 }, { width: 60, height: 497 }, { width: 1000, height: 900 }, { width: 419, height: 36 }])
    for (const [i, a] of atlas.slots.entries()) {
      expect(a.x + a.width).toBeLessThanOrEqual(atlas.width)
      expect(a.y + a.height).toBeLessThanOrEqual(atlas.height)
      for (const b of atlas.slots.slice(i + 1))
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    }
  })
  it('caps atlas memory and GPU dimensions even for large panels', () => {
    const atlas = packGlassAtlas(Array.from({ length: 24 }, () => ({ width: 7680, height: 4320 })), 2048)
    expect(atlas.width * atlas.scale).toBeLessThanOrEqual(2048)
    expect(atlas.height * atlas.scale).toBeLessThanOrEqual(2048)
    expect(atlas.width * atlas.height * atlas.scale ** 2).toBeLessThanOrEqual(4000000)
    expect(() => packGlassAtlas([{ width: Number.NaN, height: 10 }])).toThrow()
  })
  it('captures a viewport band instead of allocating a whole long feed', () => {
    expect(glassCaptureRect({ left: 100, right: 1340, top: -20000, bottom: 70000 }, 1440, 1000))
      .toEqual({ left: 100, top: -256, width: 1240, height: 1512 })
    expect(glassCaptureRect({ left: 10, right: 80, top: 3000, bottom: 4000 }, 1440, 1000).height).toBe(0)
  })
})

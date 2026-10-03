import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFirefoxGlassFilter, supportsFirefoxBackdrop } from '../utils/firefoxGlassFilter'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('firefox compositor refraction', () => {
  it('moves opposite edges symmetrically and leaves the center unwarped', () => {
    const groups = createFirefoxGlassFilter(360, 180, 32)
    const patches = groups.flatMap(group => group.patches)
    for (const patch of patches) {
      expect(patch.x <= 180 && patch.x + patch.width > 180 && patch.y <= 90 && patch.y + patch.height > 90).toBe(false)
      const opposite = patches.find(other => Math.abs(other.x - (360 - patch.x - patch.width)) < 0.001
        && Math.abs(other.y - (180 - patch.y - patch.height)) < 0.001)
      expect(opposite).toBeDefined()
      expect(opposite!.dx).toBeCloseTo(-patch.dx, 5)
      expect(opposite!.dy).toBeCloseTo(-patch.dy, 5)
      expect(Math.hypot(patch.dx, patch.dy)).toBeLessThanOrEqual(0.5)
    }
    expect(groups[0].patches.every(patch => patch.dy < 0 && patch.dx === 0)).toBe(true)
    expect(groups[1].patches.every(patch => patch.dy > 0 && patch.dx === 0)).toBe(true)
  })

  it('keeps regions inside the lens and below WebRender\'s graph limit at every size', () => {
    for (const [width, height, radius] of [[1440, 64, 0], [62, 480, 999], [420, 38, 999], [600, 800, 16], [1, 1, 9], [0.2, 0.5, 0], [3840, 2160, 999]]) {
      const groups = createFirefoxGlassFilter(width, height, radius)
      const patches = groups.flatMap(group => group.patches)
      expect(patches.length).toBeGreaterThan(0)
      expect(patches.length).toBeLessThanOrEqual(44)
      for (const patch of patches) {
        expect(Object.values(patch).every(Number.isFinite)).toBe(true)
        expect(patch.width).toBeGreaterThan(0)
        expect(patch.height).toBeGreaterThan(0)
        expect(patch.x).toBeGreaterThanOrEqual(0)
        expect(patch.y).toBeGreaterThanOrEqual(0)
        expect(patch.x + patch.width).toBeLessThanOrEqual(width + 0.001)
        expect(patch.y + patch.height).toBeLessThanOrEqual(height + 0.001)
      }
    }
    expect(() => createFirefoxGlassFilter(0, 40, 8)).toThrow(RangeError)
    expect(() => createFirefoxGlassFilter(30, Number.NaN, 8)).toThrow(RangeError)
    expect(() => createFirefoxGlassFilter(30, 40, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('keeps legacy Firefox and other engines out of the native Firefox path', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    expect(supportsFirefoxBackdrop('Mozilla/5.0 Firefox/157.0')).toBe(true)
    expect(supportsFirefoxBackdrop('Mozilla/5.0 Firefox/132.0')).toBe(true)
    expect(supportsFirefoxBackdrop('Mozilla/5.0 Firefox/131.0')).toBe(false)
    expect(supportsFirefoxBackdrop('Mozilla/5.0 Chrome/140.0')).toBe(false)
    expect(supportsFirefoxBackdrop('Mozilla/5.0 Version/18.0 Safari/605.1')).toBe(false)
    vi.stubGlobal('CSS', { supports: () => false })
    expect(supportsFirefoxBackdrop('Mozilla/5.0 Firefox/157.0')).toBe(false)
  })
})

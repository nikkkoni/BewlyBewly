import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGlassMeasurements } from '../utils/glassGeometry'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('glass frame measurements', () => {
  it('shares bounds and ancestor clipping reads while keeping the next frame fresh', () => {
    document.body.innerHTML = '<div id="clip" style="overflow-x:hidden;overflow-y:scroll"><main></main><aside></aside></div>'
    const clipper = document.querySelector<HTMLElement>('#clip')!
    const first = document.querySelector<HTMLElement>('main')!
    const second = document.querySelector<HTMLElement>('aside')!
    const bounds = vi.spyOn(clipper, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 100))
    const computed = vi.spyOn(window, 'getComputedStyle')
    const frame = createGlassMeasurements()
    expect(frame.clip(first)).toEqual({ left: 20, top: 30, right: 220, bottom: 130, width: 200, height: 100 })
    expect(frame.clip(second)).toEqual(frame.clip(first))
    frame.rect(clipper)
    expect(bounds).toHaveBeenCalledTimes(1)
    expect(computed.mock.calls.filter(([element]) => element === clipper)).toHaveLength(1)
    bounds.mockReturnValue(new DOMRect(20, 60, 200, 80))
    const next = createGlassMeasurements()
    expect(next.clip(first)).toEqual({ left: 20, top: 60, right: 220, bottom: 140, width: 200, height: 80 })
    expect(bounds).toHaveBeenCalledTimes(2)
  })

  it('intersects nested clipping axes and refreshes visibility changes', () => {
    document.body.innerHTML = '<div id="outer" style="overflow-x:hidden"><div id="inner" style="overflow-y:auto"><main></main></div></div>'
    const outer = document.querySelector<HTMLElement>('#outer')!
    const inner = document.querySelector<HTMLElement>('#inner')!
    const source = document.querySelector<HTMLElement>('main')!
    outer.getBoundingClientRect = () => new DOMRect(30, 0, 200, 500)
    inner.getBoundingClientRect = () => new DOMRect(0, 60, 400, 90)
    expect(createGlassMeasurements().clip(source)).toEqual({ left: 30, top: 60, right: 230, bottom: 150, width: 200, height: 90 })
    inner.style.opacity = '0'
    expect(createGlassMeasurements().clip(source).width).toBe(0)
    inner.style.opacity = '1'
    outer.style.display = 'none'
    const hidden = createGlassMeasurements().clip(source)
    expect(hidden.right <= hidden.left || hidden.bottom <= hidden.top).toBe(true)
    outer.style.display = 'block'
    expect(createGlassMeasurements().clip(source).height).toBe(90)
  })
})

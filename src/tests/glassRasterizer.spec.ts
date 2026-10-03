import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGlassRasterizer } from '../vendor/glassRasterizer'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('glass background image cache', () => {
  it('loads the first background URL once instead of recapturing forever', () => {
    let loads = 0
    vi.stubGlobal('Image', class {
      complete = true
      naturalWidth = 20
      get src() { return '' }
      set src(_value: string) { loads++ }
    })
    const element = document.createElement('div')
    element.style.backgroundImage = 'url(https://example.com/background.png)'
    document.body.append(element)
    const raster = createGlassRasterizer()
    const options = { width: 100, height: 100, scale: 1, ignoreElements: () => false }
    raster.measure(element, options)
    raster.measure(element, options)
    expect(loads).toBe(1)
    element.remove()
  })
})

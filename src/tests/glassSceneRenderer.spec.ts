import { describe, expect, it, vi } from 'vitest'

import type { GlassSceneLayer } from '../utils/firefoxGlass'
import { createGlassSceneRenderer } from '../utils/glassSceneRenderer'

const layer: GlassSceneLayer = {
  id: 'scene',
  backgroundImage: 'none',
  backgroundPosition: '0px -20px',
  backgroundSize: '300px 800px',
  clipPath: 'inset(0px 0px 0px 0px)',
}

describe('glass scene rendering', () => {
  it('updates only changed coordinates without publishing a new Vue layer list', () => {
    const publish = vi.fn()
    const renderer = createGlassSceneRenderer(publish)
    const element = document.createElement('span')
    renderer.render([layer])
    renderer.bind(layer.id, element)
    const observer = new MutationObserver(() => {})
    observer.observe(element, { attributes: true })
    try {
      renderer.render([{ ...layer }])
      expect(observer.takeRecords()).toHaveLength(0)
      renderer.render([{ ...layer, backgroundPosition: '0px -35px' }])
      expect(element.style.backgroundPosition).toBe('0px -35px')
      expect(element.style.backgroundSize).toBe('300px 800px')
      expect(observer.takeRecords()).toHaveLength(1)
      expect(publish).toHaveBeenCalledTimes(1)
    }
    finally {
      observer.disconnect()
    }
  })

  it('uses the latest coordinates when Vue mounts a layer after another scroll update', () => {
    const publish = vi.fn()
    const renderer = createGlassSceneRenderer(publish)
    renderer.render([layer])
    renderer.render([{ ...layer, backgroundPosition: '0px -60px' }])
    const element = document.createElement('span')
    renderer.bind(layer.id, element)
    expect(element.style.backgroundPosition).toBe('0px -60px')
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('publishes membership changes and leaves removed DOM nodes alone', () => {
    const publish = vi.fn()
    const renderer = createGlassSceneRenderer(publish)
    const element = document.createElement('span')
    renderer.render([layer])
    renderer.bind(layer.id, element)
    renderer.render([])
    expect(publish).toHaveBeenLastCalledWith([])
    renderer.render([{ ...layer, backgroundPosition: '0px -100px' }])
    expect(element.style.backgroundPosition).toBe('0px -20px')
    const replacement = document.createElement('span')
    renderer.bind(layer.id, replacement)
    expect(replacement.style.backgroundPosition).toBe('0px -100px')
    renderer.bind(layer.id, null)
    renderer.render([{ ...layer, backgroundPosition: '0px -120px' }])
    expect(replacement.style.backgroundPosition).toBe('0px -100px')
  })
})

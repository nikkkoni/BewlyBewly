import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectGlassSources, glassScenePlacement, observeFirefoxGlass } from '../utils/firefoxGlass'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'mozSetImageElement')
  document.body.replaceChildren()
})

function scrollingScene() {
  vi.useFakeTimers()
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  const register = vi.fn()
  Object.defineProperty(document, 'mozSetImageElement', { value: register, configurable: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = '<div id="scroller"><main data-glass-scene></main></div><div class="bew-liquid-glass"></div>'
  const source = root.querySelector<HTMLElement>('main')!
  const surface = root.querySelector<HTMLElement>('.bew-liquid-glass')!
  const scroller = root.querySelector<HTMLElement>('#scroller')!
  for (const element of [source, surface, scroller]) {
    element.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 300, 100))
    Object.defineProperties(element, { clientWidth: { value: 300 }, clientHeight: { value: 100 } })
  }
  const publish = vi.fn()
  const stop = observeFirefoxGlass(surface, publish)
  const tick = () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(performance.now()))
  }
  tick()
  publish.mockClear()
  vi.mocked(source.getBoundingClientRect).mockClear()
  return { root, scroller, source, surface, publish, stop, tick, register }
}

describe('firefox live glass scenes', () => {
  it('keeps registered images alive and shares a scroll listener across surfaces', () => {
    const { root, scroller, source, surface, stop, tick, register } = scrollingScene()
    const addListener = vi.spyOn(root, 'addEventListener')
    const secondStop = observeFirefoxGlass(surface, vi.fn())
    try {
      tick()
      expect(addListener.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(0)
      expect(register).toHaveBeenCalledTimes(1)
      vi.mocked(source.getBoundingClientRect).mockClear()
      for (let i = 0; i < 8; i++) {
        scroller.dispatchEvent(new Event('scroll'))
        tick()
      }
      expect(register).toHaveBeenCalledTimes(1)
      expect(source.getBoundingClientRect).toHaveBeenCalledTimes(8)
      expect(root.host.hasAttribute('data-glass-scrolling')).toBe(false)
      expect(surface.hasAttribute('data-glass-scrolling')).toBe(false)
    }
    finally {
      secondStop()
      stop()
      addListener.mockRestore()
    }
    expect(register).toHaveBeenLastCalledWith(expect.any(String), null)
  })

  it('keeps live content but excludes glass and its foreground from paint cycles', () => {
    const root = document.createElement('div').attachShadow({ mode: 'open' })
    root.innerHTML = `<div data-glass-scene id="wallpaper"></div>
      <main data-glass-scene><div><header><section><div class="bew-liquid-glass"></div><button>Tab</button></section></header>
      <article id="feed"><img><p>Video content</p></article></div></main>`
    expect(collectGlassSources(root).map(element => element.id)).toEqual(['wallpaper', 'feed'])
    expect(collectGlassSources(root).some(element => element.querySelector('.bew-liquid-glass'))).toBe(false)
  })

  it('aligns live images after scrolling and clips content to its scroll viewport', () => {
    const glass = { left: 100, top: 40, right: 300, bottom: 140, width: 200, height: 100 }
    const source = { left: 50, top: -300, right: 450, bottom: 700, width: 400, height: 1000 }
    const clip = { left: 0, top: 64, right: 800, bottom: 600, width: 800, height: 536 }
    expect(glassScenePlacement(source, glass, clip, 200, 100)).toEqual({
      backgroundPosition: '-50px -340px',
      backgroundSize: '400px 1000px',
      clipPath: 'inset(24px 0px 0px 0px)',
    })
  })

  it('uses native page siblings without capturing the extension host', () => {
    document.body.innerHTML = '<main id="native-page"></main><div id="bewly"></div><script></script>'
    const root = document.querySelector('#bewly')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<div class="bew-liquid-glass"></div>'
    expect(collectGlassSources(root).map(element => element.id)).toEqual(['native-page'])
  })

  it('accounts for scaled controls and skips offscreen or zero-size geometry', () => {
    const source = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }
    const glass = { left: 100, top: 40, right: 500, bottom: 240, width: 400, height: 200 }
    expect(glassScenePlacement(source, glass, source, 200, 100)?.backgroundPosition).toBe('-50px -20px')
    expect(glassScenePlacement(source, glass, source, 200, 100)?.backgroundSize).toBe('400px 300px')
    expect(glassScenePlacement(source, { ...glass, left: 900, right: 1300 }, source, 200, 100)).toBeNull()
    expect(glassScenePlacement(source, { ...glass, width: 0 }, source, 200, 100)).toBeNull()
    expect(glassScenePlacement(source, glass, source, 0, 100)).toBeNull()
  })

  it('shares live images and unregisters them after the last surface stops', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const register = vi.fn()
    Object.defineProperty(document, 'mozSetImageElement', { value: register, configurable: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<div data-glass-scene></div><div class="bew-liquid-glass"></div><div class="bew-liquid-glass"></div>'
    for (const element of Array.from(root.children)) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100)
      Object.defineProperties(element, { clientWidth: { value: 300 }, clientHeight: { value: 100 } })
    }
    const publish = vi.fn()
    const stops = Array.from(root.querySelectorAll<HTMLElement>('.bew-liquid-glass')).map(element => observeFirefoxGlass(element, publish))
    callbacks.splice(0).forEach(callback => callback(0))
    expect(register).toHaveBeenCalledTimes(1)
    stops[0]()
    expect(register).toHaveBeenCalledTimes(1)
    stops[1]()
    expect(register).toHaveBeenLastCalledWith(expect.any(String), null)
    expect(publish).toHaveBeenLastCalledWith([])
    Reflect.deleteProperty(document, 'mozSetImageElement')
  })

  it('updates moving image coordinates in the next frame without hiding refraction', () => {
    const { scroller, source, surface, publish, stop, tick } = scrollingScene()
    try {
      for (let i = 1; i <= 8; i++) {
        source.getBoundingClientRect = () => new DOMRect(0, -i * 5, 300, 100)
        scroller.dispatchEvent(new Event('scroll'))
        tick()
        expect(publish.mock.lastCall?.[0][0].backgroundPosition).toBe(`0px ${-i * 5}px`)
        expect(surface.hasAttribute('data-glass-scrolling')).toBe(false)
      }
      expect(publish).toHaveBeenCalledTimes(8)
    }
    finally {
      stop()
    }
  })

  it('coalesces repeated scroll events and synchronizes the final scrollend position', () => {
    const { scroller, source, publish, stop, tick } = scrollingScene()
    try {
      source.getBoundingClientRect = vi.fn(() => new DOMRect(0, -20, 300, 100))
      for (let i = 0; i < 8; i++)
        scroller.dispatchEvent(new Event('scroll'))
      expect(publish).not.toHaveBeenCalled()
      tick()
      expect(publish).toHaveBeenCalledTimes(1)
      expect(source.getBoundingClientRect).toHaveBeenCalledTimes(1)
      source.getBoundingClientRect = () => new DOMRect(0, -35, 300, 100)
      scroller.dispatchEvent(new Event('scrollend'))
      tick()
      expect(publish.mock.lastCall?.[0][0].backgroundPosition).toBe('0px -35px')
      tick()
      expect(publish).toHaveBeenCalledTimes(2)
    }
    finally {
      stop()
    }
  })

  it('releases sources outside the surface and registers them again on return', () => {
    const { scroller, source, publish, stop, tick, register } = scrollingScene()
    try {
      source.getBoundingClientRect = () => new DOMRect(0, -200, 300, 100)
      scroller.dispatchEvent(new Event('scroll'))
      tick()
      expect(publish).toHaveBeenLastCalledWith([])
      expect(register).toHaveBeenLastCalledWith(expect.any(String), null)
      source.getBoundingClientRect = () => new DOMRect(0, -10, 300, 100)
      scroller.dispatchEvent(new Event('scroll'))
      tick()
      expect(register).toHaveBeenLastCalledWith(expect.any(String), source)
      expect(publish.mock.lastCall?.[0][0].backgroundPosition).toBe('0px -10px')
    }
    finally {
      stop()
    }
  })

  it('captures nested and native scrollers and cancels queued updates on cleanup', () => {
    const { scroller, source, publish, stop, tick } = scrollingScene()
    const nativeScroller = document.createElement('div')
    document.body.append(nativeScroller)
    source.getBoundingClientRect = () => new DOMRect(0, -10, 300, 100)
    scroller.dispatchEvent(new Event('scroll'))
    nativeScroller.dispatchEvent(new Event('scroll'))
    tick()
    expect(publish).toHaveBeenCalledTimes(1)
    source.getBoundingClientRect = () => new DOMRect(0, -20, 300, 100)
    nativeScroller.dispatchEvent(new Event('scroll'))
    tick()
    expect(publish.mock.lastCall?.[0][0].backgroundPosition).toBe('0px -20px')
    nativeScroller.dispatchEvent(new Event('scroll'))
    stop()
    publish.mockClear()
    nativeScroller.dispatchEvent(new Event('scroll'))
    nativeScroller.dispatchEvent(new Event('scrollend'))
    tick()
    expect(publish).not.toHaveBeenCalled()
  })
})

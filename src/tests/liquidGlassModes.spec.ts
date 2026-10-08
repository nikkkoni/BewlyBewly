import { existsSync, readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, KeepAlive, nextTick, ref } from 'vue'

import LiquidGlass from '../components/LiquidGlass.vue'
import { settings } from '../logic'
import { observeFirefoxGlass, supportsFirefoxGlass } from '../utils/firefoxGlass'
import { glassLensDataUrl } from '../utils/glassLens'

vi.mock('../logic', async () => {
  const { ref } = await import('vue')
  return { settings: ref({ firefoxPreferScrollSync: false }) }
})
vi.mock('../utils/firefoxGlass', () => ({
  supportsFirefoxGlass: vi.fn(() => true),
  observeFirefoxGlass: vi.fn(),
}))
vi.mock('../utils/glassLens', () => ({
  glassLensDataUrl: vi.fn(() => 'data:image/png;base64,AA=='),
}))

const frames = new Map<number, FrameRequestCallback>()
const mediaQueries = new Map<string, EventTarget & { matches: boolean }>()
const sceneStops: (() => void)[] = []
let app: ReturnType<typeof createApp> | undefined
let host: HTMLDivElement
let nextFrame = 0

beforeEach(() => {
  vi.clearAllMocks()
  frames.clear()
  mediaQueries.clear()
  sceneStops.length = 0
  nextFrame = 0
  settings.value.firefoxPreferScrollSync = false
  Reflect.deleteProperty(settings.value, 'firefoxWebGL')
  vi.mocked(supportsFirefoxGlass).mockReturnValue(true)
  vi.mocked(observeFirefoxGlass).mockImplementation((_element, publish) => {
    publish([{ id: 'test-scene', backgroundImage: 'none', backgroundPosition: '0px 0px', backgroundSize: '300px 100px', clipPath: 'none' }])
    const stop = vi.fn(() => publish([]))
    sceneStops.push(stop)
    return stop
  })
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Firefox/157.0')
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100)
  vi.stubGlobal('CSS', { supports: () => true })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('matchMedia', (query: string) => {
    const media = Object.assign(new EventTarget(), { matches: false })
    mediaQueries.set(query, media)
    return media
  })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  app?.unmount()
  app = undefined
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(performance.now()))
  }
  await nextTick()
}

async function mountGlass() {
  const props = ref({ disabled: false, reduced: false })
  const visible = ref(true)
  app = createApp({
    render: () => h('section', [h(KeepAlive, null, {
      default: () => visible.value ? h(LiquidGlass, props.value) : null,
    })]),
  })
  app.mount(host)
  await settle()
  return { props, visible }
}

function glass() {
  return host.querySelector<HTMLElement>('.bew-liquid-glass')!
}

function changeMedia(query: string, matches: boolean) {
  const media = mediaQueries.get(query)!
  media.matches = matches
  media.dispatchEvent(new Event('change'))
}

describe('retained liquid glass renderers', () => {
  it.each([undefined, false, true])('keeps SVG as the default with legacy WebGL=%s', async (legacy) => {
    if (legacy !== undefined)
      Object.assign(settings.value, { firefoxWebGL: legacy })
    await mountGlass()
    expect(glass().dataset.refraction).toBe('firefox')
    expect(glass().querySelectorAll('feDisplacementMap')).toHaveLength(3)
    expect(glass().querySelector('.lens-source')).not.toBeNull()
    expect(glassLensDataUrl).toHaveBeenCalledWith(300, 100, 24, true)
    expect(glass().querySelector('canvas, .lens-webgl')).toBeNull()
  })

  it.each([undefined, false, true])('preserves explicit native synchronization with legacy WebGL=%s', async (legacy) => {
    if (legacy !== undefined)
      Object.assign(settings.value, { firefoxWebGL: legacy })
    settings.value.firefoxPreferScrollSync = true
    await mountGlass()
    expect(glass().dataset.refraction).toBe('firefox-native')
    expect(glass().querySelectorAll('feOffset').length).toBeGreaterThan(0)
    expect(glass().querySelector('.lens-source, feDisplacementMap')).toBeNull()
    expect(observeFirefoxGlass).not.toHaveBeenCalled()
    expect(glassLensDataUrl).not.toHaveBeenCalled()
  })

  it('releases SVG scenes on mode changes, cache deactivation and unmount', async () => {
    const { visible } = await mountGlass()
    for (let i = 0; i < 3; i++) {
      settings.value.firefoxPreferScrollSync = true
      await settle()
      expect(sceneStops[i]).toHaveBeenCalledTimes(1)
      expect(glass().dataset.refraction).toBe('firefox-native')
      expect(glass().querySelector('.lens-source')).toBeNull()
      settings.value.firefoxPreferScrollSync = false
      await settle()
      expect(glass().dataset.refraction).toBe('firefox')
    }
    visible.value = false
    await settle()
    expect(sceneStops[3]).toHaveBeenCalledTimes(1)
    visible.value = true
    await settle()
    expect(glass().dataset.refraction).toBe('firefox')
    app!.unmount()
    app = undefined
    expect(sceneStops[4]).toHaveBeenCalledTimes(1)
    settings.value.firefoxPreferScrollSync = true
    await settle()
    expect(observeFirefoxGlass).toHaveBeenCalledTimes(5)
    expect(frames.size).toBe(0)
  })

  it.each([
    ['Firefox/131.0', true, true, 'firefox'],
    ['Firefox/157.0', false, false, 'firefox-native'],
    ['Firefox/131.0', false, true, 'fallback'],
    ['Version/18.0 Safari/605.1', false, true, 'fallback'],
    ['Chrome/140.0 CriOS/140.0', false, true, 'fallback'],
  ] as const)('retains capability fallback for %s (live=%s, sync=%s)', async (agent, live, sync, expected) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(`Mozilla/5.0 ${agent}`)
    vi.mocked(supportsFirefoxGlass).mockReturnValue(live)
    settings.value.firefoxPreferScrollSync = sync
    await mountGlass()
    expect(glass().dataset.refraction).toBe(expected)
  })

  it.each(['Chrome/140.0', 'Edg/140.0'])('keeps the Chromium SVG pipeline for %s', async (agent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(`Mozilla/5.0 ${agent}`)
    vi.mocked(supportsFirefoxGlass).mockReturnValue(false)
    Object.assign(settings.value, { firefoxWebGL: true, firefoxPreferScrollSync: true })
    const { props } = await mountGlass()
    expect(glass().dataset.refraction).toBe('svg')
    expect(glassLensDataUrl).toHaveBeenCalledWith(300, 100, 24, false)
    props.value.reduced = true
    settings.value.firefoxPreferScrollSync = false
    await settle()
    expect(glass().dataset.refraction).toBe('svg')
    expect(glass().querySelectorAll('feDisplacementMap')).toHaveLength(3)
    expect(observeFirefoxGlass).not.toHaveBeenCalled()
  })

  it('keeps reduced SVG, disabled glass and reduced transparency behavior', async () => {
    const { props } = await mountGlass()
    props.value.reduced = true
    await settle()
    expect(glass().querySelectorAll('feDisplacementMap')).toHaveLength(1)
    expect(glass().querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('14')
    props.value.disabled = true
    await settle()
    expect(glass().classList.contains('is-opaque')).toBe(true)
    expect(glass().dataset.refraction).toBe('fallback')
    expect(sceneStops[0]).toHaveBeenCalledTimes(1)
    props.value.disabled = false
    await settle()
    expect(glass().dataset.refraction).toBe('firefox')
    changeMedia('(prefers-reduced-transparency: reduce)', true)
    await settle()
    expect(glass().dataset.refraction).toBe('fallback')
    expect(sceneStops[1]).toHaveBeenCalledTimes(1)
    changeMedia('(prefers-reduced-transparency: reduce)', false)
    await settle()
    expect(glass().dataset.refraction).toBe('firefox')
  })

  it('removes the experiment without hiding the native setting or resetting storage', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    const general = read('../components/Settings/General/General.vue')
    expect(general).not.toMatch(/firefoxWebGL|firefox_webgl/)
    expect(general).toContain('v-if="canChooseFirefoxGlass && !settings.disableFrostedGlass"')
    expect(general).toContain('v-model="settings.firefoxPreferScrollSync"')
    const storage = read('../logic/storage.ts')
    expect(storage).not.toContain('firefoxWebGL')
    expect(storage).toContain('firefoxPreferScrollSync: false')
    for (const locale of ['cmn-CN', 'cmn-TW', 'en', 'jyut']) {
      const text = read(`../_locales/${locale}.yml`)
      expect(text).not.toMatch(/^\s+firefox_webgl(?:_desc)?:/m)
      expect(text).toContain('firefox_prefer_scroll_sync:')
    }
    for (const path of ['../utils/firefoxGlassWebGL.ts', '../utils/glassWebGLGeometry.ts', '../vendor/glassRasterizer.js', '../vendor/glassRasterizer.d.ts'])
      expect(existsSync(new URL(path, import.meta.url))).toBe(false)
  })
})

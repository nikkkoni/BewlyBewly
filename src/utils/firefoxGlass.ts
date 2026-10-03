// Firefox's live element images avoid page screenshots and DOM clones.
// See https://developer.mozilla.org/docs/Web/API/Document/mozSetImageElement
// and Meapri/liquid-glass-web (THIRD_PARTY_NOTICES.md).

import { createGlassMeasurements, type GlassMeasurements, type GlassRect } from './glassGeometry'
import { observeGlassScroll } from './glassMotion'

interface FirefoxDocument extends Document {
  mozSetImageElement?: (id: string, element: Element | null) => void
}

export interface GlassSceneLayer {
  id: string
  backgroundImage: string
  backgroundPosition: string
  backgroundSize: string
  clipPath: string
}

const registrations = new WeakMap<Element, { id: string, users: number }>()
const prefix = `bew-scene-${Math.random().toString(36).slice(2)}`
let nextId = 0

export function supportsFirefoxGlass(doc: Document = document): boolean {
  return typeof (doc as FirefoxDocument).mozSetImageElement === 'function'
    && CSS.supports('background-image', '-moz-element(#bew-scene)')
}

// A source must never include a glass layer: that creates a cyclic paint graph.
// Split only around glass controls, keeping video lists as one live source.
export function collectGlassSources(root: ParentNode): HTMLElement[] {
  const result: HTMLElement[] = []
  function visit(element: HTMLElement) {
    if (result.length >= 24 || element.matches('#bewly, .bew-liquid-glass, script, style, link, svg'))
      return
    if (element.querySelector(':scope > .bew-liquid-glass'))
      return
    if (!element.querySelector('.bew-liquid-glass')) {
      result.push(element)
      return
    }
    Array.from(element.children).forEach((child) => {
      if (child instanceof HTMLElement)
        visit(child)
    })
  }
  const scenes = root.querySelectorAll<HTMLElement>('[data-glass-scene]')
  scenes.forEach((element) => {
    if (!element.parentElement?.closest('[data-glass-scene]'))
      visit(element)
  })
  // Native Bilibili pages live outside the extension's shadow root. Paint their
  // separate body children, never the body/host that contains the glass itself.
  if (!scenes.length && root instanceof ShadowRoot) {
    Array.from(root.ownerDocument.body?.children || []).forEach((element) => {
      if (element instanceof HTMLElement && !element.contains(root.host))
        visit(element)
    })
  }
  return result
}

export function glassScenePlacement(source: GlassRect, glass: GlassRect, clip: GlassRect, width: number, height: number) {
  if (width <= 0 || height <= 0 || glass.width <= 0 || glass.height <= 0)
    return null
  const sx = glass.width / width
  const sy = glass.height / height
  const left = Math.max(clip.left, source.left, glass.left)
  const top = Math.max(clip.top, source.top, glass.top)
  const right = Math.min(clip.right, source.right, glass.right)
  const bottom = Math.min(clip.bottom, source.bottom, glass.bottom)
  if (sx <= 0 || sy <= 0 || right <= left || bottom <= top)
    return null
  return {
    backgroundPosition: `${(source.left - glass.left) / sx}px ${(source.top - glass.top) / sy}px`,
    backgroundSize: `${source.width / sx}px ${source.height / sy}px`,
    clipPath: `inset(${(top - glass.top) / sy}px ${(glass.right - right) / sx}px ${(glass.bottom - bottom) / sy}px ${(left - glass.left) / sx}px)`,
  }
}

export function observeFirefoxGlass(surface: HTMLElement, publish: (layers: GlassSceneLayer[]) => void) {
  const doc = surface.ownerDocument as FirefoxDocument
  const root = surface.getRootNode() as Document | ShadowRoot
  const owned = new Map<HTMLElement, string>()
  let sources: HTMLElement[] = []
  let sourcesDirty = true
  let frame = 0
  let motionUntil = 0
  let stopped = false
  const resize = new ResizeObserver(schedule)

  function release(element: HTMLElement) {
    const registration = registrations.get(element)
    if (registration && --registration.users === 0) {
      doc.mozSetImageElement?.(registration.id, null)
      registrations.delete(element)
    }
    resize.unobserve(element)
    owned.delete(element)
  }

  function sync(measurements: GlassMeasurements = createGlassMeasurements()) {
    cancelAnimationFrame(frame)
    frame = 0
    if (stopped)
      return
    if (sourcesDirty) {
      sources = collectGlassSources(root)
      sourcesDirty = false
    }
    const glass = measurements.rect(surface)
    const width = surface.clientWidth
    const height = surface.clientHeight
    const layers: GlassSceneLayer[] = []
    for (const element of owned.keys()) {
      if (!sources.includes(element))
        release(element)
    }
    for (const element of sources) {
      const placement = glassScenePlacement(measurements.rect(element), glass, measurements.clip(element), width, height)
      if (!placement) {
        if (owned.has(element))
          release(element)
        continue
      }
      let id = owned.get(element)
      if (!id) {
        let registration = registrations.get(element)
        if (!registration) {
          registration = { id: `${prefix}-${++nextId}`, users: 0 }
          doc.mozSetImageElement?.(registration.id, element)
          registrations.set(element, registration)
        }
        registration.users++
        id = registration.id
        owned.set(element, id)
        resize.observe(element)
      }
      layers.push({ id, backgroundImage: `-moz-element(#${id})`, ...placement })
    }
    publish(layers)
    if (performance.now() < motionUntil)
      schedule()
  }

  function schedule() {
    if (!stopped && !frame)
      frame = requestAnimationFrame(() => sync())
  }

  function transition(event: Event) {
    if (event.target instanceof Element && event.target.contains(surface)) {
      // Follow finite control transitions (e.g. Dock hover / top-bar hiding).
      motionUntil = performance.now() + 600
      schedule()
    }
  }

  const mutations = new MutationObserver((records) => {
    if (records.some(record => !(record.target instanceof Element) || !record.target.closest('.bew-liquid-glass'))) {
      sourcesDirty = true
      schedule()
    }
  })
  mutations.observe(root, { childList: true, subtree: true })
  if (root instanceof ShadowRoot && doc.body)
    mutations.observe(doc.body, { childList: true })
  resize.observe(surface)
  // The shared callback already runs in a frame; sync directly so scrolling
  // does not incur a second requestAnimationFrame of latency.
  const stopMotion = observeGlassScroll(root, sync)
  root.addEventListener('transitionrun', transition, true)
  root.addEventListener('transitionend', schedule, true)
  window.addEventListener('resize', schedule, { passive: true })
  schedule()

  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    stopMotion()
    mutations.disconnect()
    for (const element of owned.keys())
      release(element)
    resize.disconnect()
    root.removeEventListener('transitionrun', transition, true)
    root.removeEventListener('transitionend', schedule, true)
    window.removeEventListener('resize', schedule)
    publish([])
  }
}

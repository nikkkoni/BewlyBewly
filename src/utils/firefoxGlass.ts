// Firefox's live element images avoid page screenshots and DOM clones.
// See https://developer.mozilla.org/docs/Web/API/Document/mozSetImageElement
// and Meapri/liquid-glass-web (THIRD_PARTY_NOTICES.md).

import { observeGlassMotion } from './glassMotion'

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

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
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

export function glassScenePlacement(source: Rect, glass: Rect, clip: Rect, width: number, height: number) {
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

function sourceClip(element: HTMLElement): Rect {
  let left = 0
  let top = 0
  let right = innerWidth
  let bottom = innerHeight
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    if (ancestor === element)
      continue
    const rect = ancestor.getBoundingClientRect()
    if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
      left = Math.max(left, rect.left)
      right = Math.min(right, rect.right)
    }
    if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
      top = Math.max(top, rect.top)
      bottom = Math.min(bottom, rect.bottom)
    }
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

export function observeFirefoxGlass(surface: HTMLElement, publish: (layers: GlassSceneLayer[]) => void) {
  const doc = surface.ownerDocument as FirefoxDocument
  const root = surface.getRootNode() as Document | ShadowRoot
  const owned = new Map<HTMLElement, string>()
  let sources: HTMLElement[] = []
  let sourcesDirty = true
  let frame = 0
  let revealFrame = 0
  let scrolling = false
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

  function sync() {
    frame = 0
    if (stopped || scrolling)
      return
    if (sourcesDirty) {
      sources = collectGlassSources(root)
      sourcesDirty = false
    }
    const glass = surface.getBoundingClientRect()
    const layers: GlassSceneLayer[] = []
    for (const element of owned.keys()) {
      if (!sources.includes(element))
        release(element)
    }
    for (const element of sources) {
      const placement = glassScenePlacement(element.getBoundingClientRect(), glass, sourceClip(element), surface.clientWidth, surface.clientHeight)
      if (!placement)
        continue
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
    // Vue applies the new layer coordinates after publish. Keep refraction
    // hidden until those coordinates have reached the DOM.
    if (surface.hasAttribute('data-glass-scrolling') && !revealFrame) {
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0
        if (!stopped && !scrolling)
          surface.removeAttribute('data-glass-scrolling')
      })
    }
    if (performance.now() < motionUntil)
      schedule()
  }

  function schedule() {
    if (!stopped && !scrolling && !frame)
      frame = requestAnimationFrame(sync)
  }

  function pause() {
    surface.setAttribute('data-glass-scrolling', '')
    // Hiding the CSS consumer is not enough: registered element images still
    // keep their source paint dependencies alive, including the long feed.
    // Drop those dependencies for the entire gesture, then register on resume.
    for (const element of owned.keys())
      release(element)
    cancelAnimationFrame(frame)
    cancelAnimationFrame(revealFrame)
    frame = revealFrame = 0
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
  const stopMotion = observeGlassMotion(root, (moving) => {
    scrolling = moving
    if (moving)
      pause()
    else
      schedule()
  })
  root.addEventListener('transitionrun', transition, true)
  root.addEventListener('transitionend', schedule, true)
  window.addEventListener('resize', schedule, { passive: true })
  schedule()

  return () => {
    stopped = true
    cancelAnimationFrame(frame)
    cancelAnimationFrame(revealFrame)
    stopMotion()
    surface.removeAttribute('data-glass-scrolling')
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

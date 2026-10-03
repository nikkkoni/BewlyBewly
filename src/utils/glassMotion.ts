type GlassRoot = Document | ShadowRoot
type Listener = (scrolling: boolean) => void

const scopes = new WeakMap<GlassRoot, ReturnType<typeof createScope>>()

function createScope(root: GlassRoot) {
  const doc = root instanceof Document ? root : root.ownerDocument
  const host = root instanceof ShadowRoot ? root.host : doc.documentElement
  const targets = new Set<GlassRoot>([root, doc])
  const listeners = new Set<Listener>()
  const scrollers = new Set<EventTarget>()
  let scrolling = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let revealFrame = 0

  function resume() {
    clearTimeout(timer)
    scrollers.clear()
    scrolling = false
    listeners.forEach(listener => listener(false))
    // Scene observers first publish current coordinates; Vue then patches DOM.
    // Keep all backdrop filters paused until that update can be painted.
    revealFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0
        host.removeAttribute('data-glass-scrolling')
      })
    })
  }

  function scroll(event: Event) {
    if (event.target)
      scrollers.add(event.target)
    cancelAnimationFrame(revealFrame)
    revealFrame = 0
    if (!scrolling) {
      scrolling = true
      host.setAttribute('data-glass-scrolling', '')
      listeners.forEach(listener => listener(true))
    }
    clearTimeout(timer)
    timer = setTimeout(resume, 180)
  }

  function scrollEnd(event: Event) {
    if (event.target)
      scrollers.delete(event.target)
    if (scrolling && !scrollers.size) {
      clearTimeout(timer)
      timer = setTimeout(resume, 100)
    }
  }

  for (const target of targets) {
    target.addEventListener('scroll', scroll, { capture: true, passive: true })
    target.addEventListener('scrollend', scrollEnd, { capture: true, passive: true })
  }

  return {
    add(listener: Listener) {
      listeners.add(listener)
      listener(scrolling)
      return () => {
        listeners.delete(listener)
        if (listeners.size)
          return
        clearTimeout(timer)
        cancelAnimationFrame(revealFrame)
        host.removeAttribute('data-glass-scrolling')
        for (const target of targets) {
          target.removeEventListener('scroll', scroll, true)
          target.removeEventListener('scrollend', scrollEnd, true)
        }
        scopes.delete(root)
      }
    },
  }
}

/** One scroll listener/timer per shadow root, independent of surface count. */
export function observeGlassMotion(root: GlassRoot, listener: Listener) {
  let scope = scopes.get(root)
  if (!scope) {
    scope = createScope(root)
    scopes.set(root, scope)
  }
  return scope.add(listener)
}

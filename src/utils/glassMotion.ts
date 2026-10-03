type GlassRoot = Document | ShadowRoot
type Listener = () => void

const scopes = new WeakMap<GlassRoot, ReturnType<typeof createScope>>()

function createScope(root: GlassRoot) {
  const doc = root instanceof Document ? root : root.ownerDocument
  const targets = new Set<GlassRoot>([root, doc])
  const listeners = new Set<Listener>()
  let frame = 0

  function update() {
    frame = 0
    listeners.forEach(listener => listener())
  }

  function scroll() {
    if (!frame)
      frame = requestAnimationFrame(update)
  }

  for (const target of targets) {
    target.addEventListener('scroll', scroll, { capture: true, passive: true })
    target.addEventListener('scrollend', scroll, { capture: true, passive: true })
  }

  return {
    add(listener: Listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size)
          return
        cancelAnimationFrame(frame)
        for (const target of targets) {
          target.removeEventListener('scroll', scroll, true)
          target.removeEventListener('scrollend', scroll, true)
        }
        scopes.delete(root)
      }
    },
  }
}

/** Batch scroll updates for every surface into one frame per shadow root. */
export function observeGlassScroll(root: GlassRoot, listener: Listener) {
  let scope = scopes.get(root)
  if (!scope) {
    scope = createScope(root)
    scopes.set(root, scope)
  }
  return scope.add(listener)
}

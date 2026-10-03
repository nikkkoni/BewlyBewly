export interface GlassRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type GlassMeasurements = ReturnType<typeof createGlassMeasurements>

/** Share layout reads within a frame, never reuse stale geometry next frame. */
export function createGlassMeasurements() {
  const bounds = new Map<HTMLElement, DOMRect>()
  const styles = new Map<HTMLElement, CSSStyleDeclaration>()
  const clips = new Map<HTMLElement, GlassRect>()
  const viewport: GlassRect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight }
  const empty: GlassRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }

  function rect(element: HTMLElement) {
    let value = bounds.get(element)
    if (!value) {
      value = element.getBoundingClientRect()
      bounds.set(element, value)
    }
    return value
  }

  function style(element: HTMLElement) {
    let value = styles.get(element)
    if (!value) {
      value = getComputedStyle(element)
      styles.set(element, value)
    }
    return value
  }

  function hidden(element: HTMLElement) {
    const value = style(element)
    return value.visibility === 'hidden' || value.display === 'none' || value.opacity === '0'
  }

  function childClip(element: HTMLElement): GlassRect {
    const cached = clips.get(element)
    if (cached)
      return cached
    let value = empty
    if (!hidden(element)) {
      const parent = element.parentElement ? childClip(element.parentElement) : viewport
      const css = style(element)
      const clipX = /hidden|clip|auto|scroll/.test(css.overflowX)
      const clipY = /hidden|clip|auto|scroll/.test(css.overflowY)
      value = parent
      if (clipX || clipY) {
        const box = rect(element)
        const left = clipX ? Math.max(parent.left, box.left) : parent.left
        const right = clipX ? Math.min(parent.right, box.right) : parent.right
        const top = clipY ? Math.max(parent.top, box.top) : parent.top
        const bottom = clipY ? Math.min(parent.bottom, box.bottom) : parent.bottom
        value = { left, right, top, bottom, width: right - left, height: bottom - top }
      }
    }
    clips.set(element, value)
    return value
  }

  function clip(element: HTMLElement) {
    if (hidden(element))
      return empty
    return element.parentElement ? childClip(element.parentElement) : viewport
  }

  return { rect, clip }
}

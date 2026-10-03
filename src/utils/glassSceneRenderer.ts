import type { GlassSceneLayer } from './firefoxGlass'

/** Vue owns layer membership; position updates only touch changed CSS values. */
export function createGlassSceneRenderer(publish: (layers: GlassSceneLayer[]) => void) {
  let layers: GlassSceneLayer[] = []
  const elements = new Map<string, HTMLElement>()
  const applied = new WeakMap<HTMLElement, GlassSceneLayer>()

  function patch(element: HTMLElement, layer: GlassSceneLayer) {
    const previous = applied.get(element)
    for (const property of ['backgroundImage', 'backgroundPosition', 'backgroundSize', 'clipPath'] as const) {
      if (previous?.[property] !== layer[property])
        element.style[property] = layer[property]
    }
    applied.set(element, layer)
  }

  function bind(id: string, element: HTMLElement | null) {
    if (!element) {
      elements.delete(id)
      return
    }
    elements.set(id, element)
    const layer = layers.find(layer => layer.id === id)
    if (layer)
      patch(element, layer)
  }

  function render(next: GlassSceneLayer[]) {
    const changed = next.length !== layers.length || next.some((layer, index) => layer.id !== layers[index].id)
    layers = next
    if (changed) {
      for (const id of elements.keys()) {
        if (!layers.some(layer => layer.id === id))
          elements.delete(id)
      }
      publish(next)
    }
    for (const layer of layers) {
      const element = elements.get(layer.id)
      if (element)
        patch(element, layer)
    }
  }

  return { bind, render }
}

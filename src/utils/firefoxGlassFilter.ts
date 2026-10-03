interface FilterRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GlassOffsetPatch extends FilterRect {
  dx: number
  dy: number
}

export interface GlassOffsetGroup extends FilterRect {
  patches: GlassOffsetPatch[]
}

/**
 * Approximate glassLens.ts's rounded lens with Firefox's accelerated feOffset.
 * feImage/feDisplacementMap force a software fallback that backdrop-filter skips.
 * Keeping the graph native lets APZ scroll the background without JS sampling.
 */
export function createFirefoxGlassFilter(width: number, height: number, cornerRadius: number): GlassOffsetGroup[] {
  if (![width, height, cornerRadius].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new RangeError('A glass lens needs finite positive dimensions')

  const radius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2))
  const bevel = Math.min(18, radius || 8, width / 2, height / 2)
  const corner = Math.min(Math.max(radius, bevel), width / 2, height / 2)

  function offset(x: number, y: number) {
    const px = x - width / 2
    const py = y - height / 2
    const qx = Math.abs(px) - width / 2 + radius
    const qy = Math.abs(py) - height / 2 + radius
    const ox = Math.max(qx, 0)
    const oy = Math.max(qy, 0)
    const length = Math.hypot(ox, oy)
    const distance = length + Math.min(Math.max(qx, qy), 0) - radius
    if (distance >= 0 || distance <= -bevel)
      return { dx: 0, dy: 0 }

    const nx = length > 0 ? ox / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0
    const ny = length > 0 ? oy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py)
    const t = -distance / bevel
    // feOffset moves the output; displacement maps move the sample, so the sign is reversed.
    const bend = Math.sin(Math.PI * t) * (1 - t) ** 0.35 / 2
    return { dx: nx * bend, dy: ny * bend }
  }

  function build(cornerSteps: number) {
    const groups: GlassOffsetGroup[] = []
    function add(x: number, y: number, w: number, h: number, columns: number, rows: number) {
      if (w <= 0 || h <= 0)
        return
      const patches: GlassOffsetPatch[] = []
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const patch = { x: x + column * w / columns, y: y + row * h / rows, width: w / columns, height: h / rows }
          const shift = offset(patch.x + patch.width / 2, patch.y + patch.height / 2)
          if (Math.abs(shift.dx) + Math.abs(shift.dy) > 0.002)
            patches.push({ ...patch, ...shift })
        }
      }
      if (patches.length)
        groups.push({ x, y, width: w, height: h, patches })
    }

    const steps = Math.min(6, Math.max(1, Math.ceil(bevel)))
    add(corner, 0, width - corner * 2, bevel, 1, steps)
    add(corner, height - bevel, width - corner * 2, bevel, 1, steps)
    add(0, corner, bevel, height - corner * 2, steps, 1)
    add(width - bevel, corner, bevel, height - corner * 2, steps, 1)
    for (const x of [0, width - corner]) {
      for (const y of [0, height - corner])
        add(x, y, corner, corner, cornerSteps, cornerSteps)
    }
    return groups
  }

  let groups = build(Math.min(3, Math.max(1, Math.ceil(corner / 4))))
  // WebRender expands offsets, clipping and merges into additional graph nodes.
  // Stay well below its 256-node limit, beyond which backdrop-filter disappears.
  if (groups.reduce((count, group) => count + group.patches.length, 0) > 44)
    groups = build(2)
  return groups
}

export function supportsFirefoxBackdrop(userAgent = navigator.userAgent): boolean {
  // Firefox 132 enabled feOffset/feMerge acceleration; CSS.supports alone also
  // returns true on older releases whose compositor cannot render this graph.
  const version = /Firefox\/(\d+)/.exec(userAgent)
  return !!version && Number(version[1]) >= 132 && CSS.supports('backdrop-filter', 'url("#bew-lens")')
}

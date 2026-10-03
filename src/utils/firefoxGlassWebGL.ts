import { createGlassRasterizer } from '../vendor/glassRasterizer'
import { collectGlassSources } from './firefoxGlass'
import { createGlassMeasurements, type GlassRect } from './glassGeometry'
import { observeGlassScroll } from './glassMotion'
import { glassCaptureRect, glassRimTiles, packGlassAtlas } from './glassWebGLGeometry'

interface Lens {
  element: HTMLElement
  layer: HTMLElement
  options: () => { strength: number, frost: number, reduced: boolean }
  ready: (value: boolean) => void
  failed: (reason?: string) => void
}
interface Capture {
  texture: WebGLTexture
  canvas: HTMLCanvasElement
  origin: DOMRect
  area: ReturnType<typeof glassCaptureRect>
  dirty: boolean
  revision: number
}
const engines = new WeakMap<Document | ShadowRoot, ReturnType<typeof createEngine>>()

const vertex = `attribute vec2 position;
varying vec2 uv;
void main(){uv=vec2(position.x,1.0-position.y);gl_Position=vec4(position*2.0-1.0,0.0,1.0);}`
const copy = `precision mediump float;
varying vec2 uv;uniform sampler2D image;
void main(){gl_FragColor=texture2D(image,uv);}`
const lensShader = `precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 screenSize;
uniform vec4 lens,tile;
uniform float radius,strength,frost,dispersion;
vec3 sampleScene(vec2 p){return texture2D(image,vec2(p.x/screenSize.x,1.0-p.y/screenSize.y)).rgb;}
void main(){
 vec2 p=tile.xy+uv*tile.zw;vec2 centered=p-lens.zw*.5;
 vec2 q=abs(centered)-lens.zw*.5+radius;
 vec2 outer=max(q,0.0);float len=length(outer);
 float distance=len+min(max(q.x,q.y),0.0)-radius;
 if(distance>0.0) discard;
 vec2 normal=len>0.0001?outer/len*sign(centered):(q.x>q.y?vec2(sign(centered.x),0.0):vec2(0.0,sign(centered.y)));
 float band=min(min(18.0,max(8.0,radius*.65)),min(lens.z,lens.w)*.5);
 float t=clamp(1.0+distance/band,0.0,1.0);
 float bend=1.0-sqrt(max(0.0,1.0-t*t));
 // The flat center stays native, so async scrolling cannot separate it from
 // the page. Only the curved rim needs a sampled WebGL background.
 float alpha=smoothstep(0.0,.18,bend);
 if(alpha<.001) discard;
 vec2 offset=-normal*bend*strength*.5;
 vec2 point=lens.xy+p;
 vec3 color=vec3(sampleScene(point+offset*(1.0+dispersion)).r,sampleScene(point+offset).g,sampleScene(point+offset*(1.0-dispersion)).b);
 if(frost>.01) color=(color*2.0+sampleScene(point+offset+vec2(frost,0.0))+sampleScene(point+offset-vec2(frost,0.0))+sampleScene(point+offset+vec2(0.0,frost))+sampleScene(point+offset-vec2(0.0,frost)))/6.0;
 float light=pow(abs(dot(normal,vec2(.70710678))),1.5);
 float glint=(.20*pow(max(0.0,1.0+distance/3.0),1.5)+.03*bend)*light;
 gl_FragColor=vec4((color+glint)*alpha,alpha);
}`

function createEngine(root: Document | ShadowRoot) {
  const doc = root instanceof Document ? root : root.ownerDocument
  const atlas = doc.createElement('canvas')
  const gl = atlas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })
  if (!gl)
    throw new Error('WebGL is unavailable')
  const limit = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE))
  const id = `bew-webgl-${Math.random().toString(36).slice(2)}`
  const raster = createGlassRasterizer()
  const lenses = new Set<Lens>()
  const tiles = new Map<Lens, HTMLElement[]>()
  const captures = new Map<HTMLElement, Capture>()
  const programs: WebGLProgram[] = []
  const uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>()
  const scene = gl.createTexture()!
  const framebuffer = gl.createFramebuffer()!
  const buffer = gl.createBuffer()!
  let sceneWidth = 0
  let sceneHeight = 0
  let frame = 0
  let stopped = false
  let failed = false
  let transitionUntil = 0
  let refreshTimer = 0
  let sources: HTMLElement[] = []
  let sourcesDirty = true
  let captureCount = 0
  let lastBackground = ''
  let background = [1, 1, 1, 1]
  let checkedGPU = false

  function program(fragment: string) {
    const p = gl!.createProgram()!
    for (const [type, source] of [[gl!.VERTEX_SHADER, vertex], [gl!.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl!.createShader(type)!
      gl!.shaderSource(shader, source)
      gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        const message = gl!.getShaderInfoLog(shader)
        gl!.deleteShader(shader)
        gl!.deleteProgram(p)
        throw new Error(message || 'Glass shader compilation failed')
      }
      gl!.attachShader(p, shader)
      gl!.deleteShader(shader)
    }
    gl!.bindAttribLocation(p, 0, 'position')
    gl!.linkProgram(p)
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
      gl!.deleteProgram(p)
      throw new Error('Glass shader linking failed')
    }
    programs.push(p)
    return p
  }
  let copyProgram: WebGLProgram
  let glassProgram: WebGLProgram
  try {
    copyProgram = program(copy)
    glassProgram = program(lensShader)
  }
  catch (error) {
    programs.forEach(p => gl.deleteProgram(p))
    gl.deleteTexture(scene)
    gl.deleteFramebuffer(framebuffer)
    gl.deleteBuffer(buffer)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    throw error
  }
  atlas.className = 'bew-glass-gpu-source'
  atlas.style.display = 'none'
  root.appendChild(atlas)
  // One GPU canvas serves every glass surface. Small 2D canvas tiles present
  // the output directly, without live CSS element-image snapshots.
  atlas.id = id
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)
  function uniform(p: WebGLProgram, name: string) {
    let locations = uniforms.get(p)
    if (!locations) {
      locations = new Map()
      uniforms.set(p, locations)
    }
    if (!locations.has(name))
      locations.set(name, gl!.getUniformLocation(p, name))
    return locations.get(name)!
  }
  function use(p: WebGLProgram) {
    gl!.useProgram(p)
    gl!.enableVertexAttribArray(0)
    gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0)
    gl!.uniform1i(uniform(p, 'image'), 0)
  }
  function texture(texture: WebGLTexture) {
    gl!.bindTexture(gl!.TEXTURE_2D, texture)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
  }
  function schedule() {
    if (!stopped && !failed && !frame && !doc.hidden)
      frame = requestAnimationFrame(render)
  }
  function invalidate() {
    captures.forEach(c => c.dirty = true)
    schedule()
  }
  function imageLoaded(event: Event) {
    const target = event.target
    if (!(target instanceof Element))
      return
    let changed = false
    const rect = target.getBoundingClientRect()
    for (const [element, c] of captures) {
      if (!element.contains(target))
        continue
      const origin = element.getBoundingClientRect()
      const left = c.area.left + origin.left - c.origin.left
      const top = c.area.top + origin.top - c.origin.top
      if (rect.right >= left && rect.left <= left + c.area.width && rect.bottom >= top && rect.top <= top + c.area.height) {
        c.dirty = true
        changed = true
      }
    }
    if (changed) {
      clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(schedule, 40)
    }
  }
  function capture(element: HTMLElement, rect: DOMRect, needed: GlassRect) {
    let cached = captures.get(element)
    const visible = { left: needed.left, top: needed.top, width: needed.width, height: needed.height }
    if (!visible.width || !visible.height)
      return null
    const shifted = cached && { left: cached.area.left + rect.left - cached.origin.left, top: cached.area.top + rect.top - cached.origin.top }
    if (cached && shifted && !cached.dirty && rect.width === cached.origin.width && rect.height === cached.origin.height
      && visible.left >= shifted.left && visible.top >= shifted.top
      && visible.left + visible.width <= shifted.left + cached.area.width
      && visible.top + visible.height <= shifted.top + cached.area.height) {
      return cached
    }
    // Capture only where a lens can see this source. On the home page the feed
    // intersects the short navigation bars, but never the Dock beside it.
    const area = glassCaptureRect({ left: rect.left - needed.left, right: rect.right - needed.left, top: rect.top - needed.top, bottom: rect.bottom - needed.top }, needed.width, needed.height)
    area.left += needed.left
    area.top += needed.top
    const scale = Math.min(1, limit / area.width, limit / area.height, Math.sqrt(3000000 / (area.width * area.height)))
    const plan = raster.measure(element, {
      width: area.width,
      height: area.height,
      scale,
      ignoreElements: (el) => {
        if (el.matches('.bew-liquid-glass, script, style, iframe, video'))
          return true
        const r = el.getBoundingClientRect()
        // Zero-sized ancestors may have absolutely positioned children.
        return r.width > 0 && r.height > 0 && (r.bottom < area.top || r.top > area.top + area.height || r.right < area.left || r.left > area.left + area.width)
      },
    })
    if (!plan)
      return null
    plan.base[4] -= (area.left - rect.left) * scale
    plan.base[5] -= (area.top - rect.top) * scale
    if (!cached) {
      cached = { texture: gl!.createTexture()!, canvas: doc.createElement('canvas'), origin: rect, area, dirty: true, revision: 0 }
      captures.set(element, cached)
    }
    raster.paint(plan, cached.canvas)
    texture(cached.texture)
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, cached.canvas)
    cached.origin = rect
    cached.area = area
    cached.dirty = false
    atlas.dataset.captures = String(++captureCount)
    const revision = ++cached.revision
    if (plan.assets.length) {
      const entry = cached
      void Promise.allSettled(plan.assets).then(() => {
        if (!stopped && captures.get(element) === entry && entry.revision === revision) {
          entry.dirty = true
          schedule()
        }
      })
    }
    return cached
  }
  function render() {
    cancelAnimationFrame(frame)
    frame = 0
    if (stopped || failed || doc.hidden || !lenses.size)
      return
    try {
      if (sourcesDirty) {
        sources = collectGlassSources(root)
        sourcesDirty = false
      }
      const measurements = createGlassMeasurements()
      for (const [element, c] of captures) {
        const r = measurements.rect(element)
        if (!sources.includes(element) || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
          gl!.deleteTexture(c.texture)
          captures.delete(element)
        }
      }
      const visible = [...lenses].filter(l => measurements.clip(l.element).width > 0 && measurements.clip(l.element).height > 0 && measurements.rect(l.element).width > 0.5 && measurements.rect(l.element).height > 0.5)
      if (!visible.length)
        return
      const geometry = visible.map(l => measurements.rect(l.element))
      const regions = visible.flatMap((l, index) => glassRimTiles(geometry[index].width, geometry[index].height).map((tile, tileIndex) => ({ l, index, tile, tileIndex }))).sort((a, b) => b.tile.height - a.tile.height || b.tile.width - a.tile.width)
      const layout = packGlassAtlas(regions.map(r => r.tile), limit)
      const aw = Math.max(1, Math.floor(layout.width * layout.scale))
      const ah = Math.max(1, Math.floor(layout.height * layout.scale))
      if (atlas.width !== aw)
        atlas.width = aw
      if (atlas.height !== ah)
        atlas.height = ah
      const sceneScale = Math.min(1, limit / innerWidth, limit / innerHeight, Math.sqrt(3000000 / (innerWidth * innerHeight)))
      const sw = Math.max(1, Math.floor(innerWidth * sceneScale))
      const sh = Math.max(1, Math.floor(innerHeight * sceneScale))
      texture(scene)
      if (sw !== sceneWidth || sh !== sceneHeight) {
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, sw, sh, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
        sceneWidth = sw
        sceneHeight = sh
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer)
        gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, scene, 0)
        if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE)
          throw new Error('Glass framebuffer is incomplete')
      }
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer)
      gl!.disable(gl!.SCISSOR_TEST)
      const color = getComputedStyle(visible[0].element).getPropertyValue('--bew-bg').trim() || '#fff'
      if (color !== lastBackground) {
        const pixel = doc.createElement('canvas')
        pixel.width = pixel.height = 1
        const ctx = pixel.getContext('2d')!
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        background = Array.from(ctx.getImageData(0, 0, 1, 1).data, c => c / 255)
        lastBackground = color
      }
      gl!.clearColor(...background as [number, number, number, number])
      gl!.clear(gl!.COLOR_BUFFER_BIT)
      gl!.enable(gl!.BLEND)
      gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA)
      use(copyProgram)
      let pixels = 0
      for (const element of sources) {
        const rect = measurements.rect(element)
        const clip = measurements.clip(element)
        if (clip.width <= 0 || clip.height <= 0)
          continue
        const intersections = geometry.map(g => ({ left: Math.max(0, rect.left, clip.left, g.left), top: Math.max(0, rect.top, clip.top, g.top), right: Math.min(innerWidth, rect.right, clip.right, g.right), bottom: Math.min(innerHeight, rect.bottom, clip.bottom, g.bottom) })).filter(r => r.right > r.left && r.bottom > r.top)
        if (!intersections.length) {
          const old = captures.get(element)
          if (old) {
            gl!.deleteTexture(old.texture)
            captures.delete(element)
          }
          continue
        }
        const left = Math.min(...intersections.map(r => r.left))
        const top = Math.min(...intersections.map(r => r.top))
        const right = Math.max(...intersections.map(r => r.right))
        const bottom = Math.max(...intersections.map(r => r.bottom))
        const c = capture(element, rect, { left, top, right, bottom, width: right - left, height: bottom - top })
        if (!c)
          continue
        pixels += c.canvas.width * c.canvas.height
        if (pixels > 10000000)
          throw new Error('Glass texture budget exceeded')
        const x = c.area.left + rect.left - c.origin.left
        const y = c.area.top + rect.top - c.origin.top
        gl!.enable(gl!.SCISSOR_TEST)
        gl!.scissor(Math.max(0, Math.floor(clip.left * sceneScale)), Math.max(0, Math.floor((innerHeight - clip.bottom) * sceneScale)), Math.max(0, Math.ceil(clip.width * sceneScale)), Math.max(0, Math.ceil(clip.height * sceneScale)))
        gl!.viewport(Math.round(x * sceneScale), Math.round((innerHeight - y - c.area.height) * sceneScale), Math.round(c.area.width * sceneScale), Math.round(c.area.height * sceneScale))
        texture(c.texture)
        gl!.drawArrays(gl!.TRIANGLES, 0, 6)
      }
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
      gl!.disable(gl!.SCISSOR_TEST)
      gl!.disable(gl!.BLEND)
      gl!.clearColor(0, 0, 0, 0)
      gl!.clear(gl!.COLOR_BUFFER_BIT)
      use(glassProgram)
      texture(scene)
      gl!.uniform2f(uniform(glassProgram, 'screenSize'), innerWidth, innerHeight)
      regions.forEach(({ l, index, tile, tileIndex }, regionIndex) => {
        const rect = geometry[index]
        const slot = layout.slots[regionIndex]
        const options = l.options()
        const radius = Math.min(Number.parseFloat(getComputedStyle(l.element).borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2)
        gl!.viewport(Math.round(slot.x * layout.scale), Math.round((layout.height - slot.y - slot.height) * layout.scale), Math.round(slot.width * layout.scale), Math.round(slot.height * layout.scale))
        gl!.uniform4f(uniform(glassProgram, 'lens'), rect.left, rect.top, rect.width, rect.height)
        gl!.uniform4f(uniform(glassProgram, 'tile'), tile.x, tile.y, tile.width, tile.height)
        gl!.uniform1f(uniform(glassProgram, 'radius'), radius)
        gl!.uniform1f(uniform(glassProgram, 'strength'), options.strength)
        gl!.uniform1f(uniform(glassProgram, 'frost'), Math.min(1, options.frost))
        gl!.uniform1f(uniform(glassProgram, 'dispersion'), options.reduced ? 0 : 0.035)
        gl!.drawArrays(gl!.TRIANGLES, 0, 6)
        let nodes = tiles.get(l)
        if (!nodes) {
          nodes = []
          tiles.set(l, nodes)
        }
        let node = nodes[tileIndex]
        if (!node) {
          node = doc.createElement('canvas')
          node.style.cssText = 'position:absolute;pointer-events:none;background-repeat:no-repeat'
          l.layer.appendChild(node)
          nodes[tileIndex] = node
        }
        const styles = { left: `${tile.x}px`, top: `${tile.y}px`, width: `${tile.width}px`, height: `${tile.height}px`, backgroundSize: `${layout.width}px ${layout.height}px`, backgroundPosition: `${-slot.x}px ${-slot.y}px` }
        for (const [key, value] of Object.entries(styles)) {
          const name = key as keyof typeof styles
          if (node.style[name] !== value)
            node.style[name] = value
        }
      })
      for (const l of visible) {
        const count = regions.filter(r => r.l === l).length
        const nodes = tiles.get(l)!
        nodes.splice(count).forEach(n => n.remove())
        l.ready(true)
      }
      gl!.flush()
      // Finish all GPU draws before presenting any tile, so the browser can
      // reuse the same completed canvas snapshot for the whole frame.
      regions.forEach(({ l, tile, tileIndex }, index) => {
        const output = tiles.get(l)![tileIndex] as HTMLCanvasElement
        const slot = layout.slots[index]
        const width = Math.ceil(tile.width)
        const height = Math.ceil(tile.height)
        if (output.width !== width)
          output.width = width
        if (output.height !== height)
          output.height = height
        const ctx = output.getContext('2d')!
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(atlas, slot.x * layout.scale, slot.y * layout.scale, slot.width * layout.scale, slot.height * layout.scale, 0, 0, width, height)
      })
      if (!checkedGPU) {
        checkedGPU = true
        if (gl!.getError() !== gl!.NO_ERROR)
          throw new Error('Glass GPU rendering failed')
      }
      if (gl!.isContextLost())
        throw new Error('Glass WebGL context lost')
      if (performance.now() < transitionUntil)
        schedule()
    }
    catch (error) {
      failed = true
      console.warn('BewlyBewly WebGL glass unavailable; using the compatible renderer.', error)
      for (const l of lenses)
        l.failed(error instanceof Error ? error.message : String(error))
    }
  }
  const mutations = new MutationObserver((records) => {
    const relevant = records.filter(r => !(r.target instanceof Element && r.target.closest('.bew-liquid-glass')))
    if (!relevant.length)
      return
    if (relevant.some(r => r.type === 'childList'))
      sourcesDirty = true
    for (const [element, c] of captures) {
      if (relevant.some(r => (root instanceof ShadowRoot && r.target === root.host) || element.contains(r.target) || (r.target instanceof Element && r.target.contains(element)))) {
        c.dirty = true
      }
    }
    // Batch asynchronously loaded thumbnails and hover styles into one capture.
    clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(schedule, 40)
  })
  mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'class', 'style'] })
  if (root instanceof ShadowRoot)
    mutations.observe(root.host, { attributes: true, attributeFilter: ['class', 'style'] })
  if (root instanceof ShadowRoot && !root.querySelector('[data-glass-scene]'))
    mutations.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'class', 'style'] })
  const resize = new ResizeObserver(schedule)
  const stopScroll = observeGlassScroll(root, render)
  function transition(event: Event) {
    if (event.target instanceof Element && [...lenses].some(l => (event.target as Element).contains(l.element))) {
      transitionUntil = performance.now() + 600
      schedule()
    }
  }
  function lose(event: Event) {
    event.preventDefault()
    failed = true
    for (const l of lenses)
      l.failed('WebGL context lost')
  }
  atlas.addEventListener('webglcontextlost', lose)
  root.addEventListener('transitionrun', transition, true)
  root.addEventListener('transitionend', schedule, true)
  root.addEventListener('load', imageLoaded, true)
  doc.addEventListener('load', imageLoaded, true)
  doc.fonts?.addEventListener('loadingdone', invalidate)
  window.addEventListener('resize', invalidate, { passive: true })
  doc.addEventListener('visibilitychange', invalidate)
  return {
    add(l: Lens) {
      lenses.add(l)
      resize.observe(l.element)
      schedule()
      return {
        update: schedule,
        dispose() {
          lenses.delete(l)
          tiles.get(l)?.forEach(n => n.remove())
          tiles.delete(l)
          resize.unobserve(l.element)
          l.layer.style.backgroundImage = ''
          l.ready(false)
          if (lenses.size) {
            schedule()
            return
          }
          stopped = true
          cancelAnimationFrame(frame)
          clearTimeout(refreshTimer)
          stopScroll()
          mutations.disconnect()
          resize.disconnect()
          root.removeEventListener('transitionrun', transition, true)
          root.removeEventListener('transitionend', schedule, true)
          root.removeEventListener('load', imageLoaded, true)
          doc.removeEventListener('load', imageLoaded, true)
          doc.fonts?.removeEventListener('loadingdone', invalidate)
          window.removeEventListener('resize', invalidate)
          doc.removeEventListener('visibilitychange', invalidate)
          atlas.removeEventListener('webglcontextlost', lose)
          atlas.remove()
          captures.forEach(c => gl!.deleteTexture(c.texture))
          captures.clear()
          gl!.deleteTexture(scene)
          gl!.deleteFramebuffer(framebuffer)
          gl!.deleteBuffer(buffer)
          programs.forEach(p => gl!.deleteProgram(p))
          gl!.getExtension('WEBGL_lose_context')?.loseContext()
          engines.delete(root)
        },
      }
    },
  }
}

export function observeFirefoxWebGL(lens: Lens) {
  const root = lens.element.getRootNode() as Document | ShadowRoot
  let engine = engines.get(root)
  try {
    if (!engine) {
      engine = createEngine(root)
      engines.set(root, engine)
    }
    return engine.add(lens)
  }
  catch (error) {
    lens.failed(error instanceof Error ? error.message : String(error))
    return { update() {}, dispose() {} }
  }
}

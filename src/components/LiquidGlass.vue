<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'

import { settings } from '~/logic'
import type { GlassSceneLayer } from '~/utils/firefoxGlass'
import { observeFirefoxGlass, supportsFirefoxGlass } from '~/utils/firefoxGlass'
import { createFirefoxGlassFilter, type GlassOffsetGroup, supportsFirefoxBackdrop } from '~/utils/firefoxGlassFilter'
import { glassLensDataUrl } from '~/utils/glassLens'
import { createGlassSceneRenderer } from '~/utils/glassSceneRenderer'

const props = withDefaults(defineProps<{
  disabled?: boolean
  reduced?: boolean
  strength?: number
  frost?: number
}>(), { strength: 28, frost: 0.25 })

const surface = ref<HTMLElement>()
const size = ref({ width: 0, height: 0 })
const mapUrl = ref<string>()
const mode = ref<'svg' | 'firefox-native' | 'firefox' | 'fallback'>('fallback')
const active = ref(true)
const sceneLayers = shallowRef<GlassSceneLayer[]>([])
const offsetGroups = shallowRef<GlassOffsetGroup[]>([])
const sceneRenderer = createGlassSceneRenderer(layers => sceneLayers.value = layers)
const reduceTransparency = ref(false)
const reduceMotion = ref(false)
const id = `bew-lens-${Math.random().toString(36).slice(2)}`
const enabled = computed(() => active.value && mode.value !== 'fallback' && !props.disabled && !reduceTransparency.value)
const refracting = computed(() => enabled.value && (mode.value === 'firefox-native'
  ? offsetGroups.value.length > 0
  : !!mapUrl.value && (mode.value !== 'firefox' || sceneLayers.value.length > 0)))
const strength = computed(() => props.reduced ? props.strength * 0.5 : props.strength)
let resizeObserver: ResizeObserver | undefined
let parent: HTMLElement | null = null
let resizeFrame = 0
let pointerFrame = 0
let pointerX = 50
let pointerY = 0
const cleanups: (() => void)[] = []
let stopScene: (() => void) | undefined

function updateMap() {
  resizeFrame = 0
  if (!surface.value || !enabled.value)
    return
  const width = surface.value.clientWidth
  const height = surface.value.clientHeight
  if (!width || !height)
    return
  const css = getComputedStyle(surface.value)
  const parsedRadius = Number.parseFloat(css.borderTopLeftRadius)
  const radius = Number.isFinite(parsedRadius) ? parsedRadius : 24
  try {
    if (mode.value === 'firefox-native')
      offsetGroups.value = createFirefoxGlassFilter(width, height, radius)
    else
      mapUrl.value = glassLensDataUrl(width, height, radius, mode.value === 'firefox')
    size.value = { width, height }
  }
  catch {
    // Canvas or SVG restrictions must leave a usable CSS surface.
    mode.value = 'fallback'
  }
}

function queueResize() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(updateMap)
}

function updateHighlight() {
  pointerFrame = 0
  surface.value?.style.setProperty('--lens-light-x', `${pointerX}%`)
  surface.value?.style.setProperty('--lens-light-y', `${pointerY}%`)
}

function onPointerMove(event: PointerEvent) {
  if (!refracting.value || reduceMotion.value || event.pointerType === 'touch' || !surface.value)
    return
  const rect = surface.value.getBoundingClientRect()
  pointerX = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100))
  pointerY = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100))
  if (!pointerFrame)
    pointerFrame = requestAnimationFrame(updateHighlight)
}

function resetHighlight() {
  pointerX = 50
  pointerY = 0
  cancelAnimationFrame(pointerFrame)
  updateHighlight()
}

watch([enabled, mode], ([value]) => {
  queueResize()
  stopScene?.()
  stopScene = undefined
  if (value && mode.value === 'firefox' && surface.value)
    stopScene = observeFirefoxGlass(surface.value, sceneRenderer.render)
}, { flush: 'post' })
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onMounted(() => {
  const nativeFirefox = supportsFirefoxBackdrop()
  const liveFirefox = supportsFirefoxGlass()
  if (nativeFirefox || liveFirefox) {
    cleanups.push(watch(() => settings.value.firefoxPreferScrollSync, (preferSync) => {
      mode.value = nativeFirefox && (preferSync || !liveFirefox) ? 'firefox-native' : 'firefox'
    }, { immediate: true }))
  }
  else if (/(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent) && !/(?:EdgiOS|CriOS)\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'url("#lens")')) {
    mode.value = 'svg'
  }

  for (const [query, state] of [
    ['(prefers-reduced-transparency: reduce)', reduceTransparency],
    ['(prefers-reduced-motion: reduce)', reduceMotion],
  ] as const) {
    const media = matchMedia(query)
    const update = () => {
      state.value = media.matches
      resetHighlight()
    }
    update()
    media.addEventListener('change', update)
    cleanups.push(() => media.removeEventListener('change', update))
  }
  parent = surface.value?.parentElement || null
  parent?.addEventListener('pointermove', onPointerMove, { passive: true })
  parent?.addEventListener('pointerleave', resetHighlight, { passive: true })
  resizeObserver = new ResizeObserver(queueResize)
  if (surface.value)
    resizeObserver.observe(surface.value)
  queueResize()
})

onBeforeUnmount(() => {
  stopScene?.()
  resizeObserver?.disconnect()
  cancelAnimationFrame(resizeFrame)
  cancelAnimationFrame(pointerFrame)
  parent?.removeEventListener('pointermove', onPointerMove)
  parent?.removeEventListener('pointerleave', resetHighlight)
  cleanups.forEach(cleanup => cleanup())
})
</script>

<template>
  <div
    ref="surface"
    class="bew-liquid-glass"
    :class="{ 'is-refracting': refracting, 'is-firefox': refracting && mode === 'firefox', 'is-opaque': disabled || reduceTransparency }"
    :data-refraction="refracting ? mode : 'fallback'"
    :style="{ '--lens-filter': refracting ? `url(#${id})${mode === 'firefox-native' ? '' : mode === 'firefox' ? ' saturate(1.08)' : ' saturate(1.2)'}` : undefined }"
    aria-hidden="true"
  >
    <svg v-if="refracting" class="lens-definitions" width="0" height="0" focusable="false">
      <defs>
        <filter
          :id="id" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB"
          x="0" y="0" :width="size.width" :height="size.height"
        >
          <feGaussianBlur
            in="SourceGraphic" :stdDeviation="reduced ? frost / 2 : frost" result="scene" x="0" y="0"
            :width="size.width" :height="size.height"
          />
          <template v-if="mode === 'firefox-native'">
            <template v-for="(group, index) in offsetGroups" :key="index">
              <feOffset
                v-for="(patch, patchIndex) in group.patches" :key="patchIndex"
                in="scene" :dx="patch.dx * strength" :dy="patch.dy * strength"
                :x="patch.x" :y="patch.y" :width="patch.width" :height="patch.height"
                :result="`patch-${index}-${patchIndex}`"
              />
              <feMerge :x="group.x" :y="group.y" :width="group.width" :height="group.height" :result="`edge-${index}`">
                <feMergeNode v-for="(_, patchIndex) in group.patches" :key="patchIndex" :in="`patch-${index}-${patchIndex}`" />
              </feMerge>
            </template>
            <feMerge x="0" y="0" :width="size.width" :height="size.height">
              <feMergeNode in="scene" />
              <feMergeNode v-for="(_, index) in offsetGroups" :key="index" :in="`edge-${index}`" />
            </feMerge>
          </template>
          <template v-else>
            <feImage
              :href="mapUrl" x="0" y="0" :width="size.width" :height="size.height"
              preserveAspectRatio="none" result="lens"
            />
            <feDisplacementMap
              v-if="mode === 'firefox' && reduced"
              in="scene" in2="lens" :scale="strength" xChannelSelector="R" yChannelSelector="G"
              result="refracted"
            />
            <template v-else>
              <feDisplacementMap
                in="scene" in2="lens" :scale="strength * 1.04" xChannelSelector="R" yChannelSelector="G"
                result="red"
              />
              <feColorMatrix in="red" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
              <feDisplacementMap
                in="scene" in2="lens" :scale="strength" xChannelSelector="R" yChannelSelector="G"
                result="green"
              />
              <feColorMatrix in="green" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
              <feDisplacementMap
                in="scene" in2="lens" :scale="strength * 0.96" xChannelSelector="R" yChannelSelector="G"
                result="blue"
              />
              <feColorMatrix in="blue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
              <feBlend in="r" in2="g" mode="screen" result="rg" />
              <feBlend in="rg" in2="b" mode="screen" result="refracted" />
            </template>
            <template v-if="mode === 'firefox'">
              <feColorMatrix
                in="lens" type="matrix" result="specular"
                values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5019607843137255"
              />
              <feComposite in="refracted" in2="specular" operator="arithmetic" k2="1" k3="1" />
            </template>
          </template>
        </filter>
      </defs>
    </svg>
    <span v-if="refracting && mode === 'firefox'" class="lens-scene-clip">
      <span class="lens-scene">
        <span
          v-for="layer in sceneLayers" :key="layer.id"
          :ref="element => sceneRenderer.bind(layer.id, element as HTMLElement | null)"
          class="lens-source"
        />
      </span>
    </span>
    <span class="lens-backdrop" />
    <span class="lens-rim" />
  </div>
</template>

<style lang="scss" scoped>
.bew-liquid-glass {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: var(--bew-shadow-2);

  .lens-definitions {
    position: absolute;
    pointer-events: none;
  }

  .lens-backdrop,
  .lens-rim,
  .lens-scene-clip,
  .lens-scene,
  .lens-source {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }

  .lens-scene-clip {
    overflow: hidden;
  }

  .lens-scene {
    background: var(--bew-bg);
    filter: var(--lens-filter);
    border-radius: 0;
  }

  .lens-source {
    background-repeat: no-repeat;
    border-radius: 0;
  }

  .lens-backdrop {
    background: var(--bew-content);
    -webkit-backdrop-filter: var(--bew-filter-glass-1);
    backdrop-filter: var(--bew-filter-glass-1);
  }

  .lens-rim {
    border: 1px solid var(--bew-glass-border);
    box-shadow: var(--bew-shadow-edge-glow-1);
    background-image: var(--bew-glass-sheen);
  }

  &.is-refracting {
    .lens-backdrop {
      background: var(--bew-lens-tint);
      -webkit-backdrop-filter: var(--lens-filter);
      backdrop-filter: var(--lens-filter);
    }

    .lens-rim {
      background: radial-gradient(
        ellipse at var(--lens-light-x, 50%) var(--lens-light-y, 0%),
        rgb(255 255 255 / 24%),
        transparent 62%
      );
      box-shadow:
        var(--bew-shadow-edge-glow-1),
        inset 0 -5px 12px -9px rgb(0 0 0 / 38%);
    }
  }

  &.is-opaque {
    .lens-backdrop {
      background: var(--bew-content-solid);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }

    .lens-rim {
      background: none;
      border-color: var(--bew-border-color);
      box-shadow: none;
    }
  }

  &.is-firefox {
    .lens-backdrop {
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }

    .lens-rim {
      background: radial-gradient(
        ellipse at var(--lens-light-x, 50%) var(--lens-light-y, 0%),
        rgb(255 255 255 / 12%),
        transparent 62%
      );
    }
  }
}
</style>

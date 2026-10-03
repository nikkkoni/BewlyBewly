interface RasterPlan {
  base: number[]
  assets: Promise<void>[]
}
export function createGlassRasterizer(): {
  measure: (element: HTMLElement, options: { width: number, height: number, scale: number, ignoreElements: (element: Element) => boolean }) => RasterPlan | null
  paint: (plan: RasterPlan, canvas: HTMLCanvasElement) => HTMLCanvasElement
}

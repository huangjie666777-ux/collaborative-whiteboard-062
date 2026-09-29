import type { Point, ViewTransform } from '../shared/types'

export const MIN_SCALE = 0.2
export const MAX_SCALE = 4

export function screenToWorld(p: Point, view: ViewTransform): Point {
  return {
    x: (p.x - view.x) / view.scale,
    y: (p.y - view.y) / view.scale
  }
}

export function worldToScreen(p: Point, view: ViewTransform): Point {
  return {
    x: p.x * view.scale + view.x,
    y: p.y * view.scale + view.y
  }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** 以光标为锚点缩放，保证缩放前后光标的世界坐标不变 */
export function zoomAt(anchor: Point, view: ViewTransform, factor: number): ViewTransform {
  const scale = clampScale(view.scale * factor)
  const realFactor = scale / view.scale
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * realFactor,
    y: anchor.y - (anchor.y - view.y) * realFactor
  }
}

export function svgTransform(view: ViewTransform): string {
  return `translate(${view.x} ${view.y}) scale(${view.scale})`
}

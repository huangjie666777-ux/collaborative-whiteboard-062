import type { Point, RectObject, NoteObject, PenObject, WhiteboardObject } from '../shared/types'

function pointInRect(x: number, y: number, ox: number, oy: number, w: number, h: number, pad = 0): boolean {
  const minX = Math.min(ox, ox + w) - pad
  const maxX = Math.max(ox, ox + w) + pad
  const minY = Math.min(oy, oy + h) - pad
  const maxY = Math.max(oy, oy + h) + pad
  return x >= minX && x <= maxX && y >= minY && y <= maxY
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function hitPen(obj: PenObject, p: Point, tolerance: number): boolean {
  const pts = obj.points
  if (pts.length === 0) return false
  const reach = tolerance + obj.width / 2
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(p, pts[i - 1], pts[i]) <= reach) return true
  }
  return distToSegment(p, pts[0], pts[0]) <= reach
}

export function hitObject(obj: WhiteboardObject, worldPoint: Point, viewScale: number): boolean {
  // 屏幕像素容差换算到世界坐标
  const tolerance = 6 / viewScale
  if (obj.type === 'pen') return hitPen(obj, worldPoint, tolerance)
  const box = obj as RectObject | NoteObject
  return pointInRect(worldPoint.x, worldPoint.y, box.x, box.y, box.w, box.h, obj.type === 'note' ? 0 : tolerance)
}

/** 从图层顶层向下命中（list 已按图层顺序排序，故倒序查找） */
export function hitTest(objects: WhiteboardObject[], worldPoint: Point, viewScale: number): WhiteboardObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitObject(objects[i], worldPoint, viewScale)) return objects[i]
  }
  return null
}

import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import type {
  NoteObject,
  PenObject,
  Point,
  RectObject,
  ShapeType,
  WhiteboardObject
} from './types'

export const LOCAL_ORIGIN = Symbol('whiteboard-local-origin')
export type LocalOrigin = typeof LOCAL_ORIGIN

const PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#0d9488', '#ea580c']

function readPrimitive(map: Y.Map<unknown>, key: string): unknown {
  return map.get(key)
}

function readPoints(map: Y.Map<unknown>): Point[] {
  const raw = map.get('points')
  if (raw instanceof Y.Array) {
    return (raw.toJSON() as Array<{ x: number; y: number }>).map((p) => ({ x: p.x, y: p.y }))
  }
  return []
}

function readText(map: Y.Map<unknown>): string {
  const raw = map.get('text')
  if (raw instanceof Y.Text) return raw.toString()
  return typeof raw === 'string' ? raw : ''
}

/** 将一个对象 Y.Map 快照为普通 JS 对象（包含已删除/墓碑对象） */
export function snapshotObject(map: Y.Map<unknown>): WhiteboardObject | null {
  const id = String(readPrimitive(map, 'id') ?? '')
  const type = readPrimitive(map, 'type') as ShapeType
  if (!id || (type !== 'pen' && type !== 'rect' && type !== 'note')) return null
  const base = {
    id,
    type,
    color: String(readPrimitive(map, 'color') ?? '#3b82f6'),
    deleted: Boolean(readPrimitive(map, 'deleted') ?? false),
    seq: Number(readPrimitive(map, 'seq') ?? 0),
    x: Number(readPrimitive(map, 'x') ?? 0),
    y: Number(readPrimitive(map, 'y') ?? 0)
  }
  if (type === 'pen') {
    return { ...base, points: readPoints(map), width: Number(readPrimitive(map, 'width') ?? 3) } satisfies PenObject
  }
  if (type === 'rect') {
    return { ...base, w: Number(readPrimitive(map, 'w') ?? 0), h: Number(readPrimitive(map, 'h') ?? 0) } satisfies RectObject
  }
  return {
    ...base,
    w: Number(readPrimitive(map, 'w') ?? 160),
    h: Number(readPrimitive(map, 'h') ?? 120),
    text: readText(map)
  } satisfies NoteObject
}

export interface RemoteChange {
  /** 被远端改动触及的对象 id */
  ids: Set<string>
}

/**
 * 白板共享文档封装。
 *
 * 数据结构：根 Y.Map('objects'): id -> Y.Map(属性)
 *  - 不同属性天然合并（Y.Map 各 key 独立 LWW）
 *  - 同一属性冲突由 Yjs 逻辑时钟保证所有端一致收敛
 *  - 便签正文使用 Y.Text，支持并发文字合并
 *  - 删除仅置 deleted=true（墓碑），迟到移动不会复活
 */
export class WhiteboardDoc {
  readonly doc: Y.Doc
  readonly objects: Y.Map<Y.Map<unknown>>
  private nextSeq = 1
  private readonly remoteListeners = new Set<(change: RemoteChange) => void>()
  private readonly updateListeners = new Set<() => void>()

  constructor(doc = new Y.Doc()) {
    this.doc = doc
    this.objects = doc.getMap<Y.Map<unknown>>('objects')
    this.objects.observeDeep((events, transaction) => {
      const isLocal = transaction.origin === LOCAL_ORIGIN
      if (!isLocal) {
        const ids = new Set<string>()
        for (const ev of events) {
          const target = ev.target
          if (target instanceof Y.Map && target.has('id')) {
            ids.add(String(target.get('id')))
          } else if (target === this.objects) {
            for (const key of ev.keys.keys()) {
              // 顶层对象被增删
              if (this.objects.has(key)) ids.add(key)
              else ids.add(key) // 删除也通知，方便版本推进
            }
            for (const [key] of ev.changes.keys) ids.add(key)
          }
        }
        if (ids.size > 0) this.remoteListeners.forEach((fn) => fn({ ids }))
      }
      this.updateListeners.forEach((fn) => fn())
    })
  }

  onUpdate(fn: () => void): () => void {
    this.updateListeners.add(fn)
    return () => this.updateListeners.delete(fn)
  }

  /** 仅非本人来源的变更（用于推进对象版本） */
  onRemoteChange(fn: (change: RemoteChange) => void): () => void {
    this.remoteListeners.add(fn)
    return () => this.remoteListeners.delete(fn)
  }

  isAlive(id: string): boolean {
    const map = this.objects.get(id)
    return map !== undefined && map.get('deleted') !== true
  }

  get(id: string): WhiteboardObject | null {
    const map = this.objects.get(id)
    return map ? snapshotObject(map) : null
  }

  /** 读取任意对象，含墓碑对象；不存在返回 null */
  readAny(id: string): WhiteboardObject | null {
    const map = this.objects.get(id)
    return map ? snapshotObject(map) : null
  }

  /** 全部未删除对象，图层顺序在所有端一致（seq 升序，平局按 id） */
  list(): WhiteboardObject[] {
    const result: WhiteboardObject[] = []
    for (const map of this.objects.values()) {
      const obj = snapshotObject(map)
      if (obj !== null && !obj.deleted) result.push(obj)
    }
    result.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return result
  }

  private allocSeq(): number {
    let max = 0
    for (const map of this.objects.values()) {
      const s = Number(map.get('seq') ?? 0)
      if (s > max) max = s
    }
    this.nextSeq = max + 1
    return this.nextSeq
  }

  private createMap(type: ShapeType, id: string, x: number, y: number, color: string): Y.Map<unknown> {
    const map = new Y.Map<unknown>()
    map.set('id', id)
    map.set('type', type)
    map.set('color', color)
    map.set('deleted', false)
    map.set('seq', this.allocSeq())
    map.set('x', x)
    map.set('y', y)
    return map
  }

  /** 在一个本地事务中执行写入，origin 标记用于区分本人/远端 */
  localTransact(fn: () => void): void {
    this.doc.transact(fn, LOCAL_ORIGIN)
  }

  createRect(x: number, y: number, w: number, h: number, color: string, id = nanoid(10)): RectObject {
    this.localTransact(() => {
      const map = this.createMap('rect', id, x, y, color)
      map.set('w', Math.max(1, w))
      map.set('h', Math.max(1, h))
      this.objects.set(id, map)
    })
    return this.get(id) as RectObject
  }

  createNote(x: number, y: number, color: string, text = '', id = nanoid(10)): NoteObject {
    this.localTransact(() => {
      const map = this.createMap('note', id, x, y, color)
      map.set('w', 160)
      map.set('h', 120)
      map.set('text', new Y.Text(text))
      this.objects.set(id, map)
    })
    return this.get(id) as NoteObject
  }

  beginPen(x: number, y: number, color: string, width = 3, id = nanoid(10)): PenObject {
    this.localTransact(() => {
      const map = this.createMap('pen', id, x, y, color)
      const points = new Y.Array<unknown>()
      points.push([{ x, y }])
      map.set('points', points)
      map.set('width', width)
      this.objects.set(id, map)
    })
    return this.get(id) as PenObject
  }

  appendPenPoint(id: string, p: Point): void {
    if (!this.isAlive(id)) return
    this.localTransact(() => {
      const map = this.objects.get(id)
      const points = map?.get('points')
      if (map && points instanceof Y.Array && map.get('deleted') !== true) {
        const last = points.get(points.length - 1) as Point | undefined
        if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) {
          points.push([p])
        }
      }
    })
  }

  /** 移动对象（墓碑对象忽略，拒绝复活） */
  move(id: string, x: number, y: number): void {
    if (!this.isAlive(id)) return
    this.localTransact(() => {
      const map = this.objects.get(id)
      if (map && map.get('deleted') !== true) {
        map.set('x', Math.round(x * 100) / 100)
        map.set('y', Math.round(y * 100) / 100)
      }
    })
  }

  setColor(id: string, color: string): void {
    if (!this.isAlive(id)) return
    this.localTransact(() => {
      const map = this.objects.get(id)
      if (map && map.get('deleted') !== true) map.set('color', color)
    })
  }

  delete(id: string): void {
    this.localTransact(() => {
      const map = this.objects.get(id)
      if (map && map.get('deleted') !== true) map.set('deleted', true)
    })
  }

  setNoteText(id: string, text: string): void {
    if (!this.isAlive(id)) return
    this.localTransact(() => {
      const map = this.objects.get(id)
      const ytext = map?.get('text')
      if (map && ytext instanceof Y.Text && map.get('deleted') !== true) {
        ytext.delete(0, ytext.length)
        ytext.insert(0, text)
      }
    })
  }

  /** 供撤销/重做以整值覆盖单个属性（Y.Text 单独处理） */
 restoreProperty(id: string, key: string, value: unknown): void {
    this.localTransact(() => {
      const map = this.objects.get(id)
      if (!map) return
      if (key === 'text') {
        const ytext = map.get('text')
        if (ytext instanceof Y.Text) {
          ytext.delete(0, ytext.length)
          ytext.insert(0, String(value ?? ''))
        }
        return
      }
      if (key === 'points') {
        const points = map.get('points')
        if (points instanceof Y.Array) {
          points.delete(0, points.length)
          points.push(value as unknown[])
        }
        return
      }
      map.set(key, value as never)
    })
  }

  /** 撤销删除时重建对象（保留同一身份 id） */
  recreate(id: string, snapshot: Record<string, unknown>): void {
    this.localTransact(() => {
      if (this.objects.has(id)) {
        const map = this.objects.get(id)!
        map.set('deleted', false)
        return
      }
      const map = new Y.Map<unknown>()
      for (const [key, value] of Object.entries(snapshot)) {
        if (key === 'points') {
          const arr = new Y.Array<unknown>()
          arr.push(value as unknown[])
          map.set(key, arr)
        } else if (key === 'text') {
          map.set(key, new Y.Text(String(value ?? '')))
        } else {
          map.set(key, value as never)
        }
      }
      this.objects.set(id, map)
    })
  }
}

let colorIndex = 0
export function nextUserColor(): string {
  const color = PALETTE[colorIndex % PALETTE.length]
  colorIndex += 1
  return color
}

export { PALETTE }

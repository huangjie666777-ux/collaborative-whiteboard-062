import type { Y } from 'yjs'
import type { WhiteboardDoc } from '../shared/whiteboard'
import type { WhiteboardObject } from '../shared/types'

export interface ObjectSnapshot {
  id: string
  /** 操作前整个对象（含墓碑），null 表示对象不存在 */
  before: WhiteboardObject | null
  /** 操作后整个对象（含墓碑），null 表示被删除且不存在 */
  after: WhiteboardObject | null
}

export interface HistoryEntry {
  label: string
  changes: ObjectSnapshot[]
  /** 做此操作时这些对象的远端版本；回滚时据此判断是否被他人改动 */
  baseVersions: Record<string, number>
  /** 重做前校验基线 */
  redoVersions?: Record<string, number>
}

export interface SkipNotice {
  action: 'undo' | 'redo'
  label: string
  skippedIds: string[]
}

const TRACKED_KEYS = ['x', 'y', 'w', 'h', 'color', 'deleted', 'points', 'text', 'width'] as const

export class UndoHistory {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private remoteVersion = new Map<string, number>()
  private captured: { before: Map<string, WhiteboardObject | null>; label: string } | null = null
  private readonly skipListeners = new Set<(notice: SkipNotice) => void>()
  private readonly changeListeners = new Set<() => void>()

  constructor(private readonly board: WhiteboardDoc) {
    board.onRemoteChange(({ ids }) => {
      for (const id of ids) {
        this.remoteVersion.set(id, (this.remoteVersion.get(id) ?? 0) + 1)
      }
      this.changeListeners.forEach((fn) => fn())
    })
  }

  onSkip(fn: (notice: SkipNotice) => void): () => void {
    this.skipListeners.add(fn)
    return () => this.skipListeners.delete(fn)
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn)
    return () => this.changeListeners.delete(fn)
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get undoLabels(): string[] {
    return this.undoStack.map((e) => e.label)
  }

  private snapshotIds(ids: string[]): Map<string, WhiteboardObject | null> {
    const map = new Map<string, WhiteboardObject | null>()
    for (const id of new Set(ids)) map.set(id, this.board.readAny(id))
    return map
  }

  /** 开始一步本地操作（一次笔画、一次拖动、一次改色……） */
  begin(label: string, ids: string[]): void {
    this.captured = { label, before: this.snapshotIds(ids) }
  }

  /** 结束并提交一步操作 */
  commit(ids: string[]): void {
    if (this.captured === null) return
    const allIds = Array.from(new Set([...this.captured.before.keys(), ...ids]))
    const changes: ObjectSnapshot[] = []
    const baseVersions: Record<string, number> = {}
    let mutated = false
    for (const id of allIds) {
      const before = this.captured.before.get(id) ?? null
      const after = this.board.readAny(id)
      if (!this.shallowEqual(before, after)) mutated = true
      changes.push({ id, before, after })
      baseVersions[id] = this.remoteVersion.get(id) ?? 0
    }
    if (mutated) {
      this.undoStack.push({ label: this.captured.label, changes, baseVersions })
      // 本人新操作清空重做
      this.redoStack = []
      this.changeListeners.forEach((fn) => fn())
    }
    this.captured = null
  }

  /** 便捷封装：把一段本地操作作为一步记录 */
  run(label: string, ids: string[], fn: () => void): void {
    this.begin(label, ids)
    try {
      fn()
    } finally {
      this.commit(ids)
    }
  }

  private shallowEqual(a: WhiteboardObject | null, b: WhiteboardObject | null): boolean {
    if (a === b) return true
    if (!a || !b) return false
    for (const key of TRACKED_KEYS) {
      const va = (a as Record<string, unknown>)[key]
      const vb = (b as Record<string, unknown>)[key]
      if (key === 'points') {
        if (JSON.stringify(va) !== JSON.stringify(vb)) return false
      } else if (va !== vb) {
        return false
      }
    }
    return true
  }

  private dirtyIds(entry: HistoryEntry, versions: Record<string, number>): string[] {
    const dirty: string[] = []
    for (const [id, base] of Object.entries(versions)) {
      if ((this.remoteVersion.get(id) ?? 0) !== base) dirty.push(id)
    }
    return dirty
  }

  private applySnapshot(id: string, snap: WhiteboardObject | null): void {
    const current = this.board.objects.get(id)
    if (snap === null) {
      // 操作前不存在：撤销新增 -> 置墓碑；重做删除同理
      if (current) this.board.restoreProperty(id, 'deleted', true)
      return
    }
    if (!current) {
      // 重建（撤销删除），身份 id 不变
      this.board.recreate(id, snap as unknown as Record<string, unknown>)
      return
    }
    this.board.restoreProperty(id, 'deleted', snap.deleted)
    for (const key of TRACKED_KEYS) {
      const value = (snap as Record<string, unknown>)[key]
      this.board.restoreProperty(id, key, value)
    }
  }

  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false
    const dirty = this.dirtyIds(entry, entry.baseVersions)
    if (dirty.length > 0) {
      // 涉及对象此后已被远端修改：跳过该步并提示，不回滚他人改动
      this.skipListeners.forEach((fn) =>
        fn({ action: 'undo', label: entry.label, skippedIds: dirty })
      )
      this.changeListeners.forEach((fn) => fn())
      return false
    }
    const redoVersions: Record<string, number> = {}
    for (const id of Object.keys(entry.baseVersions)) {
      redoVersions[id] = this.remoteVersion.get(id) ?? 0
    }
    for (const change of entry.changes) {
      this.applySnapshot(change.id, change.before)
    }
    entry.redoVersions = redoVersions
    this.redoStack.push(entry)
    this.changeListeners.forEach((fn) => fn())
    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    const expected = entry.redoVersions ?? entry.baseVersions
    const dirty = this.dirtyIds(entry, expected)
    if (dirty.length > 0) {
      this.skipListeners.forEach((fn) =>
        fn({ action: 'redo', label: entry.label, skippedIds: dirty })
      )
      this.changeListeners.forEach((fn) => fn())
      return false
    }
    const undoVersions: Record<string, number> = {}
    for (const id of Object.keys(expected)) {
      undoVersions[id] = this.remoteVersion.get(id) ?? 0
    }
    for (const change of entry.changes) {
      this.applySnapshot(change.id, change.after)
    }
    entry.baseVersions = undoVersions
    entry.redoVersions = undefined
    this.undoStack.push(entry)
    this.changeListeners.forEach((fn) => fn())
    return true
  }

  /** 切换房间时清空本人历史与版本计数 */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.captured = null
    this.remoteVersion.clear()
    this.changeListeners.forEach((fn) => fn())
  }
}

export type { Y }

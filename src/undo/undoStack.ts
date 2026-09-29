import * as Y from 'yjs';
import { Whiteboard, deepEqual } from '../model/whiteboard';

export interface InverseOp {
  id: string;
  kind: 'add' | 'delete' | 'update';
  /** delete 撤销时需要恢复原位置 */
  index?: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface UndoEntry {
  label: string;
  ops: InverseOp[];
}

export interface UndoResult {
  ok: boolean;
  skipped: string[];
}

/**
 * 按“本人操作”分步的撤销/重做栈。
 * 远端更新永不入栈；本地新操作清空重做栈。
 * 撤销时若目标对象当前值与记录的 after 不一致（已被远端修改），跳过并返回提示。
 */
export class UndoStack {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private pending: InverseOp[] | null = null;

  constructor(private board: Whiteboard) {}

  /** 开始一个本地操作步骤（如一次笔画、一次拖动） */
  begin(): void {
    this.pending = [];
  }

  record(op: InverseOp): void {
    this.pending?.push(op);
  }

  /** 结束步骤并入栈；清空重做 */
  commit(label: string): void {
    if (this.pending && this.pending.length > 0) {
      this.undoStack.push({ label, ops: this.pending });
      this.redoStack = [];
    }
    this.pending = null;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  private snapshotOf(id: string): Record<string, unknown> | undefined {
    const m = this.board.get(id);
    return m ? (m.toJSON() as Record<string, unknown>) : undefined;
  }

  undo(): UndoResult {
    const entry = this.undoStack.pop();
    if (!entry) return { ok: false, skipped: [] };
    const skipped: string[] = [];
    const redoOps: InverseOp[] = [];
    for (const op of [...entry.ops].reverse()) {
      const cur = this.snapshotOf(op.id);
      if (op.kind === 'add') {
        // 撤销新增：若对象内容已被远端改动则跳过
        if (cur && op.after && !deepEqual(stripId(cur), stripId(op.after))) {
          skipped.push(op.id);
          continue;
        }
        this.board.deleteShape(op.id);
        redoOps.push(op);
      } else if (op.kind === 'delete') {
        if (cur) { skipped.push(op.id); continue; } // 已被他人重建/未删
        const props = { ...(op.before ?? {}) };
        const id = props.id as string;
        this.board.doc.transact(() => {
          const m = new Y.Map<unknown>();
          m.set('id', id);
          for (const [k, v] of Object.entries(props)) if (k !== 'id') m.set(k, v);
          const idx = Math.min(op.index ?? this.board.shapes.length, this.board.shapes.length);
          this.board.shapes.insert(idx, [m]);
        });
        redoOps.push(op);
      } else {
        // update：仅撤销仍与 after 一致的键；不一致说明远端已改，跳过该键并提示
        if (!cur) { skipped.push(op.id); continue; }
        const revert: Record<string, unknown> = {};
        const redoAfter: Record<string, unknown> = {};
        let anyKey = false, anySkip = false;
        for (const [k, afterV] of Object.entries(op.after ?? {})) {
          if (deepEqual(cur[k], afterV)) {
            revert[k] = (op.before ?? {})[k];
            redoAfter[k] = afterV;
            anyKey = true;
          } else {
            anySkip = true;
          }
        }
        if (anySkip) skipped.push(op.id);
        if (anyKey) {
          this.board.updateShape(op.id, revert);
          // redo 条目：before 为撤销后的值，after 为原目标值
          redoOps.push({ ...op, before: revert, after: redoAfter });
        }
      }
    }
    if (redoOps.length > 0) this.redoStack.push({ label: entry.label, ops: redoOps.reverse() });
    return { ok: true, skipped };
  }

  redo(): UndoResult {
    const entry = this.redoStack.pop();
    if (!entry) return { ok: false, skipped: [] };
    const skipped: string[] = [];
    const undoOps: InverseOp[] = [];
    for (const op of [...entry.ops].reverse()) {
      const cur = this.snapshotOf(op.id);
      if (op.kind === 'add') {
        if (cur) { skipped.push(op.id); continue; }
        const props = { ...(op.after ?? {}) };
        this.board.addShape(props);
        undoOps.push(op);
      } else if (op.kind === 'delete') {
        if (cur && op.before && !deepEqual(stripId(cur), stripId(op.before))) {
          skipped.push(op.id);
          continue;
        }
        this.board.deleteShape(op.id);
        undoOps.push(op);
      } else {
        if (!cur) { skipped.push(op.id); continue; }
        const apply: Record<string, unknown> = {};
        let anyKey = false, anySkip = false;
        for (const [k, beforeV] of Object.entries(op.before ?? {})) {
          if (deepEqual(cur[k], beforeV)) {
            apply[k] = (op.after ?? {})[k];
            anyKey = true;
          } else anySkip = true;
        }
        if (anySkip) skipped.push(op.id);
        if (anyKey) {
          this.board.updateShape(op.id, apply);
          undoOps.push(op);
        }
      }
    }
    if (undoOps.length > 0) this.undoStack.push({ label: entry.label, ops: undoOps.reverse() });
    return { ok: true, skipped };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }
}

function stripId(o: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = o;
  return rest;
}

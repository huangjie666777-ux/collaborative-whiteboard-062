import { describe, it, expect } from 'vitest';
import { Whiteboard } from '../src/model/whiteboard';
import { UndoStack } from '../src/undo/undoStack';

function setup() {
  const board = new Whiteboard();
  const undo = new UndoStack(board);
  return { board, undo };
}

describe('UndoStack 本地分步撤销', () => {
  it('一次拖动算一步，撤销后重做恢复', () => {
    const { board, undo } = setup();
    const id = board.addShape({ type: 'rect', x: 0, y: 0, w: 5, h: 5, color: 'red' });
    undo.begin();
    undo.record({ id, kind: 'add', after: board.get(id)!.toJSON() as Record<string, unknown> });
    undo.commit('新增');
    // 拖动：多次 update 只记一条
    board.updateShape(id, { x: 10 });
    board.updateShape(id, { x: 20 });
    undo.begin();
    undo.record({ id, kind: 'update', before: { x: 0 }, after: { x: 20 } });
    undo.commit('移动');
    expect(undo.undo().ok).toBe(true);
    expect(board.get(id)!.get('x')).toBe(0);
    expect(undo.redo().ok).toBe(true);
    expect(board.get(id)!.get('x')).toBe(20);
  });

  it('撤销新增会删除对象；撤销删除会原位恢复', () => {
    const { board, undo } = setup();
    const id = board.addShape({ type: 'note', x: 1, y: 2, w: 3, h: 4, text: 'a' });
    undo.begin();
    undo.record({ id, kind: 'add', after: board.get(id)!.toJSON() as Record<string, unknown> });
    undo.commit('新增');
    undo.undo();
    expect(board.get(id)).toBeUndefined();
    undo.redo();
    expect(board.get(id)!.get('text')).toBe('a');
    // 删除再撤销
    const before = board.get(id)!.toJSON() as Record<string, unknown>;
    board.deleteShape(id);
    undo.begin();
    undo.record({ id, kind: 'delete', index: 0, before });
    undo.commit('删除');
    undo.undo();
    expect(board.get(id)!.get('text')).toBe('a');
  });

  it('对象被远端修改后撤销跳过并提示', () => {
    const { board, undo } = setup();
    const id = board.addShape({ type: 'rect', x: 0, y: 0, w: 5, h: 5, color: 'red' });
    undo.begin();
    undo.record({ id, kind: 'update', before: { color: 'red' }, after: { color: 'blue' } });
    undo.commit('改色');
    board.updateShape(id, { color: 'blue' });
    // 远端把颜色改成 green
    board.updateShape(id, { color: 'green' }, 'remote');
    const r = undo.undo();
    expect(r.skipped).toContain(id);
    expect(board.get(id)!.get('color')).toBe('green'); // 未回滚远端改动
  });

  it('本地新操作清空重做栈', () => {
    const { board, undo } = setup();
    const id = board.addShape({ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'red' });
    undo.begin();
    undo.record({ id, kind: 'update', before: { x: 0 }, after: { x: 5 } });
    undo.commit('移动');
    board.updateShape(id, { x: 5 });
    undo.undo();
    expect(undo.canRedo).toBe(true);
    undo.begin();
    undo.record({ id, kind: 'update', before: { x: 0 }, after: { x: 9 } });
    undo.commit('移动2');
    expect(undo.canRedo).toBe(false);
  });
});

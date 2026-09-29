import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Whiteboard } from '../src/model/whiteboard';

function sync(a: Whiteboard, b: Whiteboard) {
  const ua = Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc));
  const ub = Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc));
  Y.applyUpdate(b.doc, ua);
  Y.applyUpdate(a.doc, ub);
}

describe('Whiteboard 共享文档模型', () => {
  it('并发新增都保留，图层顺序一致', () => {
    const a = new Whiteboard();
    const b = new Whiteboard();
    sync(a, b); // 建立共同起点
    a.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10, color: 'red' });
    b.addShape({ type: 'note', x: 5, y: 5, w: 1, h: 1, text: 'hi' });
    sync(a, b);
    expect(a.snapshot()).toHaveLength(2);
    expect(b.snapshot()).toHaveLength(2);
    expect(a.snapshot().map((s) => s.id)).toEqual(b.snapshot().map((s) => s.id));
  });

  it('同一对象不同属性的修改可合并', () => {
    const a = new Whiteboard();
    const b = new Whiteboard();
    const id = a.addShape({ type: 'rect', x: 0, y: 0, w: 10, h: 10, color: 'red' });
    sync(a, b);
    a.updateShape(id, { color: 'blue' });
    b.updateShape(id, { x: 99 });
    sync(a, b);
    const sa = a.get(id)!.toJSON();
    const sb = b.get(id)!.toJSON();
    expect(sa).toMatchObject({ color: 'blue', x: 99 });
    expect(sb).toEqual(sa);
  });

  it('同一属性冲突按一致规则收敛', () => {
    const a = new Whiteboard();
    const b = new Whiteboard();
    const id = a.addShape({ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'red' });
    sync(a, b);
    a.updateShape(id, { color: 'blue' });
    b.updateShape(id, { color: 'green' });
    sync(a, b);
    expect(a.get(id)!.get('color')).toBe(b.get(id)!.get('color'));
  });

  it('删除对象后迟到的移动不能令其复活', () => {
    const a = new Whiteboard();
    const b = new Whiteboard();
    const id = a.addShape({ type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'red' });
    sync(a, b);
    a.deleteShape(id);          // a 删除
    b.updateShape(id, { x: 50 }); // b 离线期间移动（迟到）
    sync(a, b);
    expect(a.get(id)).toBeUndefined();
    expect(b.get(id)).toBeUndefined();
    expect(a.snapshot()).toHaveLength(0);
  });
});

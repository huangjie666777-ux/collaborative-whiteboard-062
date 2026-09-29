import * as Y from 'yjs';

export type ShapeType = 'stroke' | 'rect' | 'note';
export interface Point { x: number; y: number }

export interface ShapeSnapshot {
  id: string;
  type: ShapeType;
  [key: string]: unknown;
}

export const LOCAL_ORIGIN = 'local-user';

let counter = 0;
export function newShapeId(): string {
  counter += 1;
  return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '-' + counter;
}

/**
 * 白板共享文档模型。
 * - shapes 为 Y.Array<Y.Map>：数组顺序即图层顺序，Yjs 保证各端一致；
 *   每个 Y.Map 有稳定身份（item id），key 级合并使不同属性修改可合并、
 *   同属性冲突按 Yjs LWW 规则收敛。
 * - 删除即从数组移除该 Y.Map；迟到的远端移动只写入已删除 map 的墓碑，
 *   不会使其复活。
 */
export class Whiteboard {
  readonly doc: Y.Doc;
  readonly shapes: Y.Array<Y.Map<unknown>>;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.shapes = this.doc.getArray<Y.Map<unknown>>('shapes');
  }

  get(id: string): Y.Map<unknown> | undefined {
    return this.shapes.toArray().find((m) => m.get('id') === id);
  }

  indexOf(id: string): number {
    return this.shapes.toArray().findIndex((m) => m.get('id') === id);
  }

  snapshot(): ShapeSnapshot[] {
    return this.shapes.toArray().map((m) => ({ ...(m.toJSON() as ShapeSnapshot) }));
  }

  addShape(props: Record<string, unknown>, origin: unknown = LOCAL_ORIGIN): string {
    const id = (props.id as string) ?? newShapeId();
    this.doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('id', id);
      for (const [k, v] of Object.entries(props)) if (k !== 'id') m.set(k, v);
      this.shapes.push([m]);
    }, origin);
    return id;
  }

  updateShape(id: string, props: Record<string, unknown>, origin: unknown = LOCAL_ORIGIN): void {
    this.doc.transact(() => {
      const m = this.get(id);
      if (!m) return;
      for (const [k, v] of Object.entries(props)) m.set(k, v);
    }, origin);
  }

  deleteShape(id: string, origin: unknown = LOCAL_ORIGIN): void {
    this.doc.transact(() => {
      const i = this.indexOf(id);
      if (i >= 0) this.shapes.delete(i, 1);
    }, origin);
  }

  moveShape(id: string, dx: number, dy: number, origin: unknown = LOCAL_ORIGIN): void {
    const m = this.get(id);
    if (!m) return;
    if (m.get('type') === 'stroke') {
      const pts = (m.get('points') as Point[]).map((p) => ({ x: p.x + dx, y: p.y + dy }));
      this.updateShape(id, { points: pts }, origin);
    } else {
      this.updateShape(
        id,
        { x: (m.get('x') as number) + dx, y: (m.get('y') as number) + dy },
        origin,
      );
    }
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

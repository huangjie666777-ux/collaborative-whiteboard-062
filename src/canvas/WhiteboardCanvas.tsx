import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CollabSession, Presence } from '../collab/session';
import { UndoStack } from '../undo/undoStack';
import { Point, ShapeSnapshot } from '../model/whiteboard';

export type Tool = 'select' | 'pen' | 'rect' | 'note' | 'pan';
export interface View { x: number; y: number; zoom: number }

interface Props {
  session: CollabSession;
  undo: UndoStack;
  tool: Tool;
  color: string;
  shapes: ShapeSnapshot[];
  peers: Map<number, Presence>;
  view: View;
  setView: (v: View) => void;
  notify: (msg: string) => void;
}

interface DragState {
  mode: 'draw-stroke' | 'draw-rect' | 'move' | 'pan';
  id?: string;
  start: Point;          // canvas 坐标
  lastView?: View;
  before?: Record<string, unknown>;
  moved: boolean;
}

export function WhiteboardCanvas(p: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);

  const toCanvas = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left - p.view.x) / p.view.zoom,
        y: (e.clientY - rect.top - p.view.y) / p.view.zoom,
      };
    },
    [p.view],
  );

  // 滚轮缩放（以光标为中心）
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.min(5, Math.max(0.2, p.view.zoom * factor));
      p.setView({
        zoom,
        x: cx - ((cx - p.view.x) / p.view.zoom) * zoom,
        y: cy - ((cy - p.view.y) / p.view.zoom) * zoom,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [p.view, p.setView]);

  const snapshotOf = (id: string) => p.shapes.find((s) => s.id === id);

  const onBackgroundDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pt = toCanvas(e);
    if (p.tool === 'pan' || e.button === 1) {
      drag.current = { mode: 'pan', start: { x: e.clientX, y: e.clientY }, lastView: p.view, moved: false };
      return;
    }
    if (p.tool === 'pen') {
      const id = p.session.board.addShape({ type: 'stroke', points: [pt], color: p.color, width: 3 });
      drag.current = { mode: 'draw-stroke', id, start: pt, moved: false };
    } else if (p.tool === 'rect') {
      const id = p.session.board.addShape({ type: 'rect', x: pt.x, y: pt.y, w: 0, h: 0, color: p.color });
      drag.current = { mode: 'draw-rect', id, start: pt, moved: false };
    } else if (p.tool === 'note') {
      const id = p.session.board.addShape({ type: 'note', x: pt.x, y: pt.y, w: 160, h: 100, color: p.color, text: '双击编辑' });
      const after = p.session.board.get(id)!.toJSON() as Record<string, unknown>;
      p.undo.begin();
      p.undo.record({ id, kind: 'add', after });
      p.undo.commit('新增便签');
      setSelected(id);
    } else {
      setSelected(null);
    }
  };

  const onShapeDown = (id: string) => (e: React.PointerEvent) => {
    if (p.tool !== 'select') return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSelected(id);
    drag.current = {
      mode: 'move',
      id,
      start: toCanvas(e),
      before: snapshotOf(id) as Record<string, unknown>,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const pt = toCanvas(e);
    p.session.setCursor(pt);
    if (!d) return;
    d.moved = true;
    if (d.mode === 'pan') {
      p.setView({
        zoom: d.lastView!.zoom,
        x: d.lastView!.x + (e.clientX - d.start.x),
        y: d.lastView!.y + (e.clientY - d.start.y),
      });
    } else if (d.mode === 'draw-stroke') {
      const m = p.session.board.get(d.id!);
      if (m) {
        const pts = [...(m.get('points') as Point[]), pt];
        p.session.board.updateShape(d.id!, { points: pts });
      }
    } else if (d.mode === 'draw-rect') {
      p.session.board.updateShape(d.id!, {
        x: Math.min(d.start.x, pt.x),
        y: Math.min(d.start.y, pt.y),
        w: Math.abs(pt.x - d.start.x),
        h: Math.abs(pt.y - d.start.y),
      });
    } else if (d.mode === 'move') {
      const dx = pt.x - d.start.x;
      const dy = pt.y - d.start.y;
      const before = d.before!;
      if (before.type === 'stroke') {
        const pts = (before.points as Point[]).map((q) => ({ x: q.x + dx, y: q.y + dy }));
        p.session.board.updateShape(d.id!, { points: pts });
      } else {
        p.session.board.updateShape(d.id!, { x: (before.x as number) + dx, y: (before.y as number) + dy });
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'draw-stroke' || d.mode === 'draw-rect') {
      const m = p.session.board.get(d.id!);
      if (!m) return;
      const after = m.toJSON() as Record<string, unknown>;
      // 过小的矩形视为误触
      if (d.mode === 'draw-rect' && (after.w as number) < 2 && (after.h as number) < 2) {
        p.session.board.deleteShape(d.id!);
        return;
      }
      p.undo.begin();
      p.undo.record({ id: d.id!, kind: 'add', after });
      p.undo.commit(d.mode === 'draw-stroke' ? '笔画' : '矩形');
      setSelected(d.id!);
    } else if (d.mode === 'move' && d.moved) {
      const m = p.session.board.get(d.id!);
      if (!m) return;
      const after = m.toJSON() as Record<string, unknown>;
      const before = d.before!;
      const keys = before.type === 'stroke' ? ['points'] : ['x', 'y'];
      p.undo.begin();
      p.undo.record({
        id: d.id!,
        kind: 'update',
        before: pick(before, keys),
        after: pick(after, keys),
      });
      p.undo.commit('移动');
    }
  };

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    const idx = p.session.board.indexOf(selected);
    const before = snapshotOf(selected);
    if (!before || idx < 0) return;
    p.session.board.deleteShape(selected);
    p.undo.begin();
    p.undo.record({ id: selected, kind: 'delete', index: idx, before });
    p.undo.commit('删除');
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, p.session, p.undo, p.shapes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, editing]);

  const changeColor = (c: string) => {
    if (!selected) return;
    const before = snapshotOf(selected);
    if (!before) return;
    p.session.board.updateShape(selected, { color: c });
    p.undo.begin();
    p.undo.record({ id: selected, kind: 'update', before: { color: before.color }, after: { color: c } });
    p.undo.commit('改色');
  };

  const commitText = (id: string, text: string) => {
    const before = snapshotOf(id);
    if (before && before.text !== text) {
      p.session.board.updateShape(id, { text });
      p.undo.begin();
      p.undo.record({ id, kind: 'update', before: { text: before.text }, after: { text } });
      p.undo.commit('编辑文字');
    }
    setEditing(null);
  };

  // 暴露给工具栏
  useEffect(() => {
    (p as unknown as { apiRef?: React.MutableRefObject<unknown> }).apiRef;
  }, []);

  const sel = selected ? snapshotOf(selected) : undefined;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={'board tool-' + p.tool}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => p.session.setCursor(null)}
      >
        <g transform={'translate(' + p.view.x + ' ' + p.view.y + ') scale(' + p.view.zoom + ')'}>
          {p.shapes.map((s) => (
            <ShapeView
              key={s.id}
              s={s}
              selected={s.id === selected}
              onDown={onShapeDown(s.id)}
              onDblClick={() => s.type === 'note' && setEditing(s.id)}
            />
          ))}
          {[...p.peers.entries()].map(([id, u]) =>
            u.cursor ? (
              <g key={id} transform={'translate(' + u.cursor.x + ' ' + u.cursor.y + ')'}>
                <path d="M0 0 L0 16 L4 12 L7 18 L9 17 L6 11 L12 11 Z" fill={u.color} stroke="#fff" strokeWidth={1 / p.view.zoom} />
                <text x={14} y={16} fontSize={12 / p.view.zoom} fill={u.color}>{u.name}</text>
              </g>
            ) : null,
          )}
        </g>
      </svg>
      {sel && (
        <div className="color-bar">
          改色：
          {['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'].map((c) => (
            <button key={c} className="swatch" style={{ background: c }} onClick={() => changeColor(c)} />
          ))}
          <button onClick={deleteSelected}>删除</button>
        </div>
      )}
      {editing && (() => {
        const s = snapshotOf(editing);
        if (!s) return null;
        const sx = (s.x as number) * p.view.zoom + p.view.x;
        const sy = (s.y as number) * p.view.zoom + p.view.y;
        return (
          <textarea
            className="note-editor"
            style={{ left: sx, top: sy, width: (s.w as number) * p.view.zoom, height: (s.h as number) * p.view.zoom }}
            autoFocus
            defaultValue={s.text as string}
            onBlur={(e) => commitText(editing, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') commitText(editing, (e.target as HTMLTextAreaElement).value); }}
          />
        );
      })()}
    </div>
  );
}

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of keys) r[k] = o[k];
  return r;
}

function ShapeView(props: {
  s: ShapeSnapshot;
  selected: boolean;
  onDown: (e: React.PointerEvent) => void;
  onDblClick: () => void;
}) {
  const { s } = props;
  const common = {
    onPointerDown: props.onDown,
    onDoubleClick: props.onDblClick,
    style: { cursor: 'move' },
  };
  let el: React.ReactNode = null;
  if (s.type === 'stroke') {
    const pts = (s.points as Point[]).map((q) => q.x + ',' + q.y).join(' ');
    el = (
      <polyline
        points={pts}
        fill="none"
        stroke={s.color as string}
        strokeWidth={(s.width as number) ?? 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke', cursor: 'move' }}
        onPointerDown={props.onDown}
      />
    );
  } else if (s.type === 'rect') {
    el = (
      <rect
        x={s.x as number} y={s.y as number}
        width={s.w as number} height={s.h as number}
        fill="none" stroke={s.color as string} strokeWidth={3}
        {...common}
      />
    );
  } else if (s.type === 'note') {
    el = (
      <g {...common}>
        <rect
          x={s.x as number} y={s.y as number}
          width={s.w as number} height={s.h as number}
          fill="#fff9c4" stroke={s.color as string} strokeWidth={2} rx={6}
        />
        <foreignObject x={s.x as number} y={s.y as number} width={s.w as number} height={s.h as number}>
          <div className="note-text">{(s.text as string) ?? ''}</div>
        </foreignObject>
      </g>
    );
  }
  return (
    <>
      {el}
      {props.selected && s.type !== 'stroke' && (
        <rect
          x={(s.x as number) - 3} y={(s.y as number) - 3}
          width={(s.w as number) + 6} height={(s.h as number) + 6}
          fill="none" stroke="#4d7cfe" strokeDasharray="4 3" strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </>
  );
}

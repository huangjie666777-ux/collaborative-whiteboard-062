import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CollabSession, ConnStatus, Presence } from './collab/session';
import { UndoStack } from './undo/undoStack';
import { ShapeSnapshot } from './model/whiteboard';
import { WhiteboardCanvas, Tool, View } from './canvas/WhiteboardCanvas';
import { JoinScreen } from './ui/JoinScreen';

const WS_URL = location.origin.replace(/^http/, 'ws') + '/ws';

interface Toast { id: number; text: string }

export default function App() {
  const [joined, setJoined] = useState<{ name: string; room: string } | null>(null);
  const [session, setSession] = useState<CollabSession | null>(null);
  const [undo, setUndo] = useState<UndoStack | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [shapes, setShapes] = useState<ShapeSnapshot[]>([]);
  const [peers, setPeers] = useState<Map<number, Presence>>(new Map());
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#1e1e1e');
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [histTick, setHistTick] = useState(0);
  const toastId = useRef(0);

  const notify = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const join = useCallback((name: string, room: string) => {
    const s = new CollabSession(room, name, WS_URL, {
      onStatus: setStatus,
      onPresence: setPeers,
      onShapes: () => setShapes(s.board.snapshot()),
    });
    const u = new UndoStack(s.board);
    setSession(s);
    setUndo(u);
    setJoined({ name, room });
    setShapes([]);
    setView({ x: 0, y: 0, zoom: 1 });
    history.replaceState(null, '', '?room=' + encodeURIComponent(room));
  }, []);

  const leave = useCallback(() => {
    session?.destroy();   // 清理旧房间全部订阅
    undo?.clear();        // 清空本地历史，旧房间消息不得污染新房间
    setSession(null);
    setUndo(null);
    setJoined(null);
    setPeers(new Map());
    setShapes([]);
    history.replaceState(null, '', location.pathname);
  }, [session, undo]);

  const doUndo = useCallback(() => {
    if (!undo) return;
    const r = undo.undo();
    if (r.skipped.length > 0) notify('部分对象已被他人修改，已跳过 ' + r.skipped.length + ' 项');
    else if (!r.ok) notify('没有可撤销的操作');
    setHistTick((t) => t + 1);
  }, [undo, notify]);

  const doRedo = useCallback(() => {
    if (!undo) return;
    const r = undo.redo();
    if (r.skipped.length > 0) notify('部分对象已被他人修改，已跳过 ' + r.skipped.length + ' 项');
    else if (!r.ok) notify('没有可重做的操作');
    setHistTick((t) => t + 1);
  }, [undo, notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  const copyLink = () => {
    const url = location.origin + location.pathname + '?room=' + encodeURIComponent(joined!.room);
    navigator.clipboard?.writeText(url).then(() => notify('房间链接已复制'));
  };

  if (!joined || !session || !undo) return <JoinScreen onJoin={join} />;

  const statusText = { connected: '已连接', connecting: '连接中…', disconnected: '已断线（可继续离线编辑）' }[status];
  void histTick;

  return (
    <div className="app">
      <header className="toolbar">
        <span className={'status ' + status}>{statusText}</span>
        <span className="room">房间：{joined.room}</span>
        <button onClick={copyLink}>复制房间链接</button>
        <span className="sep" />
        {(['select', 'pen', 'rect', 'note', 'pan'] as Tool[]).map((t) => (
          <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)}>
            {{ select: '选择', pen: '画笔', rect: '矩形', note: '便签', pan: '平移' }[t]}
          </button>
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="画笔颜色" />
        <span className="sep" />
        <button disabled={!undo.canUndo} onClick={doUndo}>撤销</button>
        <button disabled={!undo.canRedo} onClick={doRedo}>重做</button>
        <span className="sep" />
        <span className="peers">
          在线：{[joined.name, ...[...peers.values()].map((u) => u.name)].join('、')}
        </span>
        <button onClick={leave}>切换房间</button>
      </header>
      <WhiteboardCanvas
        session={session}
        undo={undo}
        tool={tool}
        color={color}
        shapes={shapes}
        peers={peers}
        view={view}
        setView={setView}
        notify={notify}
      />
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
  );
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { WebsocketProvider } from 'y-websocket';
import { Whiteboard } from '../src/model/whiteboard';

const PORT = 14321;
const URL = 'ws://localhost:' + PORT;
let server: ChildProcess;

function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (pred()) { clearInterval(timer); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(timer); reject(new Error('timeout')); }
    }, 20);
  });
}

beforeAll(async () => {
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));
}, 20000);

afterAll(() => { server?.kill(); });

describe('房间通信（真实 WebSocket 服务）', () => {
  it('同房同步、新成员获得完整白板、异房隔离、断线重连补齐', async () => {
    const a = new Whiteboard();
    const pa = new WebsocketProvider(URL, 'room-1', a.doc);
    await waitFor(() => pa.wsconnected);
    const id = a.addShape({ type: 'rect', x: 1, y: 2, w: 3, h: 4, color: 'red' });

    // 新成员加入获得当前完整白板
    const b = new Whiteboard();
    const pb = new WebsocketProvider(URL, 'room-1', b.doc);
    await waitFor(() => b.snapshot().length === 1);
    expect(b.get(id)!.get('color')).toBe('red');

    // 异房隔离
    const c = new Whiteboard();
    const pc = new WebsocketProvider(URL, 'room-2', c.doc);
    await waitFor(() => pc.wsconnected);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.snapshot()).toHaveLength(0);

    // 断线期间双方各自编辑，恢复后自动补齐
    pa.disconnect();
    pb.disconnect();
    a.updateShape(id, { color: 'blue' });
    const id2 = b.addShape({ type: 'note', x: 0, y: 0, w: 1, h: 1, text: 'offline' });
    pa.connect();
    pb.connect();
    await waitFor(() => b.get(id)?.get('color') === 'blue' && !!a.get(id2));
    expect(a.snapshot()).toHaveLength(2);
    expect(b.snapshot()).toHaveLength(2);

    pa.destroy(); pb.destroy(); pc.destroy();
  }, 20000);
});

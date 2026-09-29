/* 双独立客户端协作演示：模拟两个浏览器 */
import { WebsocketProvider } from 'y-websocket';
import { Whiteboard } from '../src/model/whiteboard';

const DIRECT = 'ws://localhost:1234';
const PROXY = 'ws://localhost:5173/ws'; // 经 Vite 代理，等同浏览器路径

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, label: string, ms = 5000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await wait(25);
  }
}

async function main() {
  // 客户端 A（直连）加入房间 demo
  const A = new Whiteboard();
  const pa = new WebsocketProvider(DIRECT, 'demo2', A.doc);
  pa.awareness.setLocalStateField('user', { name: '小明', color: '#e03131', cursor: null });
  await until(() => pa.wsconnected, 'A connect');
  console.log('A(小明) 已连接');

  const rectId = A.addShape({ type: 'rect', x: 10, y: 10, w: 100, h: 60, color: '#1971c2' });
  A.addShape({ type: 'stroke', points: [{ x: 0, y: 0 }, { x: 50, y: 40 }], color: '#1e1e1e', width: 3 });
  await wait(200);

  // 客户端 B（经 Vite 代理）稍后加入，应获得完整白板
  const B = new Whiteboard();
  const pb = new WebsocketProvider(PROXY, 'demo2', B.doc);
  pb.awareness.setLocalStateField('user', { name: '小红', color: '#2f9e44', cursor: null });
  await until(() => B.snapshot().length === 2, 'B full sync');
  console.log('B(小红) 加入后获得完整白板，对象数 =', B.snapshot().length);

  // 在线状态（昵称）互见
  await until(() => pa.awareness.getStates().size === 2, 'presence');
  const names = [...pa.awareness.getStates().values()].map((s: any) => s.user?.name);
  console.log('A 看到的在线成员:', names.join('、'));

  // 并发编辑：A 改色，B 移动同一矩形 -> 不同属性合并
  A.updateShape(rectId, { color: '#e03131' });
  B.updateShape(rectId, { x: 200 });
  await until(() => A.get(rectId)?.get('x') === 200 && B.get(rectId)?.get('color') === '#e03131', 'merge');
  console.log('并发修改合并结果 A 端:', JSON.stringify(A.get(rectId)!.toJSON()));

  // 模拟 A 断网：离线编辑，恢复后自动补齐
  pa.disconnect();
  A.updateShape(rectId, { y: 300 });
  const noteId = B.addShape({ type: 'note', x: 5, y: 5, w: 160, h: 100, color: '#f08c00', text: '离线期间的便签' });
  await wait(300);
  console.log('A 断线期间本地矩形 y =', A.get(rectId)!.get('y'), '（尚未同步）');
  pa.connect();
  await until(() => A.snapshot().length === 3 && B.get(rectId)?.get('y') === 300, 'reconnect sync');
  console.log('A 重连后双方补齐：A 对象数 =', A.snapshot().length, '，B 端矩形 y =', B.get(rectId)!.get('y'));

  // 房间隔离
  const C = new Whiteboard();
  const pc = new WebsocketProvider(DIRECT, 'other-room', C.doc);
  await until(() => pc.wsconnected, 'C connect');
  await wait(300);
  console.log('异房客户端对象数 =', C.snapshot().length, '（应为 0）');

  // 删除 + 迟到移动不复活（离线删除 vs 离线移动）
  pa.disconnect(); pb.disconnect();
  A.deleteShape(noteId);
  B.updateShape(noteId, { x: 999 });
  pa.connect(); pb.connect();
  await wait(600);
  console.log('删除 vs 迟到移动收敛后，A/B 对象数 =', A.snapshot().length, B.snapshot().length,
    '，便签存在?', !!A.get(noteId) || !!B.get(noteId));

  pa.destroy(); pb.destroy(); pc.destroy();
  console.log('演示完成 ✔');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

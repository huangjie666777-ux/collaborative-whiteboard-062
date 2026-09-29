import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

/**
 * 标准 y-websocket 服务端（y-websocket v3 已移除 bin/utils，这里按同一协议实现）。
 * - 每个房间一个 Y.Doc + awareness，按 URL 路径分房间，互不串数据；
 * - 文档保存在进程内存中，无人房间在服务存活期间保留。
 */

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Set<number>>();

  constructor(readonly name: string) {
    this.awareness.setLocalState(null);
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      );
      this.broadcast(encoding.toUint8Array(encoder));
      // 记录各连接控制的 clientID，断连时清理
      // （added/updated 的归属在消息处理时登记）
    });
    this.doc.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  broadcast(message: Uint8Array): void {
    for (const conn of this.conns.keys()) {
      if (conn.readyState === WebSocket.OPEN) conn.send(message);
    }
  }
}

const rooms = new Map<string, Room>();

function getRoom(name: string): Room {
  let room = rooms.get(name);
  if (!room) {
    room = new Room(name);
    rooms.set(name, room);
    console.log('[server] open room:', name);
  }
  return room;
}

function handleMessage(room: Room, conn: WebSocket, data: Uint8Array): void {
  const decoder = decoding.createDecoder(data);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case MSG_SYNC: {
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
      if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
      break;
    }
    case MSG_AWARENESS: {
      const update = decoding.readVarUint8Array(decoder);
      // 登记该连接控制的 clientID，断连时移除其在线状态
      const dec2 = decoding.createDecoder(update);
      const len = decoding.readVarUint(dec2);
      let controlled = room.conns.get(conn);
      if (!controlled) {
        controlled = new Set();
        room.conns.set(conn, controlled);
      }
      for (let i = 0; i < len; i++) {
        decoding.readVarUint(dec2); // clock
        const clientId = decoding.readVarUint(dec2);
        decoding.readVarUint8Array(dec2); // state
        controlled.add(clientId);
      }
      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn);
      break;
    }
  }
}

function setupConnection(conn: WebSocket, roomName: string): void {
  const room = getRoom(roomName);
  room.conns.set(conn, new Set());

  conn.on('message', (data: Buffer) => handleMessage(room, conn, new Uint8Array(data)));
  conn.on('close', () => {
    const controlled = room.conns.get(conn);
    room.conns.delete(conn);
    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], null);
    }
  });

  // 发送同步第一步 + 当前 awareness 状态
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  conn.send(encoding.toUint8Array(encoder));
  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      enc2,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...awarenessStates.keys()]),
    );
    conn.send(encoding.toUint8Array(enc2));
  }
}

const port = Number(process.env.PORT ?? 1234);
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('whiteboard y-websocket server\n');
});
const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  const roomName = (req.url ?? '/').slice(1).split('?')[0] || 'default';
  setupConnection(conn, roomName);
});

server.listen(port, () => {
  console.log('[server] y-websocket listening on ws://localhost:' + port);
});

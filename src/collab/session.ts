import { WebsocketProvider } from 'y-websocket';
import { Whiteboard } from '../model/whiteboard';

export type ConnStatus = 'connecting' | 'connected' | 'disconnected';

export interface Presence {
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}

export interface SessionEvents {
  onStatus: (s: ConnStatus) => void;
  onPresence: (peers: Map<number, Presence>) => void;
  onShapes: () => void;
}

/**
 * 一个房间的协作会话：Y.Doc + WebsocketProvider + awareness。
 * 断网时 provider 自动重连，期间本地编辑照常写入 doc，
 * 恢复后由 Yjs 同步协议自动补齐双方改动。
 */
export class CollabSession {
  readonly board: Whiteboard;
  readonly provider: WebsocketProvider;
  private status: ConnStatus = 'connecting';

  constructor(
    readonly room: string,
    readonly name: string,
    serverUrl: string,
    private events: SessionEvents,
  ) {
    this.board = new Whiteboard();
    this.provider = new WebsocketProvider(serverUrl, room, this.board.doc, {
      // 断线自动重连（y-websocket 内置指数退避）
      connect: true,
    });
    this.provider.on('status', ({ status }: { status: string }) => {
      this.status = status === 'connected' ? 'connected' : status === 'disconnected' ? 'disconnected' : 'connecting';
      this.events.onStatus(this.status);
    });
    this.provider.awareness.setLocalStateField('user', {
      name,
      color: colorFor(name),
      cursor: null,
    } satisfies Presence);
    this.provider.awareness.on('change', () => {
      const peers = new Map<number, Presence>();
      this.provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === this.provider.awareness.clientID) return;
        const u = (state as { user?: Presence }).user;
        if (u) peers.set(clientId, u);
      });
      this.events.onPresence(peers);
    });
    this.board.shapes.observeDeep(() => this.events.onShapes());
  }

  setCursor(pos: { x: number; y: number } | null): void {
    const cur = this.provider.awareness.getLocalState()?.user as Presence | undefined;
    this.provider.awareness.setLocalStateField('user', {
      name: cur?.name ?? this.name,
      color: cur?.color ?? colorFor(this.name),
      cursor: pos,
    });
  }

  getStatus(): ConnStatus { return this.status; }

  /** 切换房间/离开时调用：断开并销毁全部订阅与本地文档 */
  destroy(): void {
    this.provider.awareness.setLocalState(null);
    this.provider.destroy();
    this.board.doc.destroy();
  }
}

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#bfef45', '#f032e6'];
export function colorFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

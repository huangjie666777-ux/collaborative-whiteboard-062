import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'
import type { MemberState, Point } from '../shared/types'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface Member {
  clientId: number
  state: MemberState
  self: boolean
}

export interface RoomEvents {
  status: (status: ConnectionStatus) => void
  synced: () => void
  members: (members: Member[]) => void
}

const MEMBER_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#0d9488', '#ea580c']

export function pickMemberColor(seed: number): string {
  return MEMBER_COLORS[Math.abs(seed) % MEMBER_COLORS.length]
}

/**
 * 封装一次房间会话：Y.Doc + WebsocketProvider + Awareness。
 * 离开房间时调用 destroy()，旧订阅与本地文档全部释放，不会污染新房间。
 */
export class RoomSession {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private readonly provider: WebsocketProvider
  private readonly listeners: Record<keyof RoomEvents, Set<(arg: never) => void>> = {
    status: new Set(),
    synced: new Set(),
    members: new Set()
  }

  constructor(
    readonly serverUrl: string,
    readonly roomId: string,
    nickname: string,
    color: string
  ) {
    this.doc = new Y.Doc()
    const wsUrl = `${serverUrl.replace(/\/$/, '')}/room/${encodeURIComponent(roomId)}`
    this.provider = new WebsocketProvider(wsUrl, '', this.doc, {
      connect: true,
      // 不使用 BroadcastChannel，强制经 Node 服务器，便于跨浏览器/机器演示
      disableBc: true
    })
    this.awareness = this.provider.awareness
    this.awareness.setLocalStateField('nickname', nickname)
    this.awareness.setLocalStateField('color', color)
    this.awareness.setLocalStateField('cursor', null)

    this.provider.on('status', ({ status }: { status: string }) => {
      this.emit('status', this.mapStatus(status))
    })
    this.provider.on('synced', () => {
      this.emit('status', 'connected')
      this.emit('synced', undefined)
    })
    this.awareness.on('change', () => this.emitMembers())
    this.emit('status', 'connecting')
  }

  private mapStatus(status: string): ConnectionStatus {
    if (status === 'connected') return 'connected'
    if (status === 'disconnected') return 'disconnected'
    return 'connecting'
  }

  get selfId(): number {
    return this.awareness.clientID
  }

  setCursor(cursor: Point | null): void {
    this.awareness.setLocalStateField('cursor', cursor)
  }

  setNickname(nickname: string): void {
    this.awareness.setLocalStateField('nickname', nickname)
  }

  private emitMembers(): void {
    const selfId = this.selfId
    const members: Member[] = []
    this.awareness.getStates().forEach((state, clientId) => {
      const memberState = state as unknown as MemberState
      if (!memberState || typeof memberState.nickname !== 'string') return
      members.push({ clientId, state: memberState, self: clientId === selfId })
    })
    members.sort((a, b) => a.clientId - b.clientId)
    this.emit('members', members)
  }

  on<K extends keyof RoomEvents>(event: K, fn: RoomEvents[K]): () => void {
    this.listeners[event].add(fn as (arg: never) => void)
    return () => this.listeners[event].delete(fn as (arg: never) => void)
  }

  private emit<K extends keyof RoomEvents>(event: K, arg: Parameters<RoomEvents[K]>[0]): void {
    this.listeners[event].forEach((fn) => fn(arg as never))
  }

  destroy(): void {
    // 清除本人 presence 并断开 WebSocket，旧房间订阅随之全部释放
    try {
      this.awareness.setLocalState(null)
    } catch {
      /* doc 已销毁时忽略 */
    }
    this.provider.disconnect()
    this.provider.destroy()
    this.doc.destroy()
    ;(Object.keys(this.listeners) as Array<keyof RoomEvents>).forEach((key) =>
      this.listeners[key].clear()
    )
  }
}

export interface JoinConfig {
  nickname: string
  roomId: string
}

/** 根据当前页面推导 WebSocket 服务地址 */
export function defaultServerUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:8787'
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams(window.location.search)
  const explicit = params.get('ws')
  if (explicit) return explicit
  return `${proto}://${window.location.host}`
}

export function buildRoomLink(roomId: string): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', roomId)
  return url.toString()
}

export type { JoinConfig as JoinConfigType }

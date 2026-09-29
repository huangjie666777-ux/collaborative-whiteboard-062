import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'

export const messageSync = 0
export const messageAwareness = 1
export const messageQueryAwareness = 3

const persistenceDisabled = false

export interface RoomConnection {
  ws: WebSocket
  clientId: number
  room: Room
  synced: boolean
}

/**
 * 一个房间对应一个 Y.Doc 与一个 Awareness 实例。
 * 房间在进程存活期间常驻内存，即使没有任何连接也保留。
 */
export class Room {
  readonly name: string
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  readonly conns = new Map<WebSocket, RoomConnection>()

  constructor(name: string) {
    this.name = name
    this.doc = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)

    // 任意客户端产生的更新广播给同房间其他已同步连接
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      for (const conn of this.conns.values()) {
        if (conn.synced && conn.ws !== origin) {
          this.send(conn.ws, message)
        }
      }
    })

    this.awareness.on('update', ({ added, updated, removed }, origin: unknown) => {
      const changedClients = added.concat(updated, removed)
      const conn = origin instanceof WebSocket ? this.conns.get(origin) : undefined
      if (conn !== undefined) {
        conn.clientId = this.awareness.clientID
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      )
      const message = encoding.toUint8Array(encoder)
      for (const c of this.conns.values()) {
        if (c.ws !== origin) this.send(c.ws, message)
      }
    })
  }

  send(ws: WebSocket, message: Uint8Array) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message, (err) => {
        if (err) console.error(`[room:${this.name}] send error:`, err.message)
      })
    }
  }

  handleMessage(conn: RoomConnection, data: Uint8Array) {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    const encoder = encoding.createEncoder()
    let messageType = decoding.readVarUint(decoder)
    const sendReply = () => {
      if (encoding.length(encoder) > 1) {
        this.send(conn.ws, encoding.toUint8Array(encoder))
      }
    }

    if (messageType === messageSync) {
      encoding.writeVarUint(encoder, messageSync)
      const syncType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn.ws)
      if (!conn.synced && syncType === syncProtocol.messageYjsSyncStep2) {
        conn.synced = true
      }
      sendReply()
    } else if (messageType === messageAwareness) {
      const update = decoding.readVarUint8Array(decoder)
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn.ws)
    } else if (messageType === messageQueryAwareness) {
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(this.awareness.getStates().keys())
        )
      )
      sendReply()
    } else {
      console.warn(`[room:${this.name}] unknown message type ${messageType}`)
    }
  }

  addConnection(ws: WebSocket): RoomConnection {
    // 让 awareness 直接使用该连接的 clientID（由 y-websocket 协议约定）
    const conn: RoomConnection = {
      ws,
      clientId: -1,
      room: this,
      synced: false
    }
    this.conns.set(ws, conn)

    ws.on('message', (data) => {
      try {
        this.handleMessage(conn, data as Uint8Array)
      } catch (err) {
        console.error(`[room:${this.name}] message handling failed:`, err)
      }
    })

    ws.on('close', () => this.removeConnection(conn))
    ws.on('error', () => this.removeConnection(conn))
    return conn
  }

  removeConnection(conn: RoomConnection) {
    if (!this.conns.delete(conn.ws)) return
    // 连接关闭时清除其 awareness 状态（成员与光标消失）
    const controlledIds: number[] = []
    if (conn.clientId >= 0) controlledIds.push(conn.clientId)
    const states = this.awareness.getStates()
    // 兜底：该连接曾通过 update 注册过的 clientID
    for (const clientId of states.keys()) {
      if (clientId === conn.clientId) controlledIds.push(clientId)
    }
    if (controlledIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(new Set(controlledIds)),
        null
      )
    }
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>()

  get(name: string): Room {
    let room = this.rooms.get(name)
    if (room === undefined) {
      room = new Room(name)
      this.rooms.set(name, room)
      console.log(`[room:${name}] created`)
    }
    return room
  }

  get size() {
    return this.rooms.size
  }

  names(): string[] {
    return Array.from(this.rooms.keys())
  }
}

// 防止未使用告警（persistenceDisabled 预留给后续持久化开关）
void persistenceDisabled

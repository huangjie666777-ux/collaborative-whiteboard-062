import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WhiteboardDoc } from './shared/whiteboard'
import { UndoHistory } from './undo/history'
import { RoomSession, defaultServerUrl, type ConnectionStatus, type Member } from './room/session'
import LoginScreen from './components/LoginScreen'
import Board from './components/Board'
import Toolbar from './components/Toolbar'
import PresencePanel from './components/PresencePanel'
import type { Point } from './shared/types'

export interface ActiveSession {
  session: RoomSession
  board: WhiteboardDoc
  history: UndoHistory
  nickname: string
  roomId: string
}

export default function App() {
  const [active, setActive] = useState<ActiveSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [members, setMembers] = useState<Member[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const join = useCallback((nickname: string, roomId: string, color: string) => {
    setActive((prev) => {
      prev?.session.destroy()
      const session = new RoomSession(defaultServerUrl(), roomId, nickname, color)
      const board = new WhiteboardDoc(session.doc)
      const history = new UndoHistory(board)
      session.on('status', (s) => setStatus(s))
      session.on('members', (m) => setMembers(m))
      history.onSkip((notice) => {
        showToast(
          `已跳过${notice.action === 'undo' ? '撤销' : '重做'}「${notice.label}」：对象已被其他成员修改`
        )
      })
      return { session, board, history, nickname, roomId }
    })
  }, [showToast])

  const leave = useCallback(() => {
    setActive((prev) => {
      prev?.session.destroy()
      return null
    })
    setMembers([])
  }, [])

  useEffect(() => {
    return () => {
      window.clearTimeout(toastTimer.current)
    }
  }, [])

  if (!active) {
    return <LoginScreen onJoin={join} />
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">协作白板</div>
        <Toolbar
          history={active.history}
          onLeave={leave}
          roomId={active.roomId}
          nickname={active.nickname}
        />
        <StatusPill status={status} />
      </header>
      <div className="main-area">
        <Board
          key={active.roomId}
          board={active.board}
          history={active.history}
          status={status}
          onCursor={(point: Point | null) => active.session.setCursor(point)}
          showToast={showToast}
          selfId={active.session.selfId}
        />
        <PresencePanel roomId={active.roomId} members={members} onLeave={leave} />
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function StatusPill({ status }: { status: ConnectionStatus }) {
  const label = status === 'connected' ? '已连接' : status === 'connecting' ? '连接中…' : '已断开（编辑会在恢复后同步）'
  return <span className={`status-pill status-${status}`}>{label}</span>
}

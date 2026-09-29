import { buildRoomLink } from '../room/session'
import type { Member } from '../room/session'
import { useState } from 'react'

interface Props {
  roomId: string
  members: Member[]
  onLeave: () => void
}

export default function PresencePanel({ roomId, members, onLeave }: Props) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildRoomLink(roomId))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 忽略 */
    }
  }

  return (
    <aside className="presence-panel">
      <h2>同房成员 · {members.length}</h2>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.clientId} className="member-item">
            <span className="dot" style={{ background: m.state.color }} />
            <span className="member-name">{m.state.nickname}</span>
            {m.self && <span className="self-tag">我</span>}
          </li>
        ))}
      </ul>
      <div className="panel-room">房间号：{roomId}</div>
      <button className="btn small wide" onClick={copy}>{copied ? '链接已复制' : '复制同房链接'}</button>
      <button className="btn small danger wide" onClick={onLeave}>离开 / 切换房间</button>
      <p className="panel-hint">空格拖动平移 · 滚轮缩放 · Delete 删除</p>
    </aside>
  )
}

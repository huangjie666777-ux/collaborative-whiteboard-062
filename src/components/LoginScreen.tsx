import { useEffect, useState } from 'react'
import { buildRoomLink } from '../room/session'
import { nextUserColor } from '../shared/whiteboard'

interface Props {
  onJoin: (nickname: string, roomId: string, color: string) => void
}

function randomRoom(): string {
  return Math.random().toString(36).slice(2, 8)
}

export default function LoginScreen({ onJoin }: Props) {
  const [nickname, setNickname] = useState(() => localStorage.getItem('wb-nickname') ?? '')
  const [roomId, setRoomId] = useState(() => new URLSearchParams(location.search).get('room') ?? randomRoom())
  const [color] = useState(() => localStorage.getItem('wb-color') ?? nextUserColor())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    localStorage.setItem('wb-color', color)
  }, [color])

  const link = buildRoomLink(roomId.trim())

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const name = nickname.trim()
    const room = roomId.trim()
    if (!name || !room) return
    localStorage.setItem('wb-nickname', name)
    onJoin(name, room, color)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // 非安全上下文回退
      const input = document.createElement('textarea')
      input.value = link
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>实时协作白板</h1>
        <p className="subtitle">输入昵称与房间号，和小组成员一起头脑风暴。</p>
        <label>
          昵称
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="例如：小王"
            maxLength={24}
            autoFocus
          />
        </label>
        <label>
          房间号
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.replace(/\s/g, ''))}
            placeholder="如 team-1"
            maxLength={64}
          />
        </label>
        <div className="room-link-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn secondary" onClick={copyLink}>
            {copied ? '已复制' : '复制邀请链接'}
          </button>
        </div>
        <button className="btn primary wide" type="submit" disabled={!nickname.trim() || !roomId.trim()}>
          加入白板
        </button>
      </form>
    </div>
  )
}

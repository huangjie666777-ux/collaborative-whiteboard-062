import { PALETTE } from '../shared/whiteboard'
import { buildRoomLink } from '../room/session'
import type { Tool } from './Board'

interface Props {
  tool: Tool
  color: string
  canUndo: boolean
  canRedo: boolean
  onTool: (tool: Tool) => void
  onColor: (color: string) => void
  onApplyColor: () => void
  onUndo: () => void
  onRedo: () => void
  roomId: string
}

export default function Toolbar({
  tool,
  color,
  canUndo,
  canRedo,
  onTool,
  onColor,
  onApplyColor,
  onUndo,
  onRedo,
  roomId
}: Props) {
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildRoomLink(roomId))
    } catch {
      /* 忽略剪贴板权限错误 */
    }
  }

  const tools: Array<{ id: Tool; label: string; hint: string }> = [
    { id: 'select', label: '选择', hint: 'V' },
    { id: 'pen', label: '笔迹', hint: 'P' },
    { id: 'rect', label: '矩形', hint: 'R' },
    { id: 'note', label: '便签', hint: 'N' }
  ]

  return (
    <div className="toolbar">
      <div className="tool-group">
        {tools.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${tool === t.id ? 'active' : ''}`}
            onClick={() => onTool(t.id)}
            title={`${t.label} (${t.hint})`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tool-group palette">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => onColor(c)}
            title="选择绘制颜色"
          />
        ))}
        <button className="btn small" onClick={onApplyColor} title="修改选中对象颜色">改色</button>
      </div>
      <div className="tool-group">
        <button className="btn small" disabled={!canUndo} onClick={onUndo} title="撤销 (Ctrl+Z)">撤销</button>
        <button className="btn small" disabled={!canRedo} onClick={onRedo} title="重做 (Ctrl+Shift+Z)">重做</button>
        <button className="btn small secondary" onClick={copyLink} title="复制同房邀请链接">邀请</button>
      </div>
    </div>
  )
}

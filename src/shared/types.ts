export type ShapeType = 'pen' | 'rect' | 'note'

export interface Point {
  x: number
  y: number
}

export interface BaseObject {
  id: string
  type: ShapeType
  color: string
  /** 墓碑位：删除后任何迟到的属性更新都不能使其复活 */
  deleted: boolean
  /** 创建序号，配合 id 构成全端一致的图层排序 */
  seq: number
  x: number
  y: number
}

export interface PenObject extends BaseObject {
  type: 'pen'
  points: Point[]
  width: number
}

export interface RectObject extends BaseObject {
  type: 'rect'
  w: number
  h: number
}

export interface NoteObject extends BaseObject {
  type: 'note'
  w: number
  h: number
  text: string
}

export type WhiteboardObject = PenObject | RectObject | NoteObject

export interface ViewTransform {
  x: number
  y: number
  scale: number
}

export interface MemberState {
  nickname: string
  color: string
  cursor: Point | null
}

# 实时协作白板

基于 React 19 + Yjs 的小组远程讨论白板：多浏览器通过本机 Node.js WebSocket 服务实时同步。

## 启动

```bash
npm install          # 首次
npm run server       # 终端1：WebSocket 同步服务（默认 :1234，PORT 环境变量可改）
npm run dev          # 终端2：前端开发服务器（:5173，/ws 代理到同步服务）
```

打开 http://localhost:5173 ，输入昵称和房间号加入；点「复制房间链接」发给同伴，
另一浏览器打开该链接输入昵称即可协作。

```bash
npm test             # 运行全部测试（模型合并 / 撤销 / 真实 WebSocket 房间通信）
npm run build        # 类型检查 + 生产构建
npx tsx scripts/demo.ts   # 双独立客户端协作与断线重连演示（需先启动 server 与 dev）
```

## 核心操作

- **工具栏**：选择 / 画笔 / 矩形 / 便签 / 平移；滚轮以光标为中心缩放，平移工具或中键拖动平移视图。
- **选择工具**下点击对象选中，拖动移动；顶部浮条可改色、删除（或按 Delete）。
- **便签**：便签工具点击画布创建，双击进入编辑，失焦或 Esc 保存。
- **撤销/重做**：Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y），仅作用于本人操作；一次笔画或一次拖动为一步。
- **断网**：顶部状态变为「已断线（可继续离线编辑）」，恢复后自动补齐双方改动。

## 架构

| 文件 | 职责 |
| --- | --- |
| `src/model/whiteboard.ts` | 共享文档模型：`Y.Array<Y.Map>`，数组顺序即图层顺序，key 级合并 |
| `src/collab/session.ts` | 房间会话：WebsocketProvider、连接状态、awareness 在线成员与光标 |
| `src/undo/undoStack.ts` | 本人操作分步撤销/重做；远端修改冲突时跳过并提示 |
| `src/canvas/WhiteboardCanvas.tsx` | SVG 画布：绘制、选择、移动、命中、平移缩放坐标换算、远端光标 |
| `src/App.tsx` | 组装：加入/切换房间、工具栏、快捷键、提示 |
| `server/index.ts` | y-websocket 协议服务端：按 URL 分房间，内存保留文档 |
| `test/` | 模型合并、删除不复活、撤销语义、真实服务房间隔离与重连测试 |

## 一致性设计

- **并发新增**：Yjs 数组插入均保留，各端顺序一致。
- **属性合并**：每个对象是独立 `Y.Map`，不同 key 修改自动合并；同 key 冲突按 Yjs LWW 规则全端收敛。
- **删除不复活**：删除即从数组移除，迟到的远端移动只写入已删除对象的墓碑，不会复活。
- **离线编辑**：断网期间修改写入本地 Y.Doc，重连后由 Yjs 同步协议增量补齐，不做整板覆盖。
- **房间隔离**：以 URL 路径为房间名，服务端每房间独立文档；切换房间销毁 provider 与 Y.Doc 并清空本地撤销历史。

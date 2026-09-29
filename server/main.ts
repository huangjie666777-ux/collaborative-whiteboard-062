import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { RoomRegistry } from './rooms.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8787)
const DIST_DIR = path.resolve(__dirname, '../dist')

const registry = new RoomRegistry()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const filePath = path.join(DIST_DIR, pathname)
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退
      fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, index) => {
        if (e2) {
          res.writeHead(404)
          res.end('Not found. Run `npm run build` first.')
        } else {
          res.writeHead(200, { 'Content-Type': MIME['.html'] })
          res.end(index)
        }
      })
      return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: registry.names() }))
    return
  }
  serveStatic(req, res)
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  // 路径形如 /room/<roomId>
  const match = /^\/room\/([A-Za-z0-9_\-]{1,64})$/.exec(url.pathname)
  if (match === null) {
    socket.destroy()
    return
  }
  const roomName = decodeURIComponent(match[1])
  wss.handleUpgrade(req, socket, head, (ws) => {
    const room = registry.get(roomName)
    const conn = room.addConnection(ws)
    ws.emit('connection-ready', conn)
  })
})

server.listen(PORT, () => {
  console.log(`Whiteboard server listening on http://localhost:${PORT}`)
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/room/<roomId>`)
})

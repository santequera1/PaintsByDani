// Micro-contador de visitas (sin dependencias).
// Corre con pm2 en el VPS: pm2 start server/contador.js --name museo-contador
// nginx proxya /api/ → 127.0.0.1:3999
// Datos en ~/apps/museo-stats/counts.json (fuera del repo: sobrevive deploys)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.CONTADOR_DIR || path.join(process.env.HOME || '/home/ubuntu', 'apps', 'museo-stats')
const FILE = path.join(DATA_DIR, 'counts.json')
fs.mkdirSync(DATA_DIR, { recursive: true })

let data = { total: 0, paginas: {}, dias: {} }
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {}

let dirty = false
setInterval(() => {
  if (!dirty) return
  dirty = false
  fs.writeFile(FILE, JSON.stringify(data, null, 1), () => {})
}, 5000)

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost')

  if (u.pathname === '/api/visita') {
    const p = (u.searchParams.get('p') || 'desconocida').slice(0, 40).replace(/[^\w-]/g, '') || 'desconocida'
    data.total += 1
    data.paginas[p] = (data.paginas[p] || 0) + 1
    const dia = new Date().toISOString().slice(0, 10)
    data.dias[dia] = (data.dias[dia] || 0) + 1
    dirty = true
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, total: data.total }))
    return
  }

  if (u.pathname === '/api/visitas') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end('{"error":"not found"}')
})

server.listen(3999, '127.0.0.1', () => {
  console.log('contador de visitas en 127.0.0.1:3999 · datos en', FILE)
})

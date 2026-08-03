// Museario API — Fase 1 (solo lectura).
// Sirve artistas, colecciones y obras desde SQLite para las futuras páginas
// dinámicas /a/:artista/:coleccion. Sin dependencias (node:http + node:sqlite).
//
// Uso:  MUSEARIO_DB=/ruta/museario.db node server/museario-api.js
// pm2:  pm2 start server/museario-api.js --name museario-api
//
// Endpoints (nginx enruta /api/m/ → :3998):
//   GET /api/m/salud
//   GET /api/m/artistas                  → lista con colecciones resumidas
//   GET /api/m/a/:artista                → ficha del artista + colecciones
//   GET /api/m/a/:artista/:coleccion     → colección completa con obras

import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const RAIZ = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.MUSEARIO_DB || resolve(RAIZ, '..', 'museario.db')
const PORT = Number(process.env.PORT || 3998)

const db = new DatabaseSync(DB_PATH)

const qArtistas = db.prepare('SELECT * FROM artistas ORDER BY id')
const qArtista = db.prepare('SELECT * FROM artistas WHERE slug = ?')
const qColecciones = db.prepare(
  'SELECT * FROM colecciones WHERE artista_id = ? AND publicada = 1 ORDER BY orden'
)
const qColeccion = db.prepare(
  'SELECT * FROM colecciones WHERE artista_id = ? AND slug = ? AND publicada = 1'
)
const qObras = db.prepare('SELECT * FROM obras WHERE coleccion_id = ? ORDER BY orden')
const qPortada = db.prepare(
  'SELECT filename FROM obras WHERE coleccion_id = ? ORDER BY orden LIMIT 1'
)

const parse = (s) => (s == null ? null : JSON.parse(s))

const pubArtista = (a) => ({
  slug: a.slug,
  nombre: a.nombre,
  handle: a.handle,
  instagramUrl: a.instagram_url,
  website: a.website,
  profileImage: a.profile_image,
  bioEs: a.bio_es,
  bioEn: a.bio_en,
})

const pubColeccion = (c, { conEstilo = false } = {}) => ({
  slug: c.slug,
  nombre: c.nombre,
  subtitulo: c.subtitulo,
  imgBase: c.img_base,
  pdfUrl: c.pdf_url,
  portada: qPortada.get(c.id)?.filename ?? null,
  ...(conEstilo && {
    statementEs: parse(c.statement_es),
    statementEn: parse(c.statement_en),
    estilo: parse(c.estilo),
  }),
})

const pubObra = (o) => ({
  id: o.slug,
  filename: o.filename,
  ratio: o.ratio,
  title: o.titulo,
  titleEn: o.titulo_en,
  medium: o.medium,
  mediumEn: o.medium_en,
  price: o.precio,
  instagramUrl: o.instagram_url,
  room: o.sala,
})

function responder(res, code, data, cache = 60) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': code === 200 ? `public, max-age=${cache}` : 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

const server = createServer((req, res) => {
  let partes
  try {
    const url = new URL(req.url, 'http://x')
    partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return responder(res, 400, { error: 'URL inválida' })
  }
  // partes: ['api', 'm', ...resto]
  if (partes[0] !== 'api' || partes[1] !== 'm') {
    return responder(res, 404, { error: 'No encontrado' })
  }
  const resto = partes.slice(2)

  try {
    if (resto[0] === 'salud') return responder(res, 200, { ok: true }, 0)

    if (resto[0] === 'artistas' && resto.length === 1) {
      const lista = qArtistas.all().map((a) => ({
        ...pubArtista(a),
        colecciones: qColecciones.all(a.id).map((c) => pubColeccion(c)),
      }))
      return responder(res, 200, lista)
    }

    if (resto[0] === 'a' && resto[1]) {
      const a = qArtista.get(resto[1])
      if (!a) return responder(res, 404, { error: 'Artista no encontrado' })

      if (resto.length === 2) {
        return responder(res, 200, {
          ...pubArtista(a),
          colecciones: qColecciones.all(a.id).map((c) => pubColeccion(c)),
        })
      }
      if (resto.length === 3) {
        const c = qColeccion.get(a.id, resto[2])
        if (!c) return responder(res, 404, { error: 'Colección no encontrada' })
        return responder(res, 200, {
          artista: pubArtista(a),
          coleccion: pubColeccion(c, { conEstilo: true }),
          obras: qObras.all(c.id).map(pubObra),
        })
      }
    }

    return responder(res, 404, { error: 'No encontrado' })
  } catch (e) {
    console.error(e)
    return responder(res, 500, { error: 'Error interno' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`museario-api en http://127.0.0.1:${PORT} · db: ${DB_PATH}`)
})

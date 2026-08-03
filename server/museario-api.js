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
import { randomBytes } from 'node:crypto'

const RAIZ = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.MUSEARIO_DB || resolve(RAIZ, '..', 'museario.db')
const PORT = Number(process.env.PORT || 3998)

// OAuth de Google (variables de entorno en el VPS, nunca en el repo)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const BASE_URL = process.env.BASE_URL || 'https://museario.art'
const COOKIE_SECURE = BASE_URL.startsWith('https') ? '; Secure' : ''
const SESION_DIAS = 30

const db = new DatabaseSync(DB_PATH)

// Cuentas: estas tablas las posee la API (la migración del catálogo no las toca).
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    nombre TEXT,
    foto TEXT,
    artista_id INTEGER,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    expira_en TEXT NOT NULL
  );
`)

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

const upsertUsuario = db.prepare(
  `INSERT INTO usuarios (google_sub, email, nombre, foto) VALUES (?, ?, ?, ?)
   ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, nombre = excluded.nombre, foto = excluded.foto
   RETURNING id`
)
const insSesion = db.prepare(
  `INSERT INTO sesiones (token, usuario_id, expira_en) VALUES (?, ?, datetime('now', '+${SESION_DIAS} days'))`
)
const delSesion = db.prepare('DELETE FROM sesiones WHERE token = ?')
const qSesion = db.prepare(
  `SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
   WHERE s.token = ? AND s.expira_en > datetime('now')`
)

const parse = (s) => (s == null ? null : JSON.parse(s))

const pubArtista = (a) => ({
  slug: a.slug,
  nombre: a.nombre,
  handle: a.handle,
  instagramUrl: a.instagram_url,
  website: a.website,
  substack: a.substack,
  profileImage: a.profile_image,
  logoBlanco: a.logo_blanco,
  logoNegro: a.logo_negro,
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
  estilo: parse(c.estilo),
  ...(conEstilo && {
    statementEs: parse(c.statement_es),
    statementEn: parse(c.statement_en),
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

// --- helpers de auth ---
function leerCookies(req) {
  const out = {}
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=')
    if (i > 0) out[par.slice(0, i).trim()] = par.slice(i + 1).trim()
  }
  return out
}

function privado(res, code, data, cookies = []) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  if (cookies.length) headers['Set-Cookie'] = cookies
  res.writeHead(code, headers)
  res.end(JSON.stringify(data))
}

function redirigir(res, url, cookies = []) {
  const headers = { Location: url, 'Cache-Control': 'no-store' }
  if (cookies.length) headers['Set-Cookie'] = cookies
  res.writeHead(302, headers)
  res.end()
}

function usuarioActual(req) {
  const token = leerCookies(req)['museario_sesion']
  if (!token) return null
  return qSesion.get(token) || null
}

// GET /api/auth/google | /google/callback | /yo · POST /salir
async function rutasAuth(req, res, resto, url) {
  if (resto[1] === 'google' && resto.length === 2) {
    if (!GOOGLE_CLIENT_ID) return privado(res, 500, { error: 'OAuth sin configurar' })
    const state = randomBytes(16).toString('hex')
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    auth.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${BASE_URL}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    })
    return redirigir(res, auth.toString(), [
      `museario_state=${state}; Max-Age=600; Path=/api/auth; HttpOnly; SameSite=Lax${COOKIE_SECURE}`,
    ])
  }

  if (resto[1] === 'google' && resto[2] === 'callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const limpiarState = `museario_state=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Lax${COOKIE_SECURE}`
    if (!code || !state || state !== leerCookies(req)['museario_state']) {
      return redirigir(res, '/cuenta.html?error=estado', [limpiarState])
    }
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${BASE_URL}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tok = await r.json()
    if (!tok.id_token) {
      console.error('Token de Google rechazado:', tok.error, tok.error_description)
      return redirigir(res, '/cuenta.html?error=google', [limpiarState])
    }
    // El id_token llega directo de Google por TLS: el payload es confiable.
    const info = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString())
    const { id } = upsertUsuario.get(info.sub, info.email, info.name || null, info.picture || null)
    const token = randomBytes(32).toString('hex')
    insSesion.run(token, id)
    return redirigir(res, '/cuenta.html', [
      limpiarState,
      `museario_sesion=${token}; Max-Age=${SESION_DIAS * 86400}; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}`,
    ])
  }

  if (resto[1] === 'yo') {
    const u = usuarioActual(req)
    if (!u) return privado(res, 401, { error: 'Sin sesión' })
    return privado(res, 200, {
      email: u.email, nombre: u.nombre, foto: u.foto, artistaId: u.artista_id,
    })
  }

  if (resto[1] === 'salir' && req.method === 'POST') {
    const token = leerCookies(req)['museario_sesion']
    if (token) delSesion.run(token)
    return privado(res, 200, { ok: true }, [
      `museario_sesion=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}`,
    ])
  }

  return privado(res, 404, { error: 'No encontrado' })
}

const server = createServer(async (req, res) => {
  let partes, url
  try {
    url = new URL(req.url, BASE_URL)
    partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return responder(res, 400, { error: 'URL inválida' })
  }

  // /api/auth/... (cuentas y sesiones)
  if (partes[0] === 'api' && partes[1] === 'auth') {
    try {
      return await rutasAuth(req, res, partes.slice(1), url)
    } catch (e) {
      console.error(e)
      return privado(res, 500, { error: 'Error interno' })
    }
  }

  // partes: ['api', 'm', ...resto] (catálogo)
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

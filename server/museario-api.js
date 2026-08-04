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
import { resolve, dirname, join } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'

const RAIZ = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.MUSEARIO_DB || resolve(RAIZ, '..', 'museario.db')
const PORT = Number(process.env.PORT || 3998)

// OAuth de Google (variables de entorno en el VPS, nunca en el repo)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const BASE_URL = process.env.BASE_URL || 'https://museario.art'
const COOKIE_SECURE = BASE_URL.startsWith('https') ? '; Secure' : ''
const SESION_DIAS = 30

// Imágenes subidas desde el panel (fuera del repo y del dist; nginx sirve /media/)
const MEDIA_DIR = process.env.MUSEARIO_MEDIA || resolve(RAIZ, '..', 'media')
const MAX_SUBIDA = 30 * 1024 * 1024 // 30 MB

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
// columnas añadidas después del primer despliegue (ignorar si ya existen)
try { db.exec('ALTER TABLE usuarios ADD COLUMN password_hash TEXT') } catch {}
try { db.exec('ALTER TABLE colecciones ADD COLUMN portada TEXT') } catch {}
try { db.exec('ALTER TABLE artistas ADD COLUMN redes TEXT') } catch {}
try { db.exec('ALTER TABLE artistas ADD COLUMN fondo TEXT') } catch {}

// correos interesados desde la landing ("avísame cuando abra")
db.exec(`
  CREATE TABLE IF NOT EXISTS interesados (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// dist del sitio (para servir /a/... con metadatos OG por colección)
const DIST_DIR = process.env.MUSEARIO_DIST || resolve(RAIZ, '..', 'dist')

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
  redes: parse(a.redes) || {},
  fondo: a.fondo,
})

const pubColeccion = (c, { conEstilo = false } = {}) => ({
  slug: c.slug,
  nombre: c.nombre,
  subtitulo: c.subtitulo,
  imgBase: c.img_base,
  pdfUrl: c.pdf_url,
  portada: qPortada.get(c.id)?.filename ?? null,
  portadaUrl: c.portada
    ? `/${c.portada}`
    : (() => {
        const f = qPortada.get(c.id)?.filename
        return f ? `/${c.img_base}/thumb/${encodeURI(f.replace(/\.[^.]+$/, ''))}.webp` : null
      })(),
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

function crearSesion(usuarioId) {
  const token = randomBytes(32).toString('hex')
  insSesion.run(token, usuarioId)
  return `museario_sesion=${token}; Max-Age=${SESION_DIAS * 86400}; Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE}`
}

const hashClave = (clave) => {
  const sal = randomBytes(16).toString('hex')
  return `${sal}:${scryptSync(clave, sal, 64).toString('hex')}`
}
const verificarClave = (clave, guardado) => {
  const [sal, hash] = (guardado || '').split(':')
  if (!sal || !hash) return false
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(clave, sal, 64))
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
    return redirigir(res, '/panel.html', [limpiarState, crearSesion(id)])
  }

  // POST /api/auth/registro — cuenta con correo y contraseña
  if (resto[1] === 'registro' && req.method === 'POST') {
    const b = await leerJSON(req)
    const nombre = (b.nombre || '').trim()
    const email = (b.email || '').trim().toLowerCase()
    const clave = b.password || ''
    if (!nombre) return privado(res, 400, { error: 'El nombre es obligatorio' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return privado(res, 400, { error: 'Correo no válido' })
    if (clave.length < 8) return privado(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres' })
    const existente = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email)
    if (existente) {
      return privado(res, 409, {
        error: existente.google_sub
          ? 'Ese correo ya tiene cuenta con Google: usa "Continuar con Google"'
          : 'Ya existe una cuenta con ese correo. Inicia sesión.',
      })
    }
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO usuarios (email, nombre, password_hash) VALUES (?, ?, ?)'
    ).run(email, nombre, hashClave(clave))
    return privado(res, 200, { ok: true }, [crearSesion(id)])
  }

  // POST /api/auth/entrar — inicio de sesión con correo
  if (resto[1] === 'entrar' && req.method === 'POST') {
    const b = await leerJSON(req)
    const email = (b.email || '').trim().toLowerCase()
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email)
    if (u && !u.password_hash && u.google_sub) {
      return privado(res, 400, { error: 'Esta cuenta entra con Google: usa "Continuar con Google"' })
    }
    if (!u || !verificarClave(b.password || '', u.password_hash)) {
      return privado(res, 401, { error: 'Correo o contraseña incorrectos' })
    }
    return privado(res, 200, { ok: true }, [crearSesion(u.id)])
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

// ============================================================
// Panel de artista (/api/panel/*, requiere sesión)
// ============================================================

const ESTILOS = {
  // Galería blanca: cubo blanco, concreto, lienzo flotante sin marco
  blanca: { minimal: true, sinMarco: true, zocalo: false },
  // Clásica: piso de madera, marcos y zócalo
  clasica: { minimal: false, sinMarco: false, zocalo: true },
}

function slugificar(texto) {
  return (texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'sin-nombre'
}

function slugUnico(base, existe) {
  let slug = base
  for (let i = 2; existe(slug); i++) slug = `${base}-${i}`
  return slug
}

function limpiarNombreArchivo(nombre) {
  const sinExt = (nombre || 'obra').replace(/\.[^.]+$/, '')
  return sinExt.normalize('NFC').replace(/[\\/:*?"<>|#%&{}]/g, '').trim().slice(0, 80) || 'obra'
}

function leerJSON(req) {
  return new Promise((resolver, rechazar) => {
    let datos = ''
    req.on('data', (c) => {
      datos += c
      if (datos.length > 1e6) { rechazar(new Error('JSON muy grande')); req.destroy() }
    })
    req.on('end', () => {
      try { resolver(datos ? JSON.parse(datos) : {}) } catch (e) { rechazar(e) }
    })
    req.on('error', rechazar)
  })
}

function leerBinario(req) {
  return new Promise((resolver, rechazar) => {
    const trozos = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > MAX_SUBIDA) { rechazar(new Error('Archivo muy grande (máx 30 MB)')); req.destroy(); return }
      trozos.push(c)
    })
    req.on('end', () => resolver(Buffer.concat(trozos)))
    req.on('error', rechazar)
  })
}

const qArtistaDeUsuario = db.prepare('SELECT a.* FROM artistas a WHERE a.id = ?')
const qColeccionPanel = db.prepare('SELECT * FROM colecciones WHERE artista_id = ? AND slug = ?')
const qObraPanel = db.prepare(
  `SELECT o.*, c.artista_id, c.img_base FROM obras o JOIN colecciones c ON c.id = o.coleccion_id
   WHERE o.id = ?`
)

async function rutasPanel(req, res, resto, url) {
  const u = usuarioActual(req)
  if (!u) return privado(res, 401, { error: 'Inicia sesión para usar el panel' })
  const artista = u.artista_id ? qArtistaDeUsuario.get(u.artista_id) : null

  // GET /api/panel/estado — todo lo que el panel necesita para pintarse
  if (resto[1] === 'estado' && req.method === 'GET') {
    let colecciones = []
    if (artista) {
      colecciones = qColecciones.all(artista.id).map((c) => {
        const primera = qPortada.get(c.id)?.filename
        return {
          slug: c.slug,
          nombre: c.nombre,
          subtitulo: c.subtitulo,
          imgBase: c.img_base,
          publicada: !!c.publicada,
          estilo: parse(c.estilo),
          portadaUrl: c.portada
            ? `/${c.portada}`
            : (primera ? `/${c.img_base}/thumb/${encodeURI(primera.replace(/\.[^.]+$/, ''))}.webp` : null),
          obras: qObras.all(c.id).map((o) => ({
            id: o.id, slug: o.slug, filename: o.filename, ratio: o.ratio,
            title: o.titulo, medium: o.medium, price: o.precio,
          })),
        }
      })
    }
    return privado(res, 200, {
      usuario: { email: u.email, nombre: u.nombre, foto: u.foto },
      limiteMuseos: 5,
      artista: artista && {
        slug: artista.slug, nombre: artista.nombre, handle: artista.handle,
        instagramUrl: artista.instagram_url, website: artista.website,
        substack: artista.substack, bioEs: artista.bio_es,
        foto: artista.profile_image,
        redes: parse(artista.redes) || {},
        fondo: artista.fondo,
        colecciones,
      },
    })
  }

  // GET /api/panel/qr?texto=... — código QR en PNG (para compartir un museo)
  if (resto[1] === 'qr' && req.method === 'GET') {
    const texto = url.searchParams.get('texto') || ''
    if (!texto.startsWith(BASE_URL)) return privado(res, 400, { error: 'URL no válida' })
    const QR = (await import('qrcode')).default
    const png = await QR.toBuffer(texto, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' })
    return res.end(png)
  }

  // POST /api/panel/artista — crear o actualizar el perfil del artista
  if (resto[1] === 'artista' && resto.length === 2 && req.method === 'POST') {
    const b = await leerJSON(req)
    const nombre = (b.nombre || '').trim()
    if (!nombre) return privado(res, 400, { error: 'El nombre es obligatorio' })
    const handle = (b.handle || '').trim() || null
    const instagram = (b.instagramUrl || '').trim() || null
    const website = (b.website || '').trim() || null
    const substack = (b.substack || '').trim() || null
    const bio = (b.bioEs || '').trim() || null
    // redes opcionales (linktree del artista)
    let redes = null
    if (b.redes && typeof b.redes === 'object') {
      const limpio = {}
      for (const k of ['telefono', 'behance', 'youtube', 'tiktok', 'facebook', 'x']) {
        const v = (b.redes[k] || '').toString().trim()
        if (v) limpio[k] = v.slice(0, 200)
      }
      redes = Object.keys(limpio).length ? JSON.stringify(limpio) : null
    }
    if (artista) {
      db.prepare(
        'UPDATE artistas SET nombre=?, handle=?, instagram_url=?, website=?, substack=?, bio_es=?, redes=? WHERE id=?'
      ).run(nombre, handle, instagram, website, substack, bio, redes, artista.id)
      return privado(res, 200, { ok: true, slug: artista.slug })
    }
    const slug = slugUnico(slugificar(nombre), (s) => !!qArtista.get(s))
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO artistas (slug, nombre, handle, instagram_url, website, substack, bio_es, redes) VALUES (?,?,?,?,?,?,?,?)'
    ).run(slug, nombre, handle, instagram, website, substack, bio, redes)
    db.prepare('UPDATE usuarios SET artista_id=? WHERE id=?').run(id, u.id)
    return privado(res, 200, { ok: true, slug })
  }

  // Todo lo demás requiere perfil de artista
  if (!artista) return privado(res, 400, { error: 'Crea primero tu perfil de artista' })

  // POST /api/panel/artista/foto — foto o logo del artista (portada del recorrido)
  if (resto[1] === 'artista' && resto[2] === 'foto' && req.method === 'POST') {
    const sharp = (await import('sharp')).default
    const cuerpo = await leerBinario(req)
    if (!cuerpo.length) return privado(res, 400, { error: 'Imagen vacía' })
    const dir = join(MEDIA_DIR, artista.slug)
    await mkdir(dir, { recursive: true })
    // fit inside (sin recortar): sirve igual para un logo que para una foto
    await sharp(cuerpo, { failOn: 'none' }).rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 }).toFile(join(dir, 'perfil.webp'))
    const ruta = `/media/${artista.slug}/perfil.webp?v=${Date.now()}`
    db.prepare('UPDATE artistas SET profile_image = ? WHERE id = ?').run(ruta, artista.id)
    return privado(res, 200, { ok: true, foto: ruta })
  }

  // POST /api/panel/artista/fondo — foto de fondo del perfil público (vertical)
  if (resto[1] === 'artista' && resto[2] === 'fondo' && req.method === 'POST') {
    const sharp = (await import('sharp')).default
    const cuerpo = await leerBinario(req)
    if (!cuerpo.length) return privado(res, 400, { error: 'Imagen vacía' })
    const dir = join(MEDIA_DIR, artista.slug)
    await mkdir(dir, { recursive: true })
    await sharp(cuerpo, { failOn: 'none' }).rotate()
      .resize({ width: 1080, height: 1700, fit: 'cover' })
      .webp({ quality: 80 }).toFile(join(dir, 'fondo.webp'))
    const ruta = `/media/${artista.slug}/fondo.webp?v=${Date.now()}`
    db.prepare('UPDATE artistas SET fondo = ? WHERE id = ?').run(ruta, artista.id)
    return privado(res, 200, { ok: true, fondo: ruta })
  }

  // POST /api/panel/colecciones — crear colección (máximo 5 por artista)
  if (resto[1] === 'colecciones' && resto.length === 2 && req.method === 'POST') {
    if (qColecciones.all(artista.id).length >= 5) {
      return privado(res, 400, { error: 'Por ahora el límite es de 5 museos por artista' })
    }
    const b = await leerJSON(req)
    const nombre = (b.nombre || '').trim()
    if (!nombre) return privado(res, 400, { error: 'El nombre es obligatorio' })
    const estilo = ESTILOS[b.estilo] || ESTILOS.blanca
    const slug = slugUnico(slugificar(nombre), (s) => !!qColeccionPanel.get(artista.id, s))
    const imgBase = `media/${artista.slug}/${slug}`
    db.prepare(
      `INSERT INTO colecciones (artista_id, slug, nombre, subtitulo, img_base, estilo, orden, publicada)
       VALUES (?,?,?,?,?,?, (SELECT COALESCE(MAX(orden)+1,0) FROM colecciones WHERE artista_id=?), 1)`
    ).run(artista.id, slug, nombre, (b.subtitulo || '').trim() || null, imgBase, JSON.stringify(estilo), artista.id)
    await mkdir(join(MEDIA_DIR, artista.slug, slug, 'thumb'), { recursive: true })
    await mkdir(join(MEDIA_DIR, artista.slug, slug, 'full'), { recursive: true })
    await mkdir(join(MEDIA_DIR, artista.slug, slug, 'orig'), { recursive: true })
    return privado(res, 200, { ok: true, slug })
  }

  // PATCH /api/panel/colecciones/:slug — nombre, subtítulo, publicada, estilo y texturas
  if (resto[1] === 'colecciones' && resto[2] && req.method === 'PATCH') {
    const col = qColeccionPanel.get(artista.id, resto[2])
    if (!col) return privado(res, 404, { error: 'Colección no encontrada' })
    const b = await leerJSON(req)

    let estilo = parse(col.estilo) || {}
    if (b.estiloBase && ESTILOS[b.estiloBase]) {
      estilo = { ...estilo, ...ESTILOS[b.estiloBase] }
    }
    if (b.sinMarco !== undefined) estilo.sinMarco = !!b.sinMarco
    if (b.banca !== undefined) estilo.banca = !!b.banca
    if (b.texturas !== undefined) {
      // valores: null (por defecto del estilo), id del sistema, o URL /media/ ya subida
      const SISTEMA = {
        piso: { concreto: '/texturas/piso-rumiaciones-2k.webp' },
        pared: { yeso: '/texturas/pared-rumiaciones-2k.webp' },
      }
      const tex = { ...(estilo.texturas || {}) }
      for (const tipo of ['piso', 'pared']) {
        if (b.texturas[tipo] === undefined) continue
        const v = b.texturas[tipo]
        if (!v) delete tex[tipo]
        else if (SISTEMA[tipo][v]) tex[tipo] = SISTEMA[tipo][v]
        else if (typeof v === 'string' && v.startsWith(`/media/${artista.slug}/`)) tex[tipo] = v
      }
      estilo.texturas = Object.keys(tex).length ? tex : undefined
      if (!estilo.texturas) delete estilo.texturas
    }

    db.prepare('UPDATE colecciones SET nombre=?, subtitulo=?, publicada=?, estilo=? WHERE id=?').run(
      (b.nombre ?? col.nombre) || col.nombre,
      b.subtitulo !== undefined ? ((b.subtitulo || '').trim() || null) : col.subtitulo,
      b.publicada !== undefined ? (b.publicada ? 1 : 0) : col.publicada,
      JSON.stringify(estilo),
      col.id
    )
    return privado(res, 200, { ok: true })
  }

  // DELETE /api/panel/colecciones/:slug/obras — vaciar la galería (todas las obras)
  if (resto[1] === 'colecciones' && resto[2] && resto[3] === 'obras' && req.method === 'DELETE') {
    const col = qColeccionPanel.get(artista.id, resto[2])
    if (!col) return privado(res, 404, { error: 'Colección no encontrada' })
    const obras = qObras.all(col.id)
    db.prepare('DELETE FROM obras WHERE coleccion_id=?').run(col.id)
    if (col.img_base.startsWith('media/')) {
      const dir = join(MEDIA_DIR, col.img_base.replace(/^media\//, ''))
      for (const o of obras) {
        const baseFinal = o.filename.replace(/\.[^.]+$/, '')
        for (const ruta of [
          join(dir, 'orig', o.filename),
          join(dir, 'full', `${baseFinal}.webp`),
          join(dir, 'thumb', `${baseFinal}.webp`),
        ]) await rm(ruta, { force: true })
      }
    }
    return privado(res, 200, { ok: true, eliminadas: obras.length })
  }

  // DELETE /api/panel/colecciones/:slug — eliminar museo completo
  if (resto[1] === 'colecciones' && resto[2] && resto.length === 3 && req.method === 'DELETE') {
    const col = qColeccionPanel.get(artista.id, resto[2])
    if (!col) return privado(res, 404, { error: 'Colección no encontrada' })
    if (!col.img_base.startsWith('media/')) {
      return privado(res, 400, { error: 'Esta colección se administra desde el sistema' })
    }
    db.prepare('DELETE FROM obras WHERE coleccion_id=?').run(col.id)
    db.prepare('DELETE FROM colecciones WHERE id=?').run(col.id)
    await rm(join(MEDIA_DIR, artista.slug, col.slug), { recursive: true, force: true })
    return privado(res, 200, { ok: true })
  }

  // POST /api/panel/colecciones/:slug/portada — imagen de portada (cards y compartir)
  if (resto[1] === 'colecciones' && resto[2] && resto[3] === 'portada' && req.method === 'POST') {
    const col = qColeccionPanel.get(artista.id, resto[2])
    if (!col) return privado(res, 404, { error: 'Colección no encontrada' })
    const sharp = (await import('sharp')).default
    const cuerpo = await leerBinario(req)
    if (!cuerpo.length) return privado(res, 400, { error: 'Imagen vacía' })
    const dir = join(MEDIA_DIR, artista.slug, col.slug)
    await mkdir(dir, { recursive: true })
    // 1200×630: el tamaño que esperan WhatsApp y las redes al compartir
    await sharp(cuerpo, { failOn: 'none' }).rotate()
      .resize(1200, 630, { fit: 'cover' })
      .jpeg({ quality: 84 }).toFile(join(dir, 'portada.jpg'))
    // la versión va en la ruta guardada: sin ella el navegador sigue
    // mostrando la portada anterior (cache de 30 días en /media/)
    const ruta = `media/${artista.slug}/${col.slug}/portada.jpg?v=${Date.now()}`
    db.prepare('UPDATE colecciones SET portada=? WHERE id=?').run(ruta, col.id)
    return privado(res, 200, { ok: true, portadaUrl: `/${ruta}` })
  }

  // POST /api/panel/colecciones/:slug/textura?tipo=piso|pared — textura propia
  if (resto[1] === 'colecciones' && resto[2] && resto[3] === 'textura' && req.method === 'POST') {
    const col = qColeccionPanel.get(artista.id, resto[2])
    if (!col) return privado(res, 404, { error: 'Colección no encontrada' })
    const tipo = url.searchParams.get('tipo')
    if (tipo !== 'piso' && tipo !== 'pared') return privado(res, 400, { error: 'Tipo no válido' })
    const sharp = (await import('sharp')).default
    const cuerpo = await leerBinario(req)
    if (!cuerpo.length) return privado(res, 400, { error: 'Imagen vacía' })
    const dir = join(MEDIA_DIR, artista.slug, col.slug)
    await mkdir(dir, { recursive: true })
    await sharp(cuerpo, { failOn: 'none' }).rotate()
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toFile(join(dir, `textura-${tipo}.webp`))
    const ruta = `/media/${artista.slug}/${col.slug}/textura-${tipo}.webp?v=${Date.now()}`
    const estilo = parse(col.estilo) || {}
    estilo.texturas = { ...(estilo.texturas || {}), [tipo]: ruta }
    db.prepare('UPDATE colecciones SET estilo=? WHERE id=?').run(JSON.stringify(estilo), col.id)
    return privado(res, 200, { ok: true, url: ruta })
  }

  // POST /api/panel/colecciones/:slug/obras?filename=&title=&medium=&price=
  // (el cuerpo es la imagen en binario; sharp genera thumb/full en webp)
  if (resto[1] === 'colecciones' && resto[2] && resto[3] === 'obras' && req.method === 'POST') {
    const col = qColeccionPanel.get(artista.id, resto[2])
    if (!col) return privado(res, 404, { error: 'Colección no encontrada' })
    let sharp
    try {
      sharp = (await import('sharp')).default
    } catch {
      return privado(res, 500, { error: 'El procesador de imágenes no está disponible' })
    }
    const cuerpo = await leerBinario(req)
    if (!cuerpo.length) return privado(res, 400, { error: 'Imagen vacía' })

    const base = limpiarNombreArchivo(url.searchParams.get('filename'))
    const titulo = (url.searchParams.get('title') || '').trim() || base
    const medium = (url.searchParams.get('medium') || '').trim() || null
    const precio = (url.searchParams.get('price') || '').trim() || null

    const dir = join(MEDIA_DIR, artista.slug, col.slug)
    const img = sharp(cuerpo, { failOn: 'none' }).rotate() // respeta la orientación EXIF
    const meta = await img.metadata()
    if (!meta.width || !meta.height) return privado(res, 400, { error: 'No parece una imagen válida' })
    const ratio = Math.round((meta.width / meta.height) * 1000) / 1000

    // nombre único dentro de la colección
    const existe = db.prepare('SELECT 1 FROM obras WHERE coleccion_id=? AND filename=?')
    let nombreArchivo = `${base}.jpg`
    for (let i = 2; existe.get(col.id, nombreArchivo); i++) nombreArchivo = `${base} (${i}).jpg`
    const baseFinal = nombreArchivo.replace(/\.[^.]+$/, '')

    await mkdir(join(dir, 'thumb'), { recursive: true })
    await mkdir(join(dir, 'full'), { recursive: true })
    await mkdir(join(dir, 'orig'), { recursive: true })
    await writeFile(join(dir, 'orig', nombreArchivo), cuerpo)
    await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toFile(join(dir, 'full', `${baseFinal}.webp`))
    await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 }).toFile(join(dir, 'thumb', `${baseFinal}.webp`))

    const slugObra = slugUnico(slugificar(titulo), (s) =>
      !!db.prepare('SELECT 1 FROM obras WHERE coleccion_id=? AND slug=?').get(col.id, s))
    const { lastInsertRowid: id } = db.prepare(
      `INSERT INTO obras (coleccion_id, slug, filename, ratio, titulo, medium, precio, instagram_url, orden)
       VALUES (?,?,?,?,?,?,?,?, (SELECT COALESCE(MAX(orden)+1,0) FROM obras WHERE coleccion_id=?))`
    ).run(col.id, slugObra, nombreArchivo, ratio, titulo, medium, precio, artista.instagram_url, col.id)
    return privado(res, 200, { ok: true, id, filename: nombreArchivo, ratio })
  }

  // PATCH /api/panel/obras/:id — editar título/técnica/precio
  if (resto[1] === 'obras' && resto[2] && req.method === 'PATCH') {
    const obra = qObraPanel.get(Number(resto[2]))
    if (!obra || obra.artista_id !== artista.id) return privado(res, 404, { error: 'Obra no encontrada' })
    const b = await leerJSON(req)
    db.prepare('UPDATE obras SET titulo=?, medium=?, precio=? WHERE id=?').run(
      (b.title ?? obra.titulo) || obra.titulo,
      b.medium !== undefined ? ((b.medium || '').trim() || null) : obra.medium,
      b.price !== undefined ? ((b.price || '').trim() || null) : obra.precio,
      obra.id
    )
    return privado(res, 200, { ok: true })
  }

  // DELETE /api/panel/obras/:id — borrar obra y sus archivos
  if (resto[1] === 'obras' && resto[2] && req.method === 'DELETE') {
    const obra = qObraPanel.get(Number(resto[2]))
    if (!obra || obra.artista_id !== artista.id) return privado(res, 404, { error: 'Obra no encontrada' })
    db.prepare('DELETE FROM obras WHERE id=?').run(obra.id)
    if (obra.img_base && obra.img_base.startsWith('media/')) {
      const dir = join(MEDIA_DIR, obra.img_base.replace(/^media\//, ''))
      const baseFinal = obra.filename.replace(/\.[^.]+$/, '')
      for (const ruta of [
        join(dir, 'orig', obra.filename),
        join(dir, 'full', `${baseFinal}.webp`),
        join(dir, 'thumb', `${baseFinal}.webp`),
      ]) await rm(ruta, { force: true })
    }
    return privado(res, 200, { ok: true })
  }

  return privado(res, 404, { error: 'No encontrado' })
}

// ============================================================
// Páginas /a/:artista/:coleccion(/galeria) con OG por colección
// (nginx nos proxya estas rutas; inyectamos título, portada y
// favicon del artista sobre el m.html/g.html construidos)
// ============================================================
const tplCache = {}
async function plantilla(nombre) {
  const c = tplCache[nombre]
  if (c && Date.now() - c.ts < 60000) return c.html
  const html = await readFile(join(DIST_DIR, nombre), 'utf8')
  tplCache[nombre] = { html, ts: Date.now() }
  return html
}

const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// /a/:artista — perfil público del artista (tipo linktree)
async function paginaPerfil(res, slug) {
  let html = await plantilla('perfil.html')
  const a = qArtista.get(slug)
  if (a) {
    const titulo = `${a.nombre} — Museario`
    const desc = (a.bio_es || `Museos y galerías de ${a.nombre} en Museario.`).slice(0, 200)
    const imgRel = (a.fondo || a.profile_image) ? (a.fondo || a.profile_image).split('?')[0] : null
    const urlPag = `${BASE_URL}/a/${a.slug}`
    const favicon = imgRel ? encodeURI(imgRel) : '/museario/favicon.svg'
    const og = [
      `  <meta property="og:type" content="profile" />`,
      `  <meta property="og:site_name" content="Museario" />`,
      `  <meta property="og:title" content="${escHtml(titulo)}" />`,
      `  <meta property="og:description" content="${escHtml(desc)}" />`,
      `  <meta property="og:url" content="${urlPag}" />`,
      imgRel && `  <meta property="og:image" content="${BASE_URL}${encodeURI(imgRel)}" />`,
    ].filter(Boolean).join('\n')
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(titulo)}</title>`)
      .replace(/\s*<meta property="og:[^"]+"[^>]*\/>/g, '')
      .replace(/\s*<link rel="icon"[^>]*\/>/, `\n  <link rel="icon" href="${favicon}" />`)
      .replace('</head>', `${og}\n</head>`)
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' })
  res.end(html)
}

async function paginaMuseo(res, partes) {
  const esGaleria = partes[3] === 'galeria'
  let html = await plantilla(esGaleria ? 'g.html' : 'm.html')
  const a = qArtista.get(partes[1])
  const col = a ? qColeccion.get(a.id, partes[2]) : null
  if (a && col) {
    const titulo = `${col.nombre} · ${a.nombre} — ${esGaleria ? 'Galería' : 'Museo Virtual 3D'}`
    const desc = esGaleria
      ? `Recorre la galería interactiva de ${col.nombre}, de ${a.nombre}, en Museario.`
      : `Camina por ${col.nombre}, el museo 3D de ${a.nombre}, en Museario.`
    const primera = qPortada.get(col.id)?.filename
    const imgRel = col.portada
      ? `/${col.portada}`
      : (primera ? `/${col.img_base}/full/${primera.replace(/\.[^.]+$/, '')}.webp` : null)
    const urlPag = `${BASE_URL}/a/${a.slug}/${col.slug}${esGaleria ? '/galeria' : ''}`
    const favicon = a.profile_image ? encodeURI(a.profile_image.split('?')[0]) : '/museario/favicon.svg'
    const og = [
      `  <meta property="og:type" content="website" />`,
      `  <meta property="og:site_name" content="Museario" />`,
      `  <meta property="og:title" content="${escHtml(titulo)}" />`,
      `  <meta property="og:description" content="${escHtml(desc)}" />`,
      `  <meta property="og:url" content="${urlPag}" />`,
      imgRel && `  <meta property="og:image" content="${BASE_URL}${encodeURI(imgRel)}" />`,
      imgRel && `  <meta property="og:image:width" content="1200" />`,
      imgRel && `  <meta name="twitter:card" content="summary_large_image" />`,
      imgRel && `  <meta name="twitter:image" content="${BASE_URL}${encodeURI(imgRel)}" />`,
    ].filter(Boolean).join('\n')
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(titulo)}</title>`)
      .replace(/\s*<meta property="og:[^"]+"[^>]*\/>/g, '')
      .replace(/\s*<link rel="icon"[^>]*\/>/, `\n  <link rel="icon" href="${favicon}" />`)
      .replace('</head>', `${og}\n</head>`)
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' })
  res.end(html)
}

const server = createServer(async (req, res) => {
  let partes, url
  try {
    url = new URL(req.url, BASE_URL)
    partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return responder(res, 400, { error: 'URL inválida' })
  }

  // /a/:artista(/:coleccion(/galeria)) — páginas públicas con OG dinámico
  if (partes[0] === 'a' && partes[1]) {
    try {
      if (partes[2]) return await paginaMuseo(res, partes)
      return await paginaPerfil(res, partes[1])
    } catch (e) {
      console.error(e)
      return responder(res, 500, { error: 'Error interno' })
    }
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

  // /api/panel/... (panel de artista)
  if (partes[0] === 'api' && partes[1] === 'panel') {
    try {
      return await rutasPanel(req, res, partes.slice(1), url)
    } catch (e) {
      console.error(e)
      return privado(res, 500, { error: e.message || 'Error interno' })
    }
  }

  // partes: ['api', 'm', ...resto] (catálogo)
  if (partes[0] !== 'api' || partes[1] !== 'm') {
    return responder(res, 404, { error: 'No encontrado' })
  }
  const resto = partes.slice(2)

  try {
    if (resto[0] === 'salud') return responder(res, 200, { ok: true }, 0)

    // POST /api/m/interes — correo de "avísame" de la landing
    if (resto[0] === 'interes' && req.method === 'POST') {
      const b = await leerJSON(req)
      const email = (b.email || '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return privado(res, 400, { error: 'Correo no válido' })
      }
      db.prepare('INSERT OR IGNORE INTO interesados (email) VALUES (?)').run(email)
      return privado(res, 200, { ok: true })
    }

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

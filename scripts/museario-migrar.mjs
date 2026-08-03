// Museario — Fase 1: migración de los datos estáticos (src/data/*.js) a SQLite.
// La base resultante es la fuente para la API (server/museario-api.js) y, más
// adelante, para las páginas dinámicas /a/:artista/:coleccion y el panel de artistas.
//
// Uso:  node scripts/museario-migrar.mjs [ruta/museario.db]
// La base se regenera completa en cada ejecución (los datos fuente siguen
// siendo los .js hasta que exista el panel de subida).

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { ARTIST as DANNI, ROOMS, ARTWORKS as OBRAS_DANNI } from '../src/data/artworks.js'
import { ARTIST as CATALINA, ARTWORKS as OBRAS_RUMIACIONES } from '../src/data/catalina.js'
import { COLLECTION as CONEXIONES, ARTWORKS as OBRAS_CONEXIONES } from '../src/data/conexiones.js'
import { ARTWORKS as OBRAS_ALMA } from '../src/data/alma.js'

const DB_PATH = resolve(process.argv[2] || 'museario.db')

// Títulos EN de Rumiaciones (oficiales de Catalina; ver src/museo/rumiaciones.js).
const TITULOS_EN_RUMIACIONES = {
  'llegaste-bien': 'Did You Get Home Safely? 2026',
  'helado': 'I Like Watching You Eat Ice Cream, 2026',
  'parque': 'I Feel Connected to This Park, 2026',
  'santuario': 'My Home Is My Sanctuary, 2026',
  'oceano': 'Lost in the Ocean, 2026',
  'te-deseo': 'I Wish You the Best, 2026',
  'distancia': 'I Saw You from a Distance, 2026',
  'sabor-sudor': 'The Taste of Your Sweat, 2026',
  'ojos': 'I Like Your Eyes, 2026',
  'arte': 'I Want to Feel Your Art, 2026',
  'conversaciones': 'We Always Have Good Conversations, 2026',
  'caminos': 'We Took Different Paths, 2026',
}

const mediumEn = (m) =>
  (m || '')
    .replace('Acrílico sobre lienzo sin imprimar', 'Acrylic on unprimed canvas')
    .replace('54 × 94 cm', '21.3 × 37 in')
    .replace('60 × 94 cm', '23.6 × 37 in')
    .replace('60 × 95 cm', '23.6 × 37.4 in') || null

const STATEMENT_RUMIACIONES_ES = [
  'La serie de pinturas acrílicas sobre lienzo de Catalina Olivero refleja la anatomía del pensamiento repetitivo, donde la abstracción opera como un medio para procesar la inestabilidad de los vínculos afectivos. Al prescindir de una imprimación que proteja el soporte, la tela cruda absorbe el pigmento de manera irreversible, transformándose en un registro textil del tránsito de las relaciones, una inmersión donde lavados ligeros y tonos vibrantes coexisten junto a texturas de carácter terroso.',
  'Estas obras, cuyos títulos recuperan fragmentos de diálogos personales, articulan un lenguaje visual de trazos que asemejan laberintos, espacios negativos que dan respiración al plano y un salpicado visceral que irrumpe como clausura mental. Así, a través de composiciones asimétricas que equilibran la tensión entre el control y la resistencia, la muestra invita a presenciar una liturgia del desahogo donde la rumiación de las ideas se convierte en un acto de liberación.',
]
const STATEMENT_RUMIACIONES_EN = [
  "Catalina Olivero's series of acrylic paintings on canvas reflects the anatomy of repetitive thought, where abstraction operates as a means of processing the instability of emotional bonds. By forgoing a primer to protect the support, the raw canvas absorbs the pigment irreversibly, becoming a textile record of the passage of relationships — an immersion where light washes and vibrant tones coexist with earthy textures.",
  'These works, whose titles recover fragments of personal dialogues, articulate a visual language of strokes that resemble labyrinths, negative spaces that let the plane breathe, and a visceral splatter that erupts like mental closure. Thus, through asymmetrical compositions that balance the tension between control and resistance, the exhibition invites us to witness a liturgy of release in which the rumination of ideas becomes an act of liberation.',
]

// --- crear base ---
// Este script solo regenera los artistas SEMILLA (danni, catalina), cuyos datos
// viven en src/data/*.js. Los artistas creados desde el panel de Museario y las
// tablas de cuentas (usuarios/sesiones) se conservan intactos.
const SEMILLA = ['danni', 'catalina']
mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS artistas (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    handle TEXT,
    instagram_url TEXT,
    website TEXT,
    substack TEXT,
    profile_image TEXT,
    logo_blanco TEXT,
    logo_negro TEXT,
    bio_es TEXT,
    bio_en TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS colecciones (
    id INTEGER PRIMARY KEY,
    artista_id INTEGER NOT NULL REFERENCES artistas(id),
    slug TEXT NOT NULL,
    nombre TEXT NOT NULL,
    subtitulo TEXT,
    img_base TEXT NOT NULL,
    statement_es TEXT,  -- JSON: array de párrafos
    statement_en TEXT,  -- JSON: array de párrafos
    pdf_url TEXT,
    estilo TEXT,        -- JSON: flags de la sala 3D (minimal, sinMarco, zocalo, ...)
    orden INTEGER NOT NULL DEFAULT 0,
    publicada INTEGER NOT NULL DEFAULT 1,
    UNIQUE (artista_id, slug)
  );
  CREATE TABLE IF NOT EXISTS obras (
    id INTEGER PRIMARY KEY,
    coleccion_id INTEGER NOT NULL REFERENCES colecciones(id),
    slug TEXT NOT NULL,
    filename TEXT NOT NULL,
    ratio REAL,
    titulo TEXT NOT NULL,
    titulo_en TEXT,
    medium TEXT,
    medium_en TEXT,
    precio TEXT,
    instagram_url TEXT,
    sala INTEGER NOT NULL DEFAULT 0,
    orden INTEGER NOT NULL,
    UNIQUE (coleccion_id, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_colecciones_artista ON colecciones (artista_id);
  CREATE INDEX IF NOT EXISTS idx_obras_coleccion ON obras (coleccion_id);
`)

// Borrar solo los datos de los artistas semilla (se reinsertan abajo).
{
  const delObras = db.prepare(
    'DELETE FROM obras WHERE coleccion_id IN (SELECT id FROM colecciones WHERE artista_id = ?)'
  )
  const delColecciones = db.prepare('DELETE FROM colecciones WHERE artista_id = ?')
  const delArtista = db.prepare('DELETE FROM artistas WHERE id = ?')
  for (const slug of SEMILLA) {
    const fila = db.prepare('SELECT id FROM artistas WHERE slug = ?').get(slug)
    if (!fila) continue
    delObras.run(fila.id)
    delColecciones.run(fila.id)
    delArtista.run(fila.id)
  }
}

const insArtista = db.prepare(
  `INSERT INTO artistas (slug, nombre, handle, instagram_url, website, substack, profile_image, logo_blanco, logo_negro, bio_es, bio_en)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
)
const insColeccion = db.prepare(
  `INSERT INTO colecciones (artista_id, slug, nombre, subtitulo, img_base, statement_es, statement_en, pdf_url, estilo, orden)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
)
const insObra = db.prepare(
  `INSERT INTO obras (coleccion_id, slug, filename, ratio, titulo, titulo_en, medium, medium_en, precio, instagram_url, sala, orden)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
)

const J = (v) => (v == null ? null : JSON.stringify(v))

function agregarObras(coleccionId, obras, { tituloEn = {}, conMediumEn = false } = {}) {
  obras.forEach((a, i) => {
    insObra.run(
      coleccionId,
      a.id,
      a.filename,
      a.ratio ?? null,
      a.title,
      tituloEn[a.id] || null,
      a.medium || null,
      conMediumEn ? mediumEn(a.medium) : null,
      a.price || null,
      a.instagramUrl || null,
      a.room ?? 0,
      i
    )
  })
}

// --- Danní ---
const danniId = insArtista.run(
  'danni', DANNI.name, DANNI.handle, DANNI.instagramUrl, null, null,
  DANNI.profileImage, null, null, DANNI.bioEs, DANNI.bioEn
).lastInsertRowid

const colDanni = insColeccion.run(
  danniId, 'obras', 'Colección permanente', '2025 – Presente', 'posts',
  null, null, null,
  J({ tipo: 'salas', rooms: ROOMS }), 0
).lastInsertRowid
agregarObras(colDanni, OBRAS_DANNI)

// --- Catalina ---
const CATALINA_BIO_ES =
  'Mi nombre es Catalina Olivero. Soy pintora abstracta y artista multidisciplinaria radicada en Cartagena de Indias, dedicada a la búsqueda de la claridad visual. Convencida de que el proceso creativo debe compartirse, uso mi Substack para explorar los rituales que sostienen mi práctica.'
const cataId = insArtista.run(
  'catalina', CATALINA.name, CATALINA.handle, CATALINA.instagramUrl,
  CATALINA.website, 'https://substack.com/@catalinaoliveroart', CATALINA.profileImage,
  '/cat-logo-blanco.svg', '/cat-logo-negro.svg', CATALINA_BIO_ES, CATALINA.bio
).lastInsertRowid

const colRum = insColeccion.run(
  cataId, 'rumiaciones', 'Rumiaciones', '2026', 'cat-posts',
  J(STATEMENT_RUMIACIONES_ES), J(STATEMENT_RUMIACIONES_EN), null,
  J({
    minimal: true, sinMarco: true, zocalo: false, reflect: 'desktop', bilingue: true,
    nombreEn: 'Ruminations',
    subtitle: 'Catalina Olivero · 2026',
    vitrina: { title: 'RUMIACIONES', sub: 'Catálogo · 2026' },
  }), 0
).lastInsertRowid
agregarObras(colRum, OBRAS_RUMIACIONES, { tituloEn: TITULOS_EN_RUMIACIONES, conMediumEn: true })

const colConex = insColeccion.run(
  cataId, 'conexiones', CONEXIONES.name, CONEXIONES.year, 'conexiones-posts',
  J(CONEXIONES.statementFull), null, CONEXIONES.pdfUrl,
  J({
    conexiones: true, floorMinimal: true, hangBottomMin: 1.05, zocalo: false,
    sinMarco: true, reflect: 'desktop',
    subtitle: `Catalina Olivero · ${CONEXIONES.year}`,
  }), 1
).lastInsertRowid
agregarObras(colConex, OBRAS_CONEXIONES)

const colAlma = insColeccion.run(
  cataId, 'alma', 'Alma', '2022 – 2025', 'alma-posts',
  null, null, null,
  J({
    minimal: true, sinMarco: true, zocalo: false, hangBottomMin: 1.05,
    subtitle: 'Catalina Olivero · 2022 – 2025',
    vitrina: { title: 'ALMA', sub: 'Catálogo' },
  }), 2
).lastInsertRowid
agregarObras(colAlma, OBRAS_ALMA)

// --- resumen ---
const n = (sql) => db.prepare(sql).get().n
console.log(`OK → ${DB_PATH}`)
console.log(`  artistas:    ${n('SELECT COUNT(*) n FROM artistas')}`)
console.log(`  colecciones: ${n('SELECT COUNT(*) n FROM colecciones')}`)
console.log(`  obras:       ${n('SELECT COUNT(*) n FROM obras')}`)
db.close()

// Genera WebP de las imágenes de public/posts en dos tamaños:
//   public/posts/thumb/<base>.webp  → miniatura para las tarjetas de la galería
//   public/posts/full/<base>.webp   → versión grande para el modal
// Uso: node scripts/gen-webp.mjs   (sharp se instala con: npm i --no-save sharp)
import sharp from 'sharp'
import { readdir, mkdir, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'

const SRC = process.argv[2] || 'public/posts'
const THUMB_DIR = join(SRC, 'thumb')
const FULL_DIR = join(SRC, 'full')
const THUMB_W = 820   // ancho máx miniatura
const FULL_W = 1600   // ancho máx modal
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

await mkdir(THUMB_DIR, { recursive: true })
await mkdir(FULL_DIR, { recursive: true })

const files = (await readdir(SRC)).filter((f) => EXTS.has(extname(f).toLowerCase()))
let srcBytes = 0, thumbBytes = 0, fullBytes = 0

for (const file of files) {
  const base = basename(file, extname(file))
  const srcPath = join(SRC, file)
  srcBytes += (await stat(srcPath)).size

  const img = sharp(srcPath, { failOn: 'none' }).rotate() // respeta EXIF

  const thumbPath = join(THUMB_DIR, base + '.webp')
  await img.clone()
    .resize({ width: THUMB_W, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(thumbPath)
  thumbBytes += (await stat(thumbPath)).size

  const fullPath = join(FULL_DIR, base + '.webp')
  await img.clone()
    .resize({ width: FULL_W, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(fullPath)
  fullBytes += (await stat(fullPath)).size

  console.log('✓', file)
}

const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB'
console.log(`\n${files.length} imágenes`)
console.log(`JPG original : ${mb(srcBytes)}`)
console.log(`WebP thumb   : ${mb(thumbBytes)}  (lo que carga la galería)`)
console.log(`WebP full    : ${mb(fullBytes)}  (solo el modal, bajo demanda)`)

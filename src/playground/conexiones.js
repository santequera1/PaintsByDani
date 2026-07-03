import { initGallery } from './gallery.js'
import { initFlipbook } from './flipbook.js'
import { ARTWORKS, ARTIST, COLLECTION } from '../data/conexiones.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'conexiones-posts',
  scatter: true,
  sound: true,
  watermark: 'Conexiones',
  // obras en orientación mixta → ratios variados por defecto
})

initFlipbook({
  trigger: '#pg-catalog',
  title: COLLECTION.name,
  years: COLLECTION.year,
  artist: ARTIST.name,
  handle: ARTIST.handle,
  photo: ARTIST.profileImage,
  statement: COLLECTION.statementFull,
  artworks: ARTWORKS,
  imgBase: 'conexiones-posts',
  pdfUrl: COLLECTION.pdfUrl,
})

import { initGallery } from './gallery.js'
import { contarVisita } from '../misc/visitas.js'
import { initFlipbook } from './flipbook.js'
import { ARTWORKS, ARTIST, COLLECTION } from '../data/conexiones.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'conexiones-posts',
  scatter: true,
  sound: true,
  defaultTheme: 'dark', // pedido de Catalina: fondo negro, sin marca de agua
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
  logo: '/cat-logo-negro.svg',
})
contarVisita('conexiones')

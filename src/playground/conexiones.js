import { initGallery } from './gallery.js'
import { ARTWORKS, ARTIST } from '../data/conexiones.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'conexiones-posts',
  scatter: true,
  sound: true,
  watermark: 'Conexiones',
  // obras en orientación mixta → ratios variados por defecto
})

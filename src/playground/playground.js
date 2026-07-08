import { initGallery } from './gallery.js'
import { contarVisita } from '../misc/visitas.js'
import { initFlipbook } from './flipbook.js'
import { ARTWORKS, ARTIST } from '../data/artworks.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'posts',
  scatter: true,
  sound: true,
  watermark: 'paintsbydani',
})

initFlipbook({
  trigger: '#pg-catalog',
  title: 'Danní',
  years: 'Museo Virtual',
  artist: ARTIST.name,
  handle: ARTIST.handle,
  photo: ARTIST.profileImage,
  statementTitle: 'Sobre la artista',
  statement: [ARTIST.bioEs],
  artworks: ARTWORKS,
  imgBase: 'posts',
  pdfUrl: null,
})
contarVisita('galeria-danni')

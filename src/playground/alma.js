import { initGallery } from './gallery.js'
import { contarVisita } from '../misc/visitas.js'
import { initFlipbook } from './flipbook.js'
import { ARTWORKS, ARTIST } from '../data/alma.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'alma-posts',
  scatter: true,
  sound: true,
  defaultTheme: 'dark',
})

initFlipbook({
  trigger: '#pg-catalog',
  title: 'Alma',
  years: '2022 \u2013 2025',
  artist: ARTIST.name,
  handle: ARTIST.handle,
  photo: ARTIST.profileImage,
  statementTitle: 'Alma',
  statement: [],
  artworks: ARTWORKS,
  imgBase: 'alma-posts',
  pdfUrl: null,
  logo: '/cat-logo-negro.svg',
})
contarVisita('alma')

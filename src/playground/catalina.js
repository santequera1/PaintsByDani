import { initGallery } from './gallery.js'
import { ARTWORKS, ARTIST } from '../data/catalina.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'cat-posts',
  scatter: true,
  sfx: {
    wind: '/cat-sonidos/air-whoosh.mp3',
    open: '/cat-sonidos/spray.mp3',
    click: '/cat-sonidos/highlighter.mp3',
  },
})

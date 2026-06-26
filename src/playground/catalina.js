import { initGallery } from './gallery.js'
import { ARTWORKS, ARTIST } from '../data/catalina.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'cat-posts',
  scatter: true,
  sound: true,
})

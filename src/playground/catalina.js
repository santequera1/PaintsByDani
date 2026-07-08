import { initGallery } from './gallery.js'
import { contarVisita } from '../misc/visitas.js'
import { ARTWORKS, ARTIST } from '../data/catalina.js'

initGallery({
  artworks: ARTWORKS,
  artist: ARTIST,
  imgBase: 'cat-posts',
  scatter: true,
  sound: true,
  defaultTheme: 'dark', // pedido de Catalina: fondo negro, sin marca de agua
  // todas las obras en horizontal (apaisadas), con leve variación
  ratios: [0.72, 0.66, 0.76, 0.69, 0.64, 0.74, 0.67, 0.71],
})
contarVisita('rumiaciones')

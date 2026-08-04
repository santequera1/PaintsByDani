// Museario — contexto de las páginas dinámicas (m.html / g.html).
// Resuelve qué artista/colección mostrar a partir de la URL:
//   /a/:artista/:coleccion            (producción, rewrite de nginx → m.html)
//   /a/:artista/:coleccion/galeria    (producción → g.html)
//   /m.html?a=catalina&c=alma         (fallback / desarrollo)
// y carga los datos desde la API (/api/m/...).

export function obtenerContexto() {
  const m = location.pathname.match(/^\/a\/([^/]+)\/([^/]+)/)
  if (m) {
    return { artista: decodeURIComponent(m[1]), coleccion: decodeURIComponent(m[2]), pretty: true }
  }
  const q = new URLSearchParams(location.search)
  return {
    artista: q.get('a') || 'catalina',
    coleccion: q.get('c') || 'rumiaciones',
    pretty: false,
  }
}

// En dev/preview (vite) no hay API local: se consulta la de producción (CORS abierto).
export const API_BASE = ['5173', '4173'].includes(location.port) ? 'https://museo.wailus.co' : ''

export function enlaceMuseo(ctx, slug) {
  return ctx.pretty ? `/a/${ctx.artista}/${slug}` : `/m.html?a=${ctx.artista}&c=${slug}`
}
export function enlaceGaleria(ctx, slug, entrar = false) {
  return ctx.pretty
    ? `/a/${ctx.artista}/${slug}/galeria${entrar ? '?entrar' : ''}`
    : `/g.html?a=${ctx.artista}&c=${slug}${entrar ? '&entrar' : ''}`
}

// Devuelve { artista, coleccion, obras, colecciones } (colecciones = todas las del artista).
export async function cargarColeccion(ctx) {
  // sin caché: el artista edita su sala en el panel y quiere ver el cambio YA
  const v = `?t=${Date.now()}`
  const [rCol, rArt] = await Promise.all([
    fetch(`${API_BASE}/api/m/a/${encodeURIComponent(ctx.artista)}/${encodeURIComponent(ctx.coleccion)}${v}`),
    fetch(`${API_BASE}/api/m/a/${encodeURIComponent(ctx.artista)}${v}`),
  ])
  if (!rCol.ok) throw new Error(`Colección no encontrada (${rCol.status})`)
  const data = await rCol.json()
  const artista = rArt.ok ? await rArt.json() : { colecciones: [] }
  return { ...data, colecciones: artista.colecciones || [] }
}

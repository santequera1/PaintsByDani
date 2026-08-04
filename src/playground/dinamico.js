import { initGallery } from './gallery.js'
import { contarVisita } from '../misc/visitas.js'
import { initFlipbook } from './flipbook.js'
import { obtenerContexto, cargarColeccion, enlaceMuseo, enlaceGaleria } from '../misc/museario.js'

/* ============================================================
   Galería en lienzo · dinámica (Museario, Fase 1)
   Una sola página que monta la galería de CUALQUIER colección
   leyendo los datos desde la API (/api/m/...).
   ============================================================ */

const CTX = obtenerContexto()

main().catch((e) => {
  console.error(e)
  const intro = document.getElementById('pg-intro')
  if (intro) {
    intro.innerHTML =
      '<div class="pg-intro-card"><p style="padding:24px;font-size:15px">No se pudo cargar la colección. Revisa tu conexión y recarga la página.</p></div>'
  }
})

async function main() {
  const { artista, coleccion, obras, colecciones } = await cargarColeccion(CTX)
  const est = coleccion.estilo || {}

  const thumb = (imgBase, filename) =>
    filename ? `/${imgBase}/thumb/${encodeURI(filename.replace(/\.[^.]+$/, ''))}.webp` : ''
  const museoDe = (c) =>
    c.estilo && c.estilo.tipo === 'salas' ? '/index.html' : enlaceMuseo(CTX, c.slug)

  document.title = `${coleccion.nombre} · Galería | ${artista.nombre}`

  // --- Portada / selector de colecciones ---
  const introLogo = document.getElementById('pg-intro-logo')
  if (introLogo) {
    // sin logo ni foto propios: el logo de Museario (la portada es clara)
    introLogo.src = artista.logoNegro || artista.profileImage || '/museario/logo-negro.svg'
    introLogo.alt = artista.nombre
    introLogo.hidden = false
    introLogo.onerror = () => { introLogo.onerror = null; introLogo.src = '/museario/logo-negro.svg' }
  }
  const choices = document.getElementById('pg-intro-choices')
  if (choices) {
    const btn = document.createElement('button')
    btn.id = 'pg-intro-enter'
    btn.className = 'pg-choice'
    btn.innerHTML =
      `<span class="pg-choice-img"><img src="${thumb(coleccion.imgBase, coleccion.portada)}" alt="${coleccion.nombre}" /></span>` +
      `<span class="pg-choice-name">${coleccion.nombre}</span>` +
      `<span class="pg-choice-sub">${coleccion.subtitulo || ''}</span>`
    choices.appendChild(btn)
    colecciones
      .filter((c) => c.slug !== CTX.coleccion)
      .forEach((c) => {
        const aEl = document.createElement('a')
        aEl.className = 'pg-choice'
        aEl.href = enlaceGaleria(CTX, c.slug, true)
        aEl.innerHTML =
          `<span class="pg-choice-img"><img src="${thumb(c.imgBase, c.portada)}" alt="${c.nombre}" /></span>` +
          `<span class="pg-choice-name">${c.nombre}</span>` +
          `<span class="pg-choice-sub">${c.subtitulo || ''}</span>`
        choices.appendChild(aEl)
      })
  }
  const introMuseo = document.getElementById('pg-intro-museo')
  if (introMuseo) introMuseo.href = museoDe(coleccion)

  // La palabra del fondo es la de la colección (el CSS trae "Rumiaciones" por defecto)
  const bgword = document.getElementById('pg-bgword')
  if (bgword) {
    const w = Math.max(300, Math.round(coleccion.nombre.length * 30) + 90)
    bgword.style.backgroundImage =
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='150'%3E%3Ctext x='16' y='100' font-family='Georgia,serif' font-style='italic' font-size='54' fill='%2334435a' fill-opacity='0.05'%3E${encodeURIComponent(coleccion.nombre)}%3C/text%3E%3C/svg%3E")`
  }

  // --- Marca / panel del artista ---
  const brandLogo = document.getElementById('pg-brand-logo')
  if (brandLogo) {
    const propio = artista.logoNegro || artista.profileImage
    if (propio) {
      brandLogo.src = propio
      brandLogo.alt = artista.nombre
      brandLogo.onerror = () => { brandLogo.onerror = null; brandLogo.style.display = 'none' }
    } else {
      // sin imagen: el nombre del artista ya está al lado, la imagen sobra
      brandLogo.style.display = 'none'
    }
  }
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt }
  set('pg-brand-name', artista.nombre)
  set('pg-brand-handle', artista.handle || '')
  set('pg-about-name', artista.nombre)

  const bios = document.querySelectorAll('.pg-about-bio')
  bios.forEach((p) => {
    const l = p.getAttribute('data-lang')
    p.textContent = (l === 'en' ? artista.bioEn : artista.bioEs) || ''
  })
  // Con una sola bio no hay toggle: se muestra la que exista.
  if (!artista.bioEn || !artista.bioEs) {
    const langGroup = document.getElementById('pg-lang')
    if (langGroup) langGroup.style.display = 'none'
    bios.forEach((p) => {
      const l = p.getAttribute('data-lang')
      p.hidden = l === 'es' ? !artista.bioEs : !artista.bioEn
    })
  }

  const linkIg = document.getElementById('pg-link-ig')
  if (linkIg) linkIg.href = artista.instagramUrl || '#'
  const linkSub = document.getElementById('pg-link-substack')
  if (linkSub && artista.substack) { linkSub.href = artista.substack; linkSub.hidden = false }
  const linkWeb = document.getElementById('pg-link-web')
  if (linkWeb && artista.website) { linkWeb.href = artista.website; linkWeb.hidden = false }

  // --- Nav ---
  const navLinks = document.getElementById('pg-nav-links')
  if (navLinks) {
    colecciones
      .filter((c) => c.slug !== CTX.coleccion)
      .forEach((c) => {
        const aEl = document.createElement('a')
        aEl.className = 'pg-btn pg-btn-ghost'
        aEl.href = enlaceGaleria(CTX, c.slug, true)
        aEl.title = `Ir a la colección ${c.nombre}`
        aEl.textContent = c.nombre
        navLinks.appendChild(aEl)
      })
  }
  const navMuseo = document.getElementById('pg-nav-museo')
  if (navMuseo) navMuseo.href = museoDe(coleccion)
  const navIg = document.getElementById('pg-nav-ig')
  if (navIg) navIg.href = artista.instagramUrl || '#'

  // --- Galería + catálogo ---
  const ARTWORKS = obras.map((o) => ({
    id: o.id,
    filename: o.filename,
    ratio: o.ratio,
    title: o.title,
    medium: o.medium,
    price: o.price,
    instagramUrl: o.instagramUrl || artista.instagramUrl,
  }))
  const ARTIST = {
    name: artista.nombre,
    handle: artista.handle,
    instagramUrl: artista.instagramUrl,
    profileImage: artista.profileImage,
  }

  initGallery({
    artworks: ARTWORKS,
    artist: ARTIST,
    imgBase: coleccion.imgBase,
    scatter: true,
    sound: true,
    defaultTheme: est.temaGaleria || 'dark',
  })

  initFlipbook({
    trigger: '#pg-catalog',
    title: coleccion.nombre,
    years: coleccion.subtitulo || '',
    artist: artista.nombre,
    handle: artista.handle,
    photo: artista.profileImage,
    statementTitle: coleccion.nombre,
    statement: coleccion.statementEs || [],
    artworks: ARTWORKS,
    imgBase: coleccion.imgBase,
    pdfUrl: coleccion.pdfUrl || null,
    logo: artista.logoNegro || null,
  })

  contarVisita(`g-${CTX.artista}-${CTX.coleccion}`)
}

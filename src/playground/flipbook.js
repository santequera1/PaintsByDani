import './flipbook.css'

/* ============================================================
   Flipbook 3D — catálogo hojeable con giro de página realista.
   Genera las páginas desde los datos (portada, declaración,
   una página por obra, contraportada con descarga del PDF).
   Navegación: click en página/flechas, ← →, swipe y Esc.
   ============================================================ */

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export function initFlipbook({
  trigger,
  title,
  years,
  artist,
  handle,
  photo,
  statementTitle = 'Declaración de Artista',
  statement = [],
  artworks = [],
  imgBase,
  pdfUrl,
  logo = null, // wordmark que sustituye la foto en portada/contraportada
  onClose = null,
}) {
  const triggerEl = typeof trigger === 'string' ? document.querySelector(trigger) : trigger
  if (trigger && !triggerEl) return null

  const thumb = (f) => `/${imgBase}/thumb/${encodeURI(f.replace(/\.[^.]+$/, ''))}.webp`

  // ---------- caras del libro ----------
  const faces = []
  faces.push(`
    <div class="fb-face fb-cover">
      ${logo
        ? `<img class="fb-logo" src="${esc(logo)}" alt="" />`
        : `<img class="fb-cover-photo" src="${esc(photo)}" alt="" />`}
      <p class="fb-kicker">Exposición</p>
      <h2 class="fb-cover-title">${esc(title)}</h2>
      <p class="fb-cover-artist">${esc(artist)}</p>
      <p class="fb-cover-years">${esc(years)}</p>
    </div>`)
  faces.push(`
    <div class="fb-face fb-statement">
      <h3>${esc(statementTitle)}</h3>
      ${statement.map((p) => `<p>${esc(p)}</p>`).join('')}
    </div>`)
  for (const art of artworks) {
    faces.push(`
      <div class="fb-face fb-work">
        <div class="fb-work-img"><img src="${thumb(art.filename)}" alt="${esc(art.title)}" loading="lazy" decoding="async" /></div>
        <h4>${esc(art.title)}</h4>
        ${art.medium ? `<p class="fb-medium">${esc(art.medium)}</p>` : ''}
        ${art.price ? `<p class="fb-price${art.price === 'Vendido' ? ' na' : ''}">${esc(art.price)}</p>` : ''}
      </div>`)
  }
  faces.push(`
    <div class="fb-face fb-end">
      ${logo
        ? `<img class="fb-logo" src="${esc(logo)}" alt="" />`
        : `<img class="fb-end-photo" src="${esc(photo)}" alt="" />`}
      <p class="fb-end-name">${esc(artist)}</p>
      <p class="fb-end-handle">${esc(handle)}</p>
      ${pdfUrl ? `<a class="fb-pdf" href="${esc(pdfUrl)}" target="_blank" rel="noopener noreferrer">Descargar catálogo (PDF)</a>` : ''}
    </div>`)
  if (faces.length % 2 === 1) faces.push('<div class="fb-face fb-blank"></div>')

  // ---------- estructura ----------
  const totalSheets = faces.length / 2
  const overlay = document.createElement('div')
  overlay.id = 'fb-overlay'
  overlay.innerHTML = `
    <div class="fb-backdrop"></div>
    <div class="fb-stage">
      <div class="fb-book">
        ${Array.from({ length: totalSheets }, (_, i) => `
          <div class="fb-sheet" data-i="${i}">
            <div class="fb-page fb-front">${faces[i * 2]}<span class="fb-shade fb-shade-f"></span></div>
            <div class="fb-page fb-back">${faces[i * 2 + 1]}<span class="fb-shade fb-shade-b"></span></div>
          </div>`).join('')}
      </div>
    </div>
    <button class="fb-close" title="Cerrar (Esc)" aria-label="Cerrar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <button class="fb-nav fb-prev" aria-label="Página anterior">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button class="fb-nav fb-next" aria-label="Página siguiente">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="fb-count"></div>`
  document.body.appendChild(overlay)

  const stage = overlay.querySelector('.fb-stage')
  const book = overlay.querySelector('.fb-book')
  const sheets = [...overlay.querySelectorAll('.fb-sheet')]
  const btnPrev = overlay.querySelector('.fb-prev')
  const btnNext = overlay.querySelector('.fb-next')
  const btnClose = overlay.querySelector('.fb-close')
  const countEl = overlay.querySelector('.fb-count')

  let current = 0 // hojas volteadas
  let animating = false
  let isOpen = false
  let pw = 320 // ancho de página (calculado en fit)

  // ---------- tamaño responsivo ----------
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight
    let ph = Math.min(vh * 0.76, 575)
    pw = ph * 0.72
    if (pw * 2 > vw * 0.92) { pw = vw * 0.46; ph = Math.min(pw / 0.72, vh * 0.72) }
    book.style.setProperty('--fbpw', pw + 'px')
    book.style.setProperty('--fbph', ph + 'px')
    positionBook(false)
  }

  // el libro se recentra: cerrado al inicio/final, abierto en el medio
  function positionBook() {
    let shift = 0
    if (current === 0) shift = -pw / 2
    else if (current === totalSheets) shift = pw / 2
    book.style.transform = `rotateX(5deg) translateX(${shift}px)`
  }

  function applyZ(topSheet = -1) {
    sheets.forEach((s, i) => {
      const flipped = i < current
      s.style.zIndex = i === topSheet ? totalSheets + 2 : flipped ? i + 1 : totalSheets - i
    })
  }

  function updateCount() {
    countEl.textContent = `${current} / ${totalSheets}`
    btnPrev.disabled = current === 0
    btnNext.disabled = current === totalSheets
  }

  let lastFlipAt = 0
  function flip(dir) {
    if (animating) return
    const now = performance.now()
    if (now - lastFlipAt < 300) return // click fantasma tras swipe
    if (dir > 0 && current >= totalSheets) return
    if (dir < 0 && current <= 0) return
    lastFlipAt = now
    animating = true
    const idx = dir > 0 ? current : current - 1
    const sheet = sheets[idx]
    applyZ(idx) // la hoja que gira, por encima de todo
    current += dir
    sheet.classList.toggle('flipped', dir > 0)
    sheet.classList.add('flipping')
    positionBook()
    updateCount()
    const settle = () => {
      sheet.classList.remove('flipping')
      applyZ()
      animating = false
    }
    if (REDUCE) { settle(); return }
    let done = false
    const onEnd = (e) => {
      if (e.propertyName !== 'transform' || done) return
      done = true
      sheet.removeEventListener('transitionend', onEnd)
      settle()
    }
    sheet.addEventListener('transitionend', onEnd)
    setTimeout(() => { if (!done) { done = true; settle() } }, 1100) // red de seguridad
  }

  // ---------- abrir / cerrar ----------
  function open() {
    isOpen = true
    fit()
    applyZ()
    updateCount()
    overlay.classList.add('show')
    requestAnimationFrame(() => overlay.classList.add('open'))
    document.addEventListener('keydown', onKey)
  }
  function close() {
    isOpen = false
    overlay.classList.remove('open')
    document.removeEventListener('keydown', onKey)
    setTimeout(() => overlay.classList.remove('show'), 450)
    if (onClose) onClose()
  }
  function onKey(e) {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowRight') flip(1)
    else if (e.key === 'ArrowLeft') flip(-1)
  }

  if (triggerEl) {
    triggerEl.hidden = false
    triggerEl.addEventListener('click', open)
  }
  btnClose.addEventListener('click', close)
  overlay.querySelector('.fb-backdrop').addEventListener('click', close)
  btnNext.addEventListener('click', () => flip(1))
  btnPrev.addEventListener('click', () => flip(-1))
  window.addEventListener('resize', () => { if (isOpen) fit() })

  // click en el libro: mitad derecha avanza, izquierda retrocede
  book.addEventListener('click', (e) => {
    if (e.target.closest('a')) return // el enlace del PDF navega normal
    const r = book.getBoundingClientRect()
    flip(e.clientX > r.left + r.width / 2 ? 1 : -1)
  })

  // swipe táctil
  let swX = null
  stage.addEventListener('pointerdown', (e) => { swX = e.clientX })
  stage.addEventListener('pointerup', (e) => {
    if (swX === null) return
    const dx = e.clientX - swX
    swX = null
    if (Math.abs(dx) > 42) flip(dx < 0 ? 1 : -1)
  })

  return { open, close }
}

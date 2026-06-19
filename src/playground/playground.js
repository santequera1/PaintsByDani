import { ARTWORKS, ARTIST } from '../data/artworks.js'
import './playground.css'

/* ============================================================
   Galería de lienzo infinito arrastrable (estilo kree8)
   Reutiliza los datos del museo 3D (ARTWORKS) y al tocar una
   obra abre un modal con el caption + botón a Instagram.
   ============================================================ */

// Algunos nombres (p. ej. el que lleva coma) fallan con %2C en ciertos
// servidores, así que probamos varias codificaciones como el museo 3D.
const candidates = (filename) => [
  `/posts/${encodeURIComponent(filename)}`,
  `/posts/${encodeURI(filename)}`,
  `/posts/${filename}`,
]

function setImgWithFallback(img, filename) {
  const list = candidates(filename)
  let idx = 0
  img.onerror = () => {
    idx += 1
    if (idx < list.length) img.src = list[idx]
    else img.onerror = null
  }
  img.src = list[0]
}

// --- DOM ---
const stage = document.getElementById('pg-stage')
const world = document.getElementById('pg-world')
const dots = document.getElementById('pg-dots')
const hint = document.getElementById('pg-hint')

// Modal
const modal = document.getElementById('pg-modal')
const modalCard = document.getElementById('pg-modal-card')
const modalImg = document.getElementById('pg-modal-img')
const modalTitle = document.getElementById('pg-modal-title')
const modalMedium = document.getElementById('pg-modal-medium')
const modalIg = document.getElementById('pg-modal-ig')
const modalClose = document.getElementById('pg-modal-close')
const modalBackdrop = document.getElementById('pg-modal-backdrop')

const mod = (n, m) => ((n % m) + m) % m

// Relaciones de aspecto (alto/ancho) deterministas para un masonry
// orgánico sin depender de la carga de cada imagen.
const RATIOS = [1.18, 0.82, 1.34, 0.95, 1.0, 1.46, 0.78, 1.12, 1.28, 0.88]

// ------------------------------------------------------------
// 1) Construir el "tile" base (masonry) que se repetirá infinito
// ------------------------------------------------------------
let COL_W, GAP, NUM_COLS, cellW, cellH, cards

function computeLayout() {
  const vw = window.innerWidth
  if (vw < 560) { NUM_COLS = 2; COL_W = Math.min(220, (vw - 56) / 2) }
  else if (vw < 920) { NUM_COLS = 3; COL_W = 220 }
  else if (vw < 1300) { NUM_COLS = 4; COL_W = 240 }
  else { NUM_COLS = 5; COL_W = 256 }
  GAP = Math.round(COL_W * 0.18) // más aire entre cuadros

  // 1) repartir obras en columnas (la más corta primero)
  const cols = Array.from({ length: NUM_COLS }, () => ({ items: [], sumH: 0 }))
  ARTWORKS.forEach((art, i) => {
    let c = 0
    for (let k = 1; k < NUM_COLS; k++) if (cols[k].sumH < cols[c].sumH) c = k
    const h = Math.round(COL_W * RATIOS[i % RATIOS.length])
    cols[c].items.push({ art, h })
    cols[c].sumH += h
  })

  // 2) altura del tile = la que necesita la columna más cargada
  cellH = Math.max(...cols.map((col) => col.sumH + col.items.length * GAP))

  // 3) cada columna reparte su holgura uniformemente para llenar cellH.
  //    Así el tiling vertical queda sin huecos ni franjas vacías.
  cards = []
  cols.forEach((col, c) => {
    const x = c * (COL_W + GAP)
    const s = col.items.length ? (cellH - col.sumH) / col.items.length : GAP
    let y = s / 2 // medio espacio arriba → al repetir, abajo+arriba = s
    col.items.forEach(({ art, h }) => {
      cards.push({ art, x, y, w: COL_W, h })
      y += h + s
    })
  })

  cellW = NUM_COLS * (COL_W + GAP)
}

function buildCellTemplate() {
  const frag = document.createDocumentFragment()
  for (const card of cards) {
    const el = document.createElement('div')
    el.className = 'pg-card'
    el.style.left = card.x + 'px'
    el.style.top = card.y + 'px'
    el.style.width = card.w + 'px'
    el.style.height = card.h + 'px'
    el.dataset.id = card.art.id

    const img = document.createElement('img')
    img.className = 'pg-card-img'
    img.alt = card.art.title
    img.loading = 'lazy'
    img.decoding = 'async'
    img.draggable = false
    setImgWithFallback(img, card.art.filename)
    el.appendChild(img)

    const cap = document.createElement('div')
    cap.className = 'pg-card-cap'
    cap.textContent = card.art.title
    el.appendChild(cap)

    frag.appendChild(el)
  }
  return frag
}

// ------------------------------------------------------------
// 2) Rejilla de copias del tile para cubrir el viewport
// ------------------------------------------------------------
function buildGrid() {
  world.innerHTML = ''

  const gridCols = Math.ceil(window.innerWidth / cellW) + 2
  const gridRows = Math.ceil(window.innerHeight / cellH) + 2

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cell = document.createElement('div')
      cell.style.position = 'absolute'
      cell.style.left = c * cellW + 'px'
      cell.style.top = r * cellH + 'px'
      cell.style.width = cellW + 'px'
      cell.style.height = cellH + 'px'
      // Construimos cada celda desde cero (no clonamos) para que cada
      // <img> conserve su handler onerror y el fallback siga funcionando.
      cell.appendChild(buildCellTemplate())
      world.appendChild(cell)
    }
  }
}

// ------------------------------------------------------------
// 3) Estado de arrastre + inercia
// ------------------------------------------------------------
let offsetX = 0, offsetY = 0
let velX = 0, velY = 0
let dragging = false
let moved = false
let pointerId = null
let lastX = 0, lastY = 0
let downX = 0, downY = 0
let rafId = null

// arranque centrado y desplazado para una composición agradable
function centerStart() {
  offsetX = -cellW * 0.5 + window.innerWidth * 0.5
  offsetY = -cellH * 0.4 + window.innerHeight * 0.3
}

function render() {
  const wx = mod(offsetX, cellW) - cellW
  const wy = mod(offsetY, cellH) - cellH
  world.style.transform = `translate3d(${wx}px, ${wy}px, 0)`
  dots.style.backgroundPosition = `${offsetX}px ${offsetY}px`
}

function inertia() {
  if (dragging) return
  velX *= 0.93
  velY *= 0.93
  offsetX += velX
  offsetY += velY
  render()
  if (Math.abs(velX) > 0.05 || Math.abs(velY) > 0.05) {
    rafId = requestAnimationFrame(inertia)
  } else {
    rafId = null
  }
}

function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return
  dragging = true
  moved = false
  pointerId = e.pointerId
  lastX = downX = e.clientX
  lastY = downY = e.clientY
  velX = velY = 0
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  stage.classList.add('dragging')
  try { stage.setPointerCapture(pointerId) } catch {}
}

function onMove(e) {
  if (!dragging) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  offsetX += dx
  offsetY += dy
  velX = dx
  velY = dy
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) {
    moved = true
    dismissHint()
  }
  render()
}

function onUp(e) {
  if (!dragging) return
  dragging = false
  stage.classList.remove('dragging')
  try { stage.releasePointerCapture(pointerId) } catch {}

  if (!moved) {
    // click "limpio" → abrir obra bajo el cursor.
    // Con setPointerCapture e.target es el stage, así que resolvemos
    // el elemento real bajo el puntero.
    const under = document.elementFromPoint(e.clientX, e.clientY)
    const target = under && under.closest('.pg-card')
    if (target) openModal(target.dataset.id)
    return
  }
  if (Math.abs(velX) > 0.5 || Math.abs(velY) > 0.5) {
    rafId = requestAnimationFrame(inertia)
  }
}

stage.addEventListener('pointerdown', onDown)
stage.addEventListener('pointermove', onMove)
stage.addEventListener('pointerup', onUp)
stage.addEventListener('pointercancel', onUp)
// evitar arrastre nativo de imágenes
stage.addEventListener('dragstart', (e) => e.preventDefault())

// ------------------------------------------------------------
// 4) Modal de obra
// ------------------------------------------------------------
function openModal(id) {
  const art = ARTWORKS.find((a) => a.id === id)
  if (!art) return
  setImgWithFallback(modalImg, art.filename)
  modalImg.alt = art.title
  modalTitle.textContent = art.title
  modalMedium.textContent = art.medium || ''
  modalMedium.style.display = art.medium ? '' : 'none'
  modalIg.href = art.instagramUrl || ARTIST.instagramUrl
  modal.classList.remove('hidden')
  modal.setAttribute('aria-hidden', 'false')
  requestAnimationFrame(() => modal.classList.add('open'))
  document.addEventListener('keydown', onKey)
}

function closeModal() {
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
  document.removeEventListener('keydown', onKey)
  setTimeout(() => {
    modal.classList.add('hidden')
    modalImg.src = ''
  }, 320)
}

function onKey(e) { if (e.key === 'Escape') closeModal() }

modalClose.addEventListener('click', closeModal)
modalBackdrop.addEventListener('click', closeModal)
modalCard.addEventListener('click', (e) => e.stopPropagation())

// ------------------------------------------------------------
// 5) Hint + resize + init
// ------------------------------------------------------------
let hintTimer = null
function dismissHint() {
  if (!hint || hint.classList.contains('gone')) return
  hint.classList.add('gone')
}
hintTimer = setTimeout(dismissHint, 6000)

let resizeTimer = null
function rebuild() {
  computeLayout()
  buildGrid()
  render()
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(rebuild, 200)
})

// init
computeLayout()
centerStart()
buildGrid()
render()

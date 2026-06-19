import { ARTWORKS, ARTIST } from '../data/artworks.js'
import './playground.css'

/* ============================================================
   Galería de lienzo infinito arrastrable (estilo kree8)
   - Virtualización con reciclado de nodos (solo renderiza las
     obras visibles + un margen; reposiciona por tiling modular)
   - Smooth-follow (lerp), inercia, tilt al arrastrar, parallax,
     zoom (rueda + pinch) y entrada escalonada
   - Respeta prefers-reduced-motion
   ============================================================ */

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// Fallback de codificación para nombres con caracteres conflictivos.
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
const tiltEl = document.getElementById('pg-tilt')
const world = document.getElementById('pg-world')
const dots = document.getElementById('pg-dots')
const hint = document.getElementById('pg-hint')
const loader = document.getElementById('pg-loader')
const centerBtn = document.getElementById('pg-center')
const gyroBtn = document.getElementById('pg-gyro')
const gyroLabel = gyroBtn ? gyroBtn.querySelector('.pg-gyro-label') : null

const modal = document.getElementById('pg-modal')
const modalCard = document.getElementById('pg-modal-card')
const modalImg = document.getElementById('pg-modal-img')
const modalTitle = document.getElementById('pg-modal-title')
const modalMedium = document.getElementById('pg-modal-medium')
const modalIg = document.getElementById('pg-modal-ig')
const modalClose = document.getElementById('pg-modal-close')
const modalBackdrop = document.getElementById('pg-modal-backdrop')

let vw = window.innerWidth
let vh = window.innerHeight

// ------------------------------------------------------------
// 1) Layout del tile base (masonry) que se repite al infinito
// ------------------------------------------------------------
const RATIOS = [1.18, 0.82, 1.34, 0.95, 1.0, 1.46, 0.78, 1.12, 1.28, 0.88]
let COL_W, GAP, NUM_COLS, tileW, tileH, cards

function computeLayout() {
  if (vw < 560) { NUM_COLS = 2; COL_W = Math.min(220, (vw - 56) / 2) }
  else if (vw < 920) { NUM_COLS = 3; COL_W = 220 }
  else if (vw < 1300) { NUM_COLS = 4; COL_W = 240 }
  else { NUM_COLS = 5; COL_W = 256 }
  GAP = Math.round(COL_W * 0.18)

  const cols = Array.from({ length: NUM_COLS }, () => ({ items: [], sumH: 0 }))
  ARTWORKS.forEach((art, i) => {
    let c = 0
    for (let k = 1; k < NUM_COLS; k++) if (cols[k].sumH < cols[c].sumH) c = k
    const h = Math.round(COL_W * RATIOS[i % RATIOS.length])
    cols[c].items.push({ art, h })
    cols[c].sumH += h
  })

  tileH = Math.max(...cols.map((col) => col.sumH + col.items.length * GAP))

  cards = []
  cols.forEach((col, c) => {
    const x = c * (COL_W + GAP)
    const s = col.items.length ? (tileH - col.sumH) / col.items.length : GAP
    let y = s / 2
    col.items.forEach(({ art, h }) => {
      cards.push({ art, x, y, w: COL_W, h })
      y += h + s
    })
  })

  tileW = NUM_COLS * (COL_W + GAP)
}

// ------------------------------------------------------------
// 2) Pool de nodos reciclables
// ------------------------------------------------------------
const active = new Map() // key "k|i|j" -> node
const pool = []
let firstPaint = true
let staggerIdx = 0
let loaderHidden = false

function hideLoader() {
  if (loaderHidden) return
  loaderHidden = true
  loader.classList.add('gone')
}
setTimeout(hideLoader, 2600)

function createNode() {
  const el = document.createElement('div')
  el.className = 'pg-card'
  const inner = document.createElement('div')
  inner.className = 'pg-card-inner'
  const img = document.createElement('img')
  img.className = 'pg-card-img'
  img.decoding = 'async'
  img.draggable = false
  img.addEventListener('load', hideLoader, { once: true })
  const cap = document.createElement('div')
  cap.className = 'pg-card-cap'
  inner.appendChild(img)
  inner.appendChild(cap)
  el.appendChild(inner)
  world.appendChild(el)
  return { el, inner, img, cap, artId: null }
}

function acquire() {
  const node = pool.pop()
  if (node) { node.el.style.display = ''; return node }
  return createNode()
}

function release(node) {
  node.el.style.display = 'none'
  node.inner.classList.remove('pg-enter')
  pool.push(node)
}

function placeCard(node, card, i, j) {
  const cx = card.x + i * tileW
  const cy = card.y + j * tileH
  node.el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`
  if (node.artId !== card.art.id) {
    node.el.style.width = card.w + 'px'
    node.el.style.height = card.h + 'px'
    node.el.dataset.id = card.art.id
    node.cap.textContent = card.art.title
    node.img.alt = card.art.title
    setImgWithFallback(node.img, card.art.filename)
    node.artId = card.art.id
  }
}

// ------------------------------------------------------------
// 3) Estado del lienzo (pan + zoom) con smooth-follow
// ------------------------------------------------------------
let panX = 0, panY = 0           // objetivo
let curX = 0, curY = 0           // mostrado (lerp)
let targetScale = 1, curScale = 1
let velX = 0, velY = 0
let startX = 0, startY = 0

let dragging = false
let moved = false
let inertia = false
let lastX = 0, lastY = 0, downX = 0, downY = 0

const pointers = new Map()
let pinch = false
let pinchStartDist = 0, pinchStartScale = 1, pinchWx = 0, pinchWy = 0

// Giroscopio (parallax al inclinar el móvil)
const GYRO_MAX = 34          // desplazamiento máximo en px (sutil)
let gyroX = 0, gyroY = 0     // offset mostrado (suavizado)
let gyroTX = 0, gyroTY = 0   // offset objetivo
let gyroBaseG = null, gyroBaseB = null
let gyroSetup = false

let rafId = null
let running = false

function centerStart() {
  startX = panX = curX = -tileW * 0.5 + vw * 0.5
  startY = panY = curY = -tileH * 0.4 + vh * 0.3
}

function kick() {
  if (!running) { running = true; rafId = requestAnimationFrame(step) }
}

function virtualize() {
  const m = 320
  const S = curScale
  const wMinX = (-m - curX) / S, wMaxX = (vw + m - curX) / S
  const wMinY = (-m - curY) / S, wMaxY = (vh + m - curY) / S

  const needed = new Set()
  for (let k = 0; k < cards.length; k++) {
    const c = cards[k]
    const iMin = Math.ceil((wMinX - (c.x + c.w)) / tileW)
    const iMax = Math.floor((wMaxX - c.x) / tileW)
    const jMin = Math.ceil((wMinY - (c.y + c.h)) / tileH)
    const jMax = Math.floor((wMaxY - c.y) / tileH)
    for (let i = iMin; i <= iMax; i++) {
      for (let j = jMin; j <= jMax; j++) {
        const key = k + '|' + i + '|' + j
        needed.add(key)
        if (!active.has(key)) {
          const node = acquire()
          placeCard(node, c, i, j)
          active.set(key, node)
          if (firstPaint && !REDUCE) {
            node.inner.style.animationDelay = (staggerIdx++ % 24) * 28 + 'ms'
            node.inner.classList.add('pg-enter')
          }
        }
      }
    }
  }
  for (const [key, node] of active) {
    if (!needed.has(key)) { active.delete(key); release(node) }
  }
}

function step() {
  if (REDUCE) {
    curX = panX; curY = panY; curScale = targetScale
  } else {
    curX += (panX - curX) * 0.16
    curY += (panY - curY) * 0.16
    curScale += (targetScale - curScale) * 0.16
  }

  if (inertia && !dragging) {
    panX += velX; panY += velY
    velX *= 0.94; velY *= 0.94
    if (Math.hypot(velX, velY) < 0.08) { inertia = false; velX = velY = 0 }
  }

  // tilt proporcional al "retraso" del seguimiento (sensación de peso)
  let tY = 0, tX = 0
  if (!REDUCE) {
    tY = clamp((panX - curX) * 0.035, -5, 5)
    tX = clamp(-(panY - curY) * 0.035, -5, 5)
  }
  // giroscopio: suavizado lento para que no maree
  if (!REDUCE) {
    gyroX += (gyroTX - gyroX) * 0.06
    gyroY += (gyroTY - gyroY) * 0.06
  }

  tiltEl.style.transform = `perspective(1300px) rotateX(${tX}deg) rotateY(${tY}deg)`
  world.style.transform = `translate3d(${curX + gyroX}px, ${curY + gyroY}px, 0) scale(${curScale})`

  const pf = REDUCE ? 1 : 0.62 // parallax: los puntos van más lentos
  dots.style.backgroundPosition = `${curX * pf}px ${curY * pf}px`

  virtualize()

  const settled =
    Math.abs(panX - curX) < 0.15 &&
    Math.abs(panY - curY) < 0.15 &&
    Math.abs(targetScale - curScale) < 0.002 &&
    Math.abs(gyroTX - gyroX) < 0.1 &&
    Math.abs(gyroTY - gyroY) < 0.1 &&
    !inertia && !dragging
  if (settled) {
    running = false
    firstPaint = false
    stage.classList.remove('moving')
  } else {
    rafId = requestAnimationFrame(step)
  }
}

// ------------------------------------------------------------
// 4) Interacción: arrastre, inercia, zoom (rueda + pinch)
// ------------------------------------------------------------
function beginPinch() {
  const pts = [...pointers.values()]
  const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y
  pinchStartDist = Math.hypot(dx, dy) || 1
  pinchStartScale = targetScale
  const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2
  pinchWx = (mx - panX) / targetScale
  pinchWy = (my - panY) / targetScale
  pinch = true
  dismissHint()
}

function handlePinch() {
  const pts = [...pointers.values()]
  const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y
  const dist = Math.hypot(dx, dy) || 1
  const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2
  targetScale = clamp(pinchStartScale * (dist / pinchStartDist), 0.6, 2.4)
  panX = mx - pinchWx * targetScale
  panY = my - pinchWy * targetScale
  kick()
}

function onDown(e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try { stage.setPointerCapture(e.pointerId) } catch {}
  stage.classList.add('moving')
  if (pointers.size === 1) {
    dragging = true; moved = false; inertia = false; velX = velY = 0
    lastX = downX = e.clientX; lastY = downY = e.clientY
    stage.classList.add('dragging')
  } else if (pointers.size === 2) {
    dragging = false
    beginPinch()
  }
  kick()
}

function onMove(e) {
  const p = pointers.get(e.pointerId)
  if (p) { p.x = e.clientX; p.y = e.clientY }
  if (pinch && pointers.size >= 2) { handlePinch(); return }
  if (!dragging) return
  const dx = e.clientX - lastX, dy = e.clientY - lastY
  lastX = e.clientX; lastY = e.clientY
  panX += dx; panY += dy
  velX = dx; velY = dy
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) {
    moved = true; dismissHint()
  }
  kick()
}

function onUp(e) {
  pointers.delete(e.pointerId)
  try { stage.releasePointerCapture(e.pointerId) } catch {}
  if (pinch && pointers.size < 2) pinch = false

  if (pointers.size === 1) {
    // queda un dedo → seguir arrastrando
    const rem = [...pointers.values()][0]
    dragging = true; moved = true; lastX = rem.x; lastY = rem.y; velX = velY = 0
    return
  }
  if (pointers.size === 0 && dragging) {
    dragging = false
    stage.classList.remove('dragging')
    if (!moved) {
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const card = under && under.closest('.pg-card')
      if (card) openModal(card.dataset.id)
    } else if (!REDUCE && Math.hypot(velX, velY) > 0.5) {
      inertia = true; kick()
    }
  }
}

function onWheel(e) {
  e.preventDefault()
  const factor = 1 + (-Math.sign(e.deltaY)) * 0.12
  const ns = clamp(targetScale * factor, 0.6, 2.4)
  const wx = (e.clientX - panX) / targetScale
  const wy = (e.clientY - panY) / targetScale
  targetScale = ns
  panX = e.clientX - wx * ns
  panY = e.clientY - wy * ns
  dismissHint()
  kick()
}

stage.addEventListener('pointerdown', onDown)
stage.addEventListener('pointermove', onMove)
stage.addEventListener('pointerup', onUp)
stage.addEventListener('pointercancel', onUp)
stage.addEventListener('dragstart', (e) => e.preventDefault())
stage.addEventListener('wheel', onWheel, { passive: false })

// ------------------------------------------------------------
//  Giroscopio: al inclinar el móvil, el lienzo se mueve un poco.
//  Reacciona al MOVIMIENTO y se auto-recentra (no a la posición
//  absoluta) para que no maree si lo dejas inclinado.
// ------------------------------------------------------------
function onOrient(e) {
  if (e.gamma == null || e.beta == null) return
  const g = e.gamma // izq/der  (-90..90)
  const b = e.beta  // ade/atrás (-180..180)
  if (gyroBaseG === null) { gyroBaseG = g; gyroBaseB = b }
  // la base persigue lentamente la inclinación actual → re-centra
  gyroBaseG += (g - gyroBaseG) * 0.02
  gyroBaseB += (b - gyroBaseB) * 0.02
  gyroTX = clamp(-(g - gyroBaseG) * 1.6, -GYRO_MAX, GYRO_MAX)
  gyroTY = clamp(-(b - gyroBaseB) * 1.6, -GYRO_MAX, GYRO_MAX)
  kick()
}

function startGyro() {
  if (gyroSetup) return
  window.addEventListener('deviceorientation', onOrient)
  gyroSetup = true
}

// ¿El navegador exige permiso explícito? (iOS 13+)
const NEEDS_GYRO_PERM =
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof DeviceOrientationEvent.requestPermission === 'function'

if (gyroBtn) {
  gyroBtn.addEventListener('click', async () => {
    try {
      const state = await DeviceOrientationEvent.requestPermission()
      if (state === 'granted') {
        startGyro()
        gyroBtn.hidden = true
      } else {
        // denegado: casi siempre Ajustes › Safari › Movimiento y orientación
        gyroLabel.textContent = 'Actívalo en Ajustes › Safari'
        setTimeout(() => { gyroBtn.hidden = true }, 4500)
      }
    } catch {
      gyroBtn.hidden = true
    }
  })
}

function setupGyro() {
  if (REDUCE || !window.DeviceOrientationEvent) return
  if (NEEDS_GYRO_PERM) {
    if (gyroBtn) gyroBtn.hidden = false // iOS: mostrar el botón
  } else {
    startGyro() // Android: directo
  }
}

// ------------------------------------------------------------
// 5) Modal de obra
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
  setTimeout(() => { modal.classList.add('hidden'); modalImg.src = '' }, 320)
}

function onKey(e) { if (e.key === 'Escape') closeModal() }

modalClose.addEventListener('click', closeModal)
modalBackdrop.addEventListener('click', closeModal)
modalCard.addEventListener('click', (e) => e.stopPropagation())

// ------------------------------------------------------------
// 6) Centrar, hint, resize, init
// ------------------------------------------------------------
function recenter() {
  panX = startX; panY = startY; targetScale = 1; inertia = false; velX = velY = 0
  if (REDUCE) { curX = panX; curY = panY; curScale = 1 }
  kick()
}
centerBtn.addEventListener('click', recenter)

function dismissHint() {
  if (hint && !hint.classList.contains('gone')) hint.classList.add('gone')
}
setTimeout(dismissHint, 6500)

let resizeTimer = null
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    vw = window.innerWidth; vh = window.innerHeight
    computeLayout()
    world.innerHTML = ''
    active.clear(); pool.length = 0; firstPaint = false
    kick()
  }, 180)
})

// init
computeLayout()
centerStart()
setupGyro()
kick()

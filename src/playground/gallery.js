import VanillaTilt from 'vanilla-tilt'
import './playground.css'

/* ============================================================
   Galería de lienzo infinito arrastrable (estilo kree8) — motor
   reutilizable. Se inicializa con initGallery({ artworks, artist,
   imgBase }). El HTML comparte los mismos IDs entre páginas.
   ============================================================ */

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const baseName = (f) => f.replace(/\.[^.]+$/, '')
const RATIOS = [1.18, 0.82, 1.34, 0.95, 1.0, 1.46, 0.78, 1.12, 1.28, 0.88]

export function initGallery({ artworks, artist, imgBase = 'posts', scatter = false, sound = false, ratios = RATIOS, watermark = null, defaultTheme = null }) {
  // Rutas de imagen: WebP (miniatura para tarjetas, grande para el modal) con
  // fallback a los originales (varias codificaciones por nombres raros).
  function candidates(filename, kind) {
    const raw = baseName(filename)
    const list = []
    // encodeURI primero: mantiene la coma literal (que el servidor sí resuelve);
    // encodeURIComponent (%2C) como respaldo.
    if (kind === 'thumb' || kind === 'full') {
      list.push(`/${imgBase}/${kind}/${encodeURI(raw)}.webp`)
      list.push(`/${imgBase}/${kind}/${encodeURIComponent(raw)}.webp`)
    }
    list.push(
      `/${imgBase}/${encodeURI(filename)}`,
      `/${imgBase}/${encodeURIComponent(filename)}`,
      `/${imgBase}/${filename}`,
    )
    return list
  }
  function setImgWithFallback(img, filename, kind) {
    const list = candidates(filename, kind)
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
  const modalFrame = document.getElementById('pg-modal-frame')
  const modalPrev = document.getElementById('pg-modal-prev')
  const modalNext = document.getElementById('pg-modal-next')
  const modalImg = document.getElementById('pg-modal-img')
  const modalTitle = document.getElementById('pg-modal-title')
  const modalMedium = document.getElementById('pg-modal-medium')
  const modalPrice = document.getElementById('pg-modal-price')
  const modalIg = document.getElementById('pg-modal-ig')
  const modalClose = document.getElementById('pg-modal-close')
  const modalBackdrop = document.getElementById('pg-modal-backdrop')

  let vw = window.innerWidth
  let vh = window.innerHeight

  // --- Layout del tile base (masonry) que se repite al infinito ---
  let COL_W, GAP, NUM_COLS, tileW, tileH, cards

  function computeLayout() {
    if (vw < 560) { NUM_COLS = 2; COL_W = Math.min(220, (vw - 56) / 2) }
    else if (vw < 920) { NUM_COLS = 3; COL_W = 220 }
    else if (vw < 1300) { NUM_COLS = 4; COL_W = 240 }
    else { NUM_COLS = 5; COL_W = 256 }
    GAP = Math.round(COL_W * 0.18)

    // Densificar si hay pocas obras: repetir (con rotación para variar el
    // patrón) hasta ~6 por columna, así el lienzo queda lleno como en una
    // galería grande en vez de quedar con huecos.
    let list = artworks
    const target = NUM_COLS * 6
    if (artworks.length > 0 && artworks.length < target) {
      list = []
      let r = 0
      while (list.length < target) {
        const off = r % artworks.length
        list = list.concat(artworks.slice(off), artworks.slice(0, off))
        r += 1
      }
    }

    const cols = Array.from({ length: NUM_COLS }, () => ({ items: [], sumH: 0 }))
    list.forEach((art, i) => {
      let c = 0
      for (let k = 1; k < NUM_COLS; k++) if (cols[k].sumH < cols[c].sumH) c = k
      // proporción real de la imagen → la obra se ve completa, sin recorte
      const h = Math.round(COL_W * (art.ratio || ratios[i % ratios.length]))
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
        // rotación leve determinista (scatter "fotos sobre la mesa")
        const seed = Math.sin((cards.length + 1) * 127.1) * 43758.5453
        const rot = scatter ? ((seed - Math.floor(seed)) * 2 - 1) * 2.2 : 0
        cards.push({ art, x, y, w: COL_W, h, rot })
        y += h + s
      })
    })

    tileW = NUM_COLS * (COL_W + GAP)
  }

  // --- Pool de nodos reciclables ---
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
    img.addEventListener('load', hideLoader)
    const cap = document.createElement('div')
    cap.className = 'pg-card-cap'
    inner.appendChild(img)
    inner.appendChild(cap)
    el.appendChild(inner)
    world.appendChild(el)
    // Tilt 3D al pasar el cursor (vanilla-tilt) en el nodo EXTERNO para que el
    // área de hover siga a la caja transformada y no parpadee.
    // Solo en dispositivos con hover real: en táctil no aporta y provoca el
    // "primer toque = hover" de iOS (había que tocar dos veces para abrir).
    if (!REDUCE && window.matchMedia('(hover: hover)').matches) {
      VanillaTilt.init(el, {
        max: 11, speed: 500, scale: 1.04, perspective: 900,
        glare: true, 'max-glare': 0.22, gyroscope: false,
      })
    }
    return { el, inner, img, cap, artId: null }
  }

  function acquire() {
    const node = pool.pop()
    if (node) { node.el.style.display = ''; return node }
    return createNode()
  }

  // Pre-crea nodos ocultos (repartidos en frames) para que el PRIMER scroll/zoom
  // reutilice el pool en vez de crear muchos nodos de golpe (evita el tirón).
  const PREWARM = 130
  function prewarmPool() {
    if (active.size + pool.length >= PREWARM) return
    let n = 0
    while (active.size + pool.length < PREWARM && n < 10) {
      const node = createNode()
      node.el.style.display = 'none'
      pool.push(node)
      n += 1
    }
    if (active.size + pool.length < PREWARM) requestAnimationFrame(prewarmPool)
  }

  function release(node) {
    node.el.style.display = 'none'
    node.inner.classList.remove('pg-enter')
    pool.push(node)
  }

  function placeCard(node, card, i, j) {
    const cx = card.x + i * tileW
    const cy = card.y + j * tileH
    node.el.style.left = cx + 'px'
    node.el.style.top = cy + 'px'
    node.inner.style.transform = card.rot ? `rotate(${card.rot}deg)` : ''
    if (node.artId !== card.art.id) {
      node.el.style.width = card.w + 'px'
      node.el.style.height = card.h + 'px'
      node.el.dataset.id = card.art.id
      node.cap.textContent = card.art.title
      node.img.alt = card.art.title
      setImgWithFallback(node.img, card.art.filename, 'thumb')
      node.artId = card.art.id
    }
  }

  // --- Estado del lienzo (pan + zoom) con smooth-follow ---
  let panX = 0, panY = 0
  let curX = 0, curY = 0
  let targetScale = 1, curScale = 1
  let velX = 0, velY = 0
  let startX = 0, startY = 0

  let dragging = false
  let moved = false
  let inertia = false
  let lastX = 0, lastY = 0, downX = 0, downY = 0
  let tapCard = null
  const TAP_SLOP = 12

  const pointers = new Map()
  let pinch = false
  let pinchStartDist = 0, pinchStartScale = 1, pinchWx = 0, pinchWy = 0

  // Giroscopio: la inclinación controla la VELOCIDAD de desplazamiento
  const GYRO_SENS = 0.55
  const GYRO_DEAD = 5
  const GYRO_VMAX = 30
  let gDX = 0, gDY = 0
  let baseG = null, baseB = null
  let gyroOn = false
  let gyroSetup = false
  let gyroPermitted = false

  // Sonidos procedurales (Web Audio API, sin archivos externos)
  let actx = null, masterGain = null, soundOn = true
  let noteIdx = 0
  const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]

  function initActx() {
    if (actx || !sound) return
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)()
      masterGain = actx.createGain()
      masterGain.gain.value = 0.55
      masterGain.connect(actx.destination)
    } catch {}
  }
  const sndReady = () => sound && actx && soundOn
  function resumeCtx() { if (actx && actx.state === 'suspended') actx.resume() }

  function soundOpen() { // acorde cálido con eco al abrir obra
    if (!sndReady()) return; resumeCtx()
    const t = actx.currentTime
    ;[220, 330, 440].forEach((freq, i) => {
      const osc = actx.createOscillator(); osc.type = i === 0 ? 'sine' : 'triangle'; osc.frequency.value = freq
      const g = actx.createGain(); const vol = i === 0 ? 0.18 : 0.06 / (i + 1)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(vol, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
      const delay = actx.createDelay(0.3); delay.delayTime.value = 0.08 * (i + 1)
      const dg = actx.createGain(); dg.gain.value = 0.12
      osc.connect(g); g.connect(masterGain); g.connect(delay); delay.connect(dg); dg.connect(masterGain)
      osc.start(t); osc.stop(t + 0.6)
    })
  }

  function soundClose() { // whoosh descendente al cerrar
    if (!sndReady()) return; resumeCtx()
    const t = actx.currentTime
    const osc = actx.createOscillator(); osc.type = 'sine'
    osc.frequency.setValueAtTime(320, t)
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.25)
    const g = actx.createGain()
    g.gain.setValueAtTime(0.14, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    osc.connect(g); g.connect(masterGain)
    osc.start(t); osc.stop(t + 0.26)
  }

  function soundBio() { // susurro de papel al abrir la bio
    if (!sndReady()) return; resumeCtx()
    const t = actx.currentTime, n = (actx.sampleRate * 0.2) | 0
    const buf = actx.createBuffer(1, n, actx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    const src = actx.createBufferSource(); src.buffer = buf
    const lpf = actx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 600; lpf.Q.value = 1.2
    const g = actx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.18, t + 0.04)
    g.gain.linearRampToValueAtTime(0.1, t + 0.1)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    src.connect(lpf); lpf.connect(g); g.connect(masterGain)
    src.start(t); src.stop(t + 0.23)
  }

  function soundNav(dir) { // nota pentatónica que sube/baja según dirección
    if (!sndReady()) return; resumeCtx()
    noteIdx = dir > 0 ? (noteIdx + 1) % PENTA.length : (noteIdx - 1 + PENTA.length) % PENTA.length
    const t = actx.currentTime
    const osc = actx.createOscillator(); osc.type = 'sine'; osc.frequency.value = PENTA[noteIdx]
    const g = actx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    osc.connect(g); g.connect(masterGain)
    osc.start(t); osc.stop(t + 0.42)
  }

  function tiltToVel(deg) {
    if (Math.abs(deg) < GYRO_DEAD) return 0
    const d = deg - Math.sign(deg) * GYRO_DEAD
    return clamp(d * GYRO_SENS, -GYRO_VMAX, GYRO_VMAX)
  }

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
    const m = 620 // margen en coords del mundo (no se infla al hacer zoom-out)
    const S = curScale
    const wMinX = -curX / S - m, wMaxX = (vw - curX) / S + m
    const wMinY = -curY / S - m, wMaxY = (vh - curY) / S + m

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
    if (gyroOn && !REDUCE) {
      panX += -tiltToVel(gDX)
      panY += -tiltToVel(gDY)
    }

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

    let tY = 0, tX = 0
    if (!REDUCE) {
      tY = clamp((panX - curX) * 0.035, -5, 5)
      tX = clamp(-(panY - curY) * 0.035, -5, 5)
    }
    tiltEl.style.transform = `perspective(1300px) rotateX(${tX}deg) rotateY(${tY}deg)`
    world.style.transform = `translate3d(${curX}px, ${curY}px, 0) scale(${curScale})`

    const pf = REDUCE ? 1 : 0.62
    dots.style.backgroundPosition = `${curX * pf}px ${curY * pf}px`

    virtualize()

    const settled =
      Math.abs(panX - curX) < 0.15 &&
      Math.abs(panY - curY) < 0.15 &&
      Math.abs(targetScale - curScale) < 0.002 &&
      !inertia && !dragging && !gyroOn
    if (settled) {
      running = false
      firstPaint = false
      stage.classList.remove('moving')
    } else {
      rafId = requestAnimationFrame(step)
    }
  }

  // --- Interacción: arrastre, inercia, zoom (rueda + pinch) ---
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
      tapCard = e.target && e.target.closest ? e.target.closest('.pg-card') : null
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
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > TAP_SLOP) {
      moved = true; dismissHint()
    }
    kick()
  }

  function onUp(e) {
    pointers.delete(e.pointerId)
    try { stage.releasePointerCapture(e.pointerId) } catch {}
    if (pinch && pointers.size < 2) pinch = false

    if (pointers.size === 1) {
      const rem = [...pointers.values()][0]
      dragging = true; moved = true; lastX = rem.x; lastY = rem.y; velX = velY = 0
      return
    }
    if (pointers.size === 0 && dragging) {
      dragging = false
      stage.classList.remove('dragging')
      if (!moved) {
        let card = tapCard
        if (!card) {
          const under = document.elementFromPoint(e.clientX, e.clientY)
          card = under && under.closest('.pg-card')
        }
        if (card) openModal(card.dataset.id)
      } else if (!REDUCE && Math.hypot(velX, velY) > 0.5) {
        inertia = true; kick()
      }
      tapCard = null
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
  // red de seguridad: si el flujo de pointer no abrió la obra (primer toque
  // en algunos navegadores), el click sintético posterior la abre
  stage.addEventListener('click', (e) => {
    if (moved || !modal.classList.contains('hidden')) return
    if (performance.now() - modalOpenedAt < 500) return
    const under = document.elementFromPoint(e.clientX, e.clientY)
    const card = under && under.closest('.pg-card')
    if (card) openModal(card.dataset.id)
  })

  // --- Giroscopio: inclinar = velocidad de desplazamiento ---
  function onOrient(e) {
    if (e.gamma == null || e.beta == null) return
    if (baseG === null) { baseG = e.gamma; baseB = e.beta }
    gDX = e.gamma - baseG
    gDY = e.beta - baseB
    if (gyroOn) kick()
  }

  const NEEDS_GYRO_PERM =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'

  function updateGyroBtn() {
    if (!gyroBtn) return
    gyroBtn.classList.toggle('on', gyroOn)
    if (gyroLabel) gyroLabel.textContent = gyroOn ? 'Detener giroscopio' : 'Activar giroscopio'
  }

  async function toggleGyro() {
    if (gyroOn) { gyroOn = false; updateGyroBtn(); return }
    if (NEEDS_GYRO_PERM && !gyroPermitted) {
      try {
        const state = await DeviceOrientationEvent.requestPermission()
        if (state !== 'granted') {
          if (gyroLabel) gyroLabel.textContent = 'Actívalo en Ajustes › Safari'
          setTimeout(updateGyroBtn, 4500)
          return
        }
        gyroPermitted = true
      } catch { return }
    }
    if (!gyroSetup) { window.addEventListener('deviceorientation', onOrient); gyroSetup = true }
    baseG = baseB = null
    gDX = gDY = 0
    gyroOn = true
    updateGyroBtn()
    kick()
  }

  function setupGyro() {
    if (REDUCE || !gyroBtn) return
    const hasGyro = 'DeviceOrientationEvent' in window &&
      window.matchMedia('(pointer: coarse)').matches
    if (hasGyro) { gyroBtn.hidden = false; updateGyroBtn() }
  }

  if (gyroBtn) gyroBtn.addEventListener('click', toggleGyro)

  // --- Modal de obra (con zoom, navegación ‹› y enlace directo) ---
  let modalIndex = -1
  let modalOpenedAt = 0 // ignora el "ghost click" que sigue al tap de apertura
  let lastNavAt = 0     // evita dobles avances por eventos duplicados

  function setModalImage(filename) {
    modalImg.onerror = null
    modalImg.src = `/${imgBase}/thumb/${encodeURI(baseName(filename))}.webp`
    const list = candidates(filename, 'full')
    let idx = 0
    const tryNext = () => {
      const probe = new Image()
      probe.onload = () => { modalImg.src = probe.src }
      probe.onerror = () => { idx += 1; if (idx < list.length) tryNext() }
      probe.src = list[idx]
    }
    tryNext()
  }

  function showArtwork(art) {
    resetModalZoom()
    setModalImage(art.filename)
    modalImg.alt = art.title
    modalTitle.textContent = art.title
    modalMedium.textContent = art.medium || ''
    modalMedium.style.display = art.medium ? '' : 'none'
    if (modalPrice) {
      modalPrice.textContent = art.price || ''
      modalPrice.style.display = art.price ? '' : 'none'
      modalPrice.classList.toggle('pg-price-na', art.price === 'Vendido')
    }
    modalIg.href = art.instagramUrl || artist.instagramUrl
    if (location.hash !== '#' + art.id) {
      history.replaceState(null, '', '#' + art.id)
    }
  }

  function openModal(id) {
    const idx = artworks.findIndex((a) => a.id === id)
    if (idx < 0) return
    soundOpen()
    modalOpenedAt = performance.now()
    modalIndex = idx
    showArtwork(artworks[idx])
    modal.classList.remove('hidden')
    modal.setAttribute('aria-hidden', 'false')
    requestAnimationFrame(() => modal.classList.add('open'))
    document.addEventListener('keydown', onKey)
  }

  function navModal(dir) {
    if (modalIndex < 0 || artworks.length < 2) return
    const now = performance.now()
    // el click sintético tras abrir con tap, o eventos duplicados, no navegan
    if (now - modalOpenedAt < 400 || now - lastNavAt < 240) return
    lastNavAt = now
    soundNav(dir)
    modalIndex = (modalIndex + dir + artworks.length) % artworks.length
    if (REDUCE) { showArtwork(artworks[modalIndex]); return }
    // crossfade con leve deslizamiento hacia la dirección de navegación
    modalImg.classList.add('pg-img-out')
    modalCard.classList.add(dir > 0 ? 'pg-nav-next' : 'pg-nav-prev')
    setTimeout(() => {
      showArtwork(artworks[modalIndex])
      modalImg.classList.remove('pg-img-out')
      modalCard.classList.remove('pg-nav-next', 'pg-nav-prev')
    }, 170)
  }

  function closeModal() {
    soundClose()
    modal.classList.remove('open')
    modal.setAttribute('aria-hidden', 'true')
    modalIndex = -1
    document.removeEventListener('keydown', onKey)
    if (location.hash) history.replaceState(null, '', location.pathname + location.search)
    setTimeout(() => { modal.classList.add('hidden'); modalImg.src = ''; resetModalZoom() }, 320)
  }

  function onKey(e) {
    if (e.key === 'Escape') closeModal()
    else if (e.key === 'ArrowLeft') navModal(-1)
    else if (e.key === 'ArrowRight') navModal(1)
  }

  modalClose.addEventListener('click', closeModal)
  modalBackdrop.addEventListener('click', closeModal)
  modalCard.addEventListener('click', (e) => e.stopPropagation())
  // Navegación blindada: solo cuenta un click precedido por un pointerdown
  // físico y reciente sobre el botón; cada pointerdown habilita UN solo nav.
  // (mata clicks sintéticos/duplicados de cualquier origen)
  function bindNav(btn, dir) {
    if (!btn) return
    let armed = 0
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); armed = performance.now() })
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const ok = armed && performance.now() - armed < 900
      armed = 0
      if (ok) navModal(dir)
    })
  }
  bindNav(modalPrev, -1)
  bindNav(modalNext, 1)
  if (artworks.length < 2) {
    if (modalPrev) modalPrev.style.display = 'none'
    if (modalNext) modalNext.style.display = 'none'
  }

  // --- Zoom dentro del modal (rueda + arrastre + pinch + doble clic) ---
  let mScale = 1, mX = 0, mY = 0
  let mDragging = false, mLastX = 0, mLastY = 0
  const mPointers = new Map()
  let mPinchDist = 0, mPinchScale = 1

  function applyModalTransform() {
    modalImg.style.transform = `translate(${mX}px, ${mY}px) scale(${mScale})`
  }
  function resetModalZoom() {
    mScale = 1; mX = 0; mY = 0
    modalImg.style.transform = ''
    if (modalFrame) modalFrame.classList.remove('zoomed')
  }
  function clampModalPan() {
    const w = modalImg.offsetWidth, h = modalImg.offsetHeight
    const maxX = Math.max(0, (mScale - 1) * w / 2)
    const maxY = Math.max(0, (mScale - 1) * h / 2)
    mX = clamp(mX, -maxX, maxX)
    mY = clamp(mY, -maxY, maxY)
  }
  function zoomModalAt(cx, cy, ns) {
    const px = (cx - mX) / mScale, py = (cy - mY) / mScale
    mScale = ns
    mX = cx - px * ns; mY = cy - py * ns
    if (mScale <= 1.001) { mScale = 1; mX = 0; mY = 0 }
    clampModalPan()
    applyModalTransform()
    if (modalFrame) modalFrame.classList.toggle('zoomed', mScale > 1)
  }

  if (modalFrame) {
    modalFrame.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = modalImg.getBoundingClientRect()
      const cx = e.clientX - (r.left + r.width / 2)
      const cy = e.clientY - (r.top + r.height / 2)
      const ns = clamp(mScale * (1 + (-Math.sign(e.deltaY)) * 0.18), 1, 4)
      zoomModalAt(cx, cy, ns)
    }, { passive: false })

    modalFrame.addEventListener('dblclick', resetModalZoom)

    modalFrame.addEventListener('pointerdown', (e) => {
      mPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (mPointers.size === 2) {
        const p = [...mPointers.values()]
        mPinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1
        mPinchScale = mScale
        mDragging = false
      } else if (mScale > 1) {
        mDragging = true; mLastX = e.clientX; mLastY = e.clientY
        try { modalFrame.setPointerCapture(e.pointerId) } catch {}
      }
    })
    modalFrame.addEventListener('pointermove', (e) => {
      const p = mPointers.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY }
      if (mPointers.size >= 2) {
        const pts = [...mPointers.values()]
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
        const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2
        const r = modalImg.getBoundingClientRect()
        zoomModalAt(mx - (r.left + r.width / 2), my - (r.top + r.height / 2),
          clamp(mPinchScale * (d / mPinchDist), 1, 4))
        return
      }
      if (!mDragging) return
      mX += e.clientX - mLastX; mY += e.clientY - mLastY
      mLastX = e.clientX; mLastY = e.clientY
      clampModalPan(); applyModalTransform()
    })
    const endPointer = (e) => {
      mPointers.delete(e.pointerId)
      if (mPointers.size < 2) mPinchDist = 0
      if (mPointers.size === 0) mDragging = false
      try { modalFrame.releasePointerCapture(e.pointerId) } catch {}
    }
    modalFrame.addEventListener('pointerup', endPointer)
    modalFrame.addEventListener('pointercancel', endPointer)
  }

  // --- Enlace directo por hash (#id de obra) ---
  function openFromHash() {
    const id = decodeURIComponent((location.hash || '').replace('#', ''))
    if (id && artworks.some((a) => a.id === id)) openModal(id)
  }
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent((location.hash || '').replace('#', ''))
    if (id && artworks.some((a) => a.id === id)) openModal(id)
    else if (!id && !modal.classList.contains('hidden')) closeModal()
  })

  // --- Brand expandible (opcional: solo si existe en el HTML) ---
  const aboutEl = document.getElementById('pg-about')
  const aboutToggle = document.getElementById('pg-about-toggle')
  if (aboutEl && aboutToggle) {
    const setAbout = (open) => {
      if (open) soundBio()
      aboutEl.classList.toggle('open', open)
      aboutToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      document.body.classList.toggle('pg-about-open', open) // desenfoca el fondo
    }
    aboutToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      setAbout(!aboutEl.classList.contains('open'))
    })
    document.addEventListener('pointerdown', (e) => {
      if (aboutEl.classList.contains('open') && !aboutEl.contains(e.target)) setAbout(false)
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setAbout(false)
    })

    // Toggle de idioma ESP/ENG dentro de la mini bio (persistente)
    const langBtns = [...aboutEl.querySelectorAll('.pg-lang-btn')]
    const bios = [...aboutEl.querySelectorAll('.pg-about-bio[data-lang]')]
    if (langBtns.length && bios.length) {
      const setLang = (l) => {
        try { localStorage.setItem('pg-lang', l) } catch {}
        langBtns.forEach((b) => b.classList.toggle('active', b.dataset.lang === l))
        bios.forEach((p) => { p.hidden = p.dataset.lang !== l })
      }
      langBtns.forEach((b) =>
        b.addEventListener('click', (e) => { e.stopPropagation(); setLang(b.dataset.lang) })
      )
      let saved = null
      try { saved = localStorage.getItem('pg-lang') } catch {}
      setLang(saved === 'en' ? 'en' : 'es')
    }
  }

  // --- Sonidos: contexto de audio + botón de silencio ---
  const audioBtn = document.getElementById('pg-audio')
  if (sound) {
    const updateAudioBtn = () => {
      if (!audioBtn) return
      audioBtn.classList.toggle('on', soundOn)
      audioBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false')
      audioBtn.title = soundOn ? 'Silenciar sonidos' : 'Activar sonidos'
    }
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        initActx()
        soundOn = !soundOn
        if (masterGain) masterGain.gain.linearRampToValueAtTime(soundOn ? 0.55 : 0, actx.currentTime + 0.25)
        updateAudioBtn()
      })
      audioBtn.hidden = false
      updateAudioBtn()
    }
    // crear el contexto en el primer gesto (política de autoplay)
    const initOnce = () => initActx()
    document.addEventListener('pointerdown', initOnce, { capture: true, once: true })
    document.addEventListener('wheel', initOnce, { capture: true, once: true })
  }

  // --- Tema claro/oscuro + marca de agua dinámica ---
  const themeBtn = document.getElementById('pg-theme')
  const bgword = document.getElementById('pg-bgword')

  function applyWatermark() {
    if (!bgword || !watermark) return
    const dark = document.documentElement.dataset.theme === 'dark'
    const fill = dark ? '%23b9c6da' : '%2334435a'
    const op = dark ? '0.06' : '0.05'
    const w = Math.max(300, Math.round(watermark.length * 32) + 90)
    bgword.style.backgroundImage =
      `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='150'%3E%3Ctext x='16' y='100' font-family='Helvetica,Arial,sans-serif' font-weight='bold' font-size='54' fill='${fill}' fill-opacity='${op}'%3E${encodeURIComponent(watermark)}%3C/text%3E%3C/svg%3E")`
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('pg-theme', t) } catch {}
    applyWatermark()
  }
  let savedTheme = null
  try { savedTheme = localStorage.getItem('pg-theme') } catch {}
  setTheme(savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : defaultTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))

  if (themeBtn) {
    themeBtn.hidden = false
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      // crossfade nativo del navegador si está disponible
      if (document.startViewTransition && !REDUCE) document.startViewTransition(() => setTheme(next))
      else setTheme(next)
    })
  }

  // --- Portada / selector de colecciones (opcional) ---
  const intro = document.getElementById('pg-intro')
  const introEnter = document.getElementById('pg-intro-enter')
  if (intro && introEnter) {
    // animación de elección: la tarjeta elegida se realza, el resto se apaga
    const chooseAnim = (el, done) => {
      if (REDUCE) { done(); return }
      intro.classList.add('pg-choosing')
      el.classList.add('pg-chosen')
      setTimeout(done, 480)
    }

    introEnter.addEventListener('click', () => {
      initActx(); resumeCtx() // gesto: prepara el audio
      chooseAnim(introEnter, () => {
        intro.classList.add('gone')
        setTimeout(() => {
          intro.style.display = 'none'
          intro.classList.remove('pg-choosing')
          introEnter.classList.remove('pg-chosen')
        }, 700)
      })
    })

    // tarjetas que llevan a la otra colección: animar antes de navegar
    intro.querySelectorAll('a.pg-choice').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        chooseAnim(a, () => { location.href = a.href })
      })
    })

    // La portada se muestra máximo 2 veces por dispositivo (como las
    // instrucciones del museo); después se entra directo al lienzo.
    // El botón "Colecciones" siempre puede reabrirla.
    const introKey = 'pg-intro-count:' + location.pathname
    let introSeen = 0
    try { introSeen = parseInt(localStorage.getItem(introKey) || '0', 10) } catch {}

    if (new URLSearchParams(location.search).has('entrar') || introSeen >= 2) {
      // viene del selector de la otra colección, o ya la vio 2 veces → directo
      // (.gone permite que "volver a colecciones" reaparezca con fade)
      intro.classList.add('gone')
      intro.style.display = 'none'
    } else {
      try { localStorage.setItem(introKey, String(introSeen + 1)) } catch {}
    }
  }

  // --- Menú móvil: muestra/oculta la barra de botones ---
  const menuBtn = document.getElementById('pg-menu')
  const navEl = document.getElementById('pg-nav')
  if (menuBtn && navEl) {
    const setNav = (open) => {
      navEl.classList.toggle('open', open)
      menuBtn.classList.toggle('open', open)
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
    }
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      setNav(!navEl.classList.contains('open'))
    })
    // se cierra al tocar fuera
    document.addEventListener('pointerdown', (e) => {
      if (!navEl.classList.contains('open')) return
      if (navEl.contains(e.target) || menuBtn.contains(e.target)) return
      setNav(false)
    })
  }

  // --- Botón "volver a colecciones": re-muestra la portada ---
  const collectionsBtn = document.getElementById('pg-collections')
  if (collectionsBtn && intro && introEnter) {
    collectionsBtn.hidden = false
    collectionsBtn.addEventListener('click', () => {
      intro.classList.remove('pg-choosing')
      intro.querySelectorAll('.pg-choice').forEach((c) => c.classList.remove('pg-chosen'))
      intro.style.display = ''
      requestAnimationFrame(() => requestAnimationFrame(() => intro.classList.remove('gone')))
    })
  }

  // --- Centrar, hint, resize ---
  function recenter() {
    panX = startX; panY = startY; targetScale = 1; inertia = false; velX = velY = 0
    if (REDUCE) { curX = panX; curY = panY; curScale = 1 }
    kick()
  }
  if (centerBtn) centerBtn.addEventListener('click', recenter)

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
      setTimeout(prewarmPool, 200)
    }, 180)
  })

  function preloadThumbs() {
    for (const art of artworks) {
      const im = new Image()
      im.src = `/${imgBase}/thumb/${encodeURI(baseName(art.filename))}.webp`
    }
  }

  // init
  computeLayout()
  centerStart()
  setupGyro()
  kick()
  setTimeout(preloadThumbs, 0)
  setTimeout(prewarmPool, 200)
  openFromHash() // abrir obra si la URL trae #id
}

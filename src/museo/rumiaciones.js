import { createEngine } from '../engine/engine.js'
import { contarVisita } from '../misc/visitas.js'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildSalaPremium } from './sala.js'
import { initFlipbook } from '../playground/flipbook.js'
import { initPanelZoom, initGyroLook, revealSala, createTourProgress, unlockAudios, mostrarErrorFatal, initDebugConsole } from './usabilidad.js'
import { ARTWORKS, ARTIST } from '../data/catalina.js'
import '../style.css'
import './museo.css'

/* ============================================================
   Museo Virtual · Rumiaciones — Catalina Olivero
   Versión MINIMALISTA (pedido de Catalina): white cube, marcos
   finos, sin vitrina, sin bancas, sin polvo. Sin música.
   ============================================================ */

// ============================================================
// Idioma ES/EN — ?lang=en en la URL o el botón de la portada;
// la elección se recuerda por navegador.
// ============================================================
let LANG = 'es'
try {
  const q = new URLSearchParams(location.search)
  if (q.get('lang') === 'en' || q.get('lang') === 'es') {
    LANG = q.get('lang')
    localStorage.setItem('museo-lang', LANG)
  } else if (localStorage.getItem('museo-lang') === 'en') {
    LANG = 'en'
  }
} catch {}
const EN = LANG === 'en'

// Statement de la serie (texto de Catalina) — vinilo en la pared sur
const STATEMENT_ES = [
  'La serie de pinturas acrílicas sobre lienzo de Catalina Olivero refleja la anatomía del pensamiento repetitivo, donde la abstracción opera como un medio para procesar la inestabilidad de los vínculos afectivos. Al prescindir de una imprimación que proteja el soporte, la tela cruda absorbe el pigmento de manera irreversible, transformándose en un registro textil del tránsito de las relaciones, una inmersión donde lavados ligeros y tonos vibrantes coexisten junto a texturas de carácter terroso.',
  'Estas obras, cuyos títulos recuperan fragmentos de diálogos personales, articulan un lenguaje visual de trazos que asemejan laberintos, espacios negativos que dan respiración al plano y un salpicado visceral que irrumpe como clausura mental. Así, a través de composiciones asimétricas que equilibran la tensión entre el control y la resistencia, la muestra invita a presenciar una liturgia del desahogo donde la rumiación de las ideas se convierte en un acto de liberación.',
]
const STATEMENT_EN = [
  "Catalina Olivero's series of acrylic paintings on canvas reflects the anatomy of repetitive thought, where abstraction operates as a means of processing the instability of emotional bonds. By forgoing a primer to protect the support, the raw canvas absorbs the pigment irreversibly, becoming a textile record of the passage of relationships — an immersion where light washes and vibrant tones coexist with earthy textures.",
  'These works, whose titles recover fragments of personal dialogues, articulate a visual language of strokes that resemble labyrinths, negative spaces that let the plane breathe, and a visceral splatter that erupts like mental closure. Thus, through asymmetrical compositions that balance the tension between control and resistance, the exhibition invites us to witness a liturgy of release in which the rumination of ideas becomes an act of liberation.',
]
const STATEMENT = EN ? STATEMENT_EN : STATEMENT_ES

// las 7 rumiaciones (en EN se traduce la técnica de la ficha)
const OBRAS = EN
  ? ARTWORKS.map((a) => ({
      ...a,
      medium: (a.medium || '').replace('Acrílico sobre lienzo sin imprimar', 'Acrylic on unprimed canvas'),
    }))
  : ARTWORKS

// --- DOM ---
const canvas = document.getElementById('scene')
const overlay = document.getElementById('overlay')
const playBtn = document.getElementById('play-btn')
const hud = document.getElementById('hud')
const crosshair = document.getElementById('crosshair')
const roomNameEl = document.getElementById('room-name')
const artworkCounterEl = document.getElementById('artwork-counter')

const tourControls = document.getElementById('tour-controls')
const tourPrev = document.getElementById('tour-prev')
const tourNext = document.getElementById('tour-next')
const tourExit = document.getElementById('tour-exit')
const tourCounter = document.getElementById('tour-counter')

const paintingPanel = document.getElementById('painting-panel')
const panelScrim = document.getElementById('panel-scrim')
const panelImage = document.getElementById('panel-image')
const panelTitle = document.getElementById('panel-title')
const panelMedium = document.getElementById('panel-medium')
const panelPrice = document.getElementById('panel-price')
const panelInstagram = document.getElementById('panel-instagram')

const mobileControls = document.getElementById('mobile-controls')
const joystickZone = document.getElementById('joystick-zone')
const joystickBase = document.getElementById('joystick-base')
const joystickThumb = document.getElementById('joystick-thumb')
const mobileInteract = document.getElementById('mobile-interact')
const roomTransition = document.getElementById('room-transition')

// Zoom en la imagen del panel + mirar con giroscopio (móvil)
const panelZoom = initPanelZoom(panelImage)
initGyroLook(document.getElementById('gyro-btn'))

// --- Engine + environment ---
initDebugConsole() // consola en pantalla con ?debug (diagnóstico en móviles)

let engine
try {
  engine = createEngine(canvas)
} catch (e) {
  mostrarErrorFatal('Tu navegador no pudo iniciar el visor 3D. Prueba a recargar o abre el enlace en otro navegador (Chrome actualizado o Samsung Internet).')
  throw e
}
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  mostrarErrorFatal('El dispositivo se quedó sin memoria gráfica. Cierra otras pestañas y recarga.')
})
{
  const pmrem = new THREE.PMREMGenerator(engine.renderer)
  engine.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  engine.scene.environmentIntensity = 0.3
  engine.scene.background = new THREE.Color(0x111110)
  engine.renderer.toneMappingExposure = 1.0
}

// --- Audio: solo pasos (sin música) ---
const audioFootsteps = new Audio('/sonidos/pasos.mp3')
audioFootsteps.loop = true
audioFootsteps.volume = 0.35

// Samsung/iOS bloquean audio fuera de un gesto → desbloquear al entrar
const unlockAudio = unlockAudios([audioFootsteps])

function playFootsteps() {
  if (audioFootsteps.paused) {
    audioFootsteps.currentTime = 0
    audioFootsteps.play().catch(() => {})
  }
}
function stopFootsteps() {
  if (!audioFootsteps.paused) {
    audioFootsteps.pause()
    audioFootsteps.currentTime = 0
  }
}

// --- Estado ---
let zoomIndex = -1
let museumEntered = false
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

// ============================================================
// Sala (minimal)
// ============================================================
let sala = null
async function enterSala() {
  try {
    sala = await buildSalaPremium(
      {
        artworks: OBRAS,
        imgBase: 'cat-posts',
        reflect: !isMobile, // concreto pulido: reflejo sutil de luz (solo desktop)
        title: 'Rumiaciones',
        subtitle: 'Catalina Olivero · 2026',
        statement: STATEMENT,
        statementTitle: 'Rumiaciones',
        statementCredit: '— Catalina Olivero',
        vitrina: { title: 'RUMIACIONES', sub: EN ? 'Catalogue · 2026' : 'Catálogo · 2026' },
        doors: [],
        minimal: true,
      },
      engine.renderer
    )
    engine.setRoom(sala)
    applyLights()
  } catch (e) {
    console.error('Error construyendo la sala:', e)
    mostrarErrorFatal('No se pudo cargar la sala. Revisa tu conexión y recarga la página.')
    return
  }
  roomNameEl.textContent = 'Rumiaciones'
  updateArtworkCounter()
}

// --- Obras vistas: "3 de 7 vistas" para incentivar completar la sala ---
const seenObras = new Set()
function updateArtworkCounter() {
  const seen = OBRAS.filter((a) => seenObras.has(a.id)).length
  artworkCounterEl.textContent = EN
    ? (seen > 0 ? `${seen} of ${OBRAS.length} works seen` : `${OBRAS.length} works`)
    : (seen > 0 ? `${seen} de ${OBRAS.length} obras vistas` : `${OBRAS.length} obras`)
}

// ============================================================
// Luces: encendidas / apagadas (modo oscuro, tecla L)
// ============================================================
const lightsBtn = document.getElementById('lights-btn')
let darkMode = false

function applyLights() {
  if (sala && sala.setDark) sala.setDark(darkMode)
  engine.scene.environmentIntensity = darkMode ? 0.1 : 0.3
  engine.scene.background.set(darkMode ? 0x040404 : 0x111110)
  if (lightsBtn) {
    lightsBtn.classList.toggle('off', darkMode)
    lightsBtn.querySelector('span').textContent = EN
      ? (darkMode ? 'Lights on' : 'Lights off')
      : (darkMode ? 'Encender luces' : 'Apagar luces')
  }
}
function toggleLights() {
  darkMode = !darkMode
  applyLights()
}
if (lightsBtn) lightsBtn.addEventListener('click', toggleLights)
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyL') toggleLights()
})

// ============================================================
// Recorrido automático (cinematográfico)
// ============================================================
const tourBtn = document.getElementById('tour-btn')
const tourStopBtn = document.getElementById('tour-auto-stop')
const tourProgress = createTourProgress(document.getElementById('tour-progress'))
let touring = false
let tourTimer = null
const TOUR_DWELL = 5200 // ms frente a cada obra

function tourAdvance() {
  if (!touring) return
  const total = engine.paintingMeshes.length
  if (zoomIndex >= total - 1) { stopTour(); return }
  navigateZoom(1)
  tourProgress.restart(TOUR_DWELL)
  tourTimer = setTimeout(tourAdvance, TOUR_DWELL)
}

function startTour() {
  const meshes = engine.paintingMeshes
  if (!meshes.length || touring) return
  touring = true
  museumEntered = true
  overlay.classList.add('fade-out')
  setTimeout(() => { overlay.style.display = 'none' }, 600)
  revealSala(roomTransition)
  hud.classList.remove('hidden')
  if (isMobile) { engine.enableMobile(); mobileControls.classList.remove('hidden') }
  if (tourStopBtn) tourStopBtn.classList.remove('hidden')
  tourProgress.show()
  tourProgress.restart(TOUR_DWELL + 800)
  enterZoom(meshes[0].userData.artwork, meshes[0])
  tourTimer = setTimeout(tourAdvance, TOUR_DWELL + 800)
  pushIn()
}

function stopTour() {
  if (!touring) return
  touring = false
  clearTimeout(tourTimer)
  if (tourStopBtn) tourStopBtn.classList.add('hidden')
  tourProgress.hide()
  exitZoom()
  if (!isMobile) {
    setTimeout(() => {
      if (!engine.locked && !engine.zoomMode) {
        overlay.style.display = ''
        overlay.classList.remove('fade-out')
        hud.classList.add('hidden')
      }
    }, 1100)
  }
}

// lento acercamiento a la obra mientras se contempla (dolly-in)
function pushIn() {
  if (!touring) return
  if (engine.zoomMode && !engine.zoomAnimating) {
    engine.camera.translateZ(-0.0009)
  }
  requestAnimationFrame(pushIn)
}

if (tourBtn) tourBtn.addEventListener('click', () => { unlockAudio(); startTour() })
if (tourStopBtn) tourStopBtn.addEventListener('click', stopTour)
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT' && !touring && museumEntered) startTour()
  else if (touring && (e.code === 'Escape' || e.code === 'KeyT')) stopTour()
})

// ============================================================
// Zoom / Tour
// ============================================================
function enterZoom(artwork, mesh) {
  stopFootsteps()
  const meshes = engine.paintingMeshes
  zoomIndex = meshes.indexOf(mesh)
  if (zoomIndex < 0) zoomIndex = 0
  engine.zoomToPainting(mesh)
  showPaintingPanel(artwork)
  showTourControls()
  hud.classList.add('hidden')
}

function exitZoom() {
  engine.zoomOut()
  zoomIndex = -1
  hidePaintingPanel()
  hideTourControls()
  hud.classList.remove('hidden')
  if (!isMobile && museumEntered) {
    setTimeout(() => { try { engine.requestLock() } catch {} }, 900)
  }
}

function navigateZoom(delta) {
  const meshes = engine.paintingMeshes
  if (meshes.length === 0) return
  const newIndex = zoomIndex + delta
  if (newIndex < 0 || newIndex >= meshes.length) return
  zoomIndex = newIndex
  const mesh = meshes[zoomIndex]
  engine.zoomToMesh(mesh)
  showPaintingPanel(mesh.userData.artwork)
  updateTourCounter()
}

function showPaintingPanel(artwork) {
  panelZoom.reset()
  panelTitle.textContent = artwork.title
  panelMedium.textContent = artwork.medium || ''
  panelMedium.style.display = artwork.medium ? '' : 'none'
  if (panelPrice) {
    panelPrice.textContent = artwork.price || ''
    panelPrice.style.display = artwork.price ? '' : 'none'
    panelPrice.classList.toggle('na', artwork.price === 'Vendido')
  }
  const base = artwork.filename.replace(/\.[^.]+$/, '')
  panelImage.src = `/cat-posts/full/${encodeURI(base)}.webp`
  panelImage.alt = artwork.title
  panelInstagram.href = artwork.instagramUrl || ARTIST.instagramUrl
  paintingPanel.classList.remove('hidden')
  if (panelScrim) panelScrim.classList.remove('hidden')
  seenObras.add(artwork.id)
  updateArtworkCounter()
}

function hidePaintingPanel() {
  panelZoom.reset()
  paintingPanel.classList.add('hidden')
  if (panelScrim) panelScrim.classList.add('hidden')
}
function showTourControls() { tourControls.classList.remove('hidden'); updateTourCounter() }
function hideTourControls() { tourControls.classList.add('hidden') }
function updateTourCounter() {
  const total = engine.paintingMeshes.length
  tourCounter.textContent = `${zoomIndex + 1} / ${total}`
  tourPrev.disabled = zoomIndex <= 0
  tourNext.disabled = zoomIndex >= total - 1
}

tourPrev.addEventListener('click', () => navigateZoom(-1))
tourNext.addEventListener('click', () => navigateZoom(1))
tourExit.addEventListener('click', () => exitZoom())
if (panelScrim) panelScrim.addEventListener('click', () => { if (!touring) exitZoom() })

document.addEventListener('keydown', (e) => {
  if (engine.zoomMode) {
    if (e.code === 'Escape') { exitZoom(); e.preventDefault() }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { navigateZoom(-1); e.preventDefault() }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { navigateZoom(1); e.preventDefault() }
  }
})

// ============================================================
// Vitrina central → catálogo (flipbook)
// ============================================================
let viewingBook = false
const book = initFlipbook({
  trigger: null,
  title: 'Rumiaciones',
  years: '2026',
  artist: ARTIST.name,
  handle: ARTIST.handle,
  photo: ARTIST.profileImage,
  statementTitle: 'Rumiaciones',
  statement: STATEMENT,
  artworks: ARTWORKS,
  imgBase: 'cat-posts',
  pdfUrl: null,
  logo: '/cat-logo-negro.svg',
  onClose: () => {
    viewingBook = false
    if (!isMobile && museumEntered) {
      setTimeout(() => { try { engine.requestLock() } catch {} }, 150)
    }
  },
})

// ============================================================
// Callbacks del motor
// ============================================================
engine.onPaintingClicked = (artwork, mesh) => enterZoom(artwork, mesh)
engine.onDoorClicked = () => {
  if (!book) return
  viewingBook = true
  stopFootsteps()
  engine.exitLock()
  book.open()
}
engine.onMovementChange = (isMoving) => { if (isMoving) playFootsteps(); else stopFootsteps() }
engine.onCrosshairChange = (state) => {
  if (state === 'pointer-artwork') crosshair.className = 'clickable artwork'
  else if (state === 'pointer-door') crosshair.className = 'clickable door'
  else crosshair.className = ''
}

// ============================================================
// Overlay / inicio
// ============================================================
const howto = document.getElementById('howto')
const howtoStart = document.getElementById('howto-start')

playBtn.addEventListener('click', () => {
  unlockAudio()
  overlay.classList.add('fade-out')
  setTimeout(() => { overlay.style.display = 'none' }, 600)
  // las instrucciones se muestran máximo 2 veces por dispositivo
  let seen = 0
  try { seen = parseInt(localStorage.getItem('howto-count') || '0', 10) } catch {}
  if (howto && seen < 2) {
    try { localStorage.setItem('howto-count', String(seen + 1)) } catch {}
    howto.classList.remove('hidden')
  } else {
    enterMuseum()
  }
})
if (howtoStart) howtoStart.addEventListener('click', enterMuseum)

// Botón "volver" del HUD (móvil): regresa a la pantalla de inicio
const backBtn = document.getElementById('back-btn')
if (backBtn) backBtn.addEventListener('click', () => {
  stopFootsteps()
  overlay.style.display = ''
  overlay.classList.remove('fade-out')
  hud.classList.add('hidden')
  if (isMobile) mobileControls.classList.add('hidden')
})

// Gestos animados al aparecer en la sala (solo móvil)
const gestureHints = document.getElementById('gesture-hints')
function showGestureHints() {
  if (!gestureHints || !isMobile) return
  gestureHints.classList.add('show')
  let hideTimer = setTimeout(hideGestureHints, 8000)
  function hideGestureHints() {
    clearTimeout(hideTimer)
    gestureHints.classList.remove('show')
    canvas.removeEventListener('touchstart', hideGestureHints)
    joystickZone.removeEventListener('touchstart', hideGestureHints)
  }
  canvas.addEventListener('touchstart', hideGestureHints, { passive: true })
  joystickZone.addEventListener('touchstart', hideGestureHints, { passive: true })
}

function enterMuseum() {
  if (howto) howto.classList.add('hidden')
  museumEntered = true
  revealSala(roomTransition) // fade desde negro: disimula la carga de texturas
  hud.classList.remove('hidden')
  if (isMobile) mobileControls.classList.remove('hidden')
  if (!isMobile) { try { engine.requestLock() } catch {} }
  showGestureHints()
}

document.addEventListener('pointerlockchange', () => {
  if (isMobile) return
  if (viewingBook || touring) return // el catálogo/recorrido gestionan su propio estado
  if (!engine.locked && !engine.zoomMode && !engine.zoomAnimating) {
    if (museumEntered) {
      overlay.style.display = ''
      overlay.classList.remove('fade-out')
      hud.classList.add('hidden')
      stopFootsteps()
    }
  } else if (engine.locked) {
    overlay.style.display = 'none'
    overlay.classList.add('fade-out')
    hud.classList.remove('hidden')
  }
})

// ============================================================
// Joystick móvil (tracking por identificador de toque)
// ============================================================
if (isMobile) {
  playBtn.addEventListener('click', () => engine.enableMobile())

  let joyTouchId = null
  let joystickStartX = 0, joystickStartY = 0
  const joystickRadius = 50

  joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (joyTouchId !== null) return
    const touch = e.changedTouches[0]
    joyTouchId = touch.identifier
    joystickStartX = touch.clientX
    joystickStartY = touch.clientY
    joystickBase.classList.add('active')
  }, { passive: false })

  document.addEventListener('touchmove', (e) => {
    if (joyTouchId === null) return
    let touch = null
    for (const t of e.touches) {
      if (t.identifier === joyTouchId) { touch = t; break }
    }
    if (!touch) return
    let dx = touch.clientX - joystickStartX
    let dy = touch.clientY - joystickStartY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > joystickRadius) {
      dx = dx / dist * joystickRadius
      dy = dy / dist * joystickRadius
    }
    joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`
    engine.setVirtualJoystick(dx / joystickRadius, dy / joystickRadius)
  }, { passive: true })

  const endJoystick = (e) => {
    if (joyTouchId === null) return
    let released = false
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) { released = true; break }
    }
    if (!released) return
    joyTouchId = null
    joystickThumb.style.transform = ''
    joystickBase.classList.remove('active')
    engine.setVirtualJoystick(0, 0)
  }
  document.addEventListener('touchend', endJoystick)
  document.addEventListener('touchcancel', endJoystick)

  mobileInteract.addEventListener('touchstart', (e) => {
    e.preventDefault()
    canvas.dispatchEvent(new MouseEvent('click'))
  }, { passive: false })

  let lookTouchId = null
  let lookStartX = 0, lookStartY = 0

  canvas.addEventListener('touchstart', (e) => {
    if (engine.zoomMode) return
    for (const touch of e.changedTouches) {
      if (touch.clientX > window.innerWidth * 0.35) {
        lookTouchId = touch.identifier
        lookStartX = touch.clientX
        lookStartY = touch.clientY
        break
      }
    }
  }, { passive: true })

  canvas.addEventListener('touchmove', (e) => {
    if (lookTouchId === null || engine.zoomMode) return
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookTouchId) {
        const dx = touch.clientX - lookStartX
        const dy = touch.clientY - lookStartY
        lookStartX = touch.clientX
        lookStartY = touch.clientY
        document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx * 2.2, movementY: dy * 2.2 }))
        break
      }
    }
  }, { passive: true })

  canvas.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookTouchId) { lookTouchId = null; break }
    }
  }, { passive: true })

  let swipeStartX = 0, swipeStartY = 0
  canvas.addEventListener('touchstart', (e) => {
    if (!engine.zoomMode) return
    const touch = e.touches[0]
    swipeStartX = touch.clientX
    swipeStartY = touch.clientY
  }, { passive: true })

  canvas.addEventListener('touchend', (e) => {
    if (!engine.zoomMode) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - swipeStartX
    const dy = touch.clientY - swipeStartY
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      navigateZoom(dx < 0 ? 1 : -1)
    } else if (dy > 80) {
      exitZoom()
    }
  }, { passive: true })
}

// ============================================================
// Interfaz en inglés + botón de idioma en la portada
// ============================================================
const langBtn = document.getElementById('lang-btn')
if (langBtn) {
  langBtn.textContent = EN ? 'Versión en español' : 'English version'
  langBtn.addEventListener('click', () => {
    try { localStorage.setItem('museo-lang', EN ? 'es' : 'en') } catch {}
    const u = new URL(location.href)
    u.searchParams.set('lang', EN ? 'es' : 'en')
    location.href = u.toString()
  })
}

if (EN) {
  const T = (sel, txt) => { const el = document.querySelector(sel); if (el) el.textContent = txt }
  const lastText = (sel, txt) => {
    const el = document.querySelector(sel)
    if (el && el.lastChild) el.lastChild.textContent = ' ' + txt
  }
  T('#play-btn', 'Enter the Museum')
  lastText('#tour-btn', 'Auto Tour')
  T('#gallery-link', 'View canvas gallery →')
  T('.overlay-link', 'Conexiones Museum →')
  T('#overlay-brand .subtitle', 'Virtual Museum · 2026')
  T('.controls-hint .desktop-only', 'WASD / Arrows move · Mouse look · Click interact')
  T('.controls-hint .mobile-only', 'Use the joystick to move · Tap to interact')
  const hintLabels = document.querySelectorAll('#control-hints .hint-label')
  const hintsEn = ['Move', 'Look', 'Click to interact', 'Lights', 'Pause']
  hintLabels.forEach((el, i) => { if (hintsEn[i]) el.textContent = hintsEn[i] })
  lastText('#tour-auto-stop', 'Stop tour')
  // instrucciones
  T('#howto h2', 'How it works')
  const hmP = document.querySelectorAll('#howto .howto-mobile .howto-step p')
  const hmEn = [
    '<strong>Move</strong> with the joystick in the bottom-left corner.',
    '<strong>Look around</strong> by dragging your finger on the screen (right side).',
    '<strong>Aim at an artwork</strong> and tap the <strong>◎</strong> button to see it up close.',
  ]
  hmP.forEach((el, i) => { if (hmEn[i]) el.innerHTML = hmEn[i] })
  const hdP = document.querySelectorAll('#howto .howto-desktop .howto-step p')
  const hdEn = [
    '<strong>Move</strong> with WASD or the arrow keys.',
    '<strong>Look around</strong> by moving the mouse.',
    '<strong>Click</strong> an artwork to see it up close.',
  ]
  hdP.forEach((el, i) => { if (hdEn[i]) el.innerHTML = hdEn[i] })
  const extra = document.querySelector('#howto .howto-extra')
  if (extra) extra.innerHTML = 'L · lights &nbsp;·&nbsp; T · auto tour &nbsp;·&nbsp; ESC · pause'
  T('#howto-start', "Ready — let's go!")
  // gestos y botones
  T('#gesture-hints .gh-move .gh-label', 'Move')
  T('#gesture-hints .gh-label-look', 'Look')
  lastText('#panel-instagram', 'View on Instagram')
  const setTitle = (id, t) => { const el = document.getElementById(id); if (el) el.title = t }
  setTitle('back-btn', 'Back to start')
  setTitle('gyro-btn', 'Look by moving your phone')
  setTitle('lights-btn', 'Lights on/off (L)')
  setTitle('panel-zoom', 'Scroll / pinch to zoom')
  setTitle('tour-prev', 'Previous')
  setTitle('tour-next', 'Next')
  setTitle('tour-exit', 'Back (ESC)')
  document.documentElement.lang = 'en'
}

// ============================================================
// Init
// ============================================================
enterSala()
contarVisita('museo-rumiaciones')

// ?entrar: salta la portada y entra directo a la sala
if (new URLSearchParams(location.search).has('entrar')) {
  overlay.classList.add('fade-out')
  setTimeout(() => { overlay.style.display = 'none' }, 150)
  if (isMobile) engine.enableMobile()
  setTimeout(enterMuseum, 500)
}

// contador de visitas visible en el HUD (tras registrar la propia)
const visitsHud = document.getElementById('visits-hud')
if (visitsHud) {
  setTimeout(() => {
    fetch('/api/visitas')
      .then((r) => r.json())
      .then((d) => {
        const n = (d.paginas && d.paginas['museo-rumiaciones']) || 0
        if (n > 0) visitsHud.textContent = EN
          ? n.toLocaleString('en-US') + (n === 1 ? ' visit' : ' visits')
          : n.toLocaleString('es-CO') + (n === 1 ? ' visita' : ' visitas')
      })
      .catch(() => {})
  }, 900)
}

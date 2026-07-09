import { createEngine } from './engine/engine.js'
import { contarVisita } from './misc/visitas.js'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildSalaPremium } from './museo/sala.js'
import { initPanelZoom, initGyroLook, revealSala, createTourProgress, unlockAudios } from './museo/usabilidad.js'
import { initFlipbook } from './playground/flipbook.js'
import { ARTWORKS, ARTIST } from './data/artworks.js'
import './style.css'
import './museo/museo.css'

/* ============================================================
   Museo Virtual · Danní — 2 salas premium (sin música).
   Misma experiencia que el museo de Catalina: skylight, focos,
   piso reflectante, polvo, recorrido automático, luces on/off.
   ============================================================ */

const SERIF = 'Georgia, "Times New Roman", serif' // identidad tipográfica de Danní

const SALAS = {
  sala1: {
    name: 'Sala I',
    artworks: ARTWORKS.filter((a) => a.room === 0 || a.room === 1),
    statement: [ARTIST.bioEs],
    statementTitle: 'Sobre la artista',
    statementCredit: '— Danní',
    statementX: -3,
    vitrina: { title: 'DANNÍ', sub: 'Catálogo · Museo Virtual' },
    doors: [{ x: 4.6, target: 'sala2', label: 'Sala II' }],
  },
  sala2: {
    name: 'Sala II',
    artworks: ARTWORKS.filter((a) => a.room === 2),
    statement: null,
    vitrina: null,
    doors: [{ x: 0, target: 'sala1', label: 'Volver a Sala I' }],
  },
}

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
const panelInstagram = document.getElementById('panel-instagram')

const roomTransition = document.getElementById('room-transition')

const mobileControls = document.getElementById('mobile-controls')
const joystickZone = document.getElementById('joystick-zone')
const joystickBase = document.getElementById('joystick-base')
const joystickThumb = document.getElementById('joystick-thumb')
const mobileInteract = document.getElementById('mobile-interact')

// Zoom en la imagen del panel + mirar con giroscopio (móvil)
const panelZoom = initPanelZoom(panelImage)
initGyroLook(document.getElementById('gyro-btn'))

// --- Engine + environment ---
const engine = createEngine(canvas)
{
  const pmrem = new THREE.PMREMGenerator(engine.renderer)
  engine.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  engine.scene.environmentIntensity = 0.28
  engine.scene.background = new THREE.Color(0x0d0c0b)
  engine.renderer.toneMappingExposure = 1.0
}

// --- Audio: solo pasos y puerta (sin música) ---
const audioFootsteps = new Audio('/sonidos/pasos.mp3')
audioFootsteps.loop = true
audioFootsteps.volume = 0.35
const audioDoor = new Audio('/sonidos/abrir-puerta.mp3')
audioDoor.volume = 0.6

// Samsung/iOS bloquean audio fuera de un gesto → desbloquear al entrar
const unlockAudio = unlockAudios([audioFootsteps, audioDoor])

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
let currentSala = 'sala1'
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

// ============================================================
// Salas
// ============================================================
let sala = null
async function enterSala(id) {
  currentSala = id
  zoomIndex = -1
  hidePaintingPanel()
  hideTourControls()
  const cfg = SALAS[id]
  try {
  sala = await buildSalaPremium(
    {
      artworks: cfg.artworks,
      imgBase: 'posts',
      reflect: !isMobile,
      title: 'Danní',
      subtitle: `Museo Virtual · ${cfg.name}`,
      font: SERIF,
      statement: cfg.statement,
      statementTitle: cfg.statementTitle,
      statementCredit: cfg.statementCredit,
      statementX: cfg.statementX || 0,
      vitrina: cfg.vitrina,
      doors: cfg.doors,
    },
    engine.renderer
  )
  engine.setRoom(sala)
  applyLights()
  } catch (e) {
    console.error("Error construyendo la sala:", e)
    roomNameEl.textContent = "Error al cargar — recarga la página"
    return
  }
  roomNameEl.textContent = cfg.name
  updateArtworkCounter()
}

// --- Obras vistas: "5 de 18 vistas" para incentivar completar la sala ---
const seenObras = new Set()
function updateArtworkCounter() {
  const obras = SALAS[currentSala].artworks
  const seen = obras.filter((a) => seenObras.has(a.id)).length
  artworkCounterEl.textContent = seen > 0
    ? `${seen} de ${obras.length} obras vistas`
    : `${obras.length} obras`
}

async function transitionToSala(id) {
  stopFootsteps()
  audioDoor.currentTime = 0
  audioDoor.play().catch(() => {})
  roomTransition.classList.add('active')
  await new Promise((res) => setTimeout(res, 420))
  await new Promise(requestAnimationFrame)
  await enterSala(id)
  if (!isMobile && museumEntered) {
    try { engine.requestLock() } catch {}
  }
  await new Promise((res) => setTimeout(res, 120))
  roomTransition.classList.remove('active')
}

// ============================================================
// Luces (tecla L)
// ============================================================
const lightsBtn = document.getElementById('lights-btn')
let darkMode = false

function applyLights() {
  if (sala && sala.setDark) sala.setDark(darkMode)
  engine.scene.environmentIntensity = darkMode ? 0.1 : 0.28
  engine.scene.background.set(darkMode ? 0x040404 : 0x0d0c0b)
  if (lightsBtn) {
    lightsBtn.classList.toggle('off', darkMode)
    lightsBtn.querySelector('span').textContent = darkMode ? 'Encender luces' : 'Apagar luces'
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
// Vitrina → catálogo (flipbook generado de los datos)
// ============================================================
let viewingBook = false
const book = initFlipbook({
  trigger: null,
  title: 'Danní',
  years: 'Museo Virtual',
  artist: ARTIST.name,
  handle: ARTIST.handle,
  photo: ARTIST.profileImage,
  statementTitle: 'Sobre la artista',
  statement: [ARTIST.bioEs],
  artworks: ARTWORKS,
  imgBase: 'posts',
  pdfUrl: null,
  onClose: () => {
    viewingBook = false
    if (!isMobile && museumEntered) {
      setTimeout(() => { try { engine.requestLock() } catch {} }, 150)
    }
  },
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
  const base = artwork.filename.replace(/\.[^.]+$/, '')
  panelImage.src = `/posts/full/${encodeURI(base)}.webp`
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
// Recorrido automático
// ============================================================
const tourBtn = document.getElementById('tour-btn')
const tourStopBtn = document.getElementById('tour-auto-stop')
const tourProgress = createTourProgress(document.getElementById('tour-progress'))
let touring = false
let tourTimer = null
const TOUR_DWELL = 5200

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
// Callbacks del motor
// ============================================================
engine.onPaintingClicked = (artwork, mesh) => enterZoom(artwork, mesh)
engine.onDoorClicked = (doorData) => {
  if (doorData.target === 'catalogo') {
    if (!book) return
    viewingBook = true
    stopFootsteps()
    engine.exitLock()
    book.open()
    return
  }
  transitionToSala(doorData.target)
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
// "Entrar" muestra primero las instrucciones; "¡Listo, entrar!" arranca
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

// Botón "volver" del HUD (móvil): regresa a la pantalla de inicio, desde
// donde se puede reentrar, lanzar el recorrido o irse a la galería.
const backBtn = document.getElementById('back-btn')
if (backBtn) backBtn.addEventListener('click', () => {
  stopFootsteps()
  overlay.style.display = ''
  overlay.classList.remove('fade-out')
  hud.classList.add('hidden')
  if (isMobile) mobileControls.classList.add('hidden')
})

// Gestos animados al aparecer en la sala (solo móvil): se ocultan al primer
// toque o a los 8 segundos — para quien no lee las instrucciones.
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
  if (viewingBook || touring) return
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
// Init
// ============================================================
enterSala('sala1')
contarVisita('museo-danni')

// contador de visitas visible en el HUD (tras registrar la propia)
const visitsHud = document.getElementById('visits-hud')
if (visitsHud) {
  setTimeout(() => {
    fetch('/api/visitas')
      .then((r) => r.json())
      .then((d) => {
        const n = (d.paginas && d.paginas['museo-danni']) || 0
        if (n > 0) visitsHud.textContent = n.toLocaleString('es-CO') + (n === 1 ? ' visita' : ' visitas')
      })
      .catch(() => {})
  }, 900)
}

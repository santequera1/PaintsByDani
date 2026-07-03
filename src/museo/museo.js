import { createEngine } from '../engine/engine.js'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildSalaConexiones } from './sala.js'
import { ARTWORKS, ARTIST, COLLECTION } from '../data/conexiones.js'
import '../style.css'
import './museo.css'

/* ============================================================
   Museo Virtual · Conexiones — Catalina Olivero
   Sala única premium. Sin música de fondo (solo pasos).
   ============================================================ */

// Obras excluidas por Catalina para el museo 3D
const EXCLUDE = new Set(['claudel-rodin', 'aron-piper', 'yes-no', 'peut-etre'])
const OBRAS = ARTWORKS.filter((a) => !EXCLUDE.has(a.id))

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

// --- Engine + environment (reflejos premium en piso/marcos) ---
const engine = createEngine(canvas)
{
  const pmrem = new THREE.PMREMGenerator(engine.renderer)
  engine.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  engine.scene.environmentIntensity = 0.28 // solo reflejos sutiles, sin lavar la luz
  engine.scene.background = new THREE.Color(0x0d0c0b)
  engine.renderer.toneMappingExposure = 1.0
}

// --- Audio: solo pasos (sin música, pedido de Catalina) ---
const audioFootsteps = new Audio('/sonidos/pasos.mp3')
audioFootsteps.loop = true
audioFootsteps.volume = 0.35

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
// Sala
// ============================================================
let sala = null
async function enterSala() {
  sala = await buildSalaConexiones(
    { artworks: OBRAS, collection: COLLECTION, imgBase: 'conexiones-posts' },
    engine.renderer
  )
  engine.setRoom(sala)
  applyLights()
  roomNameEl.textContent = COLLECTION.name
  artworkCounterEl.textContent = `${OBRAS.length} obras`
}

// ============================================================
// Luces: encendidas / apagadas (modo oscuro, tecla L)
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
  panelTitle.textContent = artwork.title
  panelMedium.textContent = artwork.medium || ''
  panelMedium.style.display = artwork.medium ? '' : 'none'
  if (panelPrice) {
    panelPrice.textContent = artwork.price || ''
    panelPrice.style.display = artwork.price ? '' : 'none'
    panelPrice.classList.toggle('na', artwork.price === 'No disponible')
  }
  const base = artwork.filename.replace(/\.[^.]+$/, '')
  panelImage.src = `/conexiones-posts/full/${encodeURI(base)}.webp`
  panelImage.alt = artwork.title
  panelInstagram.href = artwork.instagramUrl || ARTIST.instagramUrl
  paintingPanel.classList.remove('hidden')
}

function hidePaintingPanel() { paintingPanel.classList.add('hidden') }
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

document.addEventListener('keydown', (e) => {
  if (engine.zoomMode) {
    if (e.code === 'Escape') { exitZoom(); e.preventDefault() }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { navigateZoom(-1); e.preventDefault() }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { navigateZoom(1); e.preventDefault() }
  }
})

// ============================================================
// Callbacks del motor
// ============================================================
engine.onPaintingClicked = (artwork, mesh) => enterZoom(artwork, mesh)
engine.onMovementChange = (isMoving) => { if (isMoving) playFootsteps(); else stopFootsteps() }
engine.onCrosshairChange = (state) => {
  crosshair.className = state === 'pointer-artwork' ? 'clickable artwork' : ''
}

// ============================================================
// Overlay / inicio
// ============================================================
playBtn.addEventListener('click', () => {
  museumEntered = true
  overlay.classList.add('fade-out')
  hud.classList.remove('hidden')
  if (isMobile) mobileControls.classList.remove('hidden')
  setTimeout(() => {
    overlay.style.display = 'none'
    if (!isMobile) { try { engine.requestLock() } catch {} }
  }, 600)
})

document.addEventListener('pointerlockchange', () => {
  if (isMobile) return
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
// Joystick móvil (idéntico al museo de Danní)
// ============================================================
if (isMobile) {
  playBtn.addEventListener('click', () => engine.enableMobile())

  let joystickActive = false
  let joystickStartX = 0, joystickStartY = 0
  const joystickRadius = 50

  joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault()
    joystickActive = true
    const touch = e.touches[0]
    joystickStartX = touch.clientX
    joystickStartY = touch.clientY
    joystickBase.classList.add('active')
  }, { passive: false })

  document.addEventListener('touchmove', (e) => {
    if (!joystickActive) return
    let touch = null
    for (const t of e.touches) {
      const tdx = t.clientX - joystickStartX
      const tdy = t.clientY - joystickStartY
      if (Math.sqrt(tdx * tdx + tdy * tdy) < 120) { touch = t; break }
    }
    if (!touch) touch = e.touches[0]
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

  const endJoystick = () => {
    joystickActive = false
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
enterSala()

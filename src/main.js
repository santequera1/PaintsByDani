import { createEngine } from './engine/engine.js'
import { buildGalleryRoom, buildFoyer } from './game/room.js'
import { ROOMS, getArtworksByRoom, ARTWORKS, ARTIST } from './data/artworks.js'
import './style.css'

// --- DOM refs ---
const canvas = document.getElementById('scene')
const overlay = document.getElementById('overlay')
const playBtn = document.getElementById('play-btn')
const hud = document.getElementById('hud')
const crosshair = document.getElementById('crosshair')
const roomNameEl = document.getElementById('room-name')
const artworkCounterEl = document.getElementById('artwork-counter')

// Tour controls
const tourControls = document.getElementById('tour-controls')
const tourPrev = document.getElementById('tour-prev')
const tourNext = document.getElementById('tour-next')
const tourExit = document.getElementById('tour-exit')
const tourCounter = document.getElementById('tour-counter')

// Painting panel
const paintingPanel = document.getElementById('painting-panel')
const panelImage = document.getElementById('panel-image')
const panelTitle = document.getElementById('panel-title')
const panelMedium = document.getElementById('panel-medium')
const panelInstagram = document.getElementById('panel-instagram')

// Room transition
const roomTransition = document.getElementById('room-transition')

// Mobile
const mobileControls = document.getElementById('mobile-controls')
const joystickZone = document.getElementById('joystick-zone')
const joystickBase = document.getElementById('joystick-base')
const joystickThumb = document.getElementById('joystick-thumb')
const mobileInteract = document.getElementById('mobile-interact')

// --- Engine ---
const engine = createEngine(canvas)

// --- Audio ---
const audioAmbient = new Audio('/sonidos/piano-sonido ambiente.mp3')
audioAmbient.loop = true
audioAmbient.volume = 0.5

const audioFootsteps = new Audio('/sonidos/pasos.mp3')
audioFootsteps.loop = true
audioFootsteps.volume = 0.4

const audioDoor = new Audio('/sonidos/abrir-puerta.mp3')
audioDoor.volume = 0.7

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

function playDoorSound() {
  audioDoor.currentTime = 0
  audioDoor.play().catch(() => {})
}

// --- State ---
let currentRoomId = 'foyer'
let zoomIndex = -1
let museumEntered = false
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

// ============================================================
// Room management — Linear: Foyer → Sala I → Sala II
// ============================================================
async function enterRoom(roomId) {
  currentRoomId = roomId
  zoomIndex = -1
  hidePaintingPanel()
  hideTourControls()

  if (roomId === 'foyer') {
    const room = await buildFoyer({
      artworks: getArtworksByRoom(0),
      doors: [
        // Single door to Sala I (centered, on south wall at platform height)
        { position: { x: 0, z: 7.9, y: 0.7 }, rotation: Math.PI, target: 'sala1', label: 'Sala I' },
      ],
    }, engine.renderer)
    engine.setRoom(room)
    updateHUD('Bienvenida')
    return
  }

  if (roomId === 'sala1') {
    const roomDef = ROOMS[1]
    const artworks = getArtworksByRoom(1)
    const room = await buildGalleryRoom({
      width: roomDef.width,
      length: roomDef.length,
      artworks, roomId,
      doors: [
        // Back to foyer (south wall, flush)
        { position: { x: -3, z: roomDef.length / 2 - 0.01 }, rotation: Math.PI, target: 'foyer', label: 'Volver al Lobby' },
        // To Sala II (north wall, flush)
        { position: { x: 0, z: -roomDef.length / 2 + 0.01 }, rotation: 0, target: 'sala2', label: 'Sala II' },
      ],
      spawnZ: roomDef.length / 2 - 2,
    }, engine.renderer)
    engine.setRoom(room)
    updateHUD(roomDef.name)
    return
  }

  if (roomId === 'sala2') {
    const roomDef = ROOMS[2]
    const artworks = getArtworksByRoom(2)
    const room = await buildGalleryRoom({
      width: roomDef.width,
      length: roomDef.length,
      artworks, roomId,
      doors: [
        // Back to Sala I (south wall, flush)
        { position: { x: 0, z: roomDef.length / 2 - 0.01 }, rotation: Math.PI, target: 'sala1', label: 'Volver a Sala I' },
      ],
      spawnZ: roomDef.length / 2 - 2,
    }, engine.renderer)
    engine.setRoom(room)
    updateHUD(roomDef.name)
  }
}

function updateHUD(roomName) {
  roomNameEl.textContent = roomName
  artworkCounterEl.textContent = `${ARTWORKS.length} obras`
}

// ============================================================
// Zoom / Tour mode
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

  // Re-lock after zoom-out animation
  if (!isMobile && museumEntered) {
    setTimeout(() => {
      try { engine.requestLock() } catch (e) { /* ignore */ }
    }, 900)
  }
}

function navigateZoom(delta) {
  const meshes = engine.paintingMeshes
  if (meshes.length === 0) return

  const newIndex = zoomIndex + delta
  if (newIndex < 0 || newIndex >= meshes.length) return

  zoomIndex = newIndex
  const mesh = meshes[zoomIndex]
  const artwork = mesh.userData.artwork
  engine.zoomToMesh(mesh)
  showPaintingPanel(artwork)
  updateTourCounter()
}

// --- Painting panel ---
function showPaintingPanel(artwork) {
  panelTitle.textContent = artwork.title
  panelMedium.textContent = artwork.medium || ''

  // Show artwork image in panel
  const encodedFilename = encodeURIComponent(artwork.filename)
  const uriFilename = encodeURI(artwork.filename)
  const rawFilename = artwork.filename

  // Try multiple URL encodings — track attempt index to avoid src comparison issues
  let loadAttempt = 0
  const candidates = [
    `/posts/${encodedFilename}`,
    `/posts/${uriFilename}`,
    `/posts/${rawFilename}`,
  ]
  panelImage.onload = () => { panelImage.onerror = null }
  panelImage.onerror = () => {
    loadAttempt++
    if (loadAttempt < candidates.length) {
      panelImage.src = candidates[loadAttempt]
    } else {
      panelImage.src = '/profile.jpg'
    }
  }
  panelImage.src = candidates[0]
  panelImage.alt = artwork.title

  // Only show Instagram button if there's a specific post URL (not just profile)
  const isSpecificPost = artwork.instagramUrl &&
    artwork.instagramUrl !== ARTIST.instagramUrl &&
    artwork.instagramUrl.includes('/p/')
  if (isSpecificPost) {
    panelInstagram.href = artwork.instagramUrl
    panelInstagram.style.display = ''
  } else {
    panelInstagram.style.display = 'none'
  }

  paintingPanel.classList.remove('hidden')
}

function hidePaintingPanel() {
  paintingPanel.classList.add('hidden')
}

// --- Tour controls ---
function showTourControls() {
  tourControls.classList.remove('hidden')
  updateTourCounter()
}

function hideTourControls() {
  tourControls.classList.add('hidden')
}

function updateTourCounter() {
  const total = engine.paintingMeshes.length
  tourCounter.textContent = `${zoomIndex + 1} / ${total}`
  tourPrev.disabled = zoomIndex <= 0
  tourNext.disabled = zoomIndex >= total - 1
}

tourPrev.addEventListener('click', () => navigateZoom(-1))
tourNext.addEventListener('click', () => navigateZoom(1))
tourExit.addEventListener('click', () => exitZoom())

// --- Keyboard for tour ---
document.addEventListener('keydown', (e) => {
  if (engine.zoomMode) {
    if (e.code === 'Escape') { exitZoom(); e.preventDefault() }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { navigateZoom(-1); e.preventDefault() }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { navigateZoom(1); e.preventDefault() }
  }
})

// ============================================================
// Engine callbacks
// ============================================================
engine.onPaintingClicked = (artwork, mesh) => {
  enterZoom(artwork, mesh)
}

engine.onDoorClicked = (doorData) => {
  playDoorSound()
  transitionToRoom(doorData.target)
}

engine.onMovementChange = (isMoving) => {
  if (isMoving) playFootsteps()
  else stopFootsteps()
}

async function transitionToRoom(roomId) {
  stopFootsteps()
  // Fade to black, switch room, fade back (async to avoid blocking frames)
  roomTransition.classList.add('active')
  // Wait for fade-in to reach full opacity
  await new Promise((res) => setTimeout(res, 420))
  // Ensure browser had a frame to render the overlay
  await new Promise(requestAnimationFrame)
  // Load new room
  await enterRoom(roomId)
  // Re-lock pointer after transition
  if (!isMobile && museumEntered) {
    try { engine.requestLock() } catch (e) { /* ignore */ }
  }
  // Small delay to let scene settle, then fade back
  await new Promise((res) => setTimeout(res, 120))
  roomTransition.classList.remove('active')
}

engine.onCrosshairChange = (state) => {
  if (state === 'pointer-artwork') {
    crosshair.className = 'clickable artwork'
  } else if (state === 'pointer-door') {
    crosshair.className = 'clickable door'
  } else if (state === 'pointer') {
    crosshair.className = 'clickable'
  } else {
    crosshair.className = ''
  }
}

// ============================================================
// Overlay / start
// ============================================================
playBtn.addEventListener('click', () => {
  museumEntered = true
  overlay.classList.add('fade-out')
  hud.classList.remove('hidden')
  if (isMobile) {
    mobileControls.classList.remove('hidden')
  }
  // Start ambient music on user interaction
  audioAmbient.play().catch(() => {})
  setTimeout(() => {
    overlay.style.display = 'none'
    if (!isMobile) {
      try { engine.requestLock() } catch (e) { /* ignore */ }
    }
  }, 600)
})

// Re-show overlay when pointer lock lost (desktop only, not during zoom)
document.addEventListener('pointerlockchange', () => {
  if (isMobile) return
  if (!engine.locked && !engine.zoomMode && !engine.zoomAnimating) {
    if (museumEntered) {
      overlay.style.display = ''
      overlay.classList.remove('fade-out')
      hud.classList.add('hidden')
      // Pause ambient sound
      audioAmbient.pause()
      stopFootsteps()
    }
  } else if (engine.locked) {
    overlay.style.display = 'none'
    overlay.classList.add('fade-out')
    hud.classList.remove('hidden')
    // Resume ambient sound
    if (museumEntered) audioAmbient.play().catch(() => {})
  }
})

// ============================================================
// Mobile virtual joystick
// ============================================================
if (isMobile) {
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
    // Find the correct touch by proximity to start position
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

  // Mobile interact button
  mobileInteract.addEventListener('touchstart', (e) => {
    e.preventDefault()
    canvas.dispatchEvent(new MouseEvent('click'))
  }, { passive: false })

  // Mobile: touch on canvas to look around
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
        document.dispatchEvent(new MouseEvent('mousemove', {
          movementX: dx * 2.2,
          movementY: dy * 2.2,
        }))
        break
      }
    }
  }, { passive: true })

  canvas.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookTouchId) {
        lookTouchId = null
        break
      }
    }
  }, { passive: true })

  // Swipe gestures when in zoom mode
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
      if (dx < 0) navigateZoom(1)
      else navigateZoom(-1)
    } else if (dy > 80) {
      exitZoom()
    }
  }, { passive: true })
}

// Mobile: enable mobile mode in engine
if (isMobile) {
  playBtn.addEventListener('click', () => {
    engine.enableMobile()
  })
}

// ============================================================
// Init
// ============================================================
enterRoom('foyer')

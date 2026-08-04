import { createEngine } from '../engine/engine.js'
import { contarVisita } from '../misc/visitas.js'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildSalaPremium, buildSalaConexiones } from './sala.js'
import { initFlipbook } from '../playground/flipbook.js'
import { initPanelZoom, initGyroLook, revealSala, createTourProgress, unlockAudios, mostrarErrorFatal, initDebugConsole, setPanelImagen, precargarVecinas, precargarTodas } from './usabilidad.js'
import { obtenerContexto, cargarColeccion, API_BASE, enlaceMuseo, enlaceGaleria } from '../misc/museario.js'
import '../style.css'
import './museo.css'

/* ============================================================
   Museo Virtual · dinámico (Museario, Fase 1)
   Una sola página que monta el museo 3D de CUALQUIER colección
   leyendo datos y estilo desde la API (/api/m/...).
   ============================================================ */

const CTX = obtenerContexto()

// --- Idioma ES/EN (solo colecciones bilingües) ---
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

const panelZoom = initPanelZoom(panelImage)
initGyroLook(document.getElementById('gyro-btn'))
initDebugConsole()

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

// --- Audio: pasos ---
const audioFootsteps = new Audio('/sonidos/pasos.mp3')
audioFootsteps.preload = 'none'
audioFootsteps.loop = true
audioFootsteps.volume = 0.35
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

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0

main().catch((e) => {
  console.error(e)
  mostrarErrorFatal('No se pudo cargar la colección. Revisa tu conexión y recarga la página.')
})

async function main() {
  const { artista, coleccion, obras, colecciones } = await cargarColeccion(CTX)
  const est = coleccion.estilo || {}

  // El museo clásico de Danní (varias salas) tiene su propia página.
  if (est.tipo === 'salas') {
    location.replace('/index.html')
    return
  }

  const EN = LANG === 'en' && !!est.bilingue
  const TITULO = EN && est.nombreEn ? est.nombreEn : coleccion.nombre
  const IMG_BASE = coleccion.imgBase
  const STATEMENT = EN && coleccion.statementEn ? coleccion.statementEn : coleccion.statementEs
  const CLAVE = `m-${CTX.artista}-${CTX.coleccion}`

  const OBRAS = obras.map((o) => ({
    id: o.id,
    filename: o.filename,
    ratio: o.ratio,
    title: EN && o.titleEn ? o.titleEn : o.title,
    medium: EN && o.mediumEn ? o.mediumEn : o.medium,
    price: o.price,
    instagramUrl: o.instagramUrl || artista.instagramUrl,
  }))

  // --- Portada / textos ---
  document.title = `${EN ? 'Virtual Museum' : 'Museo Virtual'} · ${TITULO} | ${artista.nombre}`
  const artistPhoto = document.getElementById('artist-photo')
  if (artistPhoto) {
    // logo del artista (subido o de marca) → wordmark; foto → círculo;
    // sin nada (o si falla la carga) → logo de Museario
    const LOGO_MUSEARIO = '/museario/logo-blanco.svg'
    const subido = (artista.profileImage || '').startsWith('/media/')
    artistPhoto.src = artista.logoBlanco || artista.profileImage || LOGO_MUSEARIO
    artistPhoto.alt = artista.nombre
    artistPhoto.className = artista.logoBlanco || subido || !artista.profileImage ? 'artist-logo' : ''
    artistPhoto.hidden = false
    artistPhoto.onerror = () => {
      artistPhoto.onerror = null
      artistPhoto.src = LOGO_MUSEARIO
      artistPhoto.className = 'artist-logo'
    }
  }
  const h1 = document.querySelector('#overlay-brand h1')
  if (h1) h1.textContent = TITULO
  const sub = document.querySelector('#overlay-brand .subtitle')
  if (sub) sub.textContent = `${EN ? 'Virtual Museum' : 'Museo Virtual'} · ${coleccion.subtitulo || ''}`
  const watermark = document.getElementById('watermark')
  if (watermark) watermark.textContent = artista.handle || ''

  const galleryLink = document.getElementById('gallery-link')
  if (galleryLink) {
    galleryLink.href = enlaceGaleria(CTX, CTX.coleccion, true)
    if (EN) galleryLink.textContent = 'View canvas gallery →'
  }
  const overlayLinks = document.getElementById('overlay-links')
  if (overlayLinks) {
    colecciones
      .filter((c) => c.slug !== CTX.coleccion)
      .forEach((c) => {
        const aEl = document.createElement('a')
        aEl.className = 'overlay-link'
        aEl.href = enlaceMuseo(CTX, c.slug)
        aEl.textContent = EN ? `${c.nombre} Museum →` : `Museo ${c.nombre} →`
        overlayLinks.appendChild(aEl)
      })
  }

  // Portada del museo como fondo de la pantalla previa
  if (coleccion.portadaUrl) {
    overlay.style.backgroundImage = `url('${coleccion.portadaUrl}')`
    const velo = document.getElementById('velo-portada')
    if (velo) velo.hidden = false
  }

  // Chip con el perfil público del artista
  const chip = document.getElementById('perfil-chip')
  if (chip) {
    chip.href = CTX.pretty ? `/a/${CTX.artista}` : `/perfil.html?a=${CTX.artista}`
    const chipImg = document.getElementById('perfil-chip-img')
    const propio = artista.profileImage || artista.logoBlanco
    if (propio && chipImg) chipImg.src = propio
    const chipNombre = document.getElementById('perfil-chip-nombre')
    if (chipNombre) chipNombre.textContent = EN ? `${artista.nombre}'s profile` : `Perfil de ${artista.nombre}`
    chip.hidden = false
  }

  if (EN) {
    const T = (sel, txt) => { const el = document.querySelector(sel); if (el) el.textContent = txt }
    T('#play-btn', 'Enter the Museum')
    const tourBtnEl = document.getElementById('tour-btn')
    if (tourBtnEl) tourBtnEl.lastChild.textContent = ' Automatic tour'
    T('#overlay-cta .controls-hint .desktop-only', 'WASD / Arrows move · Mouse look · Click to interact')
    T('#overlay-cta .controls-hint .mobile-only', 'Use the joystick to move · Tap to interact')
    T('#howto-start', 'Ready, enter!')
    const lb = document.querySelector('#lights-btn span')
    if (lb) lb.textContent = 'Lights off'
  }

  // (declaradas antes de construir la sala: applyLights/updateArtworkCounter
  //  se invocan apenas termina el build)
  const lightsBtn = document.getElementById('lights-btn')
  let darkMode = false
  const seenObras = new Set()

  // ============================================================
  // Sala 3D según el estilo guardado en la base de datos
  // ============================================================
  let sala = null
  try {
    if (est.conexiones) {
      sala = await buildSalaConexiones(
        {
          artworks: OBRAS,
          collection: {
            name: coleccion.nombre,
            year: coleccion.subtitulo,
            statement: (STATEMENT && STATEMENT[0]) || '',
            statementFull: STATEMENT || [],
            pdfUrl: coleccion.pdfUrl,
          },
          imgBase: IMG_BASE,
          reflect: est.reflect === 'desktop' ? !isMobile : !!est.reflect,
        },
        engine.renderer
      )
    } else {
      const vitrina = est.vitrina
        ? { ...est.vitrina, sub: EN ? (est.vitrina.sub || '').replace('Catálogo', 'Catalogue') : est.vitrina.sub }
        : { title: coleccion.nombre.toUpperCase(), sub: EN ? 'Catalogue' : 'Catálogo' }
      sala = await buildSalaPremium(
        {
          artworks: OBRAS,
          imgBase: IMG_BASE,
          reflect: est.reflect === 'desktop' ? !isMobile : !!est.reflect,
          title: TITULO,
          subtitle: est.subtitle || `${artista.nombre} · ${coleccion.subtitulo || ''}`,
          statement: STATEMENT && STATEMENT.length ? STATEMENT : null,
          statementTitle: TITULO,
          statementCredit: `— ${artista.nombre}`,
          vitrina,
          doors: [],
          minimal: est.minimal !== false,
          sinMarco: est.sinMarco !== false,
          zocalo: !!est.zocalo,
          texPiso: (est.texturas && est.texturas.piso) || null,
          texPared: (est.texturas && est.texturas.pared) || null,
          banca: est.banca !== false,
          ...(est.hangBottomMin ? { hangBottomMin: est.hangBottomMin } : {}),
        },
        engine.renderer
      )
    }
    engine.setRoom(sala)
    applyLights()
  } catch (e) {
    console.error('Error construyendo la sala:', e)
    mostrarErrorFatal('No se pudo cargar la sala. Revisa tu conexión y recarga la página.')
    return
  }
  roomNameEl.textContent = TITULO
  updateArtworkCounter()

  // --- Obras vistas ---
  function updateArtworkCounter() {
    const seen = OBRAS.filter((a) => seenObras.has(a.id)).length
    artworkCounterEl.textContent = seen > 0
      ? (EN ? `${seen} of ${OBRAS.length} works seen` : `${seen} de ${OBRAS.length} obras vistas`)
      : (EN ? `${OBRAS.length} works` : `${OBRAS.length} obras`)
  }

  // ============================================================
  // Luces (tecla L)
  // ============================================================
  function applyLights() {
    if (sala && sala.setDark) sala.setDark(darkMode)
    engine.scene.environmentIntensity = darkMode ? 0.1 : 0.3
    engine.scene.background.set(darkMode ? 0x040404 : 0x111110)
    if (lightsBtn) {
      lightsBtn.classList.toggle('off', darkMode)
      lightsBtn.querySelector('span').textContent = darkMode
        ? (EN ? 'Lights on' : 'Encender luces')
        : (EN ? 'Lights off' : 'Apagar luces')
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
  // Vitrina central → catálogo (flipbook)
  // ============================================================
  let viewingBook = false
  const book = initFlipbook({
    trigger: null,
    title: TITULO,
    years: coleccion.subtitulo || '',
    artist: artista.nombre,
    handle: artista.handle,
    photo: artista.profileImage,
    statementTitle: TITULO,
    statement: STATEMENT || [],
    artworks: OBRAS,
    imgBase: IMG_BASE,
    pdfUrl: coleccion.pdfUrl || null,
    logo: artista.logoNegro || null,
    onClose: () => {
      viewingBook = false
      if (!isMobile && museumEntered) {
        setTimeout(() => { try { engine.requestLock() } catch {} }, 150)
      }
    },
  })

  // ============================================================
  // Recorrido automático
  // ============================================================
  let zoomIndex = -1
  let museumEntered = false
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
  // Zoom / Tour
  // ============================================================
  function enterZoom(artwork, mesh) {
    stopFootsteps()
    const meshes = engine.paintingMeshes
    zoomIndex = meshes.indexOf(mesh)
    if (zoomIndex < 0) zoomIndex = 0
    engine.zoomToPainting(mesh)
    precargarVecinas(meshes, zoomIndex, IMG_BASE)
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
    precargarVecinas(meshes, zoomIndex, IMG_BASE)
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
    setPanelImagen(panelImage, `/${IMG_BASE}/full/${encodeURI(base)}.webp`)
    panelImage.alt = artwork.title
    panelInstagram.href = artwork.instagramUrl || artista.instagramUrl
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
    else if (state === 'pointer-book') crosshair.className = 'clickable book'
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

  const backBtn = document.getElementById('back-btn')
  if (backBtn) backBtn.addEventListener('click', () => {
    stopFootsteps()
    overlay.style.display = ''
    overlay.classList.remove('fade-out')
    hud.classList.add('hidden')
    if (isMobile) mobileControls.classList.add('hidden')
  })

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
    revealSala(roomTransition)
    hud.classList.remove('hidden')
    if (isMobile) mobileControls.classList.remove('hidden')
    if (!isMobile) { try { engine.requestLock() } catch {} }
    showGestureHints()
    precargarTodas(engine.paintingMeshes, IMG_BASE)
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
  // Joystick móvil
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
  contarVisita(CLAVE)

  const visitsHud = document.getElementById('visits-hud')
  if (visitsHud) {
    setTimeout(() => {
      fetch(`${API_BASE}/api/visitas`)
        .then((r) => r.json())
        .then((d) => {
          const n = (d.paginas && d.paginas[CLAVE]) || 0
          if (n > 0) {
            visitsHud.textContent = n.toLocaleString('es-CO') +
              (EN ? (n === 1 ? ' visit' : ' visits') : (n === 1 ? ' visita' : ' visitas'))
          }
        })
        .catch(() => {})
    }, 900)
  }

  if (new URLSearchParams(location.search).has('entrar')) {
    overlay.classList.add('fade-out')
    setTimeout(() => { overlay.style.display = 'none' }, 150)
    if (isMobile) engine.enableMobile()
    setTimeout(enterMuseum, 500)
  }
}

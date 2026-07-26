/* ============================================================
   Mejoras de usabilidad compartidas por los dos museos 3D:
   - initPanelZoom: zoom en la imagen del panel de obra
     (rueda + pinch + arrastre + doble clic/doble toque)
   - initGyroLook: mirar alrededor con el giroscopio (móvil)
   - revealSala: fade desde negro al entrar (oculta el pop-in
     de texturas)
   ============================================================ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// Pantalla de error legible (estilos inline: funciona aunque el CSS falle).
// Sustituye la "página en blanco" cuando el WebGL muere o la sala no carga.
export function mostrarErrorFatal(mensaje) {
  if (document.getElementById('fatal-msg')) return
  const d = document.createElement('div')
  d.id = 'fatal-msg'
  d.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:#0a0a0c;color:#f0ece4;font-family:Helvetica,Arial,sans-serif;text-align:center;padding:32px'
  const p = document.createElement('p')
  p.style.cssText = 'margin:0;font-size:15px;line-height:1.65;max-width:420px;color:#f0ece4'
  p.textContent = mensaje
  const b = document.createElement('button')
  b.textContent = 'Recargar'
  b.style.cssText = 'padding:12px 36px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;border-radius:999px;cursor:pointer'
  b.addEventListener('click', () => location.reload())
  d.appendChild(p)
  d.appendChild(b)
  document.body.appendChild(d)
}

// Consola visible en pantalla con ?debug en la URL: para diagnosticar
// errores en teléfonos donde no hay DevTools.
export function initDebugConsole() {
  if (!new URLSearchParams(location.search).has('debug')) return
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;z-index:99999;background:rgba(0,0,0,.88);color:#7cfc9a;font:11px/1.55 monospace;padding:8px 10px;white-space:pre-wrap;word-break:break-all'
  box.textContent = '[debug] ' + navigator.userAgent + '\n'
  document.body.appendChild(box)
  const log = (m) => { box.textContent += m + '\n'; box.scrollTop = box.scrollHeight }
  window.addEventListener('error', (e) =>
    log('[error] ' + (e.message || '?') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno))
  window.addEventListener('unhandledrejection', (e) =>
    log('[promise] ' + (e.reason && (e.reason.message || e.reason))))
  const ce = console.error.bind(console)
  console.error = (...a) => { log('[console.error] ' + a.map(String).join(' ')); ce(...a) }
  const cw = console.warn.bind(console)
  console.warn = (...a) => { log('[console.warn] ' + a.map(String).join(' ')); cw(...a) }
  log('[debug] listo — esperando errores')
}

export function initPanelZoom(img) {
  const frame = img ? img.parentElement : null
  if (!img || !frame || frame.id !== 'panel-zoom') return { reset() {} }

  let scale = 1, x = 0, y = 0
  let dragging = false, lx = 0, ly = 0
  const pts = new Map()
  let pDist = 0, pScale = 1
  let lastTap = 0, movedFar = false, downX = 0, downY = 0

  function apply() {
    img.style.transform = scale > 1 ? `translate(${x}px, ${y}px) scale(${scale})` : ''
    frame.classList.toggle('zoomed', scale > 1)
  }
  function reset() { scale = 1; x = 0; y = 0; apply() }
  function clampPan() {
    const w = img.offsetWidth, h = img.offsetHeight
    const mx = Math.max(0, (scale - 1) * w / 2)
    const my = Math.max(0, (scale - 1) * h / 2)
    x = clamp(x, -mx, mx)
    y = clamp(y, -my, my)
  }
  function zoomAt(cx, cy, ns) {
    const px = (cx - x) / scale, py = (cy - y) / scale
    scale = ns
    x = cx - px * ns; y = cy - py * ns
    if (scale <= 1.001) { scale = 1; x = 0; y = 0 }
    clampPan(); apply()
  }
  function toggleZoom() { if (scale > 1) reset(); else zoomAt(0, 0, 2.2) }

  frame.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation()
    const r = img.getBoundingClientRect()
    zoomAt(
      e.clientX - (r.left + r.width / 2),
      e.clientY - (r.top + r.height / 2),
      clamp(scale * (1 + (-Math.sign(e.deltaY)) * 0.18), 1, 4)
    )
  }, { passive: false })

  frame.addEventListener('dblclick', (e) => { e.stopPropagation(); toggleZoom() })

  frame.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.size === 2) {
      const p = [...pts.values()]
      pDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1
      pScale = scale
      dragging = false
    } else {
      downX = e.clientX; downY = e.clientY; movedFar = false
      if (scale > 1) {
        dragging = true; lx = e.clientX; ly = e.clientY
        try { frame.setPointerCapture(e.pointerId) } catch {}
      }
    }
  })
  frame.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId)
    if (p) { p.x = e.clientX; p.y = e.clientY }
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 12) movedFar = true
    if (pts.size >= 2) {
      const v = [...pts.values()]
      const d = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1
      const mx = (v[0].x + v[1].x) / 2, my = (v[0].y + v[1].y) / 2
      const r = img.getBoundingClientRect()
      zoomAt(mx - (r.left + r.width / 2), my - (r.top + r.height / 2),
        clamp(pScale * (d / pDist), 1, 4))
      return
    }
    if (!dragging) return
    x += e.clientX - lx; y += e.clientY - ly
    lx = e.clientX; ly = e.clientY
    clampPan(); apply()
  })
  const endPointer = (e) => {
    // doble toque en táctil = acercar/alejar (dblclick no es fiable en móvil)
    if (e.type === 'pointerup' && e.pointerType === 'touch' && pts.size === 1 && !movedFar) {
      const now = performance.now()
      if (now - lastTap < 320) { toggleZoom(); lastTap = 0 }
      else lastTap = now
    }
    pts.delete(e.pointerId)
    if (pts.size < 2) pDist = 0
    if (pts.size === 0) dragging = false
    try { frame.releasePointerCapture(e.pointerId) } catch {}
  }
  frame.addEventListener('pointerup', endPointer)
  frame.addEventListener('pointercancel', endPointer)

  return { reset }
}

export function initGyroLook(btn) {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  if (!btn || !isTouch || !('DeviceOrientationEvent' in window)) return
  btn.hidden = false

  const NEEDS_PERM = typeof DeviceOrientationEvent.requestPermission === 'function'
  // 1° de giro del teléfono = 1° de cámara (mouseSens del motor es 0.002 rad/px)
  const DEG_TO_PX = (Math.PI / 180) / 0.002
  let on = false, granted = false, setup = false
  let lastA = null, lastB = null

  function onOrient(e) {
    if (e.beta == null) return
    const a = e.alpha, b = e.beta
    if (lastA === null) { lastA = a; lastB = b; return }
    const dA = a == null ? 0 : ((a - lastA + 540) % 360) - 180
    const dB = b - lastB
    lastA = a; lastB = b
    if (!on) return
    if (Math.abs(dA) > 40 || Math.abs(dB) > 40) return // salto de sensor, ignorar
    // el motor ya escucha mousemove (igual que el look táctil)
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: -dA * DEG_TO_PX,
      movementY: -dB * DEG_TO_PX,
    }))
  }

  async function toggle() {
    if (on) { on = false; btn.classList.remove('on'); return }
    if (NEEDS_PERM && !granted) {
      try {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') return
        granted = true
      } catch { return }
    }
    if (!setup) { window.addEventListener('deviceorientation', onOrient); setup = true }
    lastA = lastB = null
    on = true
    btn.classList.add('on')
  }
  btn.addEventListener('click', toggle)
}

// Barra de tiempo del recorrido automático: se llena durante la pausa en
// cada obra para que se sepa cuándo va a cambiar.
export function createTourProgress(el) {
  const bar = el ? el.querySelector('i') : null
  return {
    show() { if (el) el.classList.remove('hidden') },
    hide() {
      if (!el) return
      el.classList.add('hidden')
      if (bar) { bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)' }
    },
    restart(ms) {
      if (!bar) return
      bar.style.transition = 'none'
      bar.style.transform = 'scaleX(0)'
      void bar.offsetWidth
      bar.style.transition = `transform ${ms}ms linear`
      bar.style.transform = 'scaleX(1)'
    },
  }
}

// Samsung Internet / iOS bloquean audio.play() fuera de un gesto del usuario.
// Esto "desbloquea" los audios durante el clic de entrada (play mudo + pausa)
// para que los pasos suenen después, al caminar.
export function unlockAudios(list) {
  let done = false
  return function unlock() {
    if (done) return
    done = true
    for (const a of list) {
      a.muted = true
      const p = a.play()
      if (p && p.then) {
        p.then(() => { a.pause(); a.currentTime = 0; a.muted = false })
          .catch(() => { a.muted = false; done = false })
      } else {
        a.pause(); a.currentTime = 0; a.muted = false
      }
    }
  }
}

// Cambia la imagen del panel con estado de carga visible: sin esto, al
// pasar rápido entre obras se veía la imagen anterior con el nombre de la
// nueva mientras llegaba la descarga (bug reportado por Catalina).
export function setPanelImagen(img, url) {
  img.classList.add('panel-cargando')
  const done = () => img.classList.remove('panel-cargando')
  img.onload = done
  img.onerror = done
  img.src = url
}

// Precarga las obras vecinas del slider para que el cambio sea instantáneo
export function precargarVecinas(meshes, idx, imgBase) {
  for (const j of [idx - 1, idx + 1]) {
    const m = meshes[j]
    if (!m || !m.userData || !m.userData.artwork) continue
    const b = m.userData.artwork.filename.replace(/\.[^.]+$/, '')
    const im = new Image()
    im.src = `/${imgBase}/full/${encodeURI(b)}.webp`
  }
}

export function revealSala(roomTransition) {
  if (!roomTransition) return
  // accesibilidad: sin fundido si el sistema pide menos movimiento
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // negro instantáneo → pausa breve (cargan las texturas) → fade de 0.9s
  roomTransition.style.transition = 'none'
  roomTransition.classList.add('active')
  void roomTransition.offsetHeight
  roomTransition.style.transition = 'opacity 0.9s ease'
  setTimeout(() => {
    roomTransition.classList.remove('active')
    setTimeout(() => { roomTransition.style.transition = '' }, 950)
  }, 350)
}

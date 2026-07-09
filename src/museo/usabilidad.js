/* ============================================================
   Mejoras de usabilidad compartidas por los dos museos 3D:
   - initPanelZoom: zoom en la imagen del panel de obra
     (rueda + pinch + arrastre + doble clic/doble toque)
   - initGyroLook: mirar alrededor con el giroscopio (móvil)
   - revealSala: fade desde negro al entrar (oculta el pop-in
     de texturas)
   ============================================================ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

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

export function revealSala(roomTransition) {
  if (!roomTransition) return
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

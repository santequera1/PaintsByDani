import * as THREE from 'three'

// --- Seeded random (from museobase) ---
function seededRand(seed) {
  let s = (seed >>> 0) || 1
  return function rand() {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0xffffffff
  }
}

// --- Wall material: warm white gallery walls ---
export function createWallMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xeae6df,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.FrontSide,
  })
}

// --- Wood floor texture (ported from museobase) ---
function makeWoodFloorTextures(size = 1024) {
  const rand = seededRand(0x51f00d)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  // Base color: warm brown wood
  ctx.fillStyle = '#6a4a2e'
  ctx.fillRect(0, 0, size, size)

  // Draw planks
  const plankW = Math.floor(size * 0.13)
  const gap = Math.max(2, Math.floor(size * 0.004))
  const grainLines = Math.floor(size * 0.65)

  let x = 0
  while (x < size) {
    const pw = plankW + Math.floor((rand() - 0.5) * plankW * 0.3)
    const hue = 28 + rand() * 10
    const sat = 30 + rand() * 12
    const light = 22 + rand() * 10

    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`
    ctx.fillRect(x, 0, pw - gap, size)

    // Wood grain
    for (let g = 0; g < grainLines; g++) {
      const gy = rand() * size
      const gAlpha = 0.03 + rand() * 0.06
      const gLight = light + (rand() - 0.5) * 8
      ctx.strokeStyle = `hsla(${hue}, ${sat * 0.7}%, ${gLight}%, ${gAlpha})`
      ctx.lineWidth = 0.5 + rand() * 1.5
      ctx.beginPath()
      ctx.moveTo(x, gy)
      const cpx1 = x + pw * 0.3
      const cpy1 = gy + (rand() - 0.5) * 20
      const cpx2 = x + pw * 0.7
      const cpy2 = gy + (rand() - 0.5) * 20
      ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, x + pw - gap, gy + (rand() - 0.5) * 10)
      ctx.stroke()
    }

    // Knots
    if (rand() < 0.15) {
      const kx = x + pw * (0.2 + rand() * 0.6)
      const ky = rand() * size
      const kr = 3 + rand() * 8
      ctx.fillStyle = `hsla(${hue - 5}, ${sat + 5}%, ${light - 6}%, 0.6)`
      ctx.beginPath()
      ctx.ellipse(kx, ky, kr, kr * (0.6 + rand() * 0.8), rand() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }

    // Gap line
    ctx.fillStyle = `hsl(${hue - 3}, ${sat}%, ${light - 10}%)`
    ctx.fillRect(x + pw - gap, 0, gap, size)

    x += pw
  }

  // Bump map
  const bumpCanvas = document.createElement('canvas')
  bumpCanvas.width = size
  bumpCanvas.height = size
  const bCtx = bumpCanvas.getContext('2d')
  bCtx.fillStyle = '#808080'
  bCtx.fillRect(0, 0, size, size)

  // Bump from planks
  x = 0
  const rand2 = seededRand(0x51f00d)
  while (x < size) {
    const pw = plankW + Math.floor((rand2() - 0.5) * plankW * 0.3)
    const bVal = 120 + Math.floor(rand2() * 20)
    bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`
    bCtx.fillRect(x + 1, 0, pw - gap - 2, size)
    bCtx.fillStyle = '#606060'
    bCtx.fillRect(x + pw - gap, 0, gap, size)
    // consume same rands
    for (let g = 0; g < grainLines; g++) { rand2(); rand2(); rand2(); rand2(); rand2(); rand2(); rand2() }
    rand2() // knot check
    if (rand2() < 0.15) { rand2(); rand2(); rand2(); rand2() }
    x += pw
  }

  const mapTex = new THREE.CanvasTexture(canvas)
  mapTex.colorSpace = THREE.SRGBColorSpace
  mapTex.wrapS = THREE.RepeatWrapping
  mapTex.wrapT = THREE.RepeatWrapping

  const bumpTex = new THREE.CanvasTexture(bumpCanvas)
  bumpTex.wrapS = THREE.RepeatWrapping
  bumpTex.wrapT = THREE.RepeatWrapping

  return { mapTex, bumpTex }
}

// --- Floor material: wood planks ---
export function createFloorMaterial(width = 16, length = 16) {
  const { mapTex, bumpTex } = makeWoodFloorTextures()
  const repeatX = Math.max(2, Math.round(width / 2.2))
  const repeatY = Math.max(2, Math.round(length / 2.2))
  mapTex.repeat.set(repeatX, repeatY)
  bumpTex.repeat.set(repeatX, repeatY)

  return new THREE.MeshStandardMaterial({
    map: mapTex,
    bumpMap: bumpTex,
    bumpScale: 0.05,
    color: 0xfff1c8,
    roughness: 0.42,
    metalness: 0.0,
    emissive: 0x1a1008,
    emissiveIntensity: 0.3,
    side: THREE.FrontSide,
  })
}

// --- Step material for stairs ---
export function createStepMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf0ede8,
    roughness: 0.7,
    metalness: 0.0,
    emissive: 0x111111,
    emissiveIntensity: 0.2,
  })
}

// --- Railing material ---
export function createRailMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x2a2a2f,
    roughness: 0.6,
    metalness: 0.4,
    emissive: 0x0a0a0a,
    emissiveIntensity: 0.2,
  })
}

// --- Ceiling ---
export function createCeilingMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf0ede8,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.FrontSide,
  })
}

// --- Frame: thin dark contemporary ---
export function createFrameMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.3,
    metalness: 0.15,
  })
}

// --- Door ---
export function createDoorMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x9b8365,
    roughness: 0.5,
    metalness: 0.0,
    side: THREE.DoubleSide,
  })
}

export function createDoorFrameMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xd4cfc6,
    roughness: 0.7,
    metalness: 0.0,
  })
}

// --- Plaque texture ---
export function makePlaqueTexture(title, medium) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const ctx = canvas.getContext('2d')

  // Dark background to avoid bloom washout
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, 1024, 256)

  // Subtle gold border
  ctx.strokeStyle = '#8a7d6b'
  ctx.lineWidth = 3
  ctx.strokeRect(4, 4, 1016, 248)

  ctx.fillStyle = '#f0ece4'
  ctx.font = 'bold 42px Georgia, serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  let displayTitle = title || ''
  while (ctx.measureText(displayTitle).width > 920 && displayTitle.length > 3) {
    displayTitle = displayTitle.slice(0, -4) + '...'
  }
  ctx.fillText(displayTitle, 512, medium ? 90 : 128)

  if (medium) {
    ctx.fillStyle = '#a09888'
    ctx.font = 'italic 28px Georgia, serif'
    ctx.fillText(medium, 512, 175)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

// --- Profile wall texture ---
export function makeProfileTexture(artistName, handle) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#eae6df'
  ctx.fillRect(0, 0, 1024, 512)

  ctx.fillStyle = '#1a1a1a'
  ctx.font = 'bold 60px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(artistName, 512, 180)

  ctx.fillStyle = '#888888'
  ctx.font = '32px Arial, sans-serif'
  ctx.fillText(handle, 512, 270)

  ctx.fillStyle = '#aaaaaa'
  ctx.font = '22px Arial, sans-serif'
  ctx.fillText('Museo Virtual', 512, 340)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { configureArtworkTexture } from '../misc/helper.js'

/* ============================================================
   Sala premium "Conexiones" — una sola sala de museo:
   luz de skylight central (RectAreaLight), foco por obra,
   piso de nogal pulido con reflejos (environment PMREM),
   zócalos, vinilo de título, statement y placas con precio.
   ============================================================ */

const texLoader = new THREE.TextureLoader()
const gltfLoader = new GLTFLoader()
let rectInit = false

// --- util: aleatorio con semilla (para el piso) ---
function seededRand(seed) {
  let s = (seed >>> 0) || 1
  return function rand() {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0xffffffff
  }
}

// --- piso: nogal oscuro pulido ---
function makeWalnutFloor(size = 1024) {
  const rand = seededRand(0xc0ffee)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#241812'
  ctx.fillRect(0, 0, size, size)

  const plankW = Math.floor(size * 0.11)
  const gap = Math.max(2, Math.floor(size * 0.003))
  let x = 0
  while (x < size) {
    const pw = plankW + Math.floor((rand() - 0.5) * plankW * 0.25)
    const hue = 20 + rand() * 8
    const sat = 26 + rand() * 10
    const light = 11 + rand() * 7
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`
    ctx.fillRect(x, 0, pw - gap, size)

    for (let g = 0; g < 420; g++) {
      const gy = rand() * size
      ctx.strokeStyle = `hsla(${hue}, ${sat * 0.7}%, ${light + (rand() - 0.5) * 7}%, ${0.03 + rand() * 0.05})`
      ctx.lineWidth = 0.5 + rand() * 1.2
      ctx.beginPath()
      ctx.moveTo(x, gy)
      ctx.bezierCurveTo(
        x + pw * 0.3, gy + (rand() - 0.5) * 16,
        x + pw * 0.7, gy + (rand() - 0.5) * 16,
        x + pw - gap, gy + (rand() - 0.5) * 8
      )
      ctx.stroke()
    }
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${Math.max(4, light - 8)}%)`
    ctx.fillRect(x + pw - gap, 0, gap, size)
    x += pw
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

// --- texto envuelto en canvas (statement) ---
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ')
  let line = ''
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y)
      line = word
      y += lineHeight
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, y)
  return y + lineHeight
}

// --- vinilo del título (fondo transparente) ---
function makeTitleVinyl(title, subtitle) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 2048, 640)

  ctx.fillStyle = '#211e1a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 190px Helvetica, Arial, sans-serif'
  // tracking amplio dibujando letra a letra
  const word = title.toUpperCase()
  const spacing = 34
  let total = 0
  for (const ch of word) total += ctx.measureText(ch).width + spacing
  total -= spacing
  let cx = (2048 - total) / 2
  for (const ch of word) {
    const w = ctx.measureText(ch).width
    ctx.fillText(ch, cx + w / 2, 270)
    cx += w + spacing
  }

  ctx.font = '400 54px Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#6d6459'
  ctx.fillText(subtitle, 1024, 480)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- statement en la pared (vinilo, fondo transparente) ---
function makeStatementVinyl(heading, paragraphs, credit) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1280
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 1600, 1280)

  ctx.fillStyle = '#26221d'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = '700 64px Helvetica, Arial, sans-serif'
  ctx.fillText(heading, 90, 140)

  ctx.fillStyle = '#b4452f'
  ctx.fillRect(90, 175, 150, 7)

  ctx.fillStyle = '#3d382f'
  ctx.font = '400 40px Helvetica, Arial, sans-serif'
  let y = 265
  for (const p of paragraphs) {
    y = wrapText(ctx, p, 90, y, 1420, 58) + 26
  }

  ctx.fillStyle = '#6d6459'
  ctx.font = 'italic 400 40px Helvetica, Arial, sans-serif'
  ctx.fillText(credit, 90, Math.min(y + 30, 1220))

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- placa: título / técnica / precio ---
function makePlaque(title, medium, price) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 340
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#171614'
  ctx.fillRect(0, 0, 1024, 340)
  ctx.strokeStyle = '#7c6f5c'
  ctx.lineWidth = 3
  ctx.strokeRect(5, 5, 1014, 330)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f0ece4'
  ctx.font = '700 46px Helvetica, Arial, sans-serif'
  let t = title || ''
  while (ctx.measureText(t).width > 920 && t.length > 3) t = t.slice(0, -4) + '…'
  ctx.fillText(t, 512, medium || price ? 84 : 170)

  if (medium) {
    ctx.fillStyle = '#a29a8a'
    ctx.font = 'italic 400 32px Helvetica, Arial, sans-serif'
    let m = medium
    while (ctx.measureText(m).width > 940 && m.length > 3) m = m.slice(0, -4) + '…'
    ctx.fillText(m, 512, 168)
  }
  if (price) {
    ctx.fillStyle = price === 'No disponible' ? '#8d857a' : '#d98a6a'
    ctx.font = `${price === 'No disponible' ? 'italic 400' : '700'} 34px Helvetica, Arial, sans-serif`
    ctx.fillText(price, 512, 248)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- sombra de contacto (radial, para bancas) ---
function makeContactShadow() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 124)
  g.addColorStop(0, 'rgba(0,0,0,0.42)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(canvas)
  return tex
}

// ============================================================
// Construcción de la sala
// ============================================================
export async function buildSalaConexiones({ artworks, collection, imgBase }, renderer) {
  if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true }

  const W = 15, L = 22, H = 4.3
  const halfW = W / 2, halfL = L / 2

  const group = new THREE.Group()
  const obstacles = []
  const paintingMeshes = []
  const lights = []

  // ---------- materiales base ----------
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xefece5, roughness: 0.94, metalness: 0,
  })
  const floorTex = makeWalnutFloor()
  floorTex.repeat.set(Math.round(W / 2.4), Math.round(L / 2.4))
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: 0xd8c9b4,
    roughness: 0.24,          // pulido → refleja el environment
    metalness: 0.0,
    envMapIntensity: 1.15,
  })
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.96 })
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x211e1b, roughness: 0.5, metalness: 0.1 })

  // ---------- suelo / techo / paredes ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, L + 0.4), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.005
  group.add(floor)
  obstacles.push({ type: 'floor', y: 0, minX: -halfW, maxX: halfW, minZ: -halfL, maxZ: halfL })

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, L + 0.4), ceilMat)
  ceil.rotation.x = Math.PI / 2
  ceil.position.y = H
  group.add(ceil)

  const mkWall = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat)
    m.position.set(x, H / 2, z)
    m.rotation.y = rotY
    group.add(m)
  }
  mkWall(W, 0, -halfL + 0.01, 0)
  mkWall(W, 0, halfL - 0.01, Math.PI)
  mkWall(L, halfW - 0.01, 0, -Math.PI / 2)
  mkWall(L, -halfW + 0.01, 0, Math.PI / 2)

  // zócalos
  const mkBase = (w, x, z, rotY) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.03), baseMat)
    b.position.set(x, 0.07, z)
    b.rotation.y = rotY
    group.add(b)
  }
  mkBase(W, 0, -halfL + 0.03, 0)
  mkBase(W, 0, halfL - 0.03, 0)
  mkBase(L, halfW - 0.03, 0, Math.PI / 2)
  mkBase(L, -halfW + 0.03, 0, Math.PI / 2)

  // ---------- iluminación ----------
  group.add(new THREE.AmbientLight(0xfff8ee, 0.32))
  group.add(new THREE.HemisphereLight(0xfff6e8, 0x59504a, 0.5))

  // "skylight" central: banda emisiva + RectAreaLight hacia abajo
  const skyW = 2.6, skyL = L - 7
  const skyGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(skyW, skyL),
    new THREE.MeshBasicMaterial({ color: 0xfffdf4 })
  )
  skyGlow.rotation.x = Math.PI / 2
  skyGlow.position.y = H - 0.02
  group.add(skyGlow)
  // marco del lucernario
  const skyFrame = new THREE.Mesh(new THREE.BoxGeometry(skyW + 0.24, 0.1, skyL + 0.24), baseMat)
  skyFrame.position.y = H - 0.04
  group.add(skyFrame)

  const rect = new THREE.RectAreaLight(0xfff6e6, 4.2, skyW, skyL)
  rect.position.set(0, H - 0.06, 0)
  rect.rotation.x = -Math.PI / 2
  group.add(rect)

  // ---------- colocación de obras ----------
  // recorrido: oeste (S→N), norte (izq→der), este (N→S)
  const layout = [
    // pared oeste (3)
    ...[5.6, 0, -5.6].map((z, i) => ({
      art: artworks[i], x: -halfW + 0.075, z, rotY: Math.PI / 2,
    })),
    // pared norte (2, flanqueando el vinilo)
    { art: artworks[3], x: -4.4, z: -halfL + 0.075, rotY: 0 },
    { art: artworks[4], x: 4.4, z: -halfL + 0.075, rotY: 0 },
    // pared este (3)
    ...[-5.6, 0, 5.6].map((z, i) => ({
      art: artworks[5 + i], x: halfW - 0.075, z, rotY: -Math.PI / 2,
    })),
  ].filter((p) => p.art)

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x362b21, roughness: 0.34, metalness: 0.12, envMapIntensity: 0.7,
  })
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })

  for (const p of layout) {
    const ratio = p.art.ratio || 0.75 // alto/ancho
    let iw, ih
    if (ratio >= 1) { ih = 1.85; iw = ih / ratio } // vertical
    else { iw = 2.05; ih = iw * ratio }            // horizontal

    const fg = new THREE.Group()
    fg.position.set(p.x, 1.62, p.z)
    fg.rotation.y = p.rotY

    // marco nogal
    const fw = 0.06, fd = 0.05, mw = 0.11 // marco, fondo, passe-partout
    const outW = iw + mw * 2, outH = ih + mw * 2
    const mkBar = (w, h, x, y) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), frameMat)
      bar.position.set(x, y, 0)
      fg.add(bar)
    }
    mkBar(outW + fw * 2, fw, 0, outH / 2 + fw / 2)
    mkBar(outW + fw * 2, fw, 0, -outH / 2 - fw / 2)
    mkBar(fw, outH, -outW / 2 - fw / 2, 0)
    mkBar(fw, outH, outW / 2 + fw / 2, 0)

    // passe-partout blanco
    const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(outW, outH), matWhite)
    matMesh.position.z = fd / 2 - 0.006
    fg.add(matMesh)

    // imagen
    const imgMat = new THREE.MeshBasicMaterial({ color: 0x4a4a4a })
    const imgMesh = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih), imgMat)
    imgMesh.position.z = fd / 2 - 0.002
    imgMesh.userData.artwork = p.art
    fg.add(imgMesh)
    paintingMeshes.push(imgMesh)

    const base = p.art.filename.replace(/\.[^.]+$/, '')
    texLoader.load(`/${imgBase}/full/${encodeURI(base)}.webp`, (tex) => {
      configureArtworkTexture(tex, renderer)
      imgMat.map = tex
      imgMat.color.set(0xffffff)
      imgMat.needsUpdate = true
    })

    // placa
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.3),
      new THREE.MeshBasicMaterial({ map: makePlaque(p.art.title, p.art.medium, p.art.price) })
    )
    plaque.position.set(0, -(outH / 2) - 0.32, 0.012)
    fg.add(plaque)

    group.add(fg)

    // foco de galería por obra
    const dir = new THREE.Vector3(Math.sin(p.rotY), 0, Math.cos(p.rotY)) // normal de la pared
    const spot = new THREE.SpotLight(0xfff2dd, 22, 10, 0.42, 0.55, 1.9)
    spot.position.set(p.x + dir.x * 1.7, H - 0.25, p.z + dir.z * 1.7)
    spot.target.position.set(p.x, 1.62, p.z)
    lights.push(spot)

    // luminaria visible (riel)
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.06, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.4, metalness: 0.5 })
    )
    fixture.position.set(p.x + dir.x * 1.7, H - 0.12, p.z + dir.z * 1.7)
    // inclinar la luminaria hacia la obra
    fixture.lookAt(p.x, 1.62, p.z)
    fixture.rotateX(Math.PI / 2)
    group.add(fixture)
  }

  // ---------- vinilo del título (pared norte) ----------
  const titleTex = makeTitleVinyl(collection.name, `${'Catalina Olivero'} · ${collection.year}`)
  const titleMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 1.75),
    new THREE.MeshBasicMaterial({ map: titleTex, transparent: true })
  )
  titleMesh.position.set(0, 2.75, -halfL + 0.06)
  group.add(titleMesh)

  // foco del título
  const titleSpot = new THREE.SpotLight(0xfff2dd, 14, 11, 0.5, 0.6, 1.9)
  titleSpot.position.set(0, H - 0.25, -halfL + 2.4)
  titleSpot.target.position.set(0, 2.6, -halfL)
  lights.push(titleSpot)

  // ---------- statement (pared sur) ----------
  const stTex = makeStatementVinyl(
    'Declaración de Artista',
    collection.statementFull || [collection.statement],
    '— Catalina Olivero'
  )
  const stMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.0, 3.2),
    new THREE.MeshBasicMaterial({ map: stTex, transparent: true })
  )
  stMesh.position.set(0, 2.15, halfL - 0.06)
  stMesh.rotation.y = Math.PI
  group.add(stMesh)

  const stSpot = new THREE.SpotLight(0xfff2dd, 10, 11, 0.55, 0.65, 1.9)
  stSpot.position.set(0, H - 0.25, halfL - 2.4)
  stSpot.target.position.set(0, 2.1, halfL)
  lights.push(stSpot)

  // ---------- bancas + sombras de contacto ----------
  const shadowTex = makeContactShadow()
  const addShadow = (x, z, sx, sz) => {
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sz),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    )
    sh.rotation.x = -Math.PI / 2
    sh.position.set(x, 0.004, z)
    group.add(sh)
  }

  try {
    const gltf = await new Promise((resolve, reject) =>
      gltfLoader.load('/models/metal_bench.glb', resolve, undefined, reject))
    const benchBase = gltf.scene
    for (const bz of [-4.2, 4.2]) {
      const bench = benchBase.clone()
      bench.scale.set(0.45, 0.5, 0.4)
      bench.position.set(0, 0, bz)
      bench.rotation.y = Math.PI / 2
      bench.traverse((child) => {
        if (child.isMesh) {
          child.position.y = 1.21
          child.material = child.material.clone()
          child.material.side = THREE.DoubleSide
          child.material.envMapIntensity = 1.2
          child.material.needsUpdate = true
        }
      })
      group.add(bench)
      addShadow(0, bz, 2.4, 1.3)
      obstacles.push({ type: 'box', minX: -0.95, maxX: 0.95, minZ: bz - 0.42, maxZ: bz + 0.42 })
    }
  } catch { /* sin banca si falla el modelo */ }

  return {
    group,
    obstacles,
    paintingMeshes,
    doorMeshes: [],
    lights,
    bounds: { halfW, halfL },
    spawnX: 0,
    spawnZ: halfL - 2.2,
    spawnYaw: 0,
  }
}

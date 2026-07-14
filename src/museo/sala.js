import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { configureArtworkTexture } from '../misc/helper.js'

/* ============================================================
   Sala premium genérica (buildSalaPremium):
   skylight central, foco por obra, piso de nogal pulido con
   reflejos, zócalos, vinilos, statement/vitrina/puertas
   opcionales, polvo en la luz y modo "luces apagadas".
   Acepta cualquier nº de obras (el largo de la sala escala).
   ============================================================ */

const texLoader = new THREE.TextureLoader()
const gltfLoader = new GLTFLoader()
let rectInit = false

// Móvil: textura mediana (820px) en las paredes. Cargar 18 obras a 1600px
// satura la memoria gráfica de muchos Android (Chrome mata el WebGL y la
// página queda en blanco). El panel/modal sigue mostrando la grande.
const LOW_TEX = 'ontouchstart' in window || navigator.maxTouchPoints > 0

const DEFAULT_FONT = 'Helvetica, Arial, sans-serif'

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

// --- piso: nogal oscuro pulido (o roble claro si pale=true) ---
function makeWalnutFloor(size = 1024, pale = false) {
  const rand = seededRand(0xc0ffee)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = pale ? '#cfc8bc' : '#241812'
  ctx.fillRect(0, 0, size, size)

  const plankW = Math.floor(size * 0.11)
  const gap = Math.max(2, Math.floor(size * 0.003))
  let x = 0
  while (x < size) {
    const pw = plankW + Math.floor((rand() - 0.5) * plankW * 0.25)
    const hue = pale ? 36 + rand() * 6 : 20 + rand() * 8
    const sat = pale ? 16 + rand() * 8 : 26 + rand() * 10
    const light = pale ? 64 + rand() * 7 : 11 + rand() * 7
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

// --- piso: concreto pulido gris (sala minimal, estilo white cube real) ---
function makeConcreteFloor(size = 1024) {
  const rand = seededRand(0x5eedc0de)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#98989b'
  ctx.fillRect(0, 0, size, size)

  // manchas anchas y suaves (el moteado natural de la losa)
  for (let i = 0; i < 110; i++) {
    const x = rand() * size, y = rand() * size
    const r = size * (0.04 + rand() * 0.18)
    const l = 56 + (rand() - 0.5) * 18
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r)
    g.addColorStop(0, `hsla(228, 3%, ${l}%, ${0.08 + rand() * 0.1})`)
    g.addColorStop(1, 'hsla(228, 3%, 60%, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // poros y granitos
  for (let i = 0; i < 2600; i++) {
    const l = 38 + rand() * 36
    const s = 0.6 + rand() * 1.8
    ctx.fillStyle = `hsla(228, 4%, ${l}%, ${0.06 + rand() * 0.1})`
    ctx.fillRect(rand() * size, rand() * size, s, s)
  }
  // vetas de llana muy tenues
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `hsla(228, 3%, ${52 + rand() * 16}%, ${0.03 + rand() * 0.03})`
    ctx.lineWidth = 6 + rand() * 26
    ctx.beginPath()
    const y0 = rand() * size
    ctx.moveTo(-40, y0)
    ctx.bezierCurveTo(
      size * 0.3, y0 + (rand() - 0.5) * 160,
      size * 0.7, y0 + (rand() - 0.5) * 160,
      size + 40, y0 + (rand() - 0.5) * 120
    )
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

// --- texto envuelto en canvas ---
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
function makeTitleVinyl(title, subtitle, lightText, font = DEFAULT_FONT, spacing = 34) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 2048, 640)

  ctx.fillStyle = lightText ? '#ece7dc' : '#211e1a'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 190px ${font}`
  const word = title.toUpperCase()
  let total = 0
  for (const ch of word) total += ctx.measureText(ch).width + spacing
  total -= spacing
  // si no cabe, reducir tracking proporcionalmente
  const scale = total > 1960 ? 1960 / total : 1
  let cx = (2048 - total * scale) / 2
  ctx.save()
  if (scale < 1) { ctx.translate(1024, 270); ctx.scale(scale, scale); ctx.translate(-1024, -270) }
  cx = (2048 - total) / 2
  for (const ch of word) {
    const w = ctx.measureText(ch).width
    ctx.fillText(ch, cx + w / 2, 270)
    cx += w + spacing
  }
  ctx.restore()

  ctx.font = `400 54px ${font}`
  ctx.fillStyle = lightText ? '#a59d8f' : '#6d6459'
  ctx.fillText(subtitle, 1024, 480)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- statement en la pared (auto-ajusta el tamaño de fuente) ---
function makeStatementVinyl(heading, paragraphs, credit, lightText, font = DEFAULT_FONT) {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1280
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 1600, 1280)

  const maxW = 1420
  const startY = 265
  const bottom = 1150

  const measure = (size) => {
    ctx.font = `400 ${size}px ${font}`
    const lh = Math.round(size * 1.45)
    let y = startY
    for (const p of paragraphs) {
      let line = ''
      for (const word of p.split(' ')) {
        const test = line ? line + ' ' + word : word
        if (ctx.measureText(test).width > maxW && line) { y += lh; line = word }
        else line = test
      }
      y += lh + 24
    }
    return { end: y, lh }
  }

  let fontSize = 40
  let lh = 58
  for (; fontSize >= 26; fontSize -= 2) {
    const m = measure(fontSize)
    lh = m.lh
    if (m.end <= bottom) break
  }

  ctx.fillStyle = lightText ? '#ece7dc' : '#26221d'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 64px ${font}`
  ctx.fillText(heading, 90, 140)

  ctx.fillStyle = '#b4452f'
  ctx.fillRect(90, 175, 150, 7)

  ctx.fillStyle = lightText ? '#c6bfb1' : '#3d382f'
  ctx.font = `400 ${fontSize}px ${font}`
  let y = startY
  for (const p of paragraphs) {
    y = wrapText(ctx, p, 90, y, maxW, lh) + 24
  }

  ctx.fillStyle = lightText ? '#8f8779' : '#6d6459'
  ctx.font = `italic 400 ${fontSize}px ${font}`
  ctx.fillText(credit, 90, Math.min(y + 26, 1235))

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- placa: título / técnica / precio (precio opcional) ---
// light=true → etiqueta clara estilo galería white-cube (sala minimal)
function makePlaque(title, medium, price, font = DEFAULT_FONT, light = false) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 340
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = light ? '#f8f6f1' : '#171614'
  ctx.fillRect(0, 0, 1024, 340)
  ctx.strokeStyle = light ? '#c9c2b3' : '#7c6f5c'
  ctx.lineWidth = 3
  ctx.strokeRect(5, 5, 1014, 330)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = light ? '#26221d' : '#f0ece4'
  ctx.font = `700 46px ${font}`
  let t = title || ''
  while (ctx.measureText(t).width > 920 && t.length > 3) t = t.slice(0, -4) + '…'
  ctx.fillText(t, 512, medium || price ? 84 : 170)

  if (medium) {
    ctx.fillStyle = light ? '#6d6459' : '#a29a8a'
    ctx.font = `italic 400 32px ${font}`
    let m = medium
    while (ctx.measureText(m).width > 940 && m.length > 3) m = m.slice(0, -4) + '…'
    ctx.fillText(m, 512, price ? 168 : 190)
  }
  if (price) {
    ctx.fillStyle = price === 'Vendido' ? '#8d857a' : (light ? '#b4452f' : '#d98a6a')
    ctx.font = `${price === 'Vendido' ? 'italic 400' : '700'} 34px ${font}`
    ctx.fillText(price, 512, 248)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- etiqueta de puerta (estilo placa, legible en ambos modos) ---
function makeDoorLabel(label, font = DEFAULT_FONT) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 140
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#171614'
  ctx.fillRect(0, 0, 768, 140)
  ctx.strokeStyle = '#7c6f5c'
  ctx.lineWidth = 3
  ctx.strokeRect(4, 4, 760, 132)
  ctx.fillStyle = '#f0ece4'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 52px ${font}`
  ctx.fillText(label, 384, 72)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// --- sombra de contacto (radial) ---
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
  return new THREE.CanvasTexture(canvas)
}

// ============================================================
// Sala premium genérica
// ============================================================
export async function buildSalaPremium(config, renderer) {
  const {
    artworks,
    imgBase,
    reflect = false,
    title = '',
    subtitle = '',
    font = DEFAULT_FONT,
    statement = null,        // array de párrafos (o null)
    statementTitle = 'Declaración de Artista',
    statementCredit = '',
    statementX = 0,
    vitrina = null,          // { title, sub } → pedestal clickeable (target 'catalogo')
    doors = [],              // [{ x, target, label }] en la pared sur
    spawnX = 0,
    minimal = false,         // white cube: paredes blancas, marcos finos, sin bancas/polvo
  } = config

  // paleta según estilo (los valores "encendidos"; setDark usa los oscuros)
  // minimal = white cube real: blanco puro, concreto pulido, luz neutra
  const PAL = minimal
    ? { wall: 0xfaf9f6, ceil: 0xffffff, floor: 0xffffff, floorDark: 0x55555a, base: 0x141416, sky: 0xffffff, frame: 0xe9e6df, mat: 0xffffff, spot: 4.2, spotCol: 0xffffff, amb: 0.4, hemi: 0.42, rectI: 1.6, refOp: 0.9 }
    : { wall: 0xefece5, ceil: 0xf4f1ea, floor: 0xd8c9b4, floorDark: 0x8a7a68, base: 0x211e1b, sky: 0xf5efdd, frame: 0x362b21, mat: 0xffffff, spot: 5.5, spotCol: 0xfff2dd, amb: 0.22, hemi: 0.28, rectI: 1.4, refOp: 0.86 }

  if (!rectInit) { RectAreaLightUniformsLib.init(); rectInit = true }

  // ---------- dimensiones según nº de obras ----------
  const n = artworks.length
  const northArts = n >= 5 ? 2 : 0
  const sideTotal = n - northArts
  const westN = Math.ceil(sideTotal / 2)
  const eastN = sideTotal - westN
  const W = 15
  const L = Math.max(16, Math.max(westN, eastN) * 3.35 + 5)
  const H = 4.3
  const halfW = W / 2, halfL = L / 2

  const group = new THREE.Group()
  const obstacles = []
  const paintingMeshes = []
  const doorMeshes = []
  const lights = []

  // ---------- materiales base ----------
  // dithering:true en las superficies grandes: elimina las bandas visibles
  // en los degradados de luz (muy notorias en pantallas de móvil)
  const wallMat = new THREE.MeshStandardMaterial({ color: PAL.wall, roughness: 0.94, metalness: 0, dithering: true })
  const floorTex = minimal ? makeConcreteFloor() : makeWalnutFloor()
  if (minimal) floorTex.repeat.set(Math.max(1, Math.round(W / 8)), Math.max(1, Math.round(L / 8)))
  else floorTex.repeat.set(Math.round(W / 2.4), Math.round(L / 2.4))
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: PAL.floor,
    roughness: minimal ? 0.38 : 0.24, // concreto pulido: satinado, refleja la luz
    metalness: 0.0,
    envMapIntensity: minimal ? 0.85 : 1.15,
    dithering: true,
  })
  if (minimal) {
    // texturas fotográficas reales (las procedurales quedan de respaldo
    // mientras cargan o si fallan). MirroredRepeat oculta las costuras.
    const kind = LOW_TEX ? '1k' : '2k'
    texLoader.load(`/texturas/piso-rumiaciones-${kind}.webp`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping
      t.anisotropy = 8
      t.repeat.set(Math.max(1, Math.round(W / 6)), Math.max(1, Math.round(L / 6)))
      floorMat.map = t
      floorMat.needsUpdate = true
    })
    // estuco con llana en las paredes: un tile cubre toda la altura
    texLoader.load(`/texturas/pared-rumiaciones-${kind}.webp`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping
      t.anisotropy = 8
      t.repeat.set(3, 1)
      wallMat.map = t
      wallMat.needsUpdate = true
    })
    // techo: el mismo estuco de la pared, aún más claro (casi blanco)
    texLoader.load('/texturas/techo-rumiaciones-color.webp', (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping
      t.anisotropy = 8
      t.repeat.set(Math.max(2, Math.round(W / 5)), Math.max(2, Math.round(L / 5)))
      ceilMat.map = t
      ceilMat.needsUpdate = true
    })
  }
  const ceilMat = new THREE.MeshStandardMaterial({ color: PAL.ceil, roughness: 0.96, dithering: true })
  const baseMat = new THREE.MeshStandardMaterial({ color: PAL.base, roughness: 0.5, metalness: 0.1, dithering: true })

  // ---------- suelo / techo / paredes ----------
  if (reflect) {
    const mirror = new Reflector(new THREE.PlaneGeometry(W + 0.4, L + 0.4), {
      textureWidth: 1024, textureHeight: 1024, color: 0x777777,
    })
    mirror.rotation.x = -Math.PI / 2
    mirror.position.y = -0.012
    group.add(mirror)
    floorMat.transparent = true
    floorMat.opacity = PAL.refOp // minimal: reflejo apenas insinuado (satinado)
  }
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

  // minimal: "shadow gap" — línea oscura fina y casi a ras entre pared y
  // piso (como en galerías reales), en vez de zócalo saliente
  const baseH = minimal ? 0.055 : 0.14
  const baseD = minimal ? 0.012 : 0.03
  const mkBase = (w, x, z, rotY) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, baseH, baseD), baseMat)
    b.position.set(x, baseH / 2, z)
    b.rotation.y = rotY
    group.add(b)
  }
  mkBase(W, 0, -halfL + 0.03, 0)
  mkBase(W, 0, halfL - 0.03, 0)
  mkBase(L, halfW - 0.03, 0, Math.PI / 2)
  mkBase(L, -halfW + 0.03, 0, Math.PI / 2)

  // ---------- iluminación ----------
  const ambient = new THREE.AmbientLight(minimal ? 0xffffff : 0xfff8ee, PAL.amb)
  group.add(ambient)
  const hemi = new THREE.HemisphereLight(
    minimal ? 0xffffff : 0xfff6e8,
    minimal ? 0x9a9aa0 : 0x59504a,
    PAL.hemi
  )
  group.add(hemi)

  const skyW = 2.6, skyL = L - 7
  const skyGlowMat = new THREE.MeshBasicMaterial({ color: PAL.sky })
  const skyGlow = new THREE.Mesh(new THREE.PlaneGeometry(skyW, skyL), skyGlowMat)
  skyGlow.rotation.x = Math.PI / 2
  skyGlow.position.y = H - 0.02
  group.add(skyGlow)
  // marco del lucernario: material propio (el zócalo minimal es negro
  // "shadow gap" y aquí teñiría de negro todo el cielo)
  const skyFrameMat = minimal
    ? new THREE.MeshStandardMaterial({ color: 0xe9e8e4, roughness: 0.9, dithering: true })
    : baseMat
  const skyFrame = new THREE.Mesh(new THREE.BoxGeometry(skyW + 0.24, 0.1, skyL + 0.24), skyFrameMat)
  skyFrame.position.y = H - 0.04
  group.add(skyFrame)

  const rect = new THREE.RectAreaLight(minimal ? 0xffffff : 0xfff6e6, PAL.rectI, skyW, skyL)
  rect.position.set(0, H - 0.06, 0)
  rect.rotation.x = -Math.PI / 2
  group.add(rect)

  // ---------- colocación de obras ----------
  // recorrido: oeste (S→N) → norte (izq→der) → este (N→S)
  const layout = []
  const sideZ = (count, fromSouth) => {
    if (count <= 0) return []
    const m = 2.7
    const span = halfL - m
    if (count === 1) return [0]
    // separación máxima ~3.6 m: con pocas obras se agrupan hacia el centro
    // de la pared en vez de quedar regadas de punta a punta
    const step = Math.min((span * 2) / (count - 1), 3.6)
    const half = (step * (count - 1)) / 2
    const zs = []
    for (let i = 0; i < count; i++) {
      const z = -half + i * step
      zs.push(fromSouth ? -z : z)
    }
    return zs
  }
  let ai = 0
  for (const z of sideZ(westN, true)) {
    layout.push({ art: artworks[ai++], x: -halfW + 0.075, z, rotY: Math.PI / 2 })
  }
  if (northArts === 2) {
    layout.push({ art: artworks[ai++], x: -4.4, z: -halfL + 0.075, rotY: 0 })
    layout.push({ art: artworks[ai++], x: 4.4, z: -halfL + 0.075, rotY: 0 })
  }
  for (const z of sideZ(eastN, false)) {
    layout.push({ art: artworks[ai++], x: halfW - 0.075, z, rotY: -Math.PI / 2 })
  }

  const frameMat = new THREE.MeshStandardMaterial({
    color: PAL.frame,
    roughness: minimal ? 0.55 : 0.34,
    metalness: minimal ? 0 : 0.12,
    envMapIntensity: 0.7,
  })
  const matWhite = new THREE.MeshStandardMaterial({ color: PAL.mat, roughness: 0.9 })
  const obraSpots = []

  for (const p of layout) {
    if (!p.art) continue
    const fg = new THREE.Group()
    fg.position.set(p.x, 1.62, p.z)
    fg.rotation.y = p.rotY

    // minimal: marco fino y paspartú estrecho (estilo white cube)
    const fw = minimal ? 0.03 : 0.06, fd = minimal ? 0.04 : 0.05, mw = minimal ? 0.06 : 0.11

    // toneMapped:false → la obra conserva los colores exactos de la foto
    const imgMat = new THREE.MeshBasicMaterial({ color: 0x4a4a4a, toneMapped: false })
    const imgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), imgMat)
    imgMesh.position.z = fd / 2 - 0.002
    imgMesh.userData.artwork = p.art
    fg.add(imgMesh)
    paintingMeshes.push(imgMesh)

    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.3),
      new THREE.MeshBasicMaterial({ map: makePlaque(p.art.title, p.art.medium, p.art.price, font, minimal) })
    )
    fg.add(plaque)

    const sizeFrame = (ratio) => {
      let iw, ih
      if (ratio >= 1) { ih = 1.85; iw = ih / ratio }
      else { iw = 2.05; ih = iw * ratio }
      const outW = iw + mw * 2, outH = ih + mw * 2

      for (const part of [...fg.children]) {
        if (part.userData.framePart) {
          fg.remove(part)
          part.geometry.dispose()
        }
      }
      const mkBar = (w, h, x, y) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), frameMat)
        bar.position.set(x, y, 0)
        bar.userData.framePart = true
        fg.add(bar)
      }
      mkBar(outW + fw * 2, fw, 0, outH / 2 + fw / 2)
      mkBar(outW + fw * 2, fw, 0, -outH / 2 - fw / 2)
      mkBar(fw, outH, -outW / 2 - fw / 2, 0)
      mkBar(fw, outH, outW / 2 + fw / 2, 0)

      const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(outW, outH), matWhite)
      matMesh.position.z = fd / 2 - 0.006
      matMesh.userData.framePart = true
      fg.add(matMesh)

      imgMesh.geometry.dispose()
      imgMesh.geometry = new THREE.PlaneGeometry(iw, ih)
      plaque.position.set(0, -(outH / 2) - 0.32, 0.012)
    }

    let usedRatio = p.art.ratio || 0.75
    sizeFrame(usedRatio)

    const base = p.art.filename.replace(/\.[^.]+$/, '')
    texLoader.load(`/${imgBase}/${LOW_TEX ? 'thumb' : 'full'}/${encodeURI(base)}.webp`, (tex) => {
      configureArtworkTexture(tex, renderer)
      imgMat.map = tex
      imgMat.color.set(0xffffff)
      imgMat.needsUpdate = true
      if (tex.image && tex.image.width) {
        const real = tex.image.height / tex.image.width
        if (Math.abs(real - usedRatio) / usedRatio > 0.02) {
          usedRatio = real
          sizeFrame(real)
        }
      }
    })

    const dir = new THREE.Vector3(Math.sin(p.rotY), 0, Math.cos(p.rotY))
    // distance 4.6: ilumina la obra completa pero se apaga antes de llegar
    // al piso (evita los charcos de luz con bandas)
    const spot = new THREE.SpotLight(PAL.spotCol, PAL.spot, 4.6, 0.4, 0.6, 2)
    spot.position.set(p.x + dir.x * 1.7, H - 0.25, p.z + dir.z * 1.7)
    spot.target.position.set(p.x, 1.62, p.z)
    lights.push(spot)
    obraSpots.push(spot)

    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.06, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.4, metalness: 0.5 })
    )
    fixture.position.set(p.x + dir.x * 1.7, H - 0.12, p.z + dir.z * 1.7)
    fixture.lookAt(p.x, 1.62, p.z)
    fixture.rotateX(Math.PI / 2)
    group.add(fixture)

    group.add(fg)
  }

  // ---------- vinilo del título (pared norte) ----------
  // minimal: tracking normal ("RUMIACIONES", no "R U M I A C I O N E S")
  const titleTracking = minimal ? 4 : 34
  const titleTexLight = makeTitleVinyl(title, subtitle, false, font, titleTracking)
  const titleTexDark = makeTitleVinyl(title, subtitle, true, font, titleTracking)
  const titleMat = new THREE.MeshBasicMaterial({ map: titleTexLight, transparent: true })
  const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.75), titleMat)
  titleMesh.position.set(0, 2.75, -halfL + 0.06)
  group.add(titleMesh)

  const titleSpot = new THREE.SpotLight(PAL.spotCol, 4, 4.2, 0.5, 0.65, 2)
  titleSpot.position.set(0, H - 0.25, -halfL + 2.4)
  titleSpot.target.position.set(0, 2.6, -halfL)
  lights.push(titleSpot)

  // ---------- statement (pared sur, opcional) ----------
  let stMat = null, stTexLight = null, stTexDark = null, stSpot = null
  if (statement && statement.length) {
    stTexLight = makeStatementVinyl(statementTitle, statement, statementCredit, false, font)
    stTexDark = makeStatementVinyl(statementTitle, statement, statementCredit, true, font)
    stMat = new THREE.MeshBasicMaterial({ map: stTexLight, transparent: true })
    const stMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.2), stMat)
    stMesh.position.set(statementX, 2.15, halfL - 0.06)
    stMesh.rotation.y = Math.PI
    group.add(stMesh)

    stSpot = new THREE.SpotLight(0xfff2dd, 3.2, 4.2, 0.55, 0.7, 2)
    stSpot.position.set(statementX, H - 0.25, halfL - 2.4)
    stSpot.target.position.set(statementX, 2.1, halfL)
    lights.push(stSpot)
  }

  // ---------- puertas (pared sur) ----------
  for (const d of doors) {
    const doorW = 1.8, doorH = 3.0
    const dg = new THREE.Group()
    dg.position.set(d.x, 0, halfL - 0.02)
    dg.rotation.y = Math.PI

    const inner = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW, doorH),
      new THREE.MeshStandardMaterial({ color: 0x0d0c0b, roughness: 0.95 })
    )
    inner.position.set(0, doorH / 2, 0)
    dg.add(inner)

    const postGeo = new THREE.BoxGeometry(0.12, doorH, 0.16)
    const lp = new THREE.Mesh(postGeo, frameMat)
    lp.position.set(-doorW / 2 - 0.06, doorH / 2, 0)
    dg.add(lp)
    const rp = new THREE.Mesh(postGeo.clone(), frameMat)
    rp.position.set(doorW / 2 + 0.06, doorH / 2, 0)
    dg.add(rp)
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.36, 0.14, 0.16), frameMat)
    lintel.position.set(0, doorH + 0.07, 0)
    dg.add(lintel)

    const labelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.28),
      new THREE.MeshBasicMaterial({ map: makeDoorLabel(d.label, font) })
    )
    labelMesh.position.set(0, doorH + 0.42, 0.02)
    dg.add(labelMesh)

    const click = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW, doorH),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
    )
    click.position.set(0, doorH / 2, 0.05)
    click.userData.door = { target: d.target }
    dg.add(click)
    doorMeshes.push(click)

    // foco tenue sobre la puerta
    const dSpot = new THREE.SpotLight(0xfff2dd, 2.2, 4.2, 0.5, 0.7, 2)
    dSpot.position.set(d.x, H - 0.25, halfL - 2.2)
    dSpot.target.position.set(d.x, 1.8, halfL)
    lights.push(dSpot)

    group.add(dg)
  }

  // ---------- polvo flotando (no en minimal: aire limpio) ----------
  const DUST_N = minimal ? 0 : 320
  const dustPos = new Float32Array(DUST_N * 3)
  const dustSpeed = new Float32Array(DUST_N)
  const dustPhase = new Float32Array(DUST_N)
  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * (halfW - 0.6)
    dustPos[i * 3 + 1] = Math.random() * (H - 0.4) + 0.2
    dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * (halfL - 0.6)
    dustSpeed[i] = 0.03 + Math.random() * 0.06
    dustPhase[i] = Math.random() * Math.PI * 2
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dustMat = new THREE.PointsMaterial({
    color: 0xfff3dd, size: 0.016, sizeAttenuation: true,
    transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
  if (DUST_N > 0) {
    const dust = new THREE.Points(dustGeo, dustMat)
    dust.frustumCulled = false
    const dustClock = new THREE.Clock()
    dust.onBeforeRender = () => {
      const dt = Math.min(dustClock.getDelta(), 0.1)
      const t = dustClock.elapsedTime
      const arr = dustGeo.attributes.position.array
      for (let i = 0; i < DUST_N; i++) {
        arr[i * 3 + 1] -= dustSpeed[i] * dt
        arr[i * 3] += Math.sin(t * 0.4 + dustPhase[i]) * 0.0006
        if (arr[i * 3 + 1] < 0.15) arr[i * 3 + 1] = H - 0.3
      }
      dustGeo.attributes.position.needsUpdate = true
    }
    group.add(dust)
  }

  // ---------- vitrina central (opcional) ----------
  if (vitrina) {
    const pedMat = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.6 })
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.02, 0.65), pedMat)
    ped.position.set(0, 0.51, 0)
    group.add(ped)

    const coverCanvas = document.createElement('canvas')
    coverCanvas.width = 512
    coverCanvas.height = 360
    const cctx = coverCanvas.getContext('2d')
    cctx.fillStyle = '#f7f3ea'
    cctx.fillRect(0, 0, 512, 360)
    cctx.strokeStyle = '#c9c0ae'
    cctx.lineWidth = 4
    cctx.strokeRect(14, 14, 484, 332)
    cctx.fillStyle = '#211e1a'
    cctx.textAlign = 'center'
    cctx.font = `700 54px ${font}`
    cctx.fillText(vitrina.title, 256, 168)
    cctx.fillStyle = '#8a8072'
    cctx.font = `400 28px ${font}`
    cctx.fillText(vitrina.sub, 256, 226)
    const coverTex = new THREE.CanvasTexture(coverCanvas)
    coverTex.colorSpace = THREE.SRGBColorSpace
    const pageMat = new THREE.MeshStandardMaterial({ color: 0xf1ece1, roughness: 0.8 })
    const coverMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.65 })
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.05, 0.3),
      [pageMat, pageMat, coverMat, pageMat, pageMat, pageMat]
    )
    book.position.set(0, 1.045, 0)
    book.rotation.y = -0.35
    group.add(book)

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.42, 0.52),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, transparent: true, opacity: 0.12,
        roughness: 0.05, metalness: 0, envMapIntensity: 1.4,
      })
    )
    glass.position.set(0, 1.24, 0)
    group.add(glass)

    const vitSpot = new THREE.SpotLight(0xfff2dd, 1.7, 3.6, 0.3, 0.8, 2)
    vitSpot.position.set(0, H - 0.25, 0)
    vitSpot.target.position.set(0, 1.0, 0)
    lights.push(vitSpot)

    const clickMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 1.6, 0.75),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    )
    clickMesh.position.set(0, 0.8, 0)
    clickMesh.userData.door = { target: 'catalogo' }
    group.add(clickMesh)
    doorMeshes.push(clickMesh)

    obstacles.push({ type: 'box', minX: -0.55, maxX: 0.55, minZ: -0.45, maxZ: 0.45 })
  }

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

  // Las bancas se cargan SIN bloquear la sala: si el GLB tarda o se cuelga
  // (webviews de Instagram/Facebook en datos móviles), la sala aparece igual.
  // En minimal: una sola banca al centro (pieza de contraste).
  gltfLoader.load(
    '/models/metal_bench.glb',
    (gltf) => {
      const benchBase = gltf.scene
      const benchZ = minimal ? [0] : [-L * 0.19, L * 0.19]
      for (const bz of benchZ) {
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
        // El pivote del GLB está corrido ~0.9 m: centrar la banca en su
        // posición real (si no, la sombra queda a un lado) y asentar las
        // patas exactamente en el piso con su caja medida.
        bench.updateMatrixWorld(true)
        const bb = new THREE.Box3().setFromObject(bench)
        const c = bb.getCenter(new THREE.Vector3())
        bench.position.x -= c.x
        bench.position.z += bz - c.z
        bench.position.y -= bb.min.y
        group.add(bench)
        // en el piso claro la sombra grande se veía como un charco: más ceñida
        addShadow(0, bz, minimal ? 2.0 : 2.4, minimal ? 0.9 : 1.3)
        obstacles.push({ type: 'box', minX: -0.95, maxX: 0.95, minZ: bz - 0.42, maxZ: bz + 0.42 })
      }
    },
    undefined,
    () => { /* sin bancas si falla el modelo */ }
  )

  // ---------- modo "luces apagadas" ----------
  function setDark(dark) {
    wallMat.color.set(dark ? 0x232126 : PAL.wall)
    ceilMat.color.set(dark ? 0x18171b : PAL.ceil)
    floorMat.color.set(dark ? PAL.floorDark : PAL.floor)
    baseMat.color.set(dark ? 0x0f0e11 : PAL.base)
    if (skyFrameMat !== baseMat) skyFrameMat.color.set(dark ? 0x18171b : 0xe9e8e4)
    skyGlowMat.color.set(dark ? 0x2e2b26 : PAL.sky)
    ambient.intensity = dark ? 0.06 : PAL.amb
    hemi.intensity = dark ? 0.08 : PAL.hemi
    rect.intensity = dark ? 0.3 : PAL.rectI
    for (const s of obraSpots) s.intensity = dark ? 7 : PAL.spot
    titleSpot.intensity = dark ? 5 : 4
    if (stSpot) stSpot.intensity = dark ? 4 : 3.2
    titleMat.map = dark ? titleTexDark : titleTexLight
    titleMat.needsUpdate = true
    if (stMat) {
      stMat.map = dark ? stTexDark : stTexLight
      stMat.needsUpdate = true
    }
    matWhite.color.set(dark ? 0x050505 : PAL.mat)
    frameMat.color.set(dark ? 0x141210 : PAL.frame)
    dustMat.opacity = dark ? 0.4 : 0.22
    if (reflect) floorMat.opacity = dark ? 0.78 : PAL.refOp
  }

  return {
    group,
    obstacles,
    paintingMeshes,
    doorMeshes,
    lights,
    bounds: { halfW, halfL },
    spawnX,
    spawnZ: halfL - 2.2,
    spawnYaw: 0,
    setDark,
  }
}

// ============================================================
// Wrapper: sala de Conexiones (Catalina) — misma API que antes
// ============================================================
export async function buildSalaConexiones({ artworks, collection, imgBase, reflect = false }, renderer) {
  return buildSalaPremium({
    artworks,
    imgBase,
    reflect,
    title: collection.name,
    subtitle: `Catalina Olivero · ${collection.year}`,
    statement: collection.statementFull || [collection.statement],
    statementTitle: 'Declaración de Artista',
    statementCredit: '— Catalina Olivero',
    vitrina: { title: 'CONEXIONES', sub: 'Catálogo · 2022 – Presente' },
  }, renderer)
}

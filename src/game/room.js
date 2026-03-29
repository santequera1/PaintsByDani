import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { configureArtworkTexture } from '../misc/helper.js'
import {
  createWallMaterial, createFloorMaterial, createCeilingMaterial,
  createFrameMaterial, createDoorMaterial, createDoorFrameMaterial,
  createStepMaterial, createRailMaterial,
  makePlaqueTexture, makeProfileTexture,
} from './room/textures.js'
import { ARTIST } from '../data/artworks.js'

const texLoader = new THREE.TextureLoader()
const gltfLoader = new GLTFLoader()

// Cache bench model
let benchScene = null
const benchPromise = new Promise((resolve) => {
  gltfLoader.load('/models/metal_bench.glb', (gltf) => {
    benchScene = gltf.scene
    benchScene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false
        child.receiveShadow = false
      }
    })
    resolve(benchScene)
  }, undefined, () => resolve(null))
})

function addBench(group, position, rotationY = 0) {
  if (!benchScene) return
  const bench = benchScene.clone()
  bench.scale.set(0.45, 0.5, 0.4)
  bench.position.set(position[0], 0, position[2])
  bench.rotation.y = rotationY

  // The React reference positions the mesh child at [0, 1.21, 0] inside the group.
  bench.traverse((child) => {
    if (child.isMesh) {
      child.position.y = 1.21
      if (child.material) {
        child.material = child.material.clone()
        child.material.side = THREE.DoubleSide
        child.material.emissive = new THREE.Color(0x222222)
        child.material.emissiveIntensity = 0.4
        child.material.needsUpdate = true
      }
    }
  })

  group.add(bench)
  return bench
}

// ============================================================
// Build a gallery room
// ============================================================
export async function buildGalleryRoom(config, renderer) {
  const { width, length, artworks, roomId, doors } = config
  const halfW = width / 2
  const halfL = length / 2
  const height = 4.5

  const group = new THREE.Group()
  const obstacles = []
  const paintingMeshes = []
  const doorMeshes = []
  const lights = []

  // --- Materials ---
  const wallMat = createWallMaterial()
  const floorMat = createFloorMaterial(width, length)
  const ceilMat = createCeilingMaterial()

  // --- Floor ---
  const floorGeo = new THREE.PlaneGeometry(width + 0.5, length + 0.5)
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.01
  group.add(floor)
  obstacles.push({ type: 'floor', y: 0, minX: -halfW, maxX: halfW, minZ: -halfL, maxZ: halfL })

  // --- Ceiling ---
  const ceilGeo = new THREE.PlaneGeometry(width + 0.5, length + 0.5)
  const ceil = new THREE.Mesh(ceilGeo, ceilMat)
  ceil.rotation.x = Math.PI / 2
  ceil.position.y = height
  group.add(ceil)

  // --- Walls ---
  addWall(group, width, height, 0, height / 2, -halfL + 0.01, 0, wallMat)
  addWall(group, width, height, 0, height / 2, halfL - 0.01, Math.PI, wallMat)
  addWall(group, length, height, halfW - 0.01, height / 2, 0, -Math.PI / 2, wallMat)
  addWall(group, length, height, -halfW + 0.01, height / 2, 0, Math.PI / 2, wallMat)

  // --- Lighting ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.8)
  group.add(ambient)

  const hemi = new THREE.HemisphereLight(0xfff8f0, 0x444444, 0.6)
  group.add(hemi)

  const dirLight = new THREE.DirectionalLight(0xfff4e6, 0.5)
  dirLight.position.set(0, height - 0.5, 0)
  group.add(dirLight)

  // Ceiling point lights grid
  const gridX = Math.max(2, Math.ceil(width / 5))
  const gridZ = Math.max(2, Math.ceil(length / 5))
  for (let i = 0; i < gridX; i++) {
    for (let j = 0; j < gridZ; j++) {
      const x = -halfW + width * (i + 0.5) / gridX
      const z = -halfL + length * (j + 0.5) / gridZ
      const pl = new THREE.PointLight(0xfff4e6, 0.5, 16, 1.5)
      pl.position.set(x, height - 0.1, z)
      group.add(pl)
    }
  }

  // --- Determine which walls have doors ---
  const doorWalls = new Set()
  if (doors) {
    for (const d of doors) {
      const dz = d.position.z
      const dx = d.position.x
      if (Math.abs(dz - (-halfL)) < 1) doorWalls.add('north')
      if (Math.abs(dz - halfL) < 1) doorWalls.add('south')
      if (Math.abs(dx - halfW) < 1) doorWalls.add('east')
      if (Math.abs(dx - (-halfW)) < 1) doorWalls.add('west')
    }
  }

  // --- Place artworks only on walls without doors ---
  if (artworks && artworks.length > 0) {
    const availableWalls = []
    if (!doorWalls.has('west')) availableWalls.push('west')
    if (!doorWalls.has('north')) availableWalls.push('north')
    if (!doorWalls.has('east')) availableWalls.push('east')

    const walls = distributeToAvailableWalls(artworks, availableWalls)

    if (walls.west) {
      placePaintingsOnWall(walls.west, {
        wallNormal: new THREE.Vector3(1, 0, 0),
        getPosition: (u) => new THREE.Vector3(-halfW + 0.13, 0, u),
        wallLength: length, height, group, paintingMeshes, lights, renderer,
        rotY: Math.PI / 2,
      })
    }
    if (walls.north) {
      placePaintingsOnWall(walls.north, {
        wallNormal: new THREE.Vector3(0, 0, 1),
        getPosition: (u) => new THREE.Vector3(u, 0, -halfL + 0.13),
        wallLength: width, height, group, paintingMeshes, lights, renderer,
      })
    }
    if (walls.east) {
        // Reverse east wall so path continues north->south after west south->north
        placePaintingsOnWall(walls.east.slice().reverse(), {
        wallNormal: new THREE.Vector3(-1, 0, 0),
        getPosition: (u) => new THREE.Vector3(halfW - 0.13, 0, u),
        wallLength: length, height, group, paintingMeshes, lights, renderer,
        rotY: -Math.PI / 2,
      })
    }

    // Ensure paintingMeshes are ordered left-to-right by world X then Z
    if (paintingMeshes && paintingMeshes.length > 1) {
      group.updateMatrixWorld(true)
      paintingMeshes.sort((a, b) => {
        const pa = new THREE.Vector3(); a.getWorldPosition(pa)
        const pb = new THREE.Vector3(); b.getWorldPosition(pb)
        if (Math.abs(pa.x - pb.x) > 0.001) return pa.x - pb.x
        return pa.z - pb.z
      })
    }
  }

  // --- Doors (flush with walls) ---
  if (doors) {
    for (const door of doors) {
      addDoor(group, door, doorMeshes, height)
    }
  }

  // --- Benches ---
  await benchPromise
  if (benchScene) {
    addBench(group, [0, 0, 0], Math.PI / 2)
    if (length > 14) {
      addBench(group, [2.5, 0, -length / 4], 0)
      addBench(group, [-2.5, 0, -length / 4], 0)
      addBench(group, [2.5, 0, length / 4], 0)
      addBench(group, [-2.5, 0, length / 4], 0)
    } else {
      addBench(group, [2.5, 0, 0], 0)
      addBench(group, [-2.5, 0, 0], 0)
    }
    obstacles.push({ type: 'box', minX: -0.8, maxX: 0.8, minZ: -0.4, maxZ: 0.4 })
  }

  return {
    group, obstacles, paintingMeshes, doorMeshes, lights,
    bounds: { halfW, halfL },
    spawnX: config.spawnX || 0,
    spawnZ: config.spawnZ || halfL - 2,
    spawnYaw: config.spawnYaw || 0,
  }
}

// ============================================================
// Build foyer (with artworks, stairs, profile wall)
// ============================================================
export async function buildFoyer(config, renderer) {
  const width = 16, length = 16
  const halfW = width / 2, halfL = length / 2
  const height = 5

  const group = new THREE.Group()
  const obstacles = []
  const paintingMeshes = []
  const doorMeshes = []
  const lights = []

  const wallMat = createWallMaterial()
  const floorMat = createFloorMaterial(width, length)
  const ceilMat = createCeilingMaterial()

  // Floor
  const floorGeo = new THREE.PlaneGeometry(width + 0.5, length + 0.5)
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.01
  group.add(floor)
  obstacles.push({ type: 'floor', y: 0, minX: -halfW, maxX: halfW, minZ: -halfL, maxZ: halfL })

  // Ceiling
  const ceilGeo = new THREE.PlaneGeometry(width + 0.5, length + 0.5)
  const ceil = new THREE.Mesh(ceilGeo, ceilMat)
  ceil.rotation.x = Math.PI / 2
  ceil.position.y = height
  group.add(ceil)

  // Walls
  addWall(group, width, height, 0, height / 2, -halfL + 0.01, 0, wallMat)
  addWall(group, width, height, 0, height / 2, halfL - 0.01, Math.PI, wallMat)
  addWall(group, length, height, halfW - 0.01, height / 2, 0, -Math.PI / 2, wallMat)
  addWall(group, length, height, -halfW + 0.01, height / 2, 0, Math.PI / 2, wallMat)

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.9)
  group.add(ambient)
  const hemi = new THREE.HemisphereLight(0xfff8f0, 0x555555, 0.6)
  group.add(hemi)
  const centerLight = new THREE.PointLight(0xfff4e6, 1.2, 22, 1.5)
  centerLight.position.set(0, height - 0.3, 0)
  group.add(centerLight)

  // Extra ceiling lights
  for (const xOff of [-4, 4]) {
    for (const zOff of [-4, 4]) {
      const pl = new THREE.PointLight(0xfff4e6, 0.4, 14, 1.5)
      pl.position.set(xOff, height - 0.1, zOff)
      group.add(pl)
    }
  }

  // --- Stairs leading to south door ---
  const platformHeight = 0.7
  const stepCount = 4
  const stepH = platformHeight / stepCount
  const stepDepth = 0.4
  const stepWidth = 4
  const platformZ = halfL - 2.5 // near south wall
  const stepMat = createStepMaterial()
  const railMat = createRailMaterial()

  // Platform
  const platGeo = new THREE.BoxGeometry(stepWidth + 1, platformHeight, 3)
  const platMesh = new THREE.Mesh(platGeo, stepMat)
  platMesh.position.set(0, platformHeight / 2, platformZ + 0.5)
  group.add(platMesh)

  // Platform floor obstacle
  obstacles.push({
    type: 'floor', y: platformHeight,
    minX: -(stepWidth + 1) / 2, maxX: (stepWidth + 1) / 2,
    minZ: platformZ - 1, maxZ: halfL,
  })

  // Steps
  for (let i = 0; i < stepCount; i++) {
    const sz = platformZ - 1 - (stepCount - i) * stepDepth
    const sy = (i + 1) * stepH
    const stepGeo = new THREE.BoxGeometry(stepWidth, stepH + 0.02, stepDepth)
    const step = new THREE.Mesh(stepGeo, stepMat)
    step.position.set(0, sy - stepH / 2, sz + stepDepth / 2)
    group.add(step)

    obstacles.push({
      type: 'floor', y: sy,
      minX: -stepWidth / 2, maxX: stepWidth / 2,
      minZ: sz, maxZ: sz + stepDepth,
    })
  }

  // Railings
  const railHeight = 0.9
  const railThick = 0.05
  const stairsStartZ = platformZ - 1 - stepCount * stepDepth
  addRailing(group, {
    x: -stepWidth / 2, z: stairsStartZ,
    endX: -stepWidth / 2, endZ: platformZ - 1,
    startY: 0, endY: platformHeight,
    railHeight, railThick, railMat,
  })
  addRailing(group, {
    x: stepWidth / 2, z: stairsStartZ,
    endX: stepWidth / 2, endZ: platformZ - 1,
    startY: 0, endY: platformHeight,
    railHeight, railThick, railMat,
  })

  // Profile text on north wall
  const profileTex = makeProfileTexture(ARTIST.name, ARTIST.handle)
  const profileGeo = new THREE.PlaneGeometry(4, 2)
  const profileMat = new THREE.MeshStandardMaterial({ map: profileTex, roughness: 0.9 })
  const profileMesh = new THREE.Mesh(profileGeo, profileMat)
  profileMesh.position.set(0, 2.8, -halfL + 0.13)
  group.add(profileMesh)

  // Profile spotlight
  const profileSpot = new THREE.SpotLight(0xfff4e0, 5, 12, Math.PI / 5, 0.6, 1.2)
  profileSpot.position.set(0, height - 0.15, -halfL + 3)
  profileSpot.target.position.set(0, 2.5, -halfL + 0.13)
  lights.push(profileSpot)

  // Profile photo
  const photoGeo = new THREE.PlaneGeometry(1.4, 1.4)
  const photoMat = new THREE.MeshBasicMaterial({ color: 0x888888 })
  const photoMesh = new THREE.Mesh(photoGeo, photoMat)
  photoMesh.position.set(0, 1.3, -halfL + 0.13)
  group.add(photoMesh)

  texLoader.load('/profile.jpg', (tex) => {
    configureArtworkTexture(tex, renderer)
    photoMat.map = tex
    photoMat.color.set(0xffffff)
    photoMat.needsUpdate = true
  })

  // --- Artworks on east and west walls ---
  const artworks = config.artworks || []
  if (artworks.length > 0) {
    const half = Math.ceil(artworks.length / 2)
    const westArt = artworks.slice(0, half)
    const eastArt = artworks.slice(half)

    // Place west first (south→north), then east reversed (north→south)
    // This creates a U-shaped continuous path for zoom navigation
    placePaintingsOnWall(westArt, {
      wallNormal: new THREE.Vector3(1, 0, 0),
      getPosition: (u) => new THREE.Vector3(-halfW + 0.13, 0, u),
      wallLength: length, height, group, paintingMeshes, lights, renderer,
      rotY: Math.PI / 2,
    })
    // Reverse east artworks so last west (north end) connects to first east (north end)
    placePaintingsOnWall(eastArt.slice().reverse(), {
      wallNormal: new THREE.Vector3(-1, 0, 0),
      getPosition: (u) => new THREE.Vector3(halfW - 0.13, 0, u),
      wallLength: length, height, group, paintingMeshes, lights, renderer,
      rotY: -Math.PI / 2,
    })
  }

  // Ensure paintingMeshes are ordered left-to-right by world X then Z for foyer
  if (paintingMeshes && paintingMeshes.length > 1) {
    group.updateMatrixWorld(true)
    paintingMeshes.sort((a, b) => {
      const pa = new THREE.Vector3(); a.getWorldPosition(pa)
      const pb = new THREE.Vector3(); b.getWorldPosition(pb)
      if (Math.abs(pa.x - pb.x) > 0.001) return pa.x - pb.x
      return pa.z - pb.z
    })
  }

  // Doors (on south wall, at platform height)
  const doorConfigs = config.doors || []
  for (const door of doorConfigs) {
    addDoor(group, door, doorMeshes, height)
  }

  // Benches
  await benchPromise
  if (benchScene) {
    addBench(group, [0, 0, -2], Math.PI / 2)
    addBench(group, [0, 0, 2], Math.PI / 2)
  }

  return {
    group, obstacles, paintingMeshes, doorMeshes, lights,
    bounds: { halfW, halfL },
    spawnX: 0, spawnZ: 0, spawnYaw: 0,
  }
}

// ============================================================
// Helpers
// ============================================================

function addWall(group, w, h, x, y, z, rotY, material) {
  const geo = new THREE.PlaneGeometry(w, h)
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.set(x, y, z)
  mesh.rotation.y = rotY
  group.add(mesh)
}

function distributeToAvailableWalls(artworks, availableWalls) {
  const count = artworks.length
  const result = {}

  if (availableWalls.length === 3) {
    // 3 walls: north 40%, east 30%, west 30%
    const northCount = Math.ceil(count * 0.4)
    const sideCount = count - northCount
    const eastCount = Math.ceil(sideCount / 2)
    result.west = artworks.slice(northCount + eastCount)
    result.north = artworks.slice(0, northCount)
    result.east = artworks.slice(northCount, northCount + eastCount)
  } else if (availableWalls.length === 2) {
    // 2 walls: split evenly
    const half = Math.ceil(count / 2)
    const [w1, w2] = availableWalls
    result[w1] = artworks.slice(0, half)
    result[w2] = artworks.slice(half)
  } else if (availableWalls.length === 1) {
    result[availableWalls[0]] = artworks
  }

  return result
}

function placePaintingsOnWall(artworks, opts) {
  if (!artworks || artworks.length === 0) return
  const {
    wallNormal, getPosition, wallLength,
    height, group, paintingMeshes, lights, renderer,
    rotY,
  } = opts

  const margin = 2.0
  const usable = wallLength - margin * 2
  const gap = usable / (artworks.length + 1)
  const paintingCenterY = 1.6

  artworks.forEach((artwork, i) => {
    const u = -usable / 2 + gap * (i + 1)
    const pWidth = 1.3
    const pHeight = 1.5

    const frameGroup = createFrame(pWidth, pHeight)
    const basePos = getPosition(u)
    frameGroup.position.set(basePos.x, paintingCenterY, basePos.z)
    if (rotY) frameGroup.rotation.y = rotY
    group.add(frameGroup)

    // Image plane
    const imgGeo = new THREE.PlaneGeometry(pWidth - 0.08, pHeight - 0.08)
    const imgMat = new THREE.MeshBasicMaterial({ color: 0x555555 })
    const imgMesh = new THREE.Mesh(imgGeo, imgMat)
    imgMesh.position.z = 0.019
    imgMesh.userData.artwork = artwork
    frameGroup.add(imgMesh)
    paintingMeshes.push(imgMesh)

    // Load texture
    const encodedFilename = encodeURIComponent(artwork.filename)
    texLoader.load(`/posts/${encodedFilename}`, (tex) => {
      configureArtworkTexture(tex, renderer)
      imgMat.map = tex
      imgMat.color.set(0xdddddd)
      imgMat.needsUpdate = true

      if (tex.image) {
        const imgAspect = tex.image.width / tex.image.height
        const frameAspect = (pWidth - 0.08) / (pHeight - 0.08)
        if (imgAspect > frameAspect) {
          imgMesh.scale.y = frameAspect / imgAspect
        } else {
          imgMesh.scale.x = imgAspect / frameAspect
        }
      }
    })

    // Plaque
    const plaqueTex = makePlaqueTexture(artwork.title, artwork.medium)
    const plaqueGeo = new THREE.PlaneGeometry(1.0, 0.24)
    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex })
    const plaque = new THREE.Mesh(plaqueGeo, plaqueMat)
    plaque.position.set(0, -(pHeight / 2) - 0.22, 0.01)
    frameGroup.add(plaque)

    // per-painting spotlights removed to keep plaque text readable
  })
}

function createFrame(width, height) {
  const group = new THREE.Group()
  const fw = 0.045
  const fd = 0.035
  const frameMat = createFrameMaterial()

  const topGeo = new THREE.BoxGeometry(width + fw * 2, fw, fd)
  const top = new THREE.Mesh(topGeo, frameMat)
  top.position.y = height / 2 + fw / 2
  group.add(top)

  const bot = new THREE.Mesh(topGeo.clone(), frameMat)
  bot.position.y = -height / 2 - fw / 2
  group.add(bot)

  const sideGeo = new THREE.BoxGeometry(fw, height + fw * 2, fd)
  const left = new THREE.Mesh(sideGeo, frameMat)
  left.position.x = -width / 2 - fw / 2
  group.add(left)

  const right = new THREE.Mesh(sideGeo.clone(), frameMat)
  right.position.x = width / 2 + fw / 2
  group.add(right)

  // White mat
  const matGeo = new THREE.PlaneGeometry(width, height)
  const matMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const matMesh = new THREE.Mesh(matGeo, matMat)
  matMesh.position.z = fd / 2 - 0.003
  group.add(matMesh)

  // Back
  const backGeo = new THREE.PlaneGeometry(width + fw * 2, height + fw * 2)
  const backMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.BackSide })
  const backMesh = new THREE.Mesh(backGeo, backMat)
  backMesh.position.z = -fd / 2
  group.add(backMesh)

  return group
}

function addDoor(group, doorConfig, doorMeshes, roomHeight) {
  const { position, rotation, target, label } = doorConfig
  const doorW = 1.8, doorH = 3.0
  const wallDepth = 0.3 // doorway depth through the wall

  const doorGroup = new THREE.Group()
  doorGroup.position.set(position.x, position.y || 0, position.z)
  if (rotation) doorGroup.rotation.y = rotation

  // Frame material
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c8,
    roughness: 0.6,
    metalness: 0.0,
  })

  // Doorway interior (dark walls inside the opening to give depth)
  const interiorMat = new THREE.MeshStandardMaterial({
    color: 0x888880,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
  })

  // Frame posts (3D boxes with depth)
  const frameThick = 0.12
  const postGeo = new THREE.BoxGeometry(frameThick, doorH, wallDepth)

  const leftPost = new THREE.Mesh(postGeo, frameMat)
  leftPost.position.set(-doorW / 2 - frameThick / 2, doorH / 2, 0)
  doorGroup.add(leftPost)

  const rightPost = new THREE.Mesh(postGeo.clone(), frameMat)
  rightPost.position.set(doorW / 2 + frameThick / 2, doorH / 2, 0)
  doorGroup.add(rightPost)

  // Header (lintel)
  const headerGeo = new THREE.BoxGeometry(doorW + frameThick * 2, frameThick * 1.5, wallDepth)
  const header = new THREE.Mesh(headerGeo, frameMat)
  header.position.set(0, doorH + frameThick * 0.75, 0)
  doorGroup.add(header)

  // Interior side walls (give the doorway depth)
  const sideGeo = new THREE.PlaneGeometry(wallDepth, doorH)
  const leftInner = new THREE.Mesh(sideGeo, interiorMat)
  leftInner.position.set(-doorW / 2, doorH / 2, 0)
  leftInner.rotation.y = Math.PI / 2
  doorGroup.add(leftInner)

  const rightInner = new THREE.Mesh(sideGeo.clone(), interiorMat)
  rightInner.position.set(doorW / 2, doorH / 2, 0)
  rightInner.rotation.y = -Math.PI / 2
  doorGroup.add(rightInner)

  // Ceiling of doorway
  const ceilGeo = new THREE.PlaneGeometry(doorW, wallDepth)
  const ceilInner = new THREE.Mesh(ceilGeo, interiorMat)
  ceilInner.position.set(0, doorH, 0)
  ceilInner.rotation.x = Math.PI / 2
  doorGroup.add(ceilInner)

  // Clickable area (transparent plane inside doorway, offset forward to avoid z-fight)
  const clickGeo = new THREE.PlaneGeometry(doorW, doorH)
  const clickMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    opacity: 0.12,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const clickMesh = new THREE.Mesh(clickGeo, clickMat)
  clickMesh.position.set(0, doorH / 2, 0.05)
  clickMesh.userData.door = { target }
  doorGroup.add(clickMesh)
  doorMeshes.push(clickMesh)

  // Label above door
  if (label) {
    const labelCanvas = document.createElement('canvas')
    labelCanvas.width = 512
    labelCanvas.height = 80
    const ctx = labelCanvas.getContext('2d')
    ctx.fillStyle = '#eae6df'
    ctx.fillRect(0, 0, 512, 80)
    ctx.fillStyle = '#333333'
    ctx.font = 'bold 30px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 256, 40)
    const labelTex = new THREE.CanvasTexture(labelCanvas)
    labelTex.colorSpace = THREE.SRGBColorSpace
    labelTex.needsUpdate = true
    const labelGeo = new THREE.PlaneGeometry(1.6, 0.28)
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex })
    const labelMesh = new THREE.Mesh(labelGeo, labelMat)
    labelMesh.position.set(0, doorH + frameThick * 1.5 + 0.25, wallDepth / 2 + 0.01)
    doorGroup.add(labelMesh)
  }

  group.add(doorGroup)
}

function addRailing(group, opts) {
  const { x, z, endX, endZ, startY, endY, railHeight, railThick, railMat } = opts
  const dx = endX - x, dz = endZ - z
  const length = Math.sqrt(dx * dx + dz * dz)
  const angle = Math.atan2(dx, dz)

  // Top rail
  const railGeo = new THREE.CylinderGeometry(railThick, railThick, length, 6)
  railGeo.rotateX(Math.PI / 2)
  const rail = new THREE.Mesh(railGeo, railMat)
  rail.position.set(
    (x + endX) / 2,
    (startY + endY) / 2 + railHeight,
    (z + endZ) / 2
  )
  rail.rotation.y = angle
  // Tilt rail to follow stairs
  const slopeAngle = Math.atan2(endY - startY, length)
  rail.rotation.x = -slopeAngle
  group.add(rail)

  // Posts
  const postCount = Math.max(2, Math.ceil(length / 1.2))
  for (let i = 0; i <= postCount; i++) {
    const t = i / postCount
    const px = x + dx * t
    const pz = z + dz * t
    const py = startY + (endY - startY) * t
    const postGeo = new THREE.CylinderGeometry(railThick * 0.7, railThick * 0.7, railHeight, 6)
    const post = new THREE.Mesh(postGeo, railMat)
    post.position.set(px, py + railHeight / 2, pz)
    group.add(post)
  }
}

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { clamp, smoothDamp } from '../misc/helper.js'

export function createEngine(canvas) {
  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  renderer.shadowMap.enabled = false // skip for perf

  // --- Scene ---
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111114)

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100)
  const eyeHeight = 1.7
  camera.position.set(0, eyeHeight, 0)
  camera.rotation.order = 'YXZ'
  scene.add(camera)

  // --- Post-processing ---
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.1, 0.4, 0.92
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // --- Raycaster ---
  const raycaster = new THREE.Raycaster()
  raycaster.far = 15

  // --- State ---
  let currentRoom = null
  let locked = false
  let yaw = 0, pitch = 0
  let targetYaw = 0, targetPitch = 0
  const keysDown = new Set()

  // Movement smoothing
  let smoothVelX = 0, smoothVelZ = 0
  let velY = 0
  let grounded = true
  let bobPhase = 0

  const moveSpeed = 5.0
  const sprintMultiplier = 1.5
  const gravity = -16
  const jumpVel = 5.5
  const mouseSens = 0.002

  // Collision
  let obstacles = []
  let roomBounds = { halfW: 5, halfL: 5 }

  // Clickable meshes
  let paintingMeshes = []
  let doorMeshes = []

  // Callbacks
  let onPaintingClicked = null
  let onDoorClicked = null
  let onCrosshairChange = null
  let onMovementChange = null
  let _wasMoving = false

  // --- Zoom / Tour mode ---
  let zoomMode = false
  let zoomAnimating = false
  let savedCamPos = new THREE.Vector3()
  let savedYaw = 0, savedPitch = 0

  // Mobile virtual joystick input
  let virtualJoyX = 0, virtualJoyZ = 0
  let mobileMode = false

  function enableMobile() {
    mobileMode = true
    locked = true // Treat as always locked on mobile
  }

  // --- Pointer lock ---
  function requestLock() {
    if (zoomMode) return
    if (mobileMode) { locked = true; return }
    try {
      canvas.requestPointerLock()
    } catch (e) { /* ignore SecurityError */ }
  }

  function exitLock() {
    if (mobileMode) return
    try {
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock()
      }
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('pointerlockchange', () => {
    if (mobileMode) return
    locked = document.pointerLockElement === canvas
  })

  // --- Mouse / Touch look ---
  document.addEventListener('mousemove', (e) => {
    if ((!locked && !mobileMode) || zoomMode) return
    targetYaw -= e.movementX * mouseSens
    targetPitch -= e.movementY * mouseSens
    targetPitch = clamp(targetPitch, -Math.PI / 2.2, Math.PI / 2.2)
  })

  // --- Keyboard ---
  document.addEventListener('keydown', (e) => {
    keysDown.add(e.code)
  })
  document.addEventListener('keyup', (e) => {
    keysDown.delete(e.code)
  })

  // --- Click (raycast) ---
  canvas.addEventListener('click', () => {
    if (zoomAnimating) return
    if (!locked && !mobileMode) return
    if (zoomMode) return

    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)

    // Check paintings
    if (paintingMeshes.length > 0) {
      const hits = raycaster.intersectObjects(paintingMeshes, false)
      if (hits.length > 0) {
        const artwork = hits[0].object.userData.artwork
        if (artwork && onPaintingClicked) {
          onPaintingClicked(artwork, hits[0].object)
          return
        }
      }
    }

    // Check doors
    if (doorMeshes.length > 0) {
      const hits = raycaster.intersectObjects(doorMeshes, false)
      if (hits.length > 0) {
        const doorData = hits[0].object.userData.door
        if (doorData && onDoorClicked) {
          onDoorClicked(doorData)
          return
        }
      }
    }
  })

  // --- Crosshair hover ---
  function updateCrosshair() {
    if ((!locked && !mobileMode) || zoomMode) return 'default'
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
    const allClickable = [...paintingMeshes, ...doorMeshes]
    if (allClickable.length === 0) return 'default'
    const hits = raycaster.intersectObjects(allClickable, false)
    if (hits.length === 0) return 'default'
    const obj = hits[0].object
    if (obj.userData && obj.userData.door) return 'pointer-door'
    if (obj.userData && obj.userData.artwork) return 'pointer-artwork'
    return 'pointer'
  }

  // --- Zoom to painting ---
  function zoomToPainting(mesh) {
    if (zoomAnimating) return
    zoomAnimating = true

    // Save current position
    savedCamPos.copy(camera.position)
    savedYaw = yaw
    savedPitch = pitch

    // Get frame world position
    const worldPos = new THREE.Vector3()
    mesh.getWorldPosition(worldPos)

    // Get the frame's forward direction (normal)
    const normal = new THREE.Vector3(0, 0, 1)
    mesh.getWorldQuaternion(_quat)
    normal.applyQuaternion(_quat)

    // Target: 1.8 units in front of painting
    const targetPos = worldPos.clone().add(normal.multiplyScalar(1.8))
    targetPos.y = worldPos.y

    // Calculate target yaw/pitch to look at painting
    const dir = worldPos.clone().sub(targetPos).normalize()
    const targetYawVal = Math.atan2(-dir.x, -dir.z)
    const targetPitchVal = Math.asin(dir.y)

    // Animate
    const startPos = camera.position.clone()
    const startYaw = yaw
    const startPitch = pitch
    const duration = 800
    const startTime = performance.now()

    function animateZoom() {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      // Ease in-out cubic
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

      camera.position.lerpVectors(startPos, targetPos, e)
      yaw = startYaw + (targetYawVal - startYaw) * e
      pitch = startPitch + (targetPitchVal - startPitch) * e
      targetYaw = yaw
      targetPitch = pitch
      camera.rotation.y = yaw
      camera.rotation.x = pitch

      if (t < 1) {
        requestAnimationFrame(animateZoom)
      } else {
        zoomAnimating = false
        zoomMode = true
        exitLock()
      }
    }
    animateZoom()
  }

  function zoomOut() {
    if (zoomAnimating || !zoomMode) return
    zoomAnimating = true
    zoomMode = false

    const startPos = camera.position.clone()
    const startYaw = yaw
    const startPitch = pitch
    const duration = 600
    const startTime = performance.now()

    function animateOut() {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

      camera.position.lerpVectors(startPos, savedCamPos, e)
      yaw = startYaw + (savedYaw - startYaw) * e
      pitch = startPitch + (savedPitch - startPitch) * e
      targetYaw = yaw
      targetPitch = pitch
      camera.rotation.y = yaw
      camera.rotation.x = pitch

      if (t < 1) {
        requestAnimationFrame(animateOut)
      } else {
        zoomAnimating = false
      }
    }
    animateOut()
  }

  // Navigate to specific painting mesh (for slider)
  function zoomToMesh(mesh) {
    if (zoomAnimating) return
    zoomAnimating = true

    const worldPos = new THREE.Vector3()
    mesh.getWorldPosition(worldPos)

    const normal = new THREE.Vector3(0, 0, 1)
    mesh.getWorldQuaternion(_quat)
    normal.applyQuaternion(_quat)

    const targetPos = worldPos.clone().add(normal.multiplyScalar(1.8))
    targetPos.y = worldPos.y

    const dir = worldPos.clone().sub(targetPos).normalize()
    const targetYawVal = Math.atan2(-dir.x, -dir.z)
    const targetPitchVal = Math.asin(dir.y)

    const startPos = camera.position.clone()
    const startYaw = yaw
    const startPitch = pitch
    const duration = 500
    const startTime = performance.now()

    function animateSlide() {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

      camera.position.lerpVectors(startPos, targetPos, e)
      yaw = startYaw + (targetYawVal - startYaw) * e
      pitch = startPitch + (targetPitchVal - startPitch) * e
      targetYaw = yaw
      targetPitch = pitch
      camera.rotation.y = yaw
      camera.rotation.x = pitch

      if (t < 1) {
        requestAnimationFrame(animateSlide)
      } else {
        zoomAnimating = false
      }
    }
    animateSlide()
  }

  const _quat = new THREE.Quaternion()

  // --- Player update ---
  function updatePlayer(dt) {
    if ((!locked && !mobileMode) || zoomMode || zoomAnimating) return

    // Smooth camera rotation
    const rotSmooth = 1 - Math.exp(-25 * dt)
    yaw += (targetYaw - yaw) * rotSmooth
    pitch += (targetPitch - pitch) * rotSmooth
    camera.rotation.y = yaw
    camera.rotation.x = pitch

    // Movement input (keyboard + virtual joystick)
    let inputX = (keysDown.has('KeyD') || keysDown.has('ArrowRight') ? 1 : 0) -
                 (keysDown.has('KeyA') || keysDown.has('ArrowLeft') ? 1 : 0)
    let inputZ = (keysDown.has('KeyS') || keysDown.has('ArrowDown') ? 1 : 0) -
                 (keysDown.has('KeyW') || keysDown.has('ArrowUp') ? 1 : 0)

    // Add virtual joystick
    inputX += virtualJoyX
    inputZ += virtualJoyZ
    inputX = clamp(inputX, -1, 1)
    inputZ = clamp(inputZ, -1, 1)

    const hasInput = Math.abs(inputX) > 0.05 || Math.abs(inputZ) > 0.05
    const sprint = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight')
    const speed = moveSpeed * (sprint ? sprintMultiplier : 1)

    const sinY = Math.sin(yaw)
    const cosY = Math.cos(yaw)
    let targetVX = 0, targetVZ = 0
    if (hasInput) {
      const len = Math.sqrt(inputX * inputX + inputZ * inputZ) || 1
      const nx = inputX / len, nz = inputZ / len
      targetVX = (cosY * nx + sinY * nz) * speed
      targetVZ = (-sinY * nx + cosY * nz) * speed
    }

    const accelTime = hasInput ? 0.08 : 0.12
    smoothVelX = smoothDamp(smoothVelX, targetVX, dt, accelTime)
    smoothVelZ = smoothDamp(smoothVelZ, targetVZ, dt, accelTime)

    camera.position.x += smoothVelX * dt
    camera.position.z += smoothVelZ * dt

    // Gravity & jump
    if (keysDown.has('Space') && grounded) {
      velY = jumpVel
      grounded = false
    }
    velY += gravity * dt
    camera.position.y += velY * dt

    // Floor collision
    let floorY = 0
    for (const obs of obstacles) {
      if (obs.type === 'floor') {
        const px = camera.position.x, pz = camera.position.z
        if (px >= obs.minX && px <= obs.maxX && pz >= obs.minZ && pz <= obs.maxZ) {
          floorY = Math.max(floorY, obs.y)
        }
      }
    }
    if (camera.position.y <= floorY + eyeHeight) {
      camera.position.y = floorY + eyeHeight
      velY = 0
      grounded = true
    }

    // Head bob
    const isMoving = Math.abs(smoothVelX) > 0.15 || Math.abs(smoothVelZ) > 0.15
    if (isMoving && grounded) {
      bobPhase += dt * (sprint ? 10 : 7.5)
      camera.position.y += Math.sin(bobPhase) * 0.01
    } else {
      bobPhase = 0
    }

    // Movement state change callback
    const movingNow = isMoving && grounded
    if (movingNow !== _wasMoving) {
      _wasMoving = movingNow
      if (onMovementChange) onMovementChange(movingNow, sprint)
    }

    // Room bounds
    const margin = 0.35
    camera.position.x = clamp(camera.position.x, -roomBounds.halfW + margin, roomBounds.halfW - margin)
    camera.position.z = clamp(camera.position.z, -roomBounds.halfL + margin, roomBounds.halfL - margin)

    // Box obstacle collision
    for (const obs of obstacles) {
      if (obs.type !== 'box') continue
      const px = camera.position.x, pz = camera.position.z
      const r = 0.3
      if (px + r > obs.minX && px - r < obs.maxX && pz + r > obs.minZ && pz - r < obs.maxZ) {
        const overlapX1 = (px + r) - obs.minX
        const overlapX2 = obs.maxX - (px - r)
        const overlapZ1 = (pz + r) - obs.minZ
        const overlapZ2 = obs.maxZ - (pz - r)
        const minOverlap = Math.min(overlapX1, overlapX2, overlapZ1, overlapZ2)
        if (minOverlap === overlapX1) camera.position.x = obs.minX - r
        else if (minOverlap === overlapX2) camera.position.x = obs.maxX + r
        else if (minOverlap === overlapZ1) camera.position.z = obs.minZ - r
        else camera.position.z = obs.maxZ + r
      }
    }
  }

  // --- Resize ---
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
  }

  // --- Animation loop ---
  let prevTime = performance.now()
  let crosshairState = 'default'

  function animate() {
    requestAnimationFrame(animate)
    const now = performance.now()
    const dt = Math.min((now - prevTime) / 1000, 0.1)
    prevTime = now

    resize()
    updatePlayer(dt)

    const newState = updateCrosshair()
    if (newState !== crosshairState) {
      crosshairState = newState
      if (onCrosshairChange) onCrosshairChange(newState)
    }

    composer.render()
  }

  // --- Room management ---
  function setRoom(room) {
    if (currentRoom && currentRoom.group) {
      scene.remove(currentRoom.group)
      currentRoom.group.traverse(child => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach(m => {
            if (m.map) m.map.dispose()
            m.dispose()
          })
        }
      })
    }
    if (currentRoom && currentRoom.lights) {
      currentRoom.lights.forEach(l => {
        scene.remove(l)
        if (l.target) scene.remove(l.target)
      })
    }

    currentRoom = room
    if (room.group) scene.add(room.group)
    if (room.lights) room.lights.forEach(l => {
      scene.add(l)
      if (l.target) scene.add(l.target)
    })

    obstacles = room.obstacles || []
    roomBounds = room.bounds || { halfW: 5, halfL: 5 }
    paintingMeshes = room.paintingMeshes || []
    doorMeshes = room.doorMeshes || []

    // Reset player
    camera.position.set(room.spawnX || 0, eyeHeight, room.spawnZ || 0)
    yaw = room.spawnYaw || 0
    targetYaw = yaw
    pitch = 0
    targetPitch = 0
    smoothVelX = 0
    smoothVelZ = 0
    velY = 0
    grounded = true
    zoomMode = false
    zoomAnimating = false
  }

  // Start
  animate()

  return {
    renderer,
    scene,
    camera,
    requestLock,
    exitLock,
    enableMobile,
    setRoom,
    zoomToPainting,
    zoomToMesh,
    zoomOut,
    get locked() { return locked },
    get zoomMode() { return zoomMode },
    get zoomAnimating() { return zoomAnimating },
    get paintingMeshes() { return paintingMeshes },
    set onPaintingClicked(fn) { onPaintingClicked = fn },
    set onDoorClicked(fn) { onDoorClicked = fn },
    set onCrosshairChange(fn) { onCrosshairChange = fn },
    set onMovementChange(fn) { onMovementChange = fn },
    setVirtualJoystick(x, z) { virtualJoyX = x; virtualJoyZ = z },
  }
}

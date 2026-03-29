import * as THREE from 'three'

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function smoothDamp(current, target, dt, smoothTime) {
  const factor = 1 - Math.exp(-dt / Math.max(smoothTime, 0.001))
  return current + (target - current) * factor
}

export function configureArtworkTexture(tex, renderer) {
  if (!tex) return tex
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  if (renderer) {
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  }
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export function disposeObject(obj) {
  if (!obj) return
  if (obj.geometry) obj.geometry.dispose()
  if (obj.material) {
    if (Array.isArray(obj.material)) {
      obj.material.forEach(m => disposeMaterial(m))
    } else {
      disposeMaterial(obj.material)
    }
  }
  if (obj.children) {
    for (let i = obj.children.length - 1; i >= 0; i--) {
      disposeObject(obj.children[i])
    }
  }
}

function disposeMaterial(mat) {
  if (!mat) return
  if (mat.map) mat.map.dispose()
  if (mat.normalMap) mat.normalMap.dispose()
  if (mat.roughnessMap) mat.roughnessMap.dispose()
  if (mat.emissiveMap) mat.emissiveMap.dispose()
  mat.dispose()
}

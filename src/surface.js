// "Surface" materials: many plain-coloured materials folded into one draw call.
//
// Meshes are merged by material to save draw calls, but a merged mesh still costs one draw
// per material, and the car models and roadside props use dozens of materials that differ
// only in colour, roughness, metalness and glow. foldKey() says which materials can be
// folded together; their values are written into each vertex (colour, aSurf = roughness,
// metalness, aEmis = emissive colour × intensity, and for MeshPhysicalMaterial aCoat =
// clearcoat, clearcoat roughness) and surfaceMaterial() returns one shared material that
// reads them, with the same lighting as the materials it replaces.
import * as THREE from 'three';

/**
 * The fold group a material belongs to, or null when it has to stay a material of its own:
 * textures, transparency, a per-car role (paint, lamps that switch), its own shader, ...
 */
export function foldKey(m) {
  if (!m || m.userData.role || m.userData.noFold || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null;
  if (!(m.type === 'MeshStandardMaterial' || m.type === 'MeshPhysicalMaterial')) return null;
  if (m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.vertexColors || m.wireframe) return null;
  for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) return null;   // map, emissiveMap, ...
  if (m.type === 'MeshPhysicalMaterial' && (m.transmission > 0 || m.sheen > 0 || m.iridescence > 0 || m.anisotropy > 0 || m.dispersion > 0)) return null;
  // (envMapIntensity is left out: with scene.environment three.js uses the scene's intensity instead)
  return [m.type, m.side, m.flatShading, m.fog, m.toneMapped, m.type === 'MeshPhysicalMaterial' ? m.ior : ''].join('|');
}

const MATS = new Map();
/** The shared material for a fold key (built from the first material seen with it). */
export function surfaceMaterial(key, like) {
  if (MATS.has(key)) return MATS.get(key);
  const physical = like.type === 'MeshPhysicalMaterial';
  const opts = { vertexColors: true, roughness: 1, metalness: 1, emissive: 0xffffff, side: like.side, flatShading: like.flatShading, fog: like.fog, toneMapped: like.toneMapped };
  const m = physical ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 1, ior: like.ior }) : new THREE.MeshStandardMaterial(opts);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 aSurf;\nattribute vec3 aEmis;\nvarying vec2 vSurf;\nvarying vec3 vEmis;\n'
      + (physical ? 'attribute vec2 aCoat;\nvarying vec2 vCoat;\n' : '')
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf; vEmis = aEmis;' + (physical ? ' vCoat = aCoat;' : ''));
    sh.fragmentShader = 'varying vec2 vSurf;\nvarying vec3 vEmis;\n' + (physical ? 'varying vec2 vCoat;\n' : '')
      + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vEmis;')
        .replace('material.clearcoat = clearcoat;', 'material.clearcoat = vCoat.x;')
        .replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = vCoat.y;');
  };
  m.customProgramCacheKey = () => 'surface:' + (physical ? 'physical' : 'standard');
  m.userData.shared = true;     // one per fold key for the whole game: never freed with a chunk
  m.userData.surface = true;
  MATS.set(key, m);
  return m;
}

/**
 * Per-vertex surface attributes for `count` vertices of material `m`, written at vertex
 * offset `o` into arrays { col, surf, emis, coat } (coat only for physical materials).
 */
export function writeSurface(arrays, o, count, m) {
  const c = m.color, e = m.emissive, ei = m.emissiveIntensity ?? 1;
  const { col, surf, emis, coat } = arrays;
  for (let i = o; i < o + count; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    surf[i * 2] = m.roughness; surf[i * 2 + 1] = m.metalness;
    emis[i * 3] = e.r * ei; emis[i * 3 + 1] = e.g * ei; emis[i * 3 + 2] = e.b * ei;
    if (coat) { coat[i * 2] = m.clearcoat ?? 0; coat[i * 2 + 1] = m.clearcoatRoughness ?? 0; }
  }
}

/** Arrays for writeSurface, sized for `n` vertices. */
export function surfaceArrays(n, physical) {
  return { col: new Float32Array(n * 3), surf: new Float32Array(n * 2), emis: new Float32Array(n * 3), coat: physical ? new Float32Array(n * 2) : null };
}

/** Attach the arrays from surfaceArrays to a geometry. */
export function setSurfaceAttributes(geo, a) {
  geo.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(a.surf, 2));
  geo.setAttribute('aEmis', new THREE.BufferAttribute(a.emis, 3));
  if (a.coat) geo.setAttribute('aCoat', new THREE.BufferAttribute(a.coat, 2));
}

// "Surface" materials: many plain-coloured materials folded into one draw call.
//
// Meshes are merged by material to save draw calls, but a merged mesh still costs one draw
// per material, and the car models and roadside props use dozens of materials that differ
// only in colour, roughness, metalness and glow. foldKey() says which materials can be
// folded together; their values are written into each vertex and surfaceMaterial() returns
// one shared material that reads them, with the same lighting as the materials it replaces.
//
// The per-vertex values are packed into bytes (12 per vertex instead of 32-40 as floats):
//   color  4 × u8  the colour in sRGB, as the 8-bit hex it was written in (exact), decoded to
//                  linear in the vertex shader; the 4th byte is 255 (opaque)
//   aSurf  4 × u8  roughness, metalness, clearcoat, clearcoat roughness
//   aEmis  4 × u8  emissive colour in sRGB, and its intensity / EMIS_MAX
// Four components, not three, keep every attribute 4-byte aligned (3-byte formats are
// converted on the CPU by some GPU drivers).
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

/** Largest emissive intensity a folded material can carry (car daytime lights use 3.2). */
const EMIS_MAX = 4;

/** GLSL: sRGB (0-1) to linear, for colours stored as sRGB bytes. */
export const SRGB_TO_LINEAR_GLSL = 'vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }\n';

/** A linear colour channel (0-1) as an sRGB byte. */
export function srgbByte(x) {
  x = Math.min(1, Math.max(0, x));
  return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
}

const MATS = new Map();
/** The shared material for a fold key (built from the first material seen with it). */
export function surfaceMaterial(key, like) {
  if (MATS.has(key)) return MATS.get(key);
  const physical = like.type === 'MeshPhysicalMaterial';
  const opts = { vertexColors: true, roughness: 1, metalness: 1, emissive: 0xffffff, side: like.side, flatShading: like.flatShading, fog: like.fog, toneMapped: like.toneMapped };
  const m = physical ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 1, ior: like.ior }) : new THREE.MeshStandardMaterial(opts);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 aSurf;\nattribute vec4 aEmis;\nvarying vec4 vSurf;\nvarying vec3 vEmis;\n' + SRGB_TO_LINEAR_GLSL
      + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vSurf = aSurf; vEmis = srgbToLinear(aEmis.rgb) * aEmis.a * ${EMIS_MAX.toFixed(1)};`)
        .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb = srgbToLinear(vColor.rgb);');
    sh.fragmentShader = 'varying vec4 vSurf;\nvarying vec3 vEmis;\n'
      + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vEmis;')
        .replace('material.clearcoat = clearcoat;', 'material.clearcoat = vSurf.z;')
        .replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = vSurf.w;');
  };
  m.customProgramCacheKey = () => 'surface8:' + (physical ? 'physical' : 'standard');
  m.userData.shared = true;     // one per fold key for the whole game: never freed with a chunk
  m.userData.surface = true;
  MATS.set(key, m);
  return m;
}

const tmp = new THREE.Color();
/**
 * Per-vertex surface values for `count` vertices of material `m`, written at vertex offset
 * `o` into arrays { col, surf, emis } from surfaceArrays.
 */
export function writeSurface(arrays, o, count, m) {
  const { col, surf, emis } = arrays;
  m.color.getRGB(tmp, THREE.SRGBColorSpace);
  const c0 = Math.round(tmp.r * 255), c1 = Math.round(tmp.g * 255), c2 = Math.round(tmp.b * 255);
  m.emissive.getRGB(tmp, THREE.SRGBColorSpace);
  const e0 = Math.round(tmp.r * 255), e1 = Math.round(tmp.g * 255), e2 = Math.round(tmp.b * 255);
  const ei = Math.round(255 * Math.min(1, (m.emissiveIntensity ?? 1) / EMIS_MAX));
  const r = Math.round(255 * m.roughness), mt = Math.round(255 * m.metalness);
  const cc = Math.round(255 * Math.min(1, m.clearcoat ?? 0)), cr = Math.round(255 * Math.min(1, m.clearcoatRoughness ?? 0));
  for (let i = o * 4, end = (o + count) * 4; i < end; i += 4) {
    col[i] = c0; col[i + 1] = c1; col[i + 2] = c2; col[i + 3] = 255;
    surf[i] = r; surf[i + 1] = mt; surf[i + 2] = cc; surf[i + 3] = cr;
    emis[i] = e0; emis[i + 1] = e1; emis[i + 2] = e2; emis[i + 3] = ei;
  }
}

/** Arrays for writeSurface, sized for `n` vertices (`physical` is accepted for older callers; the layout is the same). */
export function surfaceArrays(n) {
  return { col: new Uint8Array(n * 4), surf: new Uint8Array(n * 4), emis: new Uint8Array(n * 4) };
}

/** Attach the arrays from surfaceArrays to a geometry (normalised bytes: the shader sees 0-1). */
export function setSurfaceAttributes(geo, a) {
  geo.setAttribute('color', new THREE.BufferAttribute(a.col, 4, true));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(a.surf, 4, true));
  geo.setAttribute('aEmis', new THREE.BufferAttribute(a.emis, 4, true));
}

/** Read back one vertex's linear colour and emissive radiance (for building the one-piece car). */
export function readSurface(geo, i, colOut, emisOut) {
  const C = geo.attributes.color, E = geo.attributes.aEmis;
  colOut.setRGB(C.getX(i), C.getY(i), C.getZ(i), THREE.SRGBColorSpace);
  emisOut.setRGB(E.getX(i), E.getY(i), E.getZ(i), THREE.SRGBColorSpace).multiplyScalar(E.getW(i) * EMIS_MAX);
}

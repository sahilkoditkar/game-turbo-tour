// Banded ground: alternating light and dark bands of grass running across the road,
// the classic arcade sense-of-speed cue. Each ground vertex stores the sine of its phase
// along the nearest road (so the pattern wraps cleanly round a closed loop and never
// aliases where two roads meet) and its distance from that road; the fragment shader
// picks light or dark from the sign and fades the bands out away from the road.
import * as THREE from 'three';

/**
 * Add the band attributes to a ground geometry.
 * near(x, z) -> { s: metres along the nearest road, dist: metres from its centreline, cycle?: metres per light+dark pair }
 * (ox, oz) is added to the geometry's x/z to get world coordinates.
 */
export function addBandAttributes(geo, near, ox = 0, oz = 0, cycle = 48) {
  const P = geo.attributes.position, n = P.count;
  const phase = new Float32Array(n), dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = near(P.getX(i) + ox, P.getZ(i) + oz);
    phase[i] = Math.sin((2 * Math.PI * r.s) / (r.cycle || cycle));
    dist[i] = r.dist;
  }
  geo.setAttribute('aBand', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aBandDist', new THREE.BufferAttribute(dist, 1));
}

/** A whole number of band pairs round a loop of length L, each close to `cycle` metres. */
export function loopCycle(L, cycle = 48) { return L / Math.max(1, Math.round(L / cycle)); }

/**
 * Patch a MeshStandardMaterial to draw the bands.
 * o.colors [light, dark] replaces the surface colour with flat bands (race tracks);
 * otherwise the existing colour (e.g. vertex colours) is lifted by o.lift on light bands.
 * Bands fade out between o.near and o.far metres from the road.
 */
export function bandMaterial(mat, o = {}) {
  const near = o.near ?? 70, far = o.far ?? 110;
  const flat = !!o.colors;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBandA = { value: new THREE.Color(flat ? o.colors[0] : 0xffffff) };
    sh.uniforms.uBandB = { value: new THREE.Color(flat ? o.colors[1] : 0xffffff) };
    sh.vertexShader = 'attribute float aBand;\nattribute float aBandDist;\nvarying float vBand;\nvarying float vBandDist;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBand = aBand; vBandDist = aBandDist;');
    sh.fragmentShader = 'uniform vec3 uBandA;\nuniform vec3 uBandB;\nvarying float vBand;\nvarying float vBandDist;\n' +
      sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  float bandOn = step(0.0, vBand) * (1.0 - smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, vBandDist));
  ${flat ? 'diffuseColor.rgb = mix(uBandB, uBandA, bandOn);' : `diffuseColor.rgb *= 1.0 + ${(o.lift ?? 0.12).toFixed(3)} * bandOn;`}`);
  };
  mat.customProgramCacheKey = () => (flat ? 'bands-flat' : 'bands-lift');
  mat.needsUpdate = true;
  return mat;
}

/** Light and dark band colours for a theme's ground (snow and sand get darker bands instead of lighter). */
export function bandColors(ground) {
  const base = new THREE.Color(ground);
  const hsl = {}; base.getHSL(hsl);
  // [band, plain]: the plain colour is the theme's ground, so the bands fade into the far ground
  if (hsl.l > 0.62) return [base.clone().offsetHSL(0, 0.02, -0.07), base.clone()];
  return [base.clone().offsetHSL(0.015, 0.08, 0.12), base.clone()];
}

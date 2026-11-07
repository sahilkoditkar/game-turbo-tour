// Stylised sky and horizon: a gradient sky dome with a big sun, flat cartoon clouds
// (or stars at night), and layered backdrop silhouettes (mountains, mesas, tree lines
// or a city skyline) painted in flat two-tone facets that fade into the horizon haze.
// Both ride with the camera, so they always sit on the horizon, whatever the track
// length or height, and work with any number of split-screen cameras.
// The horizon colour is the fog colour, so distant terrain melts into the sky.
import * as THREE from 'three';

const SUN_AZ = Math.atan2(80, 120); // same compass direction as the shadow-casting sun (scenekit SUN_DIR)

const NOISE = /* glsl */`
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = vec4(p.xy, p.w * 0.99999, p.w);   // on the far plane, behind everything
  }`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop, uHorizon, uGlow, uSunColor, uSunDir, uCloud, uCloudShade;
  uniform float uGlowAmt, uSunSize, uClouds, uStars;
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 c = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.34, h), 0.7));
    c = mix(c, uGlow, exp(-max(h, 0.0) * 9.0) * uGlowAmt * step(0.0, h));
    if (h < 0.0) c = uHorizon;
    // sun: a crisp disc with a soft halo
    float sd = dot(d, uSunDir);
    if (uSunSize > 0.0) {
      c += uSunColor * (pow(max(sd, 0.0), 10.0) * 0.28 + pow(max(sd, 0.0), 160.0) * 0.45);
      c = mix(c, uSunColor * 1.6 + 0.4, smoothstep(uSunSize, uSunSize + 0.0006, sd));
    }
    // flat cartoon clouds on a plane above the world, two-tone with a shaded underside
    if (uClouds > 0.0 && h > 0.0) {
      vec2 uv = d.xz / (h + 0.1) * 1.3;
      float n = fbm(uv);
      float edge = 0.66 - uClouds * 0.22;
      float m = smoothstep(edge, edge + 0.015, n) * smoothstep(0.015, 0.09, h);
      float lit = smoothstep(edge + 0.04, edge + 0.06, fbm(uv + vec2(0.0, 0.06)));
      vec3 cc = mix(uCloudShade, uCloud, max(lit, 0.35 * smoothstep(edge + 0.08, edge + 0.2, n)));
      c = mix(c, cc, m);
    }
    // stars
    if (uStars > 0.0 && h > 0.05) {
      vec2 g = vec2(atan(d.z, d.x) * 120.0, h * 160.0);
      vec2 cell = floor(g), f = fract(g) - 0.5;
      float r = h21(cell);
      float star = step(0.985, r) * smoothstep(0.18, 0.0, length(f));
      c += vec3(star) * uStars * smoothstep(0.05, 0.3, h);
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const RIDGE_VERT = /* glsl */`
  attribute vec2 aWin;
  varying vec3 vColor;
  varying vec2 vWin;
  void main() {
    vColor = color;
    vWin = aWin;
    vec3 wp = position + cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const RIDGE_FRAG = /* glsl */`
  varying vec3 vColor;
  varying vec2 vWin;
  ${NOISE}
  void main() {
    vec3 c = vColor;
    // lit windows on skyline towers (vWin is in metres; x < 0 means no windows)
    if (vWin.x >= 0.0) {
      vec2 g = vWin / vec2(7.0, 6.0);
      vec2 cell = floor(g), f = fract(g);
      float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
      float r = h21(cell);
      vec3 lc = r > 0.93 ? vec3(0.2, 0.9, 1.0) : r > 0.88 ? vec3(1.0, 0.3, 0.7) : vec3(1.0, 0.82, 0.5);
      c = mix(c, lc * 1.4, win * step(0.5, r));
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Sky dome for a theme. Sets the scene fog colour to the sky's horizon. */
export function buildSky(scene, th) {
  const elev = THREE.MathUtils.degToRad(th.sunElev ?? 14);
  const sunDir = new THREE.Vector3(Math.cos(SUN_AZ) * Math.cos(elev), Math.sin(elev), Math.sin(SUN_AZ) * Math.cos(elev));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: {
      uTop: { value: new THREE.Color(th.skyTop ?? th.sky) },
      uHorizon: { value: new THREE.Color(th.fog) },
      uGlow: { value: new THREE.Color(th.skyGlow ?? th.fog) },
      uGlowAmt: { value: th.skyGlowAmt ?? 0 },
      uSunColor: { value: new THREE.Color(th.sunColor ?? 0xfff3c4) },
      uSunDir: { value: sunDir },
      uSunSize: { value: th.night ? 0 : Math.cos(THREE.MathUtils.degToRad(th.sunSize ?? 2.4)) },
      uClouds: { value: th.clouds ?? 0 },
      uCloud: { value: new THREE.Color(th.cloudColor ?? 0xffffff) },
      uCloudShade: { value: new THREE.Color(th.cloudShade ?? 0xd6e6f5) },
      uStars: { value: th.night ? 0.9 : 0 },
    },
    depthWrite: false, fog: false, side: THREE.BackSide,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.name = 'sky';
  scene.add(dome);
  scene.background = null;
  return dome;
}

// ---------------------------------------------------------------- Backdrop

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Accumulates flat-coloured triangles on a ring around the camera. */
class RingBuilder {
  constructor(horizon) { this.pos = []; this.col = []; this.win = []; this.horizon = new THREE.Color(horizon); }
  // a point at compass angle a (radians), radius r, height y (relative to the eye)
  p(a, r, y) { return [Math.cos(a) * r, y, Math.sin(a) * r]; }
  tri(p0, p1, p2, c0, c1, c2, w = null) {
    this.pos.push(...p0, ...p1, ...p2);
    for (const c of [c0, c1, c2]) this.col.push(c.r, c.g, c.b);
    if (w) for (const v of w) this.win.push(v[0], v[1]);
    else this.win.push(-1, 0, -1, 0, -1, 0);
  }
  /** Colour at the base of a shape: mostly horizon haze. */
  base(c, haze = 0.7) { return c.clone().lerp(this.horizon, haze); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 2));
    return g;
  }
}

const tone = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

/**
 * A range of faceted peaks: each peak is a tent with a lit and a shaded face,
 * optionally capped with snow. heights in metres above `base` (relative to the eye).
 */
function mountains(rb, rand, o) {
  const { r, base, count, hMin, hMax, wMin, wMax, color, haze, snow = 0, snowColor = 0xf4f8ff, arc = null } = o;
  const hz = (c) => c.clone().lerp(rb.horizon, haze);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * (Math.PI * 2 / count);
    let h = hMin + rand() * (hMax - hMin);
    if (arc) h *= arc(a);
    if (h < 4) continue;
    const w = (wMin + rand() * (wMax - wMin)) * (0.6 + h / hMax * 0.6);
    const rr = r + i % 7 * 6 + rand() * 4;                 // stagger depth so overlapping peaks never z-fight
    const peakA = a + (rand() - 0.5) * w * 0.4;
    const L = rb.p(a - w, rr, base), R = rb.p(a + w, rr, base), P = rb.p(peakA, rr, base + h), M = rb.p(peakA, rr, base);
    const lit = hz(tone(color, 1.14)), shade = hz(tone(color, 0.78));
    rb.tri(L, P, M, rb.base(lit), lit, rb.base(lit));
    rb.tri(M, P, R, rb.base(shade), shade, rb.base(shade));
    if (snow && h > hMin + (hMax - hMin) * 0.35) {
      const f = snow * (0.8 + rand() * 0.4);
      const ys = base + h * (1 - f);
      const sl = (peakA - (a - w)) * f, sr = ((a + w) - peakA) * f;
      const rs = rr - 2;
      const SL = rb.p(peakA - sl, rs, ys), SR = rb.p(peakA + sr, rs, ys), SP = rb.p(peakA, rs, base + h);
      const SM = rb.p(peakA + (rand() - 0.5) * sl * 0.4, rs, ys - h * f * 0.35);
      const sLit = hz(new THREE.Color(snowColor)), sShade = hz(new THREE.Color(snowColor).multiply(new THREE.Color(0xc4d4ee)));
      rb.tri(SL, SP, SM, sLit, sLit, sLit);
      rb.tri(SM, SP, SR, sShade, sShade, sShade);
    }
  }
}

/** Flat-topped mesas and buttes for the desert. */
function mesas(rb, rand, o) {
  const { r, base, count, hMin, hMax, color, haze } = o;
  const hz = (c) => c.clone().lerp(rb.horizon, haze);
  for (let i = 0; i < count; i++) {
    if (rand() < 0.35) continue;
    const a = (i / count) * Math.PI * 2 + rand() * 0.05;
    const h = hMin + rand() * (hMax - hMin);
    const top = 0.012 + rand() * 0.05, slope = 0.006 + rand() * 0.01;
    const rr = r + i % 5 * 7;
    const BL = rb.p(a - top - slope, rr, base), TL = rb.p(a - top, rr, base + h), TR = rb.p(a + top, rr, base + h), BR = rb.p(a + top + slope, rr, base);
    const BLi = rb.p(a - top, rr, base), BRi = rb.p(a + top, rr, base);
    const lit = hz(tone(color, 1.12)), mid = hz(tone(color, 0.95)), shade = hz(tone(color, 0.74));
    rb.tri(BL, TL, BLi, rb.base(lit), lit, rb.base(lit));
    rb.tri(BLi, TL, TR, rb.base(mid), mid, mid);
    rb.tri(BLi, TR, BRi, rb.base(mid), mid, rb.base(mid));
    rb.tri(BRi, TR, BR, rb.base(shade), shade, rb.base(shade));
    // a darker band of strata near the top
    const sy = base + h * 0.82;
    const s = hz(tone(color, 0.82));
    rb.tri(rb.p(a - top, rr - 1, sy), rb.p(a - top, rr - 1, base + h * 0.9), rb.p(a + top, rr - 1, sy), s, s, s);
    rb.tri(rb.p(a + top, rr - 1, sy), rb.p(a - top, rr - 1, base + h * 0.9), rb.p(a + top, rr - 1, base + h * 0.9), s, s, s);
  }
}

/** A distant tree line: narrow two-tone spires along a rolling hill contour. */
function treeLine(rb, rand, o) {
  const { r, base, hill, color, tree, haze, step = 0.012, tMin = 14, tMax = 34, arc = null } = o;
  const hz = (c) => c.clone().lerp(rb.horizon, haze);
  const contour = (a) => hill * (0.55 + 0.25 * Math.sin(a * 3 + 1.3) + 0.2 * Math.sin(a * 7.1 + 0.4));
  const hillC = hz(new THREE.Color(color)), hillTop = hz(tone(color, 1.08));
  const N = Math.round(Math.PI * 2 / 0.02);
  for (let i = 0; i < N; i++) {
    const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
    const k0 = arc ? arc(a0) : 1, k1 = arc ? arc(a1) : 1;
    const y0 = base + contour(a0) * k0, y1 = base + contour(a1) * k1;
    rb.tri(rb.p(a0, r, base), rb.p(a0, r, y0), rb.p(a1, r, base), rb.base(hillC), hillTop, rb.base(hillC));
    rb.tri(rb.p(a1, r, base), rb.p(a0, r, y0), rb.p(a1, r, y1), rb.base(hillC), hillTop, hillTop);
  }
  if (!tree) return;
  const lit = hz(tone(tree, 1.12)), shade = hz(tone(tree, 0.8));
  for (let a = 0; a < Math.PI * 2; a += step * (0.5 + rand())) {
    const k = arc ? arc(a) : 1;
    if (k < 0.5) continue;
    const y = base + contour(a) * k - 3;
    const h = (tMin + rand() * (tMax - tMin)) * k;
    const w = step * (0.35 + rand() * 0.3);
    const rr = r - 3 - rand() * 2;
    const L = rb.p(a - w, rr, y), R = rb.p(a + w, rr, y), P = rb.p(a, rr, y + h), M = rb.p(a, rr, y);
    rb.tri(L, P, M, lit, lit, lit);
    rb.tri(M, P, R, shade, shade, shade);
  }
}

/** Rolling hills with no trees (coast, dunes). */
function hills(rb, rand, o) { treeLine(rb, rand, { ...o, tree: null }); }

/** A city skyline of towers with lit windows. */
function skyline(rb, rand, o) {
  const { r, base, color, haze } = o;
  const hz = (c) => c.clone().lerp(rb.horizon, haze);
  let a = 0;
  while (a < Math.PI * 2) {
    const wM = 18 + rand() * 46, h = 50 + Math.pow(rand(), 1.6) * 260;
    const rr = r + rand() * 30;
    const w = wM / rr;
    const front = hz(tone(color, 0.9 + rand() * 0.25)), side = hz(tone(color, 0.7));
    const y0 = base, y1 = base + h;
    const A = rb.p(a, rr, y0), B = rb.p(a, rr, y1), Cc = rb.p(a + w, rr, y1), D = rb.p(a + w, rr, y0);
    rb.tri(A, B, Cc, front, front, front, [[0, 0], [0, h], [wM, h]]);
    rb.tri(A, Cc, D, front, front, front, [[0, 0], [wM, h], [wM, 0]]);
    if (rand() < 0.4) {   // a spire or stepped top
      const sw = w * 0.3, sh = 15 + rand() * 40;
      const S0 = rb.p(a + w / 2 - sw, rr - 1, y1), S1 = rb.p(a + w / 2, rr - 1, y1 + sh), S2 = rb.p(a + w / 2 + sw, rr - 1, y1);
      rb.tri(S0, S1, S2, side, side, side);
    }
    a += w + (rand() < 0.3 ? 0.004 : 0);
  }
}

/**
 * Layered backdrop for a circuit theme. `o.seaDir` (radians) leaves a low gap where
 * the sea is, so the coast looks out over open water.
 */
export function buildBackdrop(scene, th, o = {}) {
  const kind = th.backdrop;
  if (!kind) return null;
  const rand = mulberry32(o.seed || 1234);
  const rb = new RingBuilder(th.fog);
  const base = -80;
  const seaDir = o.seaDir;
  const arc = seaDir == null ? null : (a) => {
    let d = Math.abs(((a - seaDir) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    return THREE.MathUtils.smoothstep(d, 0.5, 1.2) * 0.9 + 0.1;
  };
  if (kind === 'meadow') {
    mountains(rb, rand, { r: 2250, base, count: 34, hMin: 240, hMax: 470, wMin: 0.09, wMax: 0.16, color: 0x6f8fd0, haze: 0.27, snow: 0.3 });
    mountains(rb, rand, { r: 2080, base, count: 40, hMin: 130, hMax: 240, wMin: 0.1, wMax: 0.18, color: 0x3f9a62, haze: 0.17 });
    treeLine(rb, rand, { r: 1880, base, hill: 120, color: 0x58ad46, tree: 0x2f8a3a, haze: 0.07, step: 0.018 });
  } else if (kind === 'coast') {
    mountains(rb, rand, { r: 2250, base, count: 30, hMin: 200, hMax: 400, wMin: 0.1, wMax: 0.18, color: 0x7aa0d6, haze: 0.3, arc });
    hills(rb, rand, { r: 1900, base, hill: 130, color: 0x5aac58, haze: 0.11, arc });
  } else if (kind === 'desert') {
    mesas(rb, rand, { r: 2250, base, count: 40, hMin: 160, hMax: 300, color: 0xd9845a, haze: 0.3 });
    mesas(rb, rand, { r: 2050, base, count: 34, hMin: 120, hMax: 230, color: 0xc0582f, haze: 0.13 });
    hills(rb, rand, { r: 1880, base, hill: 105, color: 0xe2b066, haze: 0.09 });
  } else if (kind === 'forest') {
    mountains(rb, rand, { r: 2250, base, count: 32, hMin: 300, hMax: 560, wMin: 0.08, wMax: 0.14, color: 0x6a8ccc, haze: 0.25, snow: 0.34 });
    mountains(rb, rand, { r: 2080, base, count: 40, hMin: 150, hMax: 280, wMin: 0.09, wMax: 0.16, color: 0x2f8a58, haze: 0.15 });
    treeLine(rb, rand, { r: 1880, base, hill: 115, color: 0x2f8a46, tree: 0x1d6a38, haze: 0.06, step: 0.011 });
  } else if (kind === 'alpine') {
    mountains(rb, rand, { r: 2250, base, count: 30, hMin: 380, hMax: 680, wMin: 0.08, wMax: 0.14, color: 0x6d8fd4, haze: 0.21, snow: 0.55 });
    mountains(rb, rand, { r: 2080, base, count: 36, hMin: 200, hMax: 360, wMin: 0.08, wMax: 0.15, color: 0x8aa6d8, haze: 0.12, snow: 0.45 });
    treeLine(rb, rand, { r: 1880, base, hill: 110, color: 0xdfe9f5, tree: 0x1d6a42, haze: 0.05, step: 0.012 });
  } else if (kind === 'city') {
    mountains(rb, rand, { r: 2250, base, count: 28, hMin: 200, hMax: 380, wMin: 0.1, wMax: 0.2, color: 0x2a1a52, haze: 0.21 });
    skyline(rb, rand, { r: 1850, base, color: 0x1c1640, haze: 0.05 });
  }
  const mat = new THREE.ShaderMaterial({ vertexShader: RIDGE_VERT, fragmentShader: RIDGE_FRAG, vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(rb.build(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;
  mesh.name = 'backdrop';
  scene.add(mesh);
  return mesh;
}

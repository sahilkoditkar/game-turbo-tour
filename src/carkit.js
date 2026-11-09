// Procedural car-body toolkit: smooth lofted shells with real wheel-arch openings,
// panels that hug the body surface (lights, glass, intakes, livery), detailed wheels,
// and a merge pass that keeps each car to a handful of draw calls.
import * as THREE from 'three';
import { foldKey, surfaceMaterial, surfaceArrays, writeSurface, setSurfaceAttributes } from './surface.js';

export const PIVOT = 0.36; // body roll/pitch pivot height (the old WHEEL_R)

/** Mesh density multiplier: 1 for high quality, lower for the 'low' graphics setting. */
export const detail = { f: 1 };
const res = (n, min = 2) => Math.max(min, Math.round(n * detail.f));

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const win = (v, a, b, s) => smooth(a - s, a + s, v) * (1 - smooth(b - s, b + s, v));
const val = (f, z) => (typeof f === 'function' ? f(z) : f);

/** Monotone cubic (Fritsch–Carlson) interpolant through (xs, ys): smooth, no overshoot. */
function monotone(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Resample a 2D polyline to n+1 points evenly spaced by arc length. */
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1] || 1e-6;
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1e-6, t = clamp((s - cum[j]) / seg, 0, 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

/**
 * A symmetric body shell lofted through cross-sections along z (forward).
 * Station: [z, w, sill, belt, top, n = 4, dip = 0, tuck = 0.06]
 *   w     half-width at the belt (widest line)       sill  height of the lower body edge
 *   belt  height of the widest line                  top   height of the top at the centre line
 *   n     squareness of the upper section (2 round … 8 boxy)
 *   dip   how far the centre sits below the shoulders (fender peaks); negative = centre bulge
 *   tuck  how far the sides tuck in toward the sill
 * Options: arches [{z, y, R, xIn}] cut wheel openings; dents [{z0, z1, y0, y1, depth, s}] push scoops in.
 */
export class Loft {
  constructor(stations, o = {}) {
    const S = stations.map(s => [s[0], s[1], s[2], s[3], s[4], s[5] ?? 4, s[6] ?? 0, s[7] ?? 0.06]);
    this.z0 = S[0][0]; this.z1 = S[S.length - 1][0];
    const zs = S.map(s => s[0]);
    this.f = [1, 2, 3, 4, 5, 6, 7].map(k => monotone(zs, S.map(s => s[k])));
    this.arches = o.arches || [];
    this.dents = o.dents || [];
    this.ka = res(o.ka ?? 6, 3);
    this.kb = res(o.kb ?? 24, 10);
    this.n = res(o.n ?? 40, 16);
    this.na = res(14, 8);
    this.cache = new Map();
  }

  params(z) {
    const f = this.f;
    return { w: f[0](z), sill: f[1](z), belt: f[2](z), top: f[3](z), n: f[4](z), dip: f[5](z), tuck: f[6](z) };
  }

  /** Dense half cross-section at z: from the sill up the side and over to the top centre. */
  curve(z) {
    const key = Math.round(z * 2e4);
    let c = this.cache.get(key);
    if (c) return c;
    const p = this.params(z);
    const pts = [];
    const hL = Math.max(1e-4, p.belt - p.sill);
    for (let i = 0; i < 24; i++) {
      const u = i / 24;
      pts.push([p.w - p.tuck * Math.pow(1 - u, 2.2), p.sill + hL * u]);
    }
    const e = 2 / p.n;
    for (let i = 0; i <= 120; i++) {
      const u = i / 120, u3 = u * u * u, v3 = (1 - u) * (1 - u) * (1 - u);
      const phi = (u3 / (u3 + v3)) * Math.PI / 2;
      const x = p.w * Math.pow(Math.max(0, Math.cos(phi)), e);
      const r = x / p.w, q = 1 - r * r;
      pts.push([x, p.belt + (p.top - p.belt) * Math.pow(Math.sin(phi), e) - p.dip * q * q]);
    }
    for (const d of this.dents) {
      const wz = win(z, d.z0, d.z1, d.s ?? 0.03);
      if (wz <= 0) continue;
      for (const pt of pts) {
        if (pt[0] < p.w * 0.45) continue;
        pt[0] -= d.depth * wz * win(pt[1], val(d.y0, z), val(d.y1, z), d.s ?? 0.03);
      }
    }
    c = { p, pts };
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  /** x of the side surface at height y. */
  sideX(z, y) {
    const P = this.curve(z).pts;
    if (y <= P[0][1]) return P[0][0];
    let best = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if (a[1] <= y && b[1] >= y) { const t = (y - a[1]) / ((b[1] - a[1]) || 1e-6); return a[0] + (b[0] - a[0]) * t; }
      if (P[i][1] > P[best][1]) best = i;
    }
    return P[best][0];
  }

  /** Height of the upper surface at lateral offset |x|. */
  topY(z, x) {
    const P = this.curve(z).pts;
    x = Math.abs(x);
    for (let i = P.length - 1; i > 0; i--) {
      const a = P[i], b = P[i - 1];
      if (a[0] <= x && b[0] >= x) { const t = (x - a[0]) / ((b[0] - a[0]) || 1e-6); return a[1] + (b[1] - a[1]) * t; }
    }
    return x < P[P.length - 1][0] ? P[P.length - 1][1] : this.params(z).belt;
  }

  /** Half ring (+x side) from bottom centre to top centre, fixed vertex count. */
  ring(z) {
    const { p, pts: P } = this.curve(z);
    let yLip = p.sill, arch = null;
    for (const a of this.arches) {
      const dz = z - a.z;
      if (Math.abs(dz) < a.R) { const y = a.y + Math.sqrt(a.R * a.R - dz * dz); if (y > yLip) { yLip = y; arch = a; } }
    }
    let lip, rest;
    if (yLip <= P[0][1] + 1e-6) { lip = P[0].slice(); rest = P.slice(1); }
    else {
      let i = 0;
      while (i < P.length - 2 && P[i + 1][1] < yLip) i++;
      const a = P[i], b = P[i + 1], t = clamp((yLip - a[1]) / ((b[1] - a[1]) || 1e-6), 0, 1);
      lip = [a[0] + (b[0] - a[0]) * t, yLip];
      rest = P.slice(i + 1);
    }
    const B = resample([lip, ...rest], this.kb);
    const A = arch
      ? resample([[0, p.sill], [arch.xIn, p.sill], [arch.xIn, yLip - 0.03], [Math.max(arch.xIn + 0.01, lip[0] - 0.02), yLip - 0.005], lip], this.ka)
      : resample([[0, p.sill], [Math.max(0.01, lip[0] - 0.04), p.sill], lip], this.ka);
    return [...A, ...B.slice(1)];
  }

  stations() {
    const zs = [];
    for (let i = 0; i <= this.n; i++) zs.push(this.z0 + (this.z1 - this.z0) * (1 - Math.cos(Math.PI * i / this.n)) / 2);
    for (const a of this.arches) {
      for (let i = 1; i < this.na; i++) zs.push(a.z - a.R * Math.cos(Math.PI * i / this.na));
      for (const s of [-1, 1]) { zs.push(a.z + s * (a.R - 0.002)); zs.push(a.z + s * (a.R + 0.002)); }
    }
    zs.sort((a, b) => a - b);
    const out = [];
    for (const z of zs) if (z >= this.z0 && z <= this.z1 && (!out.length || z - out[out.length - 1] > 0.0015)) out.push(z);
    return out;
  }

  geometry() {
    const zs = this.stations();
    const pos = [], idx = [];
    let H = 0;
    for (const z of zs) {
      const r = this.ring(z);
      H = r.length;
      for (let j = 0; j < H; j++) pos.push(r[j][0], r[j][1], z);
      for (let j = H - 2; j >= 1; j--) pos.push(-r[j][0], r[j][1], z);
    }
    const R = 2 * (H - 1), N = zs.length;
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < R; j++) {
      const a = i * R + j, b = (i + 1) * R + j, c = (i + 1) * R + ((j + 1) % R), d = i * R + ((j + 1) % R);
      idx.push(a, d, b, b, d, c);
    }
    // flat end caps with their own vertices so they stay crisp
    for (const [ri, dir] of [[0, -1], [N - 1, 1]]) {
      const base = pos.length / 3;
      let cx = 0, cy = 0;
      for (let j = 0; j < R; j++) { const k = (ri * R + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); cx += pos[k]; cy += pos[k + 1]; }
      pos.push(cx / R, cy / R, zs[ri]);
      const c = base + R;
      for (let j = 0; j < R; j++) {
        const a = base + j, b = base + ((j + 1) % R);
        if (dir > 0) idx.push(c, a, b); else idx.push(c, b, a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}

/* ------------------------------------------------------------ parameter shapes */

/** Bilinear patch through four [z, v] corners: p00, p10 (a = 1), p01 (b = 1), p11. */
export const quad = (p00, p10, p01, p11) => (a, b) => [
  (p00[0] * (1 - a) + p10[0] * a) * (1 - b) + (p01[0] * (1 - a) + p11[0] * a) * b,
  (p00[1] * (1 - a) + p10[1] * a) * (1 - b) + (p01[1] * (1 - a) + p11[1] * a) * b,
];
export const rect = (z0, z1, v0, v1) => quad([z0, v0], [z1, v0], [z0, v1], [z1, v1]);
/** Elliptical disc centred on [zc, vc], optionally rotated in parameter space. */
export const ellipse = (zc, vc, rz, rv, rot = 0) => (a, b) => {
  const t = b * Math.PI * 2, x = a * rz * Math.cos(t), y = a * rv * Math.sin(t);
  return [zc + x * Math.cos(rot) - y * Math.sin(rot), vc + x * Math.sin(rot) + y * Math.cos(rot)];
};

/**
 * A panel lying on a loft surface. kind 'side' maps (z, y) onto the side; 'top' maps (z, x)
 * onto the upper surface. Offset `off` lifts it along the surface normal.
 */
export function patchGeometry(loft, kind, fn, o = {}) {
  // resolution follows the panel's size so chords never cut under a tightly curved surface
  const span = (a0, b0, a1, b1) => { const p = fn(a0, b0), q = fn(a1, b1); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
  const lu = Math.max(span(0, 0, 1, 0), span(0, 1, 1, 1), span(0, 0.5, 1, 0.5)), lv = Math.max(span(0, 0, 0, 1), span(1, 0, 1, 1), span(0.5, 0, 0.5, 1));
  const nu = o.nu ?? clamp(Math.ceil(lu * detail.f / 0.08), 2, 40), nv = o.nv ?? clamp(Math.ceil(lv * detail.f / 0.035), 2, 40);
  const off = o.off ?? 0.004, mirror = o.mirror ?? (kind === 'side');
  const P = kind === 'side' ? (z, v) => [loft.sideX(z, v), v, z] : (z, v) => [v, loft.topY(z, v), z];
  const pos = [], uv = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const [z, v] = fn(i / nu, j / nv);
    pos.push(...P(z, v));
    uv.push(i / nu, j / nv);
  }
  const V = nv + 1, n0 = pos.length / 3;
  let idx = [];
  // side panels never cover a wheel opening
  const open = (t) => {
    if (kind !== 'side') return false;
    const z = (pos[t[0] * 3 + 2] + pos[t[1] * 3 + 2] + pos[t[2] * 3 + 2]) / 3, y = (pos[t[0] * 3 + 1] + pos[t[1] * 3 + 1] + pos[t[2] * 3 + 1]) / 3;
    return loft.arches.some(a => Math.abs(z - a.z) < a.R + 0.008 && (y < a.y || Math.hypot(z - a.z, y - a.y) < a.R + 0.008));
  };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * V + j, b = (i + 1) * V + j, c = b + 1, d = a + 1;
    if (!open([a, b, d])) idx.push(a, b, d);
    if (!open([b, c, d])) idx.push(b, c, d);
  }
  // Face normals from the grid itself (robust at the edge of the surface), then orient outward.
  const nor = new Float32Array(n0 * 3);
  let facing = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3], wy = pos[c * 3 + 1] - pos[a * 3 + 1], wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    facing += kind === 'side' ? nx + 0.3 * nz * Math.sign(pos[a * 3 + 2]) : ny;
    for (const k of [a, b, c]) { nor[k * 3] += nx; nor[k * 3 + 1] += ny; nor[k * 3 + 2] += nz; }
  }
  const sgn = facing < 0 ? -1 : 1;
  if (sgn < 0) for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  for (let k = 0; k < n0; k++) {
    const l = Math.hypot(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]) || 1;
    for (let c = 0; c < 3; c++) { nor[k * 3 + c] *= sgn / l; pos[k * 3 + c] += nor[k * 3 + c] * off; }
  }
  const norm = Array.from(nor);
  if (mirror) {
    const m = idx.length;
    for (let i = 0; i < n0; i++) { pos.push(-pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); norm.push(-norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]); uv.push(1 - uv[i * 2], uv[i * 2 + 1]); }
    for (let t = 0; t < m; t += 3) idx.push(idx[t] + n0, idx[t + 2] + n0, idx[t + 1] + n0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Point and outward normal on a loft surface ('side': (z, y), 'top': (z, x)). */
export function surfaceFrame(loft, kind, z, v) {
  const P = kind === 'side' ? (z, v) => new THREE.Vector3(loft.sideX(z, v), v, z) : (z, v) => new THREE.Vector3(v, loft.topY(z, v), z);
  const e = 0.01, p = P(z, v);
  const dz = P(z + e, v).sub(P(z - e, v)), dv = P(z, v + e).sub(P(z, v - e));
  const n = kind === 'side' ? dv.clone().cross(dz) : dz.clone().cross(dv);
  if (kind === 'top' && n.y < 0) n.negate();
  if (kind === 'side' && n.x < 0 && Math.abs(n.x) > Math.abs(n.z)) n.negate();
  return { p, n: n.normalize() };
}

/* ------------------------------------------------------------ flat geometry helpers */

export function roundRect(x0, y0, x1, y1, r, seg = 4) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts;
}
export function ellipsePts(cx, cy, rx, ry, n = 20) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return pts;
}
const toShape = (pts, holes = []) => {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
  return s;
};

/** Side profile [[z, y], ...] extruded across the car's width, centred on x = 0. */
export function profileGeometry(profile, width, bevel = 0.01) {
  bevel = Math.min(bevel, width * 0.45);
  const g = new THREE.ExtrudeGeometry(toShape(profile), {
    depth: Math.max(0.002, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

/** Aerofoil section (leading edge forward) extruded across `span`. `angle` > 0 lifts the trailing edge. */
export function foilGeometry(chord, thick, span, angle = 0) {
  const up = [], lo = [];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const x = (1 - Math.cos(Math.PI * i / N)) / 2;
    const t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) * chord;
    const camber = -0.04 * chord * Math.sin(Math.PI * x); // inverted camber: downforce
    const z = chord / 2 - x * chord;
    up.push([z, camber + t]); lo.push([z, camber - t]);
  }
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const outline = [...up, ...lo.reverse().slice(1, -1)];
  return profileGeometry(outline.map(([z, y]) => [z * ca + y * sa, y * ca - z * sa]), span, 0.003);
}

/* ------------------------------------------------------------ merging */

/**
 * Merge every mesh below `parent` into one indexed mesh per material. Meshes flagged
 * userData.keep stay. With `fold`, plain-coloured materials are folded together into shared
 * surface materials (see surface.js): one mesh per fold group instead of one per material.
 */
export function mergeByMaterial(parent, { fold = false } = {}) {
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert();
  const groups = new Map();
  const doomed = [];
  parent.traverse(o => {
    if (!o.isMesh || o.userData.keep) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const fk = fold ? foldKey(o.material) : null;
    const key = fk ? 'fold:' + fk : o.material;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ g: o.geometry, m, shadow: o.castShadow, mat: o.material, fk });
    doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const list of groups.values()) {
    const fk = list[0].fk, physical = !!fk && list[0].mat.type === 'MeshPhysicalMaterial';
    const mat = fk ? surfaceMaterial(fk, list[0].mat) : list[0].mat;
    let nv = 0, ni = 0;
    for (const { g } of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
    const surf = fk ? surfaceArrays(nv, physical) : null;
    let vo = 0, io = 0, shadow = false;
    for (const { g, m, shadow: s, mat: partMat } of list) {
      shadow = shadow || s;
      if (!g.attributes.normal) g.computeVertexNormals();
      nm.getNormalMatrix(m);
      const flip = m.determinant() < 0;
      const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
      }
      const I = g.index, cnt = I ? I.count : P.count;
      for (let t = 0; t < cnt; t += 3) {
        const a = I ? I.getX(t) : t, b = I ? I.getX(t + 1) : t + 1, c = I ? I.getX(t + 2) : t + 2;
        idx[io++] = a + vo; idx[io++] = (flip ? c : b) + vo; idx[io++] = (flip ? b : c) + vo;
      }
      if (surf) writeSurface(surf, vo, P.count, partMat);
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (surf) setSurfaceAttributes(geo, surf);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

/* ------------------------------------------------------------ materials */

const role = (m, r) => { m.userData.role = r; return m; };
let SHARED = null;

/** Soft round glow sprite (white core fading out) for lamp halos. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Materials shared by every car. Per-car roles (paint, accent, …) are placeholders swapped per instance. */
export function sharedMaterials() {
  if (SHARED) return SHARED;
  const S = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, ...o });
  const P = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, ...o });
  const E = (color, emissive, emissiveIntensity) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness: 0.2, metalness: 0.1 });
  SHARED = {
    paint: role(P(0xffffff), 'paint'),
    accent: role(P(0xffffff), 'accent'),
    accent2: role(P(0xffffff), 'accent2'),
    tail: role(E(0x3a0000, 0xff1a1a, 0.8), 'tail'),
    // additive halo in front of the tail lamps; its opacity follows the brakes like the lamps
    glow: role(new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff2412, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 'glow'),
    plate: role(S(0xffffff, { transparent: true, roughness: 0.4 }), 'plate'),
    num: role(S(0xffffff, { transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }), 'num'),
    carbon: P(0x1c1d21, { roughness: 0.4, metalness: 0.4, clearcoatRoughness: 0.35, envMapIntensity: 0.6 }),
    gloss: P(0x0b0b0d, { roughness: 0.2, metalness: 0.3 }),
    trim: S(0x131417, { roughness: 0.75, metalness: 0.1 }),
    grille: S(0x060607, { roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide }),
    chrome: S(0xeef0f4, { roughness: 0.06, metalness: 1.0 }),
    alu: S(0xc3c7ce, { roughness: 0.22, metalness: 1.0 }),
    brightChrome: S(0xf6f8fb, { roughness: 0.12, metalness: 0.92 }),
    gunmetal: S(0x3a3d44, { roughness: 0.3, metalness: 0.9 }),
    blackRim: S(0x17181b, { roughness: 0.35, metalness: 0.6 }),
    gold: S(0xc8a24a, { roughness: 0.28, metalness: 1.0 }),
    whiteRim: S(0xf0f0f0, { roughness: 0.35, metalness: 0.1 }),
    rimInner: S(0x1d1e22, { roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
    tyre: S(0x161618, { roughness: 0.93, metalness: 0.0 }),
    disc: S(0x6a6d72, { roughness: 0.45, metalness: 0.85 }),
    caliperRed: S(0xc8161b, { roughness: 0.35, metalness: 0.3 }),
    caliperYellow: S(0xf0c000, { roughness: 0.35, metalness: 0.3 }),
    caliperBlack: S(0x1a1a1a, { roughness: 0.35, metalness: 0.3 }),
    caliperBlue: S(0x1f4fd1, { roughness: 0.35, metalness: 0.3 }),
    pirelliRed: S(0xe0161b, { roughness: 0.6 }),
    white: S(0xf4f4f2, { roughness: 0.45 }),
    glass: P(0x0d141b, { roughness: 0.04, metalness: 0.2, envMapIntensity: 1.8 }),
    lens: P(0x1d2229, { roughness: 0.05, metalness: 0.5, envMapIntensity: 1.6 }),
    lamp: E(0xffffff, 0xeef4ff, 1.6),
    drl: E(0xffffff, 0xf4f8ff, 3.2),
    amber: E(0xffa23a, 0xff8a10, 1.2),
    liner: S(0x0a0a0b, { roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    interior: S(0x1c1b1d, { roughness: 0.85 }),
    leather: S(0x5a2a1c, { roughness: 0.6 }),
    wood: S(0x6b3f1d, { roughness: 0.4 }),
    helmet: P(0xf2f2f2, { roughness: 0.2 }),
  };
  return SHARED;
}

/* ------------------------------------------------------------ kit */

/** Collects the parts of one car template. Everything is authored in absolute car space (y up from the ground). */
export class Kit {
  constructor() {
    this.M = sharedMaterials();
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.userData.tag = 'body';
    this.body.position.y = PIVOT;
    this.root.add(this.body);
    this.shell = new THREE.Group();
    this.shell.position.y = -PIVOT;
    this.body.add(this.shell);
    this.wheelGroups = [];
    this.style = null;   // 'arcade': bold paint, bright glowing lamps (see carmodels instanceMaterials)
  }

  mesh(geo, mat, parent = this.shell) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  loft(stations, o) { return new Loft(stations, o); }
  arch(z, r, x, w, gap = 0.045) { return { z, y: r, R: r + gap, xIn: Math.abs(x) - w / 2 - 0.035 }; }
  skin(loft, mat, x = 0) { const m = this.mesh(loft.geometry(), mat); m.position.x = x; return m; }
  side(loft, fn, mat, o = {}) { const m = this.mesh(patchGeometry(loft, 'side', fn, o), mat); if (o.x) m.position.x = o.x; if (o.keep) m.userData.keep = true; return m; }
  top(loft, fn, mat, o = {}) { const m = this.mesh(patchGeometry(loft, 'top', fn, o), mat); if (o.x) m.position.x = o.x; if (o.keep) m.userData.keep = true; return m; }

  box(w, h, d, x, y, z, mat, rx = 0, ry = 0, rz = 0) {
    const m = this.mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    return m;
  }
  /** Cylinder along an axis ('x' | 'y' | 'z'). */
  cyl(r0, r1, len, x, y, z, mat, axis = 'z', seg = 16, open = false) {
    const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1, open);
    if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    const m = this.mesh(g, mat);
    m.position.set(x, y, z);
    return m;
  }
  ellipsoid(rx, ry, rz, x, y, z, mat, seg = 16) {
    const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1));
    g.scale(rx, ry, rz);
    const m = this.mesh(g, mat);
    m.position.set(x, y, z);
    return m;
  }
  prof(profile, width, x, mat, bevel = 0.01) { const m = this.mesh(profileGeometry(profile, width, bevel), mat); m.position.x = x; return m; }
  foil(chord, thick, span, x, y, z, angle, mat) { const m = this.mesh(foilGeometry(chord, thick, span, angle), mat); m.position.set(x, y, z); return m; }
  tube(pts, r, mat, seg = 40, closed = false, radial = 8) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
    return this.mesh(new THREE.TubeGeometry(curve, res(seg, 4), r, radial, closed), mat);
  }
  /** Flat plate from a plan-view outline [[x, z], ...] at height y, `thick` upward. */
  plate(pts, y, thick, mat, bevel = 0) {
    const g = new THREE.ExtrudeGeometry(toShape(pts.map(([x, z]) => [x, -z])), { depth: thick, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
    g.rotateX(-Math.PI / 2);
    const m = this.mesh(g, mat);
    m.position.y = y;
    return m;
  }
  /** Flat part on a vertical plane at z, outline [[x, y], ...]; facing +1 front, -1 rear. */
  fascia(pts, z, facing, mat, depth = 0.03, holes = [], proud = 0.006) {
    const flip = facing < 0;
    const P = flip ? pts.map(([x, y]) => [-x, y]).reverse() : pts;
    const Hs = holes.map(h => (flip ? h.map(([x, y]) => [-x, y]).reverse() : h));
    const g = new THREE.ExtrudeGeometry(toShape(P, Hs), { depth, bevelEnabled: false, curveSegments: 6 });
    if (flip) { g.rotateY(Math.PI); g.translate(0, 0, z - proud + depth); } else g.translate(0, 0, z + proud - depth);
    return this.mesh(g, mat);
  }
  /** Same flat part on both sides (outline given for the +x side). */
  fascia2(pts, z, facing, mat, depth, holes, proud) {
    this.fascia(pts, z, facing, mat, depth, holes, proud);
    this.fascia(pts.map(([x, y]) => [-x, y]).reverse(), z, facing, mat, depth, (holes || []).map(h => h.map(([x, y]) => [-x, y]).reverse()), proud);
  }
  /** Flat textured plane (numbers). Normal along +x, +z or +y by `axis`, sign by `facing`. */
  decal(w, h, x, y, z, mat, axis = 'x', facing = 1, tilt = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    if (axis === 'x') g.rotateY(facing > 0 ? Math.PI / 2 : -Math.PI / 2);
    else if (axis === 'y') { g.rotateX(-Math.PI / 2); if (facing < 0) g.rotateY(Math.PI); }
    else if (facing < 0) g.rotateY(Math.PI);
    const m = this.mesh(g, mat);
    m.position.set(x, y, z);
    if (tilt) { if (axis === 'y') m.rotation.x = tilt; else m.rotation.z = tilt; }
    m.userData.keep = true; m.castShadow = false;
    return m;
  }
  /** Glow halo: a soft additive sprite on a vertical plane at z, facing rear (-1) or front (+1). */
  glow(x, y, z, w, h, facing = -1) {
    const g = new THREE.PlaneGeometry(w, h);
    if (facing < 0) g.rotateY(Math.PI);
    const m = new THREE.Mesh(g, this.M.glow);
    m.position.set(x, y, z + facing * 0.03);
    m.userData.keep = true;   // keeps its UVs (merging drops them)
    m.renderOrder = 2;
    this.shell.add(m);
    return m;
  }
  /** Flattened dome (lens, lamp) sitting on a loft surface, facing along its normal. */
  dome(loft, kind, z, v, r1, r2, h, mat, spin = 0) {
    const { p, n } = surfaceFrame(loft, kind, z, v);
    const g = new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(r1, h, r2);
    const m = this.mesh(g, mat);
    m.position.copy(p).addScaledVector(n, -h * 0.25);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    if (spin) m.rotateY(spin);
    return m;
  }
  mirrorPod(x, y, z, len = 0.2, h = 0.09, depth = 0.12, mat = this.M.paint, stalk = true) {
    for (const s of [-1, 1]) {
      this.ellipsoid(len / 2, h / 2, depth / 2, s * x, y, z, mat, 14);
      this.box(len * 0.75, h * 0.7, 0.01, s * x, y, z - depth / 2 + 0.006, this.M.glass);
      if (stalk) this.box(0.1, 0.025, 0.06, s * (x - len / 2), y - 0.03, z + 0.01, this.M.trim);
    }
  }

  /**
   * Wheel with tyre, rim, brake disc and caliper.
   * o: { x, z, r, w, rim = 0.66 (rim radius / tyre radius), style, rimMat, caliper, front, band }
   */
  wheel(o) {
    const M = this.M;
    const { x, z, r, w } = o;
    const rimR = r * (o.rim ?? 0.66), hw = w / 2, sx = Math.sign(x) || 1;
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    if (o.front) pivot.userData.tag = 'steer';
    const spin = new THREE.Group();
    spin.userData.tag = 'spin';
    pivot.add(spin);
    const inner = new THREE.Group();
    inner.rotation.y = sx < 0 ? Math.PI : 0; // outer face toward +x in `inner`
    spin.add(inner);
    const add = (geo, mat, px = 0, py = 0, pz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; inner.add(m); return m; };

    // Tyre: lathe profile with rounded shoulders and a bulging sidewall
    const sw = r - rimR;
    const prof = [
      [rimR + 0.004, -hw + 0.012], [rimR + sw * 0.35, -hw - 0.004], [r - sw * 0.25, -hw + 0.002], [r - 0.012, -hw + 0.018], [r, -hw + 0.045],
      [r, hw - 0.045], [r - 0.012, hw - 0.018], [r - sw * 0.25, hw - 0.002], [rimR + sw * 0.35, hw + 0.004], [rimR + 0.004, hw - 0.012],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    const tyre = new THREE.LatheGeometry(prof, res(32, 16));
    tyre.rotateZ(-Math.PI / 2);
    add(tyre, M.tyre);
    if (o.band) { // coloured compound band on the sidewall
      for (const s of [-1, 1]) {
        const band = new THREE.RingGeometry(rimR + sw * 0.42, rimR + sw * 0.52, 40);
        band.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
        add(band, o.band, s * (hw + 0.006));
      }
    }
    // Rim barrel, lip, brake disc
    const barrel = new THREE.CylinderGeometry(rimR, rimR, w - 0.02, res(24, 12), 1, true);
    barrel.rotateZ(Math.PI / 2);
    add(barrel, M.rimInner);
    const rimMat = o.rimMat || M.alu;
    const lip = new THREE.TorusGeometry(rimR - 0.004, 0.012, 4, res(28, 14));
    lip.rotateY(Math.PI / 2);
    add(lip, rimMat, hw - 0.012);
    const discR = rimR * 0.8;
    const disc = new THREE.CylinderGeometry(discR, discR, 0.028, res(24, 12));
    disc.rotateZ(Math.PI / 2);
    const discX = hw - Math.min(0.14, w * 0.45);
    add(disc, M.disc, discX);
    const hat = new THREE.CylinderGeometry(rimR * 0.36, rimR * 0.36, 0.06, 16);
    hat.rotateZ(Math.PI / 2);
    add(hat, M.gunmetal, discX + 0.03);

    // Spokes
    const face = hw - 0.02;
    const hubR = rimR * 0.2;
    const spoke = (ang, width, depth = 0.03, inset = 0.035, r0 = hubR, r1 = rimR - 0.006, mat = rimMat) => {
      const len = r1 - r0;
      const g = new THREE.BoxGeometry(depth, len, width);
      g.translate(0, r0 + len / 2, 0);
      g.rotateZ(-Math.atan2(inset, len)); // dish: hub sits inboard of the rim face
      g.rotateX(ang);
      add(g, mat, face - inset);
    };
    const style = o.style || 'five';
    const N = { five: 5, twin: 5, ten: 10, y: 5, rally: 6, mesh: 10, classic: 4, f1: 0, wire: 0, turbine: 12, six: 6 }[style] ?? 5;
    if (style === 'twin') for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; spoke(a - 0.13, 0.03); spoke(a + 0.13, 0.03); }
    else if (style === 'y') for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      spoke(a, 0.05, 0.03, 0.035, hubR, rimR * 0.55);
      spoke(a - 0.2, 0.03, 0.03, 0.012, rimR * 0.5, rimR - 0.006); spoke(a + 0.2, 0.03, 0.03, 0.012, rimR * 0.5, rimR - 0.006);
    }
    else if (style === 'mesh') for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; spoke(a, 0.022); spoke(a + Math.PI / N, 0.016, 0.02, 0.02, rimR * 0.45); }
    else if (style === 'turbine') for (let i = 0; i < N; i++) spoke((i / N) * Math.PI * 2, 0.035, 0.03, 0.03);
    else if (style === 'classic') {
      const dish = new THREE.CylinderGeometry(rimR * 0.95, rimR * 0.95, 0.02, 28);
      dish.rotateZ(Math.PI / 2);
      add(dish, rimMat, face - 0.04);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8).rotateZ(Math.PI / 2), M.trim, face - 0.03, Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62); }
    }
    else if (style === 'wire') {
      const hubIn = face - 0.12, hubOut = face - 0.02;
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2, a1 = a0 + (i % 2 ? 0.5 : -0.5);
        const hx = i % 3 === 0 ? hubIn : hubOut;
        const p0 = new THREE.Vector3(hx, Math.cos(a0) * hubR * 1.1, Math.sin(a0) * hubR * 1.1);
        const p1 = new THREE.Vector3(face - 0.06 + (i % 3 === 0 ? 0.03 : -0.02), Math.cos(a1) * (rimR - 0.01), Math.sin(a1) * (rimR - 0.01));
        const d = p1.clone().sub(p0), len = d.length();
        const g = new THREE.CylinderGeometry(0.0035, 0.0035, len, 4);
        g.translate(0, len / 2, 0);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
        add(g, M.chrome, p0.x, p0.y, p0.z);
      }
      const dish = new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.98, 0.01, 28, 1, true);
      dish.rotateZ(Math.PI / 2);
      add(dish, M.chrome, face - 0.05);
      // two-eared knock-off spinner
      add(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 8).rotateZ(Math.PI / 2), M.chrome, face + 0.02);
      add(new THREE.BoxGeometry(0.03, 0.2, 0.035), M.chrome, face + 0.035);
    }
    else if (style === 'f1') {
      const cover = new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.98, 0.012, 32);
      cover.rotateZ(Math.PI / 2);
      add(cover, M.blackRim, face - 0.015);
      const ring = new THREE.TorusGeometry(rimR * 0.8, 0.012, 6, 36);
      ring.rotateY(Math.PI / 2);
      add(ring, o.accentMat || M.paint, face - 0.006);
    }
    else for (let i = 0; i < N; i++) spoke((i / N) * Math.PI * 2, style === 'rally' ? 0.07 : style === 'ten' ? 0.028 : style === 'six' ? 0.055 : 0.065);
    if (style !== 'wire') {
      const hub = new THREE.CylinderGeometry(hubR * 1.15, hubR * 1.2, 0.05, 16);
      hub.rotateZ(Math.PI / 2);
      add(hub, rimMat, face - 0.035);
      const nut = new THREE.CylinderGeometry(hubR * 0.55, hubR * 0.55, 0.04, 6);
      nut.rotateZ(Math.PI / 2);
      add(nut, o.nutMat || M.gunmetal, face - 0.01);
    }
    mergeByMaterial(inner, { fold: true });

    // Caliper rides on the upright, not the spinning wheel
    if (o.caliper !== false) {
      const cal = new THREE.TorusGeometry(discR * 0.9, 0.04, 6, 10, 1.0);
      cal.rotateY(Math.PI / 2);
      cal.rotateX(-0.2);
      const cm = new THREE.Mesh(cal, o.caliper || M.caliperRed);
      cm.scale.x = 0.8;
      cm.position.x = sx * discX;
      cm.castShadow = true;
      pivot.add(cm);
    }
    this.root.add(pivot);
    this.wheelGroups.push(pivot);
    return pivot;
  }

  finish() {
    mergeByMaterial(this.shell, { fold: true });
    this.root.userData.style = this.style;
    return this.root;
  }
}

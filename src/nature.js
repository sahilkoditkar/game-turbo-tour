// Stylised low-poly vegetation: chunky faceted trees, bushes and boulders in bold,
// saturated colours. Each species is one small geometry with its colours baked in
// (built once and shared), drawn as an instanced mesh per species, so a whole
// forest costs a handful of draw calls. Flat shading gives every facet a clean
// light or dark tone.
import * as THREE from 'three';

const shared = (o) => { o.userData.shared = true; return o; };
let MAT = null;
function material() {
  if (!MAT) MAT = shared(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));
  return MAT;
}

/** Deterministic hash of a position to [0, 1). */
function hash(x, z, k = 0) {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Turn a primitive into a non-indexed part with baked vertex colours. `top` (optional)
 * blends towards a second colour with height, so crowns are lighter at the top.
 * `jitter` nudges vertices (the same amount for every copy of a shared vertex) so
 * crowns and rocks look hand-cut rather than perfectly regular.
 */
function part(geo, color, { top = null, jitter = 0, seed = 1, scale = null, at = null, rotY = 0, rotZ = 0, rotX = 0 } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (jitter) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (hash(Math.round(x * 100), Math.round(z * 100) + Math.round(y * 100) * 7, seed) - 0.5) * jitter;
      p.setXYZ(i, x * k, y * (1 + (k - 1) * 0.6), z * k);
    }
  }
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  if (rotY) g.rotateY(rotY);
  if (at) g.translate(at[0], at[1], at[2]);
  const p = g.attributes.position;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y;
  const c0 = new THREE.Color(color), c1 = new THREE.Color(top ?? color), c = new THREE.Color();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = y1 > y0 ? (p.getY(i) - y0) / (y1 - y0) : 0;
    c.copy(c0).lerp(c1, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
  return g;
}

/** Concatenate non-indexed parts (position + colour) into one geometry. */
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return shared(g);
}

/** A palm frond: a creased leaf that arches up and droops, closed on both sides. */
function frond(len, width, color, tip) {
  const pts = [];
  const N = 3;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t * len;
    const y = Math.sin(t * Math.PI * 0.9) * len * 0.22 - t * t * len * 0.45;
    const w = Math.sin(Math.min(1, t * 1.3) * Math.PI) * width * (1 - t * 0.35) + 0.04;
    pts.push({ x, y, w, crease: y + 0.18 * (1 - t) });
  }
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[i + 1];
    const aC = [a.x, a.crease, 0], bC = [b.x, b.crease, 0];
    const aL = [a.x, a.y, -a.w], bL = [b.x, b.y, -b.w], aR = [a.x, a.y, a.w], bR = [b.x, b.y, b.w];
    tri(aC, aL, bL); tri(aC, bL, bC); tri(aC, bC, bR); tri(aC, bR, aR);
    // underside
    tri(aC, bL, aL); tri(aC, bC, bL); tri(aC, bR, bC); tri(aC, aR, bR);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return part(g, color, { top: tip });
}

const C = {
  trunk: 0x8f4a26, trunkDark: 0x6e3a20, palmTrunk: 0xb98a58, palmTrunkTop: 0xd6ab73,
  pine: 0x1f8a4c, pineTop: 0x47c46d, pineDeep: 0x17703f, pineDeepTop: 0x2fa356,
  green: 0x3fae35, greenTop: 0x8ade3c, autumn: 0xe0611f, autumnTop: 0xffa531, gold: 0xe8a90f, goldTop: 0xffde3d,
  blossom: 0xf0508f, blossomTop: 0xff9cc6, frond: 0x26a046, frondTip: 0x7bdc4a,
  cactus: 0x2a8a40, cactusTop: 0x48ad4c,
};

/** Species geometries, built on first use. */
const SPECIES = {};
const BUILD = {
  spirePine() {
    return merge([
      part(new THREE.CylinderGeometry(0.32, 0.55, 4, 6), C.trunk, { at: [0, 2, 0] }),
      part(new THREE.ConeGeometry(2.7, 11, 6), C.pine, { top: C.pineTop, jitter: 0.16, seed: 2, at: [0, 8.6, 0] }),
    ]);
  },
  stackPine() {
    return merge([
      part(new THREE.CylinderGeometry(0.35, 0.6, 3, 6), C.trunkDark, { at: [0, 1.5, 0] }),
      part(new THREE.ConeGeometry(3.6, 5.2, 7), C.pineDeep, { top: C.pineDeepTop, jitter: 0.12, seed: 3, at: [0, 4.6, 0] }),
      part(new THREE.ConeGeometry(2.8, 4.6, 7), C.pineDeep, { top: C.pineDeepTop, jitter: 0.12, seed: 4, at: [0, 7.3, 0], rotY: 0.4 }),
      part(new THREE.ConeGeometry(1.9, 4.0, 7), C.pineDeep, { top: C.pineTop, jitter: 0.12, seed: 5, at: [0, 9.8, 0], rotY: 0.8 }),
    ]);
  },
  roundGreen() { return roundTree(C.green, C.greenTop, 11); },
  roundAutumn() { return roundTree(C.autumn, C.autumnTop, 12); },
  roundGold() { return roundTree(C.gold, C.goldTop, 13); },
  roundBlossom() { return roundTree(C.blossom, C.blossomTop, 14); },
  palm() {
    const parts = [];
    let x = 0, y = 0;
    const segs = 5, segH = 2.1;
    for (let i = 0; i < segs; i++) {
      const r0 = 0.48 - i * 0.04, r1 = 0.44 - i * 0.04;
      const lean = 0.06 + i * 0.05;
      parts.push(part(new THREE.CylinderGeometry(r1, r0, segH, 6), i % 2 ? C.palmTrunk : C.palmTrunkTop, { rotZ: -lean, at: [x + Math.sin(lean) * segH / 2, y + segH / 2, 0] }));
      x += Math.sin(lean) * segH; y += Math.cos(lean) * segH * 0.98;
    }
    for (let k = 0; k < 8; k++) {
      const f = frond(4.6 + (k % 2) * 0.8, 0.85, C.frond, C.frondTip);
      f.rotateY((k / 8) * Math.PI * 2 + 0.2);
      f.translate(x, y - 0.1, 0);
      parts.push(f);
    }
    parts.push(part(new THREE.IcosahedronGeometry(0.55, 0), 0x6b4423, { at: [x + 0.2, y - 0.5, 0.25] }));
    parts.push(part(new THREE.IcosahedronGeometry(0.5, 0), 0x7a4e28, { at: [x - 0.25, y - 0.55, -0.2] }));
    return merge(parts);
  },
  saguaro() {
    const arm = (side, h, len, up) => [
      part(new THREE.CylinderGeometry(0.42, 0.42, len, 7), C.cactus, { rotZ: Math.PI / 2, at: [side * (0.6 + len / 2), h, 0] }),
      part(new THREE.CylinderGeometry(0.42, 0.42, up, 7), C.cactus, { top: C.cactusTop, at: [side * (0.6 + len), h + up / 2 - 0.2, 0] }),
      part(new THREE.ConeGeometry(0.42, 0.5, 7), C.cactusTop, { at: [side * (0.6 + len), h + up + 0.03, 0] }),
    ];
    return merge([
      part(new THREE.CylinderGeometry(0.7, 0.8, 8, 8), C.cactus, { top: C.cactusTop, at: [0, 4, 0] }),
      part(new THREE.ConeGeometry(0.7, 0.8, 8), C.cactusTop, { at: [0, 8.4, 0] }),
      ...arm(1, 3.6, 1.0, 2.6),
      ...arm(-1, 4.8, 0.8, 1.9),
    ]);
  },
  bushLime() { return bush(0x6cc62e, 0xb4ec45, 21); },
  bushYellow() { return bush(0xc4b818, 0xf3e84a, 22); },
  bushDark() { return bush(0x2f8a3a, 0x58b84a, 23); },
  bushDry() { return bush(0x9a8a3a, 0xc9b85a, 24); },
  bushPink() { return bush(0xd85b93, 0xff9cc4, 25); },
  rockGrey() { return rock(0xa9b1ba, 0xe4e9ee, 31); },
  rockLight() { return rock(0xc9d3dc, 0xf7fafc, 32); },
  rockRed() { return rock(0xa5532f, 0xdb8a55, 33); },
};

function roundTree(color, top, seed) {
  return merge([
    part(new THREE.CylinderGeometry(0.38, 0.62, 4.2, 6), C.trunk, { at: [0, 2.1, 0] }),
    part(new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5), C.trunk, { rotZ: -0.7, at: [0.75, 4.2, 0] }),
    part(new THREE.IcosahedronGeometry(3.3, 0), color, { top, jitter: 0.28, seed, at: [0, 6.6, 0] }),
    part(new THREE.IcosahedronGeometry(2.4, 0), color, { top, jitter: 0.3, seed: seed + 1, at: [1.9, 5.6, 0.7], rotY: 0.9 }),
    part(new THREE.IcosahedronGeometry(2.2, 0), color, { top, jitter: 0.3, seed: seed + 2, at: [-1.6, 5.8, -0.9], rotY: 1.7 }),
  ]);
}
function bush(color, top, seed) {
  return merge([
    part(new THREE.IcosahedronGeometry(1.25, 0), color, { top, jitter: 0.3, seed, scale: [1, 0.8, 1], at: [0, 0.75, 0] }),
    part(new THREE.IcosahedronGeometry(0.95, 0), color, { top, jitter: 0.3, seed: seed + 1, scale: [1, 0.8, 1], at: [1.05, 0.55, 0.35], rotY: 1.1 }),
    part(new THREE.IcosahedronGeometry(0.8, 0), color, { top, jitter: 0.3, seed: seed + 2, scale: [1, 0.8, 1], at: [-0.9, 0.5, -0.3], rotY: 2.3 }),
  ]);
}
function rock(color, top, seed) {
  return merge([
    part(new THREE.DodecahedronGeometry(1, 0), color, { top, jitter: 0.35, seed, scale: [1.2, 0.75, 1], at: [0, 0.45, 0] }),
  ]);
}

function species(name) {
  if (!SPECIES[name]) SPECIES[name] = BUILD[name]();
  return SPECIES[name];
}

/** Which trees grow in each biome, with weights. */
const TREES = {
  forest: [['spirePine', 0.45], ['stackPine', 0.35], ['roundGreen', 0.2]],
  alpine: [['spirePine', 0.5], ['stackPine', 0.5]],
  meadow: [['roundGreen', 0.46], ['roundAutumn', 0.16], ['roundGold', 0.1], ['roundBlossom', 0.06], ['spirePine', 0.22]],
  park: [['roundGreen', 0.55], ['roundBlossom', 0.3], ['roundGold', 0.15]],
  coast: [['palm', 0.78], ['roundGreen', 0.22]],
  desert: [['saguaro', 1]],
};
/** Bushes and boulders for the undergrowth of each biome. */
const UNDER = {
  forest: [['bushDark', 0.45], ['bushLime', 0.25], ['rockGrey', 0.3]],
  alpine: [['rockLight', 0.6], ['bushDark', 0.4]],
  meadow: [['bushLime', 0.4], ['bushYellow', 0.25], ['bushPink', 0.1], ['rockGrey', 0.25]],
  park: [['bushLime', 0.5], ['bushPink', 0.3], ['bushYellow', 0.2]],
  coast: [['bushLime', 0.55], ['rockLight', 0.45]],
  desert: [['bushDry', 0.45], ['rockRed', 0.55]],
};
/** The old single-kind tree names map onto biomes. */
const KIND_BIOME = { pine: 'forest', round: 'meadow', palm: 'coast', cactus: 'desert' };

function pick(table, r) {
  let acc = 0;
  for (const [name, w] of table) { acc += w; if (r < acc) return name; }
  return table[table.length - 1][0];
}

/**
 * Plant vegetation into `g`. positions: [x, z, scale, rotation, groundY].
 * `biome` is a key of TREES/UNDER (or an old tree kind: pine, round, palm, cactus).
 * `layer` 'trees' or 'under' (bushes and boulders).
 */
export function addVegetation(g, biome, positions, highQ, layer = 'trees') {
  biome = KIND_BIOME[biome] || biome;
  const table = (layer === 'under' ? UNDER : TREES)[biome];
  if (!table || !positions.length) return;
  const groups = new Map();
  for (const p of positions) {
    const name = pick(table, hash(p[0], p[1], layer === 'under' ? 5 : 1));
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(p);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const [name, list] of groups) {
    const mesh = new THREE.InstancedMesh(species(name), material(), list.length);
    list.forEach(([x, z, sc, rot, y = 0], i) => {
      q.setFromAxisAngle(up, rot);
      const squash = layer === 'under' ? 0.8 + hash(x, z, 9) * 0.5 : 1;
      m.compose(v.set(x, y - 0.25 * sc, z), q, s.set(sc, sc * squash, sc));
      mesh.setMatrixAt(i, m);
      const l = 0.9 + hash(x, z, 3) * 0.2;
      mesh.setColorAt(i, col.setRGB(l, l, l * (0.96 + hash(z, x, 4) * 0.08)));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = highQ && layer === 'trees';
    mesh.receiveShadow = layer === 'under';
    g.add(mesh);
  }
}

/**
 * The same plants as addVegetation, baked into one mesh: one draw call for everything in
 * `parts` ([[biome, positions, layer], ...]) instead of one per species and layer. Used for
 * the open world's terrain chunks, where instancing per species meant a few hundred calls.
 */
export function vegetationMesh(parts, highQ) {
  const items = [];
  for (const [biomeIn, positions, layer] of parts) {
    const biome = KIND_BIOME[biomeIn] || biomeIn;
    const table = (layer === 'under' ? UNDER : TREES)[biome];
    if (!table) continue;
    for (const p of positions) items.push([species(pick(table, hash(p[0], p[1], layer === 'under' ? 5 : 1))), p, layer]);
  }
  if (!items.length) return null;
  let n = 0;
  for (const [g] of items) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let o = 0;
  for (const [g, [x, z, sc, rot, y = 0], layer] of items) {
    q.setFromAxisAngle(up, rot);
    const squash = layer === 'under' ? 0.8 + hash(x, z, 9) * 0.5 : 1;
    m.compose(v.set(x, y - 0.25 * sc, z), q, sc3.set(sc, sc * squash, sc));
    nm.getNormalMatrix(m);
    const l = 0.9 + hash(x, z, 3) * 0.2, lb = l * (0.96 + hash(z, x, 4) * 0.08);   // the same per-plant shade as the instanced version
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    for (let i = 0; i < P.count; i++, o++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
      col[o * 3] = C.getX(i) * l; col[o * 3 + 1] = C.getY(i) * l; col[o * 3 + 2] = C.getZ(i) * lb;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material());
  mesh.castShadow = highQ;
  return mesh;
}

/** Backwards-compatible entry point: trees of one kind or biome. */
export function addTrees(g, kind, positions, highQ) { addVegetation(g, kind, positions, highQ, 'trees'); }

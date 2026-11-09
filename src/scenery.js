import * as THREE from 'three';
import { addVegetation } from './nature.js';
import { mergeByMaterial } from './carkit.js';
import { addBandAttributes, bandMaterial, bandColors, loopCycle } from './bands.js';

// Deterministic pseudo-random so the scenery is the same every time.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function buildScenery(track, quality = 'high') {
  const g = new THREE.Group();
  const th = track.theme;
  const rand = mulberry32(track.def.id.length * 7919 + track.count);
  const highQ = quality !== 'low';
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);

  // Terrain: a height-mapped ground that hugs the road and rolls away from it, in flat
  // colour with light and dark bands across the track near the road (see bands.js)
  const terrainSize = extent + 1100;
  const cellsN = Math.min(highQ ? 420 : 300, Math.round(terrainSize / (highQ ? 9 : 14)));
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, cellsN, cellsN);
  terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i) + cx, z = tp.getZ(i) + cz;
    tp.setY(i, track.terrainHeight(x, z));
  }
  terrainGeo.computeVertexNormals();
  const cycle = track.open ? 48 : loopCycle(track.length);
  addBandAttributes(terrainGeo, (x, z) => { const n = track.nearestGlobal(x, z); return { s: n.idx * track.spacing, dist: n.dist, cycle }; }, cx, cz);
  const terrain = new THREE.Mesh(terrainGeo, bandMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }), { colors: bandColors(th.ground) }));
  terrain.position.set(cx, 0, cz);
  terrain.receiveShadow = true;
  g.add(terrain);
  // Far ground so the horizon never shows the void
  const far = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(cx, Math.min(0, track.minHeight) - (th.hills || 8) - 6, cz);
  g.add(far);
  const hAt = (x, z) => track.terrainHeight(x, z);

  // Water for coastal
  if (th.water !== null) {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 1400),
      new THREE.MeshStandardMaterial({ color: th.water, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.92 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, track.seaLevel, b.maxZ + 780);
    g.add(water);
  }

  const farFromTrack = (x, z, margin) => track.nearestGlobal(x, z).dist > margin;

  // Trees, bushes and boulders: scattered over the land, plus a band along the
  // roadside where they frame the view
  if (th.biome) {
    const area = (extent + 500) * (extent + 500) / (1500 * 1500);
    const count = Math.round(Math.min(1600, Math.max(200, (highQ ? 420 : 160) * area)));
    const ok = (x, z, margin) => farFromTrack(x, z, margin) && !(th.water !== null && z > b.maxZ + 60);
    const positions = [];
    let tries = 0;
    while (positions.length < count && tries < count * 20) {
      tries++;
      const x = cx + (rand() - 0.5) * (extent + 500);
      const z = cz + (rand() - 0.5) * (extent + 500);
      if (!ok(x, z, track.wallOffset + 7 + rand() * 12)) continue;
      positions.push([x, z, 0.8 + rand() * 0.6, rand() * Math.PI * 2, hAt(x, z)]);
    }
    // roadside: every few metres pick a side and plant just beyond the wall
    const roadside = [], under = [];
    const every = highQ ? 9 : 16;
    for (let i = 0; i < track.count; i += every) {
      const s = track.samples[i];
      for (const sd of [-1, 1]) {
        const r = rand();
        const tree = r < 0.36;
        if (!tree && r > 0.7) continue;
        // trees stand clear of the wall (crowns may lean over it); bushes and rocks can sit right behind it
        const off = s.wall + (tree ? 6.5 : 2.5) + rand() * 9;
        const x = s.p.x + s.n.x * sd * off, z = s.p.z + s.n.z * sd * off;
        const near = track.nearestGlobal(x, z);
        const wall = track.samples[near.idx]?.wall ?? track.wallOffset;
        if (near.dist < wall + (tree ? 5.5 : 1.8)) continue;   // too close to another part of the track
        if (th.water !== null && z > b.maxZ + 60) continue;
        (tree ? roadside : under).push([x, z, (tree ? 0.85 : 0.8) + rand() * (tree ? 0.55 : 0.9), rand() * Math.PI * 2, hAt(x, z)]);
      }
    }
    addVegetation(g, th.biome, positions.concat(roadside), highQ, 'trees');
    addVegetation(g, th.biome, under, highQ, 'under');
  }

  // Buildings for city theme
  if (th.buildings) {
    const boxes = [];
    let tries = 0;
    while (boxes.length < Math.round(Math.min(400, (highQ ? 140 : 60) * Math.max(1, (extent + 500) * (extent + 500) / (1500 * 1500)))) && tries < 6000) {
      tries++;
      const x = cx + (rand() - 0.5) * (extent + 420);
      const z = cz + (rand() - 0.5) * (extent + 420);
      const w = 14 + rand() * 22, d = 14 + rand() * 22;
      if (!farFromTrack(x, z, track.wallOffset + Math.max(w, d) * 0.75 + 4)) continue;
      if (boxes.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 3 && Math.abs(o.z - z) < (o.d + d) / 2 + 3)) continue;
      boxes.push({ x, z, w, d, h: 18 + rand() * 90, hue: rand(), y: hAt(x, z) });
    }
    addBuildings(g, boxes, rand);
    addStreetLights(g, track, highQ);
  }

  // Grandstand near start line
  const s0 = track.samples[0];
  const stand = buildGrandstand(th, rand);
  const side = -1; // right side of the track
  stand.position.set(s0.p.x + s0.n.x * side * (s0.wall + 12), s0.p.y - 0.3, s0.p.z + s0.n.z * side * (s0.wall + 12));
  stand.rotation.y = s0.heading + Math.PI / 2 * side;
  g.add(stand);

  // Sponsor boards scattered along the outside
  const boardMat = new THREE.MeshStandardMaterial({ map: makeBoardTexture(rand), roughness: 0.7 });
  const boardGeo = new THREE.BoxGeometry(10, 2.2, 0.3);
  for (let i = 0; i < track.count; i += Math.floor(track.count / 14)) {
    const s = track.samples[i];
    const sd = rand() > 0.5 ? 1 : -1;
    const m = new THREE.Mesh(boardGeo, boardMat);
    m.position.set(s.p.x + s.n.x * sd * (s.wall + 4), s.p.y + 1.0, s.p.z + s.n.z * sd * (s.wall + 4));
    m.rotation.y = s.heading;
    m.castShadow = highQ;
    g.add(m);
  }

  return g;
}

const NEON = [0xff2d95, 0x00e5ff, 0xb46bff, 0xff8a00, 0x39ff88];

/**
 * Night towers: dark blue-violet blocks with bright windows in three palettes, neon strips
 * round the roof line and up a corner, and neon signs. The strips and signs skip tone
 * mapping so they stay vivid, and are merged into one mesh per colour.
 */
function addBuildings(g, boxes, rand) {
  const winTex = [makeWindowTexture('warm'), makeWindowTexture('cool'), makeWindowTexture('mixed')];
  for (const t of winTex) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const neonMats = NEON.map(c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  const glowHolder = new THREE.Group();
  const strip = (w, h, d, x, y, z, ci) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), neonMats[ci]); m.position.set(x, y, z); glowHolder.add(m); };
  for (const bx of boxes) {
    const tex = winTex[Math.floor(rand() * winTex.length)].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(bx.w / 4)), Math.max(1, Math.round(bx.h / 4)));
    const c = new THREE.Color().setHSL(0.64 + bx.hue * 0.1, 0.45, 0.07 + rand() * 0.05);
    const mat = new THREE.MeshStandardMaterial({ color: c, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.45, metalness: 0.25 });
    const y0 = bx.y || 0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bx.w, bx.h + 4, bx.d), mat);
    m.position.set(bx.x, y0 + bx.h / 2 - 2, bx.z);
    g.add(m);
    const ci = Math.floor(rand() * NEON.length), top = y0 + bx.h + 2;
    if (rand() < 0.6) {   // neon outline round the roof
      const t = 0.35;
      strip(bx.w + t, t, t, bx.x, top, bx.z + bx.d / 2, ci);
      strip(bx.w + t, t, t, bx.x, top, bx.z - bx.d / 2, ci);
      strip(t, t, bx.d + t, bx.x + bx.w / 2, top, bx.z, ci);
      strip(t, t, bx.d + t, bx.x - bx.w / 2, top, bx.z, ci);
    }
    if (rand() < 0.3) {   // a strip up one corner
      const sx = rand() < 0.5 ? 1 : -1, sz = rand() < 0.5 ? 1 : -1;
      strip(0.3, bx.h + 2, 0.3, bx.x + sx * bx.w / 2, y0 + bx.h / 2, bx.z + sz * bx.d / 2, ci);
    }
    if (rand() < 0.55) {  // a sign on a face
      const face = Math.floor(rand() * 4), along = face < 2 ? bx.w : bx.d;
      const sw = along * (0.35 + rand() * 0.3), sh = 1.4 + rand() * 1.6, sy = y0 + bx.h * (0.35 + rand() * 0.5);
      const off = (face < 2 ? bx.d : bx.w) / 2 + 0.3, sgn = face % 2 ? -1 : 1;
      if (face < 2) strip(sw, sh, 0.3, bx.x, sy, bx.z + sgn * off, (ci + 1) % NEON.length);
      else strip(0.3, sh, sw, bx.x + sgn * off, sy, bx.z, (ci + 1) % NEON.length);
    }
  }
  mergeByMaterial(glowHolder);
  glowHolder.traverse(o => { if (o.isMesh) o.castShadow = false; });
  g.add(glowHolder);
}

/** Soft round glow sprite (white core fading out) for lamp halos and light pools. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Street lamps on arms over the road, each with a glowing head, a soft halo and a pool of
 * light on the tarmac (additive decals, so the road reads without dozens of real lights).
 */
function addStreetLights(g, track, highQ) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.5, metalness: 0.4 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false });
  const glowTex = glowTexture();
  const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc46b, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const holder = new THREE.Group();
  const pools = [];
  const step = 16;
  for (let i = 0; i < track.count; i += step) {
    const s = track.samples[i];
    const sd = (Math.floor(i / step) % 2) ? 1 : -1;
    const bx = s.p.x + s.n.x * sd * (s.wall + 1.2), bz = s.p.z + s.n.z * sd * (s.wall + 1.2), y = s.p.y;
    const reach = Math.min(5, s.wall * 0.4);   // arm reaches out over the road
    const hx = bx - s.n.x * sd * reach, hz = bz - s.n.z * sd * reach;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 8, 6), poleMat); pole.position.set(bx, y + 4, bz); holder.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, reach), poleMat);
    arm.position.set((bx + hx) / 2, y + 7.9, (bz + hz) / 2); arm.lookAt(hx, y + 7.9, hz); holder.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.45), headMat);
    head.position.set(hx, y + 7.75, hz); head.rotation.y = s.heading + Math.PI / 2; holder.add(head);
    const halo = new THREE.Sprite(haloMat); halo.position.set(hx, y + 7.6, hz); halo.scale.set(5, 5, 1); g.add(halo);
    pools.push([hx, y + 0.17, hz]);
    if (highQ && (Math.floor(i / step) % 4 === 0)) {
      const pl = new THREE.PointLight(0xffc46b, 70, 40, 2);
      pl.position.set(hx, y + 7, hz);
      g.add(pl);
    }
  }
  mergeByMaterial(holder);
  g.add(holder);
  // light pools: one mesh of flat quads
  const R = 11, pos = [], uv = [], idx = [];
  pools.forEach(([x, y, z], k) => {
    pos.push(x - R, y, z - R, x + R, y, z - R, x + R, y, z + R, x - R, y, z + R);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    const o = k * 4; idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  pg.setIndex(idx);
  const pool = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: glowTex, color: 0xc08a48, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  pool.renderOrder = 1;
  g.add(pool);
}

function buildGrandstand(th, rand) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 14), new THREE.MeshStandardMaterial({ color: 0x777c88 }));
  base.position.y = 0.5; g.add(base);
  const seatColors = [0xff5a1f, 0x2f7bff, 0xffd23f, 0x3ddc84];
  for (let r = 0; r < 6; r++) {
    const row = new THREE.Mesh(new THREE.BoxGeometry(60, 1.2, 2.2), new THREE.MeshStandardMaterial({ color: seatColors[r % seatColors.length] }));
    row.position.set(0, 1.6 + r * 1.1, -2 + r * 2.1);
    g.add(row);
    // crowd dots
    const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 5, 5), new THREE.MeshStandardMaterial({ color: 0xffffff }), 40);
    const m = new THREE.Matrix4(); const c = new THREE.Color();
    for (let i = 0; i < 40; i++) {
      m.makeTranslation(-29 + i * 1.5 + rand() * 0.5, 2.6 + r * 1.1, -2 + r * 2.1);
      crowd.setMatrixAt(i, m);
      c.setHSL(rand(), 0.7, 0.55); crowd.setColorAt(i, c);
    }
    g.add(crowd);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(62, 0.6, 18), new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide }));
  roof.position.set(0, 10, 4); roof.rotation.x = 0.15; g.add(roof);
  for (const x of [-28, 0, 28]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 10, 6), new THREE.MeshStandardMaterial({ color: 0x8a8f99 }));
    post.position.set(x, 5, 12); g.add(post);
  }
  return g;
}

/** Lit windows on a dark facade; palette 'warm', 'cool' or 'mixed'. */
function makeWindowTexture(palette = 'warm') {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 32, 32);
  const pick = () => {
    const r = Math.random();
    if (palette === 'warm') return `rgb(255,${190 + Math.random() * 60 | 0},${110 + Math.random() * 80 | 0})`;
    if (palette === 'cool') return r < 0.8 ? `rgb(${170 + Math.random() * 60 | 0},${225 + Math.random() * 30 | 0},255)` : 'rgb(255,240,210)';
    return r < 0.5 ? 'rgb(255,214,150)' : r < 0.75 ? 'rgb(140,230,255)' : r < 0.9 ? 'rgb(255,120,200)' : 'rgb(200,160,255)';
  };
  for (let y = 0; y < 32; y += 8) for (let x = 0; x < 32; x += 8) {
    if (Math.random() < 0.5) { ctx.fillStyle = pick(); ctx.fillRect(x + 2, y + 2, 4, 4); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBoardTexture(rand) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 112;
  const ctx = c.getContext('2d');
  const names = ['TURBO TOUR', 'OCTANE OIL', 'NITRO TYRES', 'VELOCITA', 'GRIP&GO', 'PIT STOP CAFE'];
  const colors = ['#ff5a1f', '#2f7bff', '#3ddc84', '#ffd23f', '#b04cff', '#ffffff'];
  const i = Math.floor(rand() * names.length);
  ctx.fillStyle = '#14161c'; ctx.fillRect(0, 0, 512, 112);
  ctx.fillStyle = colors[i]; ctx.fillRect(0, 0, 512, 12); ctx.fillRect(0, 100, 512, 12);
  ctx.font = 'italic 900 56px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = colors[i]; ctx.fillText(names[i], 256, 56);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

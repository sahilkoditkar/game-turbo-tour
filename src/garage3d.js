// The inside of a garage, drawn in 3D behind the garage menus: the car on a turntable in a
// room themed per venue. The camera and the room stay put; dragging turns the turntable
// (and the car on it), the wheel or a pinch zooms a little. Turbo Motors is a night-time
// glass showroom looking out over Turbo City, Festival HQ the festival's own garage, a
// tuning shop a workshop with tyre stacks and a lift.
import * as THREE from 'three';
import { buildCarMesh, disposeCarMesh } from './carmodels.js';
import { releaseShadowTextures } from './scenekit.js';

const THEMES = {
  dealer: {   // night showroom: glossy dark floor, cool white light, the city through the glass
    bg: 0x0a1020, fog: [26, 70], floor: 0x111827, floorRough: 0.28, floorMetal: 0.65, disc: 0x1e293b, accent: 0x38bdf8,
    hemi: [0xbfd7ff, 0x0f172a, 1.35], key: 2.6, rimColor: 0x38bdf8, rim: 1.8, exposure: 1.05, envBg: 0x26334a,
  },
  hq: {       // the festival garage: dark polished concrete, orange festival light
    bg: 0x0b0d12, fog: [18, 46], floor: 0x14161c, floorRough: 0.35, floorMetal: 0.5, disc: 0x1f2230, accent: 0xff5a1f,
    hemi: [0x8ab4ff, 0x1a1c24, 1.4], key: 2.6, rimColor: 0xff5a1f, rim: 2.2, exposure: 1.05, envBg: 0x2a3140,
  },
  tuning: {   // workshop: warm amber work lights, oily floor
    bg: 0x17130f, fog: [16, 42], floor: 0x231e19, floorRough: 0.55, floorMetal: 0.3, disc: 0x2c2620, accent: 0xf97316,
    hemi: [0xffd9b0, 0x1c1814, 1.3], key: 2.4, rimColor: 0xf97316, rim: 1.8, exposure: 1.05, envBg: 0x3a3028,
  },
};

// The camera's fixed bearing and how far it may tilt / zoom: the rooms are built to fill this view.
const YAW = 0.32, PITCH = [0.06, 0.5], DIST = [7.5, 13];

export class GarageStage {
  /**
   * @param {THREE.WebGLRenderer} renderer the game's renderer (shared; this only draws with it)
   * @param {'dealer'|'hq'|'tuning'} type which room to build
   */
  constructor(renderer, type = 'hq') {
    this.renderer = renderer;
    this.type = THEMES[type] ? type : 'hq';
    const T = this.theme = THEMES[this.type];
    this.owned = [];   // geometries / materials / textures this stage made (car meshes are not: they share templates)
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(T.bg);
    scene.fog = new THREE.Fog(T.bg, T.fog[0], T.fog[1]);
    scene.add(new THREE.HemisphereLight(...T.hemi));
    const key = new THREE.DirectionalLight(0xffffff, T.key);
    key.position.set(4, 11, 7); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 40 });
    key.shadow.bias = -0.0004;
    scene.add(key);
    // the rim light sits low, straight behind the car from the camera, so its glare on the glossy floor lands behind the turntable
    const rim = new THREE.DirectionalLight(T.rimColor, T.rim); rim.position.set(-Math.sin(YAW) * 12, 1.6, -Math.cos(YAW) * 12); scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.6); fill.position.set(6, 2, 3); scene.add(fill);

    // the floor takes only a little of the reflection map: at full strength its light panels show as glare blobs
    const floor = this._mesh(new THREE.CircleGeometry(60, 72), this._mat({ color: T.floor, roughness: T.floorRough, metalness: T.floorMetal, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    // the turntable: a low disc with a glowing ring in the venue's colour; the car rides on it
    this.table = new THREE.Group();
    const disc = this._mesh(new THREE.CylinderGeometry(3.7, 3.9, 0.14, 64), this._mat({ color: T.disc, roughness: 0.25, metalness: 0.6 }));
    disc.position.y = 0.07; disc.receiveShadow = true;
    this.table.add(disc);
    // a few marks on the disc so you can see it turn
    const mark = this._mat({ color: T.accent, emissive: T.accent, emissiveIntensity: 0.9 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, m = this._mesh(new THREE.BoxGeometry(0.06, 0.02, 0.36), mark);
      m.position.set(Math.cos(a) * 3.45, 0.145, Math.sin(a) * 3.45); m.rotation.y = -a + Math.PI / 2;
      this.table.add(m);
    }
    const ring = this._mesh(new THREE.TorusGeometry(3.8, 0.045, 8, 96), this._mat({ color: T.accent, emissive: T.accent, emissiveIntensity: 2.2 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; scene.add(ring);
    this.pivot = new THREE.Group(); this.pivot.position.y = 0.14;
    this.table.add(this.pivot);
    scene.add(this.table);
    this['_room_' + this.type](scene, T);

    // reflections for the paint: a soft room with a few light panels
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 16, 8), new THREE.MeshBasicMaterial({ color: T.envBg, side: THREE.BackSide })));
    for (const [x, y, z] of [[10, 12, 6], [-8, 10, -6], [0, 14, -10], [12, 3, -8]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      l.position.set(x, y, z); l.lookAt(0, 0, 0); env.add(l);
    }
    const g = new THREE.Mesh(new THREE.CircleGeometry(30, 16), new THREE.MeshBasicMaterial({ color: 0x1a1c20 })); g.rotation.x = -Math.PI / 2; g.position.y = -1; env.add(g);
    this.envRT = pm.fromScene(env, 0.03);   // a render target: free it with dispose() on the target, not its texture
    this.envTex = this.envRT.texture;
    scene.environment = this.envTex;
    env.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    pm.dispose();

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    this.pitch = 0.2; this.dist = 11.5;
    this.spin = 0.9;           // the turntable's angle
    this.vel = 0;              // its spin speed after you let go (rad/s)
    this.idle = 0;             // seconds since you last touched it: it starts turning by itself again
    this.inset = { left: 0, bottom: 0 };
    this.meshes = new Map();   // `${shape}:${color}` -> car mesh, reused when you flick back
    this.current = null; this.pop = 1;
    this._bind();
    this.resize();
  }

  _mat(o) { const m = new THREE.MeshStandardMaterial(o); this.owned.push(m); return m; }
  _mesh(geo, mat) { this.owned.push(geo); return new THREE.Mesh(geo, mat); }
  _box(w, h, d, mat, x, y, z, parent = this.scene) { const m = this._mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
  _tex(canvas) { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.owned.push(t); return t; }

  /** A box room: back wall and two side walls, so the fixed camera never looks out into nothing. */
  _walls(mat, { back = -14, side = 21, front = 8, h = 12 } = {}) {
    this._box(side * 2, h, 0.4, mat, 0, h / 2, back);
    for (const sx of [-side, side]) this._box(0.4, h, front - back, mat, sx, h / 2, (back + front) / 2);
    this._box(side * 2, 0.4, front - back, mat, 0, h, (back + front) / 2);   // ceiling
  }

  /** Turbo Motors: a dark showroom with a wall of glass onto Turbo City at night and the brand sign above. */
  _room_dealer(scene, T) {
    // the city through the glass: a painted skyline, unaffected by the room's fog
    const c = document.createElement('canvas'); c.width = 2048; c.height = 512;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, '#050914'); sky.addColorStop(0.7, '#13234a'); sky.addColorStop(1, '#2a3f73');
    x.fillStyle = sky; x.fillRect(0, 0, 2048, 512);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [layer, base, alpha] of [[0, 200, 0.55], [1, 120, 1]]) {
      for (let bx = -20; bx < 2048;) {
        const w = 40 + rnd() * 110, h = base + rnd() * (layer ? 240 : 180);
        x.fillStyle = layer ? '#0b1224' : '#16213d'; x.globalAlpha = 1; x.fillRect(bx, 512 - h, w, h);
        x.globalAlpha = alpha;
        for (let wy = 512 - h + 10; wy < 500; wy += 14) for (let wx = bx + 6; wx < bx + w - 8; wx += 11) {
          if (rnd() < 0.42) { x.fillStyle = rnd() < 0.8 ? '#ffd58a' : '#7dd3fc'; x.fillRect(wx, wy, 5, 7); }
        }
        x.globalAlpha = 1;
        bx += w + 4 + rnd() * 18;
      }
    }
    const city = new THREE.Mesh(new THREE.PlaneGeometry(110, 27.5), new THREE.MeshBasicMaterial({ map: this._tex(c), fog: false }));
    this.owned.push(city.geometry, city.material);
    city.position.set(-4, 11, -34); scene.add(city);
    // the glass wall: tinted panes between slim dark mullions, then the room around it
    const glass = this._mat({ color: 0x9fd8ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.12, depthWrite: false });
    const frame = this._mat({ color: 0x0f172a, roughness: 0.35, metalness: 0.8 });
    const wall = this._mat({ color: 0x141c2c, roughness: 0.7, metalness: 0.2 });
    for (let i = -6; i <= 6; i++) {
      this._box(0.22, 10, 0.22, frame, i * 3.6, 5, -14);
      if (i < 6) this._box(3.4, 10, 0.05, glass, i * 3.6 + 1.8, 5, -14);
    }
    this._box(48, 0.5, 0.5, frame, 0, 10.2, -14);
    this._box(48, 0.3, 0.5, frame, 0, 0.15, -14);
    for (const sx of [-22, 22]) this._box(0.4, 12, 24, wall, sx, 6, -2);
    this._box(44, 1.4, 0.4, wall, 0, 11.3, -14);
    this._box(44, 0.4, 24, wall, 0, 12, -2);
    // the sign over the glass
    const s = document.createElement('canvas'); s.width = 1024; s.height = 128;
    const sx2 = s.getContext('2d');
    sx2.fillStyle = '#0b1224'; sx2.fillRect(0, 0, 1024, 128);
    sx2.font = 'italic 900 84px Segoe UI, Roboto, Helvetica, Arial, sans-serif'; sx2.textAlign = 'center'; sx2.textBaseline = 'middle';
    sx2.shadowColor = '#38bdf8'; sx2.shadowBlur = 24; sx2.fillStyle = '#e0f2fe'; sx2.fillText('TURBO MOTORS', 512, 68);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.25), new THREE.MeshBasicMaterial({ map: this._tex(s) }));
    this.owned.push(sign.geometry, sign.material);
    sign.position.set(-2, 11.3, -13.75); scene.add(sign);
    // light strips in the ceiling and a cyan line along the foot of the glass
    const light = this._mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.8 });
    for (let i = -3; i <= 3; i++) this._box(0.35, 0.06, 14, light, i * 3, 11.75, -2);
    const strip = this._mat({ color: T.accent, emissive: T.accent, emissiveIntensity: 2 });
    this._box(44, 0.06, 0.12, strip, 0, 0.32, -13.6);
  }

  /** Festival HQ: a big shed with roller doors, light bars overhead and the festival colours. */
  _room_hq(scene, T) {
    const wall = this._mat({ color: 0x1b1f29, roughness: 0.8, metalness: 0.2 });
    const door = this._mat({ color: 0x2a303d, roughness: 0.6, metalness: 0.5 });
    const light = this._mat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 });
    const orange = this._mat({ color: T.accent, emissive: T.accent, emissiveIntensity: 1.4 });
    this._walls(wall);
    for (let i = -2; i <= 2; i++) {
      this._box(6.4, 5.2, 0.2, door, i * 8, 2.6, -13.7);
      for (let k = 0; k < 9; k++) this._box(6.4, 0.04, 0.24, wall, i * 8, 0.4 + k * 0.55, -13.6);   // the door's slats
    }
    this._box(30, 0.18, 0.1, orange, 0, 6.2, -13.6);
    for (let i = -3; i <= 3; i++) this._box(0.5, 0.08, 10, light, i * 2.6, 9.5, -2);
    // tool chests along the back wall, well clear of the turntable
    const chest = this._mat({ color: 0xc2410c, roughness: 0.45, metalness: 0.4 });
    for (const x of [-15, -12.6, 12.6, 15]) this._box(2.2, 1.1, 0.9, chest, x, 0.55, -12.8);
  }

  /** Tuning shop: a workshop with a pegboard wall, tyre stacks and a two-post lift in the back bay. */
  _room_tuning(scene, T) {
    const wall = this._mat({ color: 0x2a231c, roughness: 0.9 });
    const steel = this._mat({ color: 0x8b9099, roughness: 0.4, metalness: 0.8 });
    const yellow = this._mat({ color: 0xfacc15, roughness: 0.5, metalness: 0.3 });
    const rubber = this._mat({ color: 0x15161a, roughness: 0.9 });
    const light = this._mat({ color: 0xfff1d6, emissive: 0xfff1d6, emissiveIntensity: 2 });
    this._walls(wall, { back: -13, h: 11 });
    const peg = this._mat({ color: 0x5b4a3a, roughness: 0.9 });
    this._box(9, 3, 0.1, peg, -9, 3.2, -12.7);
    for (let i = 0; i < 9; i++) this._box(0.12, 0.7 + (i % 3) * 0.25, 0.08, steel, -12.6 + i * 0.9, 3 + (i % 2) * 0.4, -12.6);
    // the lift stands in the back bay, behind the turntable
    for (const x of [5, 10]) { this._box(0.45, 4.2, 0.45, yellow, x, 2.1, -10); this._box(0.9, 0.12, 0.9, steel, x, 0.06, -10); }
    this._box(5.45, 0.3, 0.4, yellow, 7.5, 4.2, -10);
    // tyre stacks against the walls
    const tyre = new THREE.TorusGeometry(0.42, 0.2, 10, 24); this.owned.push(tyre);
    for (const [x, z, n] of [[-12, -10, 4], [-13.2, -8.6, 3], [14, -11, 5], [15.2, -9.6, 2]]) {
      for (let k = 0; k < n; k++) { const t = new THREE.Mesh(tyre, rubber); t.rotation.x = Math.PI / 2; t.position.set(x, 0.2 + k * 0.4, z); t.castShadow = true; scene.add(t); }
    }
    for (let i = -2; i <= 2; i++) this._box(0.4, 0.08, 8, light, i * 3, 8.5, -2);
  }

  /** Put this car (shape id, 0xRRGGBB paint) on the turntable. */
  show(shape, color) {
    const key = `${shape}:${color}`;
    if (this.current && this.current.userData.key === key) return;
    let m = this.meshes.get(key);
    if (!m) {
      m = buildCarMesh(shape, color, 'high');
      m.userData.key = key;
      m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.meshes.set(key, m);
    }
    const sameShape = this.current && this.current.userData.key.split(':')[0] === shape;
    if (this.current) this.pivot.remove(this.current);
    this.pivot.add(m);
    this.current = m;
    if (!sameShape) this.pop = 0;   // a new car drops in; a repaint just swaps
  }

  /** Screen space the menus cover, in CSS px: the car is framed in the rest. */
  setInset(left = 0, bottom = 0) { this.inset = { left, bottom }; this.resize(); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    // shift the picture so the car sits in the middle of the uncovered part of the screen
    this.camera.setViewOffset(w, h, -this.inset.left / 2, this.inset.bottom / 2, w, h);
    this.camera.updateProjectionMatrix();
    // keep the whole car in view on tall screens: the field of view is vertical, so a narrow screen needs the camera further back
    this.fit = Math.max(1, 1.45 / (w / h));
  }

  update(dt) {
    if (!this.drag) {
      this.idle += dt;
      // a flick keeps it turning and slows down; after a few quiet seconds it turns slowly by itself
      const auto = this.idle > 3 ? 0.25 * Math.min(1, (this.idle - 3) / 1.5) : 0;
      this.vel += (auto - this.vel) * Math.min(1, dt * (Math.abs(this.vel) > 0.3 ? 1.2 : 2));
      this.spin += this.vel * dt;
    }
    this.table.rotation.y = this.spin;
    this.pop = Math.min(1, this.pop + dt * 3.2);
    const e = 1 - Math.pow(1 - this.pop, 3);
    this.pivot.position.y = 0.14 + (1 - e) * 0.6;
    this.pivot.scale.setScalar(0.94 + 0.06 * e);
    const d = this.dist * this.fit, ty = 0.6;
    this.camera.position.set(Math.sin(YAW) * Math.cos(this.pitch) * d, ty + Math.sin(this.pitch) * d, Math.cos(YAW) * Math.cos(this.pitch) * d);
    this.camera.lookAt(0, ty, 0);
  }

  render() {
    const r = this.renderer, exp = r.toneMappingExposure;
    r.toneMappingExposure = this.theme.exposure;
    r.render(this.scene, this.camera);
    r.toneMappingExposure = exp;
  }

  _bind() {
    const canvas = this.renderer.domElement;
    const pts = new Map();
    let pinch = 0, lastT = 0;
    const down = (e) => {
      if (e.target !== canvas) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      this.drag = true; this.vel = 0; this.idle = 0; lastT = performance.now();
    };
    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        const [a2, b2] = [...pts.values()];
        const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]), d1 = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
        if (pinch && d1 > 0) this.dist = Math.max(DIST[0], Math.min(DIST[1], this.dist * d0 / d1));
        pinch = 1;
        return;
      }
      // sideways turns the turntable; up and down tilts the view a little
      const dx = e.clientX - p[0], now = performance.now(), dts = Math.max(0.008, (now - lastT) / 1000);
      const dSpin = dx * 0.009;
      this.spin += dSpin;
      this.vel = this.vel * 0.6 + (dSpin / dts) * 0.4;   // for the flick when you let go
      lastT = now;
      this.pitch = Math.max(PITCH[0], Math.min(PITCH[1], this.pitch + (e.clientY - p[1]) * 0.004));
      pts.set(e.pointerId, [e.clientX, e.clientY]);
    };
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (!pts.size) {
        this.drag = false; pinch = 0; this.idle = 0;
        if (performance.now() - lastT > 80) this.vel = 0;   // held still before letting go: no flick
        this.vel = Math.max(-6, Math.min(6, this.vel));
      }
    };
    const wheel = (e) => { if (e.target !== canvas) return; this.dist = Math.max(DIST[0], Math.min(DIST[1], this.dist * (1 + e.deltaY * 0.001))); };
    const resize = () => this.resize();
    this.listeners = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['wheel', wheel], ['resize', resize]];
    for (const [ev, fn] of this.listeners) addEventListener(ev, fn, ev === 'wheel' ? { passive: true } : undefined);
  }

  dispose() {
    for (const [ev, fn] of this.listeners) removeEventListener(ev, fn);
    // the key light's 2048x2048 shadow map is a render target of its own: free it with the light
    this.scene.traverse(o => { if (o.isLight) o.dispose(); });
    for (const o of this.owned) o.dispose();
    // every car shown on the turntable has its own paint and number-plate textures
    for (const m of this.meshes.values()) disposeCarMesh(m);
    this.envRT.dispose();
    this.meshes.clear();
    this.scene.clear();
    releaseShadowTextures(this.renderer);
  }
}

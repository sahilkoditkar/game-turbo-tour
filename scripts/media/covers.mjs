// CrazyGames cover images for Turbo Tour: real in-game renders with the TURBO TOUR logo on top.
//
//   node scripts/media/covers.mjs                 render the shots, then compose the three covers
//   node scripts/media/covers.mjs --render-only   only the raw renders (into the work dir)
//   node scripts/media/covers.mjs --compose-only  only the logo pass, from the last raw renders
//   options: --port 8601  --work <dir> (raw renders; default: the OS temp dir)  --only landscape,square
//            --track coastal --car centro --color 0 --seed 7 --at <race s> --samples 16 --debug (to try other shots)
//
// Needs Playwright with Chromium (as the headless tests do) and the Inter font (Black Italic) installed
// for the logo; nothing is installed in the repository. Headless WebGL runs on SwiftShader, so a full run
// takes a few minutes. Outputs: media/covers/{landscape-1920x1080,portrait-800x1200,square-800x800}.{png,jpg}
//
// How a shot is made: a Quick Race against 7 AI cars with the player's car on autopilot (the game's own
// AI driving). The hero car is moved to pole on the grid, the race is stepped forward off-screen with a
// fixed time step until rivals are right behind it (then replayed to that moment, Math.random being
// seeded), the game is paused and the camera placed by hand for each aspect ratio. Each frame is
// rendered at 2x and averaged over a short shutter with the camera locked to the car (motion blur:
// the car stays sharp, the road streaks). The logo is then laid over it in an HTML page and captured.
import { serve, chromium, atMenu, sleep } from '../../tests/helpers.mjs';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);
const PORT = +opt('port', 8601);
const WORK = resolve(opt('work', join(tmpdir(), 'turbo-tour-covers')));
const OUT = join(ROOT, 'media/covers');
const SCALE = 2;   // render at 2x, downscale when composing
const SHUTTER = +opt('shutter', 1 / 90);   // seconds of motion blur
const SAMPLES = +opt('samples', 16);

// ------------------------------------------------------------------ the shot
const SCENE = {
  track: opt('track', 'coastal'),   // Azure Coast: palms, the start gantry, the pack right behind
  car: opt('car', 'centro'),        // Centro GT, the McLaren F1-style hypercar
  colorIndex: +opt('color', 0),   // paint (PLAYER_COLORS): 0 Festival Orange, the game's accent colour
  aiCount: 7,
  debug: flag('debug'),
  difficulty: +opt('difficulty', 0),   // Quick Race AI: 0 easy, 1 medium, 2 hard, 3 dynamic
  minTime: +opt('mintime', 2.5),   // race seconds before looking for a moment
  maxTime: 90,
  at: opt('at') ? +opt('at') : null,   // a fixed race time instead of searching
  want: +opt('want', 6),   // moment score to stop at (rivals behind, max 4, +1 if one is within 14 m, +1 over 40 m/s)
  seed: +opt('seed', 7),   // Math.random is seeded, so the race (and the shot) is reproducible
};

// Camera rigs. The camera stands on the track `ahead` metres in front of the hero car, at `lat`
// (fraction of the half width; + is the left side of the road in the direction of travel), `up` metres
// above the road, and looks at a point given relative to the car (fwd along its heading, left to its left); roll tilts it (degrees).
// shift moves the subject in the frame (fraction of the frame, like a shift lens) without changing perspective.
const COVERS = {
  // the logo: top-left corner of its block at (x, y) in px, font size in px; align 'left' | 'center'.
  // Kept well inside the frame: portals put badges on the corners and the title along the bottom.
  // scrim: a dark gradient behind the logo so it reads on any background.
  landscape: { w: 1920, h: 1080,
    cam: { ahead: 9.5, lat: -0.85, up: 1.7, look: { fwd: 0, left: 0, up: 0.75 }, fov: 27, roll: -4, shift: [0.2, 0.2] },
    logo: { x: 140, y: 120, size: 230, align: 'left' },
    scrim: 'radial-gradient(ellipse 46% 50% at 24% 30%, rgba(10,16,34,.58) 0%, rgba(10,16,34,.36) 50%, rgba(10,16,34,0) 100%)' },
  portrait: { w: 800, h: 1200,
    cam: { ahead: 12, lat: -0.4, up: 2.6, look: { fwd: -2, left: 0, up: 0.75 }, fov: 32, roll: -3, shift: [-0.05, 0.22] },
    logo: { x: 0, y: 170, size: 172, align: 'center' },
    scrim: 'linear-gradient(180deg, rgba(10,16,34,.62) 0%, rgba(10,16,34,.42) 30%, rgba(10,16,34,.12) 44%, rgba(10,16,34,0) 52%)' },
  square: { w: 800, h: 800,
    cam: { ahead: 11, lat: -0.65, up: 2.0, look: { fwd: -1, left: 0, up: 0.75 }, fov: 30, roll: -4, shift: [0.08, 0.18] },
    logo: { x: 0, y: 105, size: 150, align: 'center' },
    scrim: 'radial-gradient(ellipse 62% 40% at 50% 28%, rgba(10,16,34,.6) 0%, rgba(10,16,34,.36) 55%, rgba(10,16,34,0) 100%)' },
};
const ONLY = opt('only', Object.keys(COVERS).join(',')).split(',');

// ------------------------------------------------------------------ render
async function render() {
  mkdirSync(WORK, { recursive: true });
  const srv = await serve(ROOT, PORT);
  const browser = await chromium.launch();
  const first = COVERS[ONLY[0]];
  const page = await browser.newPage({ viewport: { width: first.w, height: first.h }, deviceScaleFactor: SCALE });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  // a deterministic Math.random (mulberry32), so the same race plays out every run
  await page.addInitScript((seed) => {
    let a = seed >>> 0;
    window.__reseed = (v) => { a = v >>> 0; };
    Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }, SCENE.seed);
  // a save that owns every car, high graphics, no sound
  await page.addInitScript((car) => {
    const ids = ['classic', 'raiden', 'muscle', 'hornet', 'rally', 'groupb', 'mamba', 'super', 'kaze', 'fiamma', 'centro', 'formula'];
    localStorage.setItem('turbotour.save.v1', JSON.stringify({
      name: 'You', money: 50000, cars: ids, selected: car, colorIndex: 0, paint: {}, upgrades: {}, series: {},
      stats: { races: 1, wins: 0, podiums: 0, earned: 0 }, bestLaps: {},
      settings: { quality: 'high', volume: 0, sound: false, p1Control: 'wasd', p2Control: 'arrows' },
      horizon: { xp: 0, traps: {}, drifts: {}, zones: {}, boards: [], events: {}, discovered: [], pos: null, stats: { distance: 0 }, guide: 'done' },
    }));
  }, SCENE.car);
  const t0 = Date.now();
  const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
  await page.goto(srv.url);
  await atMenu(page);
  await page.addStyleTag({ content: '#hud-layer, #ui-layer, #touch-controls, #rotate-overlay, #about { display: none !important; }' });
  // Find the moment, then replay the race to it: Math.random is reseeded before each start and the
  // race is stepped with a fixed dt, so the replay is identical to the search run.
  const moment = await page.evaluate((s) => {
    const app = window.app, dt = 1 / 60;
    app.setup = { mode: 'quick', trackId: s.track, laps: 5, aiCount: s.aiCount, difficulty: s.difficulty,
      players: [{ name: 'You', carId: s.car, colorIndex: s.colorIndex, control: 'wasd' }, { name: 'P2', carId: 'hornet', colorIndex: 1, control: 'arrows' }] };
    let r, hero;
    const trace = [];
    const start = () => {
      window.__reseed(s.seed);
      app.startQuickRace('quick');
      app.paused = true;
      window.__reseed(s.seed + 1);   // again: building a race draws a different count the second time (cached models)
      r = app.race; hero = r.players[0];
      hero.autopilot = true; hero.aiSkill = 1.0;
      // pole position: swap the hero with the car at the front of the grid
      const pole = r.cars.reduce((a, c) => (c.progress > a.progress ? c : a), r.cars[0]);
      if (pole !== hero) {
        const a = { x: hero.pos.x, y: hero.pos.y - 0.12, z: hero.pos.z, h: hero.heading, idx: hero.trackIdx, pr: hero.progress };
        hero.place(pole.pos.x, pole.pos.z, pole.heading, pole.pos.y - 0.12); hero.trackIdx = pole.trackIdx; hero.progress = pole.progress;
        pole.place(a.x, a.z, a.h, a.y); pole.trackIdx = a.idx; pole.progress = a.pr;
      }
    };
    // a good moment: the hero leads, settled at speed, with rivals close behind it and nothing between
    // it and the camera (which stands ahead of it on its right-hand side)
    const score = () => {
      const f = hero.forward, lx = f.z, lz = -f.x;
      let behind = 0, close = 0, blocked = 0;
      for (const c of r.cars) {
        if (c === hero) continue;
        const dx = c.pos.x - hero.pos.x, dz = c.pos.z - hero.pos.z;
        const d = dx * f.x + dz * f.z, lat = dx * lx + dz * lz;   // lat > 0: to the hero's left
        if (d < -3 && d > -32 && Math.abs(lat) < 11) { behind++; if (d > -14) close = 1; }
        if (d > 2 && d < 40 && Math.abs(lat) < 14) blocked++;                // ahead of the hero
        if (d >= -6 && d <= 2 && lat < -1.5) blocked++;                      // alongside, on the camera's side
      }
      const calm = Math.abs(hero.pitch) < 0.06 && Math.abs(hero.slide || 0) < 0.4 && !hero.spinTime && !hero.offroad;
      if (s.debug) trace.push([+r.time.toFixed(1), hero.rank, behind, blocked, calm ? 1 : 0, Math.round(hero.speed)].join(' '));
      if (blocked || !calm || hero.speed < 28) return -1;
      return Math.min(behind, 4) + close + (hero.speed > 40 ? 1 : 0);
    };
    let best = { sc: -Infinity, step: 0 };
    if (s.at !== null) best.step = Math.round((s.at + 3.9) / dt);   // the countdown is 3.9 s
    else {
      start();
      for (let step = 1; step * dt < s.maxTime + 3.9; step++) {
        r.update(dt);
        if (r.state !== 'racing' || r.time < s.minTime || step % 6) continue;
        const sc = score();
        if (sc > best.sc) best = { sc, step };
        if (sc >= s.want) break;
      }
    }
    start();
    for (let step = 1; step <= best.step; step++) r.update(dt);
    return { time: +r.time.toFixed(2), score: score(), found: best.sc, trace: s.debug ? trace.filter((_, i) => i % 10 === 0) : undefined, speed: +hero.speed.toFixed(1), rank: hero.rank };
  }, SCENE);
  log('moment:', JSON.stringify(moment));
  for (const name of ONLY) {
    const cv = COVERS[name];
    await page.setViewportSize({ width: cv.w, height: cv.h });
    await sleep(500);
    const info = await page.evaluate(({ c, w, h, shutter, samples }) => {
      const app = window.app, r = app.race, hero = r.players[0], cam = r.cameras[0];
      r.resize();
      // the hero's frame: forward f, left l (the track's normal points left too), up
      const frame = () => { const hd = hero.heading; return { f: [Math.sin(hd), Math.cos(hd)], l: [Math.cos(hd), -Math.sin(hd)] }; };
      const toWorld = (o) => { const { f, l } = frame(); return [hero.pos.x + f[0] * o.fwd + l[0] * o.left, hero.pos.y + o.up, hero.pos.z + f[1] * o.fwd + l[1] * o.left]; };
      // where the camera stands: on the track ahead of the car; then held fixed relative to the car
      const S = r.track.samples, s = S[(hero.trackIdx + Math.round(c.ahead / r.track.spacing)) % S.length];
      const wp = [s.p.x + s.n.x * s.hw * c.lat, s.p.y + c.up, s.p.z + s.n.z * s.hw * c.lat];
      const { f, l } = frame(), dx = wp[0] - hero.pos.x, dz = wp[2] - hero.pos.z;
      const rig = { fwd: dx * f[0] + dz * f[1], left: dx * l[0] + dz * l[1], up: wp[1] - hero.pos.y };
      const aim = () => {
        cam.position.set(...toWorld(rig));
        cam.up.set(0, 1, 0);
        cam.lookAt(...toWorld(c.look));
        cam.rotateZ((c.roll || 0) * Math.PI / 180);   // a little dutch angle
        cam.fov = c.fov; cam.aspect = w / h;
        cam.setViewOffset(w, h, -c.shift[0] * w, -c.shift[1] * h, w, h);   // shift > 0: subject right / down
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      };
      // motion blur: average frames over a short shutter with the camera locked to the car, so the
      // car stays sharp and the world streaks past (a panning shot)
      const gl = app.renderer.domElement, W = gl.width, H = gl.height;
      const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H;
      const ctx = cv2.getContext('2d', { willReadFrequently: true });
      const acc = new Float32Array(W * H * 4);
      for (let k = 0; k < samples; k++) {
        if (k > 0) r.update(shutter / samples);
        aim();
        r.render();
        ctx.drawImage(gl, 0, 0);
        const d = ctx.getImageData(0, 0, W, H).data;
        for (let i = 0; i < d.length; i++) acc[i] += d[i];
      }
      const out = ctx.createImageData(W, H);
      for (let i = 0; i < acc.length; i++) out.data[i] = Math.round(acc[i] / samples);
      ctx.putImageData(out, 0, 0);
      cv2.id = 'cover-shot';
      cv2.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';
      document.getElementById('cover-shot')?.remove();
      document.body.appendChild(cv2);
      return { rig, W, H, speed: hero.speed };
    }, { c: cv.cam, w: cv.w, h: cv.h, shutter: SHUTTER, samples: SAMPLES });
    log(name, JSON.stringify(info));
    const file = join(WORK, `${name}.png`);
    await page.screenshot({ path: file });
    log('rendered', file);
  }
  await browser.close();
  srv.stop();
}

// ------------------------------------------------------------------ compose
async function compose() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const name of ONLY) {
    const cv = COVERS[name];
    const raw = join(WORK, `${name}.png`);
    if (!existsSync(raw)) throw new Error('missing raw render ' + raw + ' (run without --compose-only)');
    const html = join(WORK, `${name}.html`);
    writeFileSync(html, overlayHtml(name, cv, pathToFileURL(raw).href));
    const page = await browser.newPage({ viewport: { width: cv.w, height: cv.h }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(html).href);
    await page.evaluate(() => document.fonts.ready);
    await sleep(200);
    const base = join(OUT, `${name}-${cv.w}x${cv.h}`);
    await page.screenshot({ path: base + '.png' });
    await page.screenshot({ path: base + '.jpg', type: 'jpeg', quality: 92 });
    await page.close();
    console.log('wrote', base + '.png', base + '.jpg');
  }
  await browser.close();
}

function overlayHtml(name, cv, img) {
  const L = cv.logo;
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${cv.w}px; height: ${cv.h}px; overflow: hidden; background: #0b0d12; }
  .shot { position: absolute; inset: 0; width: 100%; height: 100%; filter: saturate(1.12) contrast(1.06); }
  .scrim { position: absolute; inset: 0; background: ${cv.scrim}; }
  .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse 85% 85% at 55% 55%, transparent 60%, rgba(5,6,10,.45) 100%); }
  /* the game's .logo: heavy italic caps, TOUR in the accent colour */
  .logo { position: absolute; left: ${L.x}px; top: ${L.y}px; ${L.align === 'center' ? `width: ${cv.w - 2 * L.x}px; text-align: center;` : ''}
    margin: 0; font: italic 900 ${L.size}px/0.9 Inter, 'Inter Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    letter-spacing: .01em; color: #f4f5f7; text-transform: uppercase;
    text-shadow: ${L.size * 0.012}px ${L.size * 0.03}px 0 rgba(6,8,14,.55), 0 ${L.size * 0.04}px ${L.size * 0.16}px rgba(0,0,0,.6); }
  .logo span { display: block; color: #ff5a1f; text-shadow: ${L.size * 0.012}px ${L.size * 0.03}px 0 rgba(60,14,0,.6), 0 0 ${L.size * 0.3}px rgba(255,90,31,.4), 0 ${L.size * 0.04}px ${L.size * 0.16}px rgba(0,0,0,.5); }
  .logo i { display: block; }
  </style>
  <img class="shot" src="${img}"><div class="vignette"></div><div class="scrim"></div>
  <h1 class="logo"><i>TURBO</i><span>TOUR</span></h1>`;
}

if (!flag('compose-only')) await render();
if (!flag('render-only')) await compose();

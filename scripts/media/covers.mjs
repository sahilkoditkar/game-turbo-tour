// CrazyGames cover images for Turbo Tour: real in-game renders with the TURBO TOUR logo on top.
//
//   node scripts/media/covers.mjs                 render the shots, then compose the three covers
//   node scripts/media/covers.mjs --render-only   only the raw renders (into the work dir)
//   node scripts/media/covers.mjs --compose-only  only the logo pass, from the last raw renders
//   options: --port 8601  --work <dir> (raw renders; default: the OS temp dir)  --only landscape,square
//
// Needs Playwright with Chromium (as the headless tests do) and the Inter font (Black Italic) installed
// for the logo; nothing is installed in the repository. Headless WebGL runs on SwiftShader, so a full run
// takes a few minutes. Outputs: media/covers/{landscape-1920x1080,portrait-800x1200,square-800x800}.{png,jpg}
//
// How a shot is made: a Quick Race (Dynamic AI, which races around the player, so the field stays
// bunched) with the player's car on autopilot. The hero car is moved to pole during the countdown,
// the race is stepped forward off-screen until a few rivals are right behind it, then the game is
// paused and the camera is placed by hand for each aspect ratio and the frame is rendered at 2x.
import { serve, chromium, atMenu, until, sleep } from '../../tests/helpers.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

// ------------------------------------------------------------------ the shot
const SCENE = {
  track: opt('track', 'spa'),
  car: opt('car', 'fiamma'),
  colorIndex: 0,            // Festival Orange (#ff5a1f), the game's accent colour
  aiCount: 7,
  minTime: +opt('mintime', 10),   // race seconds before looking for a moment
  maxTime: 90,
};

// Camera rigs. The camera stands on the track `ahead` metres in front of the hero car, at `lat`
// (fraction of the half width; + is the left side of the road in the direction of travel), `up` metres
// above the road, and looks at a point given relative to the car (fwd along its heading, side to its right).
// shift moves the subject in the frame (fraction of the frame, like a shift lens) without changing perspective.
const COVERS = {
  landscape: { w: 1920, h: 1080, cam: { ahead: 16, lat: -0.75, up: 1.0, look: { fwd: 0, side: 0, up: 0.75 }, fov: 26, shift: [0.18, 0.08] } },
  portrait:  { w: 800, h: 1200, cam: { ahead: 13, lat: -0.7, up: 1.1, look: { fwd: -1, side: 0, up: 0.75 }, fov: 34, shift: [0, 0.18] } },
  square:    { w: 800, h: 800, cam: { ahead: 14, lat: -0.72, up: 1.05, look: { fwd: -0.5, side: 0, up: 0.75 }, fov: 30, shift: [0.05, 0.14] } },
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
  await page.evaluate((s) => {
    window.app.setup = { trackId: s.track, laps: 5, aiCount: s.aiCount, difficulty: 3,
      players: [{ name: 'You', carId: s.car, colorIndex: s.colorIndex, control: 'wasd' }, { name: 'P2', carId: 'hornet', colorIndex: 1, control: 'arrows' }] };
  }, SCENE);
  await page.click('[data-go="quick"]');
  await page.click('[data-start]');
  await until(page, () => window.app.race && window.app.race.cars.length > 0, null, 120_000, 'race built');
  log('race built:', SCENE.track, SCENE.car);
  await page.addStyleTag({ content: '#hud-layer, #ui-layer, #touch-controls, #rotate-overlay, #about { display: none !important; }' });
  // step the race off-screen (much faster than real time under SwiftShader) until rivals are right behind the hero
  const moment = await page.evaluate((s) => {
    const app = window.app, r = app.race, hero = r.players[0];
    app.paused = true;
    hero.autopilot = true; hero.aiSkill = 1.0;
    // pole position: swap the hero with the car at the front of the grid
    const pole = r.cars.reduce((a, c) => (c.progress > a.progress ? c : a), r.cars[0]);
    if (pole !== hero) {
      const a = { x: hero.pos.x, y: hero.pos.y - 0.12, z: hero.pos.z, h: hero.heading, idx: hero.trackIdx, pr: hero.progress };
      hero.place(pole.pos.x, pole.pos.z, pole.heading, pole.pos.y - 0.12); hero.trackIdx = pole.trackIdx; hero.progress = pole.progress;
      pole.place(a.x, a.z, a.h, a.y); pole.trackIdx = a.idx; pole.progress = a.pr;
    }
    const dt = 1 / 60;
    let best = null;
    const score = () => {
      const f = hero.forward, rx = f.z, rz = -f.x;
      let n = 0, near = 0;
      for (const c of r.cars) {
        if (c === hero) continue;
        const dx = c.pos.x - hero.pos.x, dz = c.pos.z - hero.pos.z;
        const d = dx * f.x + dz * f.z, lat = dx * rx + dz * rz;
        if (d < -4 && d > -28 && Math.abs(lat) < 9) { n++; near = Math.max(near, -d < 12 ? 1 : 0); }
        if (d >= -4 && d < 25 && Math.abs(lat) < 9) n -= 2;   // a car beside or ahead would block the view
      }
      // ...and the hero settled on the road at speed (not mid-crash or over a crest)
      const calm = Math.abs(hero.pitch) < 0.03 && Math.abs(hero.slide || 0) < 0.15 && !hero.spinTime;
      return n + near + (hero.offroad ? -5 : 0) + (hero.speed > 30 ? 1 : -3) + (calm ? 0 : -4);
    };
    for (let t = 0; r.time < s.maxTime && t < 6000; t++) {
      r.update(dt);
      if (r.state !== 'racing' || r.time < s.minTime || t % 15) continue;
      const sc = score();
      if (!best || sc > best.sc) best = { sc, t: r.time };
      if (sc >= 4) break;
    }
    return { time: r.time, score: score(), speed: hero.speed, rank: hero.rank };
  }, SCENE);
  log('moment:', JSON.stringify(moment));
  for (const name of ONLY) {
    const cv = COVERS[name];
    await page.setViewportSize({ width: cv.w, height: cv.h });
    await sleep(500);
    await page.evaluate(({ c, w, h }) => {
      const r = window.app.race, hero = r.players[0], cam = r.cameras[0];
      r.resize();
      const hd = hero.heading, fx = Math.sin(hd), fz = Math.cos(hd), rx = Math.cos(hd), rz = -Math.sin(hd);
      const S = r.track.samples, n = S.length;
      const s = S[(hero.trackIdx + Math.round(c.ahead / r.track.spacing)) % n];
      cam.position.set(s.p.x + s.n.x * s.hw * c.lat, s.p.y + c.up, s.p.z + s.n.z * s.hw * c.lat);
      const o = c.look;
      cam.lookAt(hero.pos.x + fx * o.fwd + rx * o.side, hero.pos.y + o.up, hero.pos.z + fz * o.fwd + rz * o.side);
      cam.fov = c.fov; cam.aspect = w / h;
      cam.setViewOffset(w, h, -c.shift[0] * w, -c.shift[1] * h, w, h);   // shift > 0: subject right / down
      cam.updateProjectionMatrix();
    }, { c: cv.cam, w: cv.w, h: cv.h });
    await sleep(2500);   // a few frames at this size so shadows / streaming settle
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
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${cv.w}px; height: ${cv.h}px; overflow: hidden; background: #0b0d12; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; }
  </style><img src="${img}">`;
}

if (!flag('compose-only')) await render();
if (!flag('render-only')) await compose();

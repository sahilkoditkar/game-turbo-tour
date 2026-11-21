// Portrait (2:3) CrazyGames preview video: 1080x1620, H.264, 30 fps, 16.5 s, silent.
//
//   node scripts/media/video-portrait.mjs [framesDir] [--only=race,drift,roam] [--no-encode] [--probe [--every=N]]
//
// Shots (hard cuts): race (Azure Coast pack start, 4 s), drift (Mesa Verde Dash, 4.7 s), roam (Free Roam
// into Turbo City with traffic, 6.3 s, ending on a 1.5 s TURBO TOUR card). --only re-renders some shots and
// re-encodes from the frames already in framesDir; --probe only screenshots every Nth frame and skips encoding.
// Takes ~6-8 minutes (about 0.6 s per frame with SwiftShader).
//
// Real gameplay captured headless. Time is deterministic: an init script replaces performance.now,
// Date.now, requestAnimationFrame and Math.random, so the game only advances when we step it (1/30 s per
// step, under the main.js 0.1 s and race.js / horizon.js 1/20 s dt caps), then each frame is a page
// screenshot (canvas + HUD DOM). The PNGs go to outDir and are encoded with ffmpeg into
// media/video/portrait-1080x1620.mp4. Nothing under src/ is changed; HUD tweaks are injected CSS.
import { serve, chromium } from '../../tests/helpers.mjs';
import { mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const OUT = resolve(args.find((a) => !a.startsWith('--')) || join(tmpdir(), 'turbotour-video-portrait'));
const ORDER = ['race', 'drift', 'roam'];
const ONLY = opt('only', ORDER.join(',')).split(',');
const PROBE = flag('probe');
const PORT = 8603;
const FPS = 30;
const W = 540, H = 810, DSF = 2;           // CSS viewport; rendered and captured at 1080x1620
const VIDEO = join(ROOT, 'media/video/portrait-1080x1620.mp4');

// ---------------------------------------------------------------- save game: all cars, flashy paint, no guide
function profile() {
  const ids = ['classic', 'raiden', 'muscle', 'hornet', 'rally', 'groupb', 'mamba', 'super', 'kaze', 'fiamma', 'centro', 'formula'];
  const up = {}; for (const id of ids) up[id] = { engine: 3, tires: 3, brakes: 3, aero: 3 };
  return {
    name: 'You', money: 48250, cars: ids, selected: 'super', colorIndex: 0, paint: { super: 0 },
    upgrades: up, series: {}, stats: { races: 12, wins: 5, podiums: 9, earned: 52000 }, bestLaps: {},
    settings: { quality: 'high', volume: 0, sound: false, p1Control: 'wasd', p2Control: 'arrows' },
    horizon: { xp: 9200, traps: {}, drifts: {}, zones: {}, boards: [], events: {}, discovered: ['hq', 'dealer'], pos: null, stats: { distance: 120 }, guide: 'done' },
  };
}

// ---------------------------------------------------------------- deterministic clock (runs in the page)
function initScript(save) {
  let t = 1000; const T0 = 1763700000000;
  performance.now = () => t;
  Date.now = () => T0 + t;
  const q = new Map(); let nid = 0;
  window.requestAnimationFrame = (cb) => { q.set(++nid, cb); return nid; };
  window.cancelAnimationFrame = (id) => { q.delete(id); };
  // setTimeout runs on the same clock (the HUD hides "GO!" and toasts with timers)
  const realSetInterval = window.setInterval.bind(window);
  const timers = new Map(); let tid = 0;
  window.setTimeout = (fn, ms = 0, ...a) => { timers.set(++tid, { due: t + (+ms || 0), fn, a }); return tid; };
  window.clearTimeout = (id) => { timers.delete(id); };
  const runTimers = () => {
    for (let guard = 0; guard < 50; guard++) {
      const due = [...timers].filter(([, x]) => x.due <= t).sort((a, b) => a[1].due - b[1].due);
      if (!due.length) return;
      for (const [id, x] of due) { timers.delete(id); try { typeof x.fn === 'function' ? x.fn(...x.a) : 0; } catch (e) { console.error('timer', e && e.stack || e); } }
    }
  };
  window.__auto = true;   // free-running while the game boots; stepped by hand while recording
  window.__tick = (ms) => {
    t += ms;
    runTimers();
    const l = [...q.values()]; q.clear();
    for (const cb of l) { try { cb(t); } catch (e) { console.error('rAF', e && e.stack || e); } }
  };
  window.__steps = (n) => { for (let i = 0; i < n; i++) window.__tick(1000 / 30); };
  realSetInterval(() => { if (window.__auto) window.__tick(1000 / 30); else runTimers(); }, 20);
  let s = 20261121;
  Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.clear(); localStorage.setItem('turbotour.save.v1', save); } catch (e) { /* */ }
}

// HUD: injected CSS only (see report). Empty until the portrait layout has been checked.
const HUD_CSS = `
  .hz-hint, .hz-mapbtn, #touch-ui, .touch-controls { display: none !important; }
`;

async function shoot(page, file) {
  await page.screenshot({ path: file, animations: 'allow', caret: 'hide' });
}
const step = (page, n = 1) => page.evaluate((n) => window.__steps(n), n);
/** Simulate without rendering (fast-forward). */
async function warm(page, n) {
  await page.evaluate((n) => {
    const r = window.app.renderer, orig = r.render;
    r.render = () => {};
    try { window.__steps(n); } finally { r.render = orig; }
  }, n);
}
/** Step and screenshot n frames into dir (PROBE: every 10th frame only). `perFrame(i)` runs in the page before each step. */
async function record(page, dir, n, perFrame) {
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (perFrame) await page.evaluate(perFrame, i);
    await step(page, 1);
    if (!PROBE || i % +opt('every', 10) === 0) await shoot(page, join(dir, `f${String(i).padStart(4, '0')}.png`));
    if (i % 30 === 29) console.log(`  ${i + 1}/${n} (${((Date.now() - t0) / (i + 1) / 1000).toFixed(2)} s/frame)`);
  }
}

async function newPage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, hasTouch: false, isMobile: false });
  await ctx.addInitScript(initScript, JSON.stringify(profile()));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => !!(window.app && document.querySelector('[data-go="quick"]')), null, { timeout: 180000 });
  await page.addStyleTag({ content: HUD_CSS });
  return { ctx, page };
}

// ---------------------------------------------------------------- shots
/** Quick Race straight from app.setup; returns once the race is live (after `afterGo` seconds of racing, fast-forwarded). */
async function startRace(page, { track, ai, car, laps = 3, difficulty = 3, afterGo = 0, skill = 0.95 }) {
  await page.evaluate(({ track, ai, car, laps, difficulty }) => {
    const app = window.app;
    app.setup = { trackId: track, laps, aiCount: ai, difficulty, mode: 'quick',
      players: [{ name: 'You', carId: car, colorIndex: 0, control: 'wasd' }, { name: 'P2', carId: 'hornet', colorIndex: 1, control: 'arrows' }] };
    app.ui.hide();
    app.startQuickRace('quick');
  }, { track, ai, car, laps, difficulty });
  await page.evaluate(() => { window.__auto = false; });
  // countdown (3.9 s) without rendering
  await warm(page, 120);
  await page.evaluate((skill) => { const p = window.app.race.players[0]; p.autopilot = true; p.aiSkill = skill; }, skill);
  if (afterGo > 0) await warm(page, Math.round(afterGo * FPS));
}

const DRIFT_CFG = { start: +opt('dstart', 252), end: +opt('dend', 366), kickAt: +opt('kickat', 250), kickT: +opt('kickt', 0.35), holdK: +opt('holdk', 0.6),
  thr: 0.6, vT: +opt('dvt', 130), outMax: +opt('outmax', 0.42), lead: +opt('lead', 14), kicks: +opt('kicks', 2) };
const ROAM_FRAMES = +opt('roamframes', 189), LOGO_FRAMES = +opt('logoframes', 45);
const SHOTS = {
  // 1. Pack racing: Azure Coast, seven Dynamic AI cars, the player (on autopilot) in the pack just after the start.
  race: { frames: 120, async setup(page) { await startRace(page, { track: opt('track', 'coastal'), ai: 7, car: 'super', afterGo: +opt('after', 0.6), skill: +opt('skill', 0.95), difficulty: +opt('diff', 3) }); } },

  // 2. Drift: Mesa Verde Dash, a handbrake flick into the long right-hander after the first straight,
  //    held on the throttle (steering into the slide, as a player does), then caught and driven out.
  drift: {
    frames: 141,
    async setup(page) {
      await startRace(page, { track: 'desert', ai: 7, car: 'super' });
      await page.evaluate(installDrift, DRIFT_CFG);
      // drive (autopilot) up the straight until shortly before the corner
      await page.evaluate(() => { const r = window.app.renderer, o = r.render; r.render = () => {}; const c = window.app.race.players[0]; let n = 0; while (!(c.lap >= 1 && c.trackIdx >= window.__driftCfg.from && c.trackIdx < window.__driftCfg.end) && n++ < 3000) { window.__driftStep(); window.__steps(1); } r.render = o; });
    },
    perFrame: () => window.__driftStep(),
  },

  // 3. Free Roam: North Gate Rd into Turbo City with ambient traffic (oncoming cars, an overtake, a near miss),
  //    then the TURBO TOUR end card fading in over the still-running game.
  roam: {
    frames: ROAM_FRAMES + LOGO_FRAMES,
    async setup(page) {
      await page.evaluate(installRoam, { road: opt('road', 'st-ns3'), li: +opt('li', 120), dir: 1, vT: +opt('vt', 36) });
      await page.evaluate((n) => { const r = window.app.renderer, o = r.render; r.render = () => {}; for (let i = 0; i < n; i++) { window.__roamStep(); window.__steps(1); } r.render = o; }, Math.round(+opt('roamwarm', 7) * FPS));
      await page.evaluate(installEndCard);
      await page.evaluate((n) => { window.__endCardFrom = n; }, ROAM_FRAMES);
    },
    perFrame: (i) => { window.__roamStep(); window.__endCard(i - window.__endCardFrom); },
  },
};

/** In the page: the end card (logo in the game's own .logo style), faded in frame by frame. */
function installEndCard() {
  const el = document.createElement('div');
  el.id = 'endcard';
  el.innerHTML = '<div class="logo" style="font-size:66px">TURBO <span>TOUR</span></div>'
    + '<div class="tagline" style="margin:18px 0 0;font-size:14px;color:#e6e9ef">Race · Drift · Free Roam</div>'
    + '<div style="margin-top:26px;padding:10px 22px;border-radius:999px;background:var(--accent);color:#fff;font-weight:800;letter-spacing:.12em;font-size:15px">PLAY FREE</div>';
  el.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;'
    + 'background:radial-gradient(ellipse at 50% 46%, rgba(255,90,31,.28), transparent 62%), rgba(8,10,15,.62);backdrop-filter:blur(5px);pointer-events:none';
  document.body.appendChild(el);
  const logo = el.querySelector('.logo');
  window.__endCard = (k) => {
    if (k < 0) return;
    const a = Math.min(1, (k + 1) / 9), e = 1 - Math.pow(1 - a, 3);
    el.style.opacity = String(e);
    logo.style.transform = `scale(${(1.18 - 0.18 * e).toFixed(4)})`;
    document.getElementById('hud-layer').style.opacity = String(1 - e);
  };
}

/** In the page: a drift controller for player 1 (inputs as a player would give them). */
async function installDrift(cfg) {
  const { driveAI } = await import('./src/ai.js');
  const app = window.app, race = app.race, car = race.players[0];
  window.__driftCfg = { ...cfg, from: cfg.kickAt - cfg.lead };
  const orig = app.input.read.bind(app.input);
  app.input.read = (s, p, i) => { const r = orig(s, p, i); return i === 0 && window.__ctl ? { ...r, ...window.__ctl } : r; };
  const D = { phase: 'approach', t: 0, s: 1, kicks: 0 };
  window.__driftStep = () => {
    const tr = race.track, idx = car.trackIdx;
    if (D.phase === 'approach' && idx >= cfg.kickAt && idx < cfg.end) { D.phase = 'kick'; D.t = 0; D.kicks++; D.s = -Math.sign(tr.samples[cfg.start + 10].curv); car.autopilot = false; }
    D.t += 1 / 30;
    if (D.phase === 'done' && D.kicks < cfg.kicks && idx < cfg.end - 40 && D.t > 1.2) {
      const m = tr.samples[idx].hw - Math.abs(tr.lateral(car.pos, idx));
      if (m > 0.55 * tr.samples[idx].hw) { D.phase = 'kick'; D.t = 0; D.kicks++; car.autopilot = false; }
    }
    if (D.phase === 'approach' || D.phase === 'done') { car.autopilot = true; window.__ctl = null; return; }
    driveAI(car, { track: tr, cars: race.cars, live: true, bestPlayerProgress: null, time: race.time, dynamic: race.dynamic }, 1 / 30);
    const ai = { ...car.input };
    if (D.phase === 'kick') {
      window.__ctl = { throttle: cfg.thr, brake: 0, steer: D.s, handbrake: true };
      if (D.t > cfg.kickT) { D.phase = 'hold'; D.t = 0; }
    } else {
      const lat = tr.lateral(car.pos, idx), hw = tr.samples[idx].hw;
      const st = D.s * Math.max(0.3, Math.min(1, cfg.holdK + 0.6 * D.s * ai.steer));
      window.__ctl = { throttle: car.speed > cfg.vT / 3.6 ? 0.25 : 1, brake: 0, steer: st, handbrake: false };
      if (idx >= cfg.end - 8 || D.t > 3.5 || -D.s * lat > cfg.outMax * hw) { D.phase = 'done'; D.t = 0; car.autopilot = true; window.__ctl = null; }
    }
  };
}

/** In the page: start Free Roam on a road and drive it like a player (keyboard-style inputs), passing traffic. */
async function installRoam(cfg) {
  const { snapChaseCamera } = await import('./src/scenekit.js');
  const app = window.app;
  app.startHorizon();
  window.__auto = false;
  const hz = app.horizon, W = hz.world, car = hz.car;
  const road = W.getRoad(cfg.road);
  hz.placeAt(road.i0 + cfg.li);
  if (cfg.dir < 0) { car.place(car.pos.x, car.pos.z, car.heading + Math.PI, car.pos.y); }
  car.vf = cfg.vT;
  snapChaseCamera(hz.camera, car, hz.tmp2);
  const ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const orig = app.input.read.bind(app.input);
  app.input.read = (s, p, i) => { const r = orig(s, p, i); return i === 0 ? { ...r, ...ctl } : r; };
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  let li = cfg.li, laneOff = 0;
  window.__roam = { road: cfg.road };
  window.__roamStep = () => {
    // nearest sample on our road, searched around the last one
    let best = li, bd = Infinity;
    for (let k = -8; k <= 12; k++) { const j = Math.max(0, Math.min(road.n - 1, li + k)), q = W.samples[road.i0 + j].p; const d = (q.x - car.pos.x) ** 2 + (q.z - car.pos.z) ** 2; if (d < bd) { bd = d; best = j; } }
    li = best;
    const v = car.speed, dir = cfg.dir;
    const look = Math.max(10, Math.min(40, 8 + v * 0.55));
    const s = W.samples[road.i0 + Math.max(0, Math.min(road.n - 1, li + dir * Math.round(look / W.spacing)))];
    const hw = road.width / 2;
    // keep right, move out to pass traffic ahead in our lane
    let lane = -dir * hw * 0.32;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = -fz, rz = fx;
    let slow = 0;
    for (const t of hz.traffic.cars) {
      const dx = t.pos.x - car.pos.x, dz = t.pos.z - car.pos.z;
      const fwd = dx * fx + dz * fz, side = dx * rx + dz * rz;
      const own = Math.abs(t.heading - car.heading) < 1.2 || Math.abs(t.heading - car.heading) > 5.1;   // same direction
      if (own && fwd > 0 && fwd < 50 && Math.abs(side - (-laneOff)) < 3.4) lane = dir * hw * 0.22;   // pull out to pass
      if (fwd > 0 && fwd < 12 && Math.abs(side) < 2.4) slow = 1;
    }
    laneOff += (lane - laneOff) * 0.06;
    const tx = s.p.x + s.n.x * laneOff, tz = s.p.z + s.n.z * laneOff;
    const diff = wrapA(Math.atan2(tx - car.pos.x, tz - car.pos.z) - car.heading);
    ctl.steer = Math.max(-1, Math.min(1, -diff * 2.4));
    const curv = W.maxCurvatureAhead(road.i0 + li, 18 + v * 1.4);
    const vT = Math.min(cfg.vT, Math.sqrt(car.stats.grip * 2.6 * 0.8 / Math.max(curv, 0.0004)));
    ctl.throttle = v < vT && !slow ? 1 : 0;
    ctl.brake = v > vT + 2 || slow ? 0.5 : 0;
    window.__roam.li = li;
  };
}

async function runShot(page, name, n) {
  const sh = SHOTS[name];
  await sh.setup(page);
  await record(page, join(OUT, name), n ?? sh.frames, sh.perFrame);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const srv = await serve(ROOT, PORT);
  const browser = await chromium.launch();
  try {
    for (const name of ONLY) {
      if (!SHOTS[name]) continue;
      console.log('shot', name);
      rmSync(join(OUT, name), { recursive: true, force: true });
      const { ctx, page } = await newPage(browser, srv.url);
      await runShot(page, name, opt('frames') ? +opt('frames') : undefined);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  if (!PROBE && !flag('no-encode')) encode();
}

/** Concatenate the shots' PNGs in order and encode the H.264 MP4. */
function encode() {
  const seq = join(OUT, 'seq');
  rmSync(seq, { recursive: true, force: true });
  mkdirSync(seq, { recursive: true });
  let n = 0;
  for (const name of ORDER) {
    const files = readdirSync(join(OUT, name)).filter((f) => f.endsWith('.png')).sort().slice(0, SHOTS[name].frames);
    if (files.length !== SHOTS[name].frames) throw new Error(`${name}: ${files.length} frames, expected ${SHOTS[name].frames}`);
    for (const f of files) symlinkSync(join(OUT, name, f), join(seq, `${String(n++).padStart(5, '0')}.png`));
  }
  mkdirSync(dirname(VIDEO), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(seq, '%05d.png'),
    '-vf', `scale=${W * DSF}:${H * DSF}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '19'),
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-an', VIDEO], { stdio: 'inherit' });
  console.log(`${VIDEO}: ${n} frames, ${(n / FPS).toFixed(2)} s`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

export { DRIFT_CFG, SHOTS, installRoam, installDrift, newPage, startRace, warm, step, shoot, record, serve, chromium, ROOT, PORT };

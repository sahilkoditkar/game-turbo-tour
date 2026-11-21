// Landscape CrazyGames preview video (1920x1080, 30 fps, ~17.5 s) recorded from real gameplay.
//
//   node scripts/media/video-landscape.mjs                 record every shot and encode the mp4
//   node scripts/media/video-landscape.mjs --shots=2,3     re-record only these shots, then encode
//   node scripts/media/video-landscape.mjs --encode        encode from the frames already on disk
//   node scripts/media/video-landscape.mjs --explore=<name> one still per second of a shot's set-up (to pick moments)
//
// Headless WebGL (SwiftShader) is far too slow for real-time capture, so time is made deterministic:
// an init script replaces performance.now / Date.now / requestAnimationFrame / setTimeout and drives
// the Web Animations clock, and the game only advances when step() is called (exactly 1/30 s per
// step). Each step runs the game's own frame (App.frame via setAnimationLoop: update + render), then
// page.screenshot() grabs the canvas together with the HUD DOM. Frames go to a scratch dir and are
// encoded with ffmpeg (libx264, yuv420p, +faststart). The player's car is driven by the game's own
// AI (src/ai.js driveAI) through a patched Input.read; nothing in src/ is changed. Stretches before
// a shot are simulated without rendering ("pre-roll"), which is cheap.
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { serve, chromium } from '../../tests/helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'media', 'video', 'landscape-1920x1080.mp4');
const SCRATCH = process.env.FRAMES_DIR || '/tmp/claude-0/-home-user-game-turbo-tour/a3913eca-563b-5e81-a79e-26b72cd27168/scratchpad/video-landscape';
const PORT = 8602;
const FPS = 30;
const W = 1920, H = 1080;                     // output frame size
// The page is laid out at 1280x720 CSS px and rendered at 1.5x (so frames are 1920x1080): a common laptop
// window, and the HUD stays legible when the preview plays as a small thumbnail.
const DSF = +(process.env.DSF || 1.5);
const XFADE = 0.3;   // seconds of crossfade between shots
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };

// ------------------------------------------------------------------ deterministic clock (page side)
const TIME_SHIM = `(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  const pnow = performance.now.bind(performance), dnow = Date.now.bind(Date);
  let manual = false, vt = 0, dateBase = 0, rafId = 1e6, timerId = 1e6;
  let rafQ = new Map();
  const timers = new Map();       // id -> { at, fn, a, every }
  const anims = new WeakMap();    // Web Animation (CSS animations/transitions) -> virtual start time
  // seeded Math.random so a re-run gives the same AI wobble / traffic choices.
  // Reseeded at the start of every simulated frame from (base, frame number): three.js also draws
  // Math.random while rendering (object UUIDs), so without this a rendered frame and a pre-rolled one
  // would leave the game's random stream in different places and the race would play out differently.
  let seed = 20261121 >>> 0, base = seed, fno = 0;
  const frameSeed = () => { fno++; seed = (Math.imul(base ^ 0x9E3779B9, 0x85EBCA6B) + Math.imul(fno, 0xC2B2AE35)) >>> 0; };
  window.__reseed = (n) => { base = n >>> 0; fno = 0; seed = base; };
  Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  performance.now = () => manual ? vt : pnow();
  Date.now = () => manual ? Math.round(dateBase + vt) : dnow();
  window.requestAnimationFrame = (cb) => { if (!manual) return realRAF(() => cb(performance.now())); const id = ++rafId; rafQ.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { if (rafQ.has(id)) rafQ.delete(id); else realCAF(id); };
  window.setTimeout = (fn, ms = 0, ...a) => { if (!manual) return realST(fn, ms, ...a); const id = ++timerId; timers.set(id, { at: vt + Math.max(0, +ms || 0), fn, a }); return id; };
  window.clearTimeout = (id) => { if (timers.has(id)) timers.delete(id); else realCT(id); };
  window.setInterval = (fn, ms = 0, ...a) => { if (!manual) return realSI(fn, ms, ...a); const id = ++timerId; timers.set(id, { at: vt + Math.max(1, +ms || 0), fn, a, every: Math.max(1, +ms || 0) }); return id; };
  window.clearInterval = (id) => { if (timers.has(id)) timers.delete(id); else realCI(id); };
  function runTimers() {
    for (;;) {
      let best = null;
      for (const [id, t] of timers) if (t.at <= vt && (!best || t.at < best[1].at)) best = [id, t];
      if (!best) return;
      const [id, t] = best;
      if (t.every) t.at += t.every; else timers.delete(id);
      try { typeof t.fn === 'function' ? t.fn(...t.a) : (0, eval)(t.fn); } catch (e) { console.error(e); }
    }
  }
  function syncAnimations() {
    if (!document.getAnimations) return;
    for (const an of document.getAnimations()) {
      // a CSS transition started this frame has had one frame to run by the time it is painted (the HUD's
      // speed bar retargets its transition every frame and would otherwise never leave its start value)
      if (!anims.has(an)) { anims.set(an, vt - (an instanceof CSSTransition ? 1000 / 30 : 0)); try { an.pause(); } catch (e) {} }
      try { an.currentTime = vt - anims.get(an); } catch (e) {}
    }
  }
  window.__clock = {
    freeze() { if (manual) return; vt = pnow(); dateBase = dnow() - vt; manual = true; },
    get now() { return vt; },
    // one frame: advance the clock, fire due timers, run the rAF callbacks (the game's frame)
    step(ms) {
      vt += ms; frameSeed();
      runTimers();
      const q = rafQ; rafQ = new Map();
      for (const cb of q.values()) { try { cb(vt); } catch (e) { console.error(e); } }
      syncAnimations();
    },
    // time and timers only (the game is simulated by hand meanwhile, see __vid.preroll)
    tick(ms) { vt += ms; frameSeed(); runTimers(); syncAnimations(); },
  };
})();`;

// ------------------------------------------------------------------ page-side helpers
const PAGE_HELPERS = `(() => {
  window.__vid = {
    ctl: null,   // { skill, drift, cap (m/s), laneFrac } while the capture drives player 1 (an array per player in split screen)
    async install() {
      const { driveAI } = await import('/src/ai.js');
      const app = window.app, input = app.input, orig = input.read.bind(input);
      // every rendered frame is exactly 1/30 s, the same as a pre-rolled one (so a pre-roll and a recording agree)
      app.clock.getDelta = () => 1 / 30;
      const self = this;
      // Free Roam: follow the road the car is on (the world's sample() would run into the next road)
      const roadTrack = (W, car) => {
        const road = W.roadOf(car.trackIdx);
        return { spacing: W.spacing, sample: (i) => W.samples[W.roadWrap(road, i, true)], maxCurvatureAhead: (i, m) => W.maxCurvatureAhead(i, m) };
      };
      input.read = (scheme, pad, pi = 0) => {
        const r = orig(scheme, pad, pi);
        const c = self.ctl && self.ctl[pi] !== undefined ? self.ctl[pi] : (pi === 0 ? self.ctl : null);
        if (!c) return r;
        let car, ctx;
        if (app.race) {
          car = app.race.players[pi];
          ctx = { track: app.race.track, cars: app.race.cars, live: app.race.state !== 'countdown', bestPlayerProgress: null, time: app.race.time, dynamic: true };
        } else if (app.horizon) {
          const hz = app.horizon; car = hz.car;
          ctx = { track: roadTrack(hz.world, car), cars: [car, ...hz.traffic.cars], live: true, bestPlayerProgress: null, time: hz.time };
        } else return r;
        car.aiSkill = c.skill ?? 0.95;
        if (c.laneBase !== undefined) car.laneBase = c.laneBase;
        // keep right (Free Roam traffic drives on the right: laneFrac < 0, a fraction of the half width), and pull
        // out to overtake slower traffic in our lane when the other lane is clear, like a driver would
        if (c.laneFrac !== undefined && app.horizon) {
          const s = ctx.track.sample(car.trackIdx), hw = s.hw;
          const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
          let blocked = false, oncoming = false;
          for (const t of app.horizon.traffic.cars) {
            const dx = t.pos.x - car.pos.x, dz = t.pos.z - car.pos.z, fwd = dx * fx + dz * fz;
            const lat = (t.pos.x - s.p.x) * s.n.x + (t.pos.z - s.p.z) * s.n.z;
            const own = lat * Math.sign(c.laneFrac) > 0;   // in our half of the road
            if (fwd > 0 && fwd < (c.look || 55) && own && Math.abs(lat - c.laneFrac * hw) < hw * 0.5) blocked = true;
            if (fwd > -8 && fwd < (c.clear || 70) && !own) oncoming = true;
          }
          if (self.lane === undefined) self.lane = c.laneFrac;
          const want = blocked && !oncoming ? -c.laneFrac : c.laneFrac;
          self.lane += Math.sign(want - self.lane) * Math.min(Math.abs(want - self.lane), 1 / 30 * 0.9);
          car.laneBase = 2 * self.lane * hw;
          if (blocked && oncoming) c._slow = true; else c._slow = false;
        }
        if (c.pace !== undefined) car.paceScale = c.pace;
        driveAI(car, ctx, 1 / 30);
        const out = { ...r, throttle: car.input.throttle, brake: car.input.brake, steer: car.input.steer, handbrake: false };
        if (c.cap && car.speed > c.cap) { out.throttle = 0; }
        if (c._slow && car.speed > 15) { out.throttle = 0; out.brake = 0.3; }
        // drift: a dab of handbrake on corner entry, then power through with opposite lock
        if (c.drift && car.speed > (c.driftMin || 22)) {
          const curv = Math.abs(ctx.track.sample(car.trackIdx + 6).curv || 0);
          if (curv > (c.driftCurv || 0.012)) { out.handbrake = car.slide === undefined || Math.abs(car.slide) < (c.driftSlide || 0.35); out.throttle = 1; out.brake = 0; }
        }
        return out;
      };
    },
    live() { return window.app.race || window.app.horizon; },
    // simulate n frames without rendering
    preroll(n) {
      const app = window.app;
      for (let i = 0; i < n; i++) { window.__clock.tick(1000 / 30); const l = this.live(); l.update(1 / 30); app.input.endFrame(); }
    },
  };
})();`;

// ------------------------------------------------------------------ save: every car owned, guides done
function seedSave(selected = 'super', paint = 0) {
  const ids = ['classic', 'raiden', 'muscle', 'hornet', 'rally', 'groupb', 'mamba', 'super', 'kaze', 'fiamma', 'centro', 'formula'];
  const up = {}; for (const id of ids) up[id] = { engine: 4, tires: 4, brakes: 4, aero: 4 };
  return {
    name: 'You', money: 84250, cars: ids, selected, colorIndex: paint, paint: { [selected]: paint },
    upgrades: up, series: {}, stats: { races: 12, wins: 5, podiums: 9, earned: 64000 }, bestLaps: {},
    settings: { quality: 'high', volume: 0.7, sound: false, p1Control: 'wasd', p2Control: 'arrows', touch: { chosen: true } },
    horizon: { xp: 23000, traps: {}, drifts: {}, zones: {}, boards: [], events: {}, discovered: ['hq'], pos: null, stats: { distance: 120 }, guide: 'done' },
  };
}

// ------------------------------------------------------------------ shots
// Each shot: setup(page) builds the scene, `pre` seconds are pre-rolled to the first frame, `frames` are recorded;
// during(page, i) runs before frame i (optional).
// gaps: the Dynamic AI's target time gaps to the player (s, negative = ahead), to keep the pack close
const quickRace = (page, { track, car, color = 0, ai = 7, laps = 3, gaps = null, skill = 1.0, mode = 'quick', drift = false }) => page.evaluate(({ track, car, color, ai, laps, gaps, skill, mode, drift }) => {
  const a = window.app;
  window.__reseed(4242);
  a.disposeHorizon(); a.disposeRace();
  a.setup = { trackId: track, laps, aiCount: ai, difficulty: 3, mode, players: [{ name: 'You', carId: car, colorIndex: color, control: 'wasd' }, { name: 'Player 2', carId: car, colorIndex: 1, control: 'arrows' }] };
  a.startQuickRace(mode);
  if (gaps) a.race.cars.filter(c => !c.isPlayer).forEach((c, i) => { c.desiredGap = gaps[i % gaps.length]; });
  window.__vid.ctl = mode === 'split' ? [{ skill }, { skill: skill * 0.97 }] : { skill, drift };
}, { track, car, color, ai, laps, gaps, skill, mode, drift });
const PACK = [-0.9, -0.6, -0.3, 0.25, 0.5, 0.8, 1.1, 1.4];

// Free Roam: start the world in `car`, put it on `road` at fraction `frac` and let the capture drive
const freeRoam = (page, { road, frac, car, color, ctl, seed = 777 }) => page.evaluate(({ road, frac, car, color, ctl, seed }) => {
  const a = window.app;
  window.__reseed(seed);
  window.__vid.lane = undefined;
  a.disposeRace();
  a.profile.selected = car; a.profile.paint = { [car]: color }; a.profile.horizon.pos = null;
  a.startHorizon();
  const hz = a.horizon, idx = hz.world.indexAt(road, frac);
  hz.placeAt(idx);
  hz.teleportTo({ idx, name: '' });
  window.__vid.ctl = ctl;
}, { road, frac, car, color, ctl, seed });

// End card: the TURBO TOUR logo (style.css .logo) fades in over the last second of gameplay; the HUD fades out.
const END_CARD = `
  #hud-layer { transition: opacity .35s ease-out; opacity: 0 !important; }
  #vid-end { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: radial-gradient(ellipse at center, rgba(11,13,18,.55) 0%, rgba(11,13,18,.82) 70%); animation: vidEndIn .45s ease-out both; }
  #vid-end .logo { font-size: 132px; text-shadow: 0 6px 30px rgba(0,0,0,.55); animation: vidLogoIn .6s cubic-bezier(.2,.9,.3,1.2) both; }
  #vid-end .tag { margin-top: 18px; color: #f2f3f5; font-weight: 700; letter-spacing: .22em; font-size: 19px; text-transform: uppercase; opacity: .92; animation: vidEndIn .5s .2s ease-out both; }
  #vid-end .bar { width: 120px; height: 4px; border-radius: 2px; margin-top: 20px; background: var(--accent); animation: vidEndIn .5s .3s ease-out both; }
  @keyframes vidEndIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes vidLogoIn { from { opacity: 0; transform: scale(1.25); } to { opacity: 1; transform: scale(1); } }`;
const showEndCard = (page) => page.evaluate((css) => {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const d = document.createElement('div'); d.id = 'vid-end';
  d.innerHTML = '<div class="logo">TURBO <span>TOUR</span></div><div class="bar"></div><div class="tag">Open-world racing · 16 circuits · 12 cars</div>';
  document.body.appendChild(d);
}, END_CARD);

// start: game time (s) of the first recorded frame (everything before it is pre-rolled); frames: how many to record.
// Times were picked from contact sheets (--explore / the peek tools); the runs are deterministic (seeded).
const SHOTS = {
  // 1. Monza: lights out, GO!, the pack scrambles off the grid and the player carves from 7th up to 3rd
  monza: {
    start: 4.07, frames: 137,
    setup: (page) => quickRace(page, { track: 'monza', car: 'super', color: 0, ai: 6, gaps: PACK }),
  },
  // 2. Neon City Nights: wheel to wheel with an AI car through the night-time corners, 6th -> 5th
  neon: {
    start: 18.5, frames: 114,
    setup: (page) => quickRace(page, { track: 'neon', car: 'raiden', color: 6, ai: 6, gaps: PACK, drift: true }),
  },
  // 3. Free Roam, Turbo City: Grand Avenue between the towers, oncoming traffic, overtaking a car
  city: {
    start: 16.6, frames: 114,
    setup: (page) => freeRoam(page, { road: 'st-ew0', frac: 0.05, car: 'fiamma', color: 10, ctl: { skill: 0.85, cap: 32, laneFrac: -0.4 } }),
  },
  // 4. Free Roam, Shoreline Highway: past traffic and through a speed trap (popup with the stars), then the logo
  coast: {
    start: 6.6, frames: 180,
    setup: (page) => freeRoam(page, { road: 'coast', frac: 0.37, car: 'fiamma', color: 10, ctl: { skill: 0.85, cap: 48, laneFrac: -0.45 } }),
    during: (page, i) => (i === 132 ? showEndCard(page) : null),
  },
};

// ------------------------------------------------------------------ browser
async function openGame() {
  const srv = await serve(ROOT, PORT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: Math.round(W / DSF), height: Math.round(H / DSF) }, deviceScaleFactor: DSF });
  await ctx.addInitScript(TIME_SHIM);
  await ctx.addInitScript(PAGE_HELPERS);
  await ctx.addInitScript((save) => { try { localStorage.setItem('turbotour.save.v1', JSON.stringify(save)); } catch (e) { /* no storage */ } }, seedSave());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
  await page.goto(srv.url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.app && document.querySelector('[data-go="quick"]')), null, { timeout: 120000 });
  await page.evaluate(async () => { window.__clock.freeze(); await window.__vid.install(); });
  // capture only: no mouse cursor
  await page.addStyleTag({ content: '* { cursor: none !important; }' });
  return { page, close: async () => { await browser.close(); srv.stop(); } };
}

const step = (page) => page.evaluate((ms) => window.__clock.step(ms), 1000 / FPS);
const shoot = (page, path) => page.screenshot({ path, type: 'png', animations: 'allow', caret: 'hide' });

async function recordShot(page, name) {
  const shot = SHOTS[name];
  const dir = join(SCRATCH, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await shot.setup(page);
  await page.evaluate((n) => window.__vid.preroll(n), Math.max(0, Math.round(shot.start * FPS) - 1));
  const t0 = Date.now();
  for (let i = 0; i < shot.frames; i++) {
    if (shot.during) await shot.during(page, i);
    await step(page);
    await shoot(page, join(dir, `f${String(i).padStart(4, '0')}.png`));
    if (i % 30 === 29) console.log(`  ${name}: ${i + 1}/${shot.frames} frames, ${((Date.now() - t0) / (i + 1) / 1000).toFixed(2)} s/frame`);
  }
}

async function explore(page, name, seconds = 20, every = 1) {
  const shot = SHOTS[name];
  const dir = join(SCRATCH, 'explore', name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await shot.setup(page);
  for (let t = 0; t <= seconds; t += every) {
    await step(page);
    await shoot(page, join(dir, `t${String(t.toFixed(1)).padStart(5, '0')}.png`));
    await page.evaluate((n) => window.__vid.preroll(n), Math.round(every * FPS) - 1);
  }
  // contact sheet
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', join(dir, 't*.png'), '-vf', 'scale=480:-1,tile=4x6', '-frames:v', '1', join(dir, 'sheet.png')]);
  console.log('explore sheet:', join(dir, 'sheet.png'));
}

async function encode() {
  const names = Object.keys(SHOTS);
  const clips = [];
  for (const n of names) {
    const dir = join(SCRATCH, n);
    const files = (await readdir(dir)).filter(f => f.endsWith('.png'));
    clips.push({ n, dir, frames: files.length });
  }
  // inputs, then a chain of crossfades
  const inArgs = [];
  for (const c of clips) inArgs.push('-framerate', String(FPS), '-i', join(c.dir, 'f%04d.png'));
  const parts = [];
  let acc = '[0:v]', len = clips[0].frames / FPS;
  for (let i = 1; i < clips.length; i++) {
    const off = (len - XFADE).toFixed(3);
    const out = i === clips.length - 1 ? '[v]' : `[x${i}]`;
    parts.push(`${acc}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${off}${out}`);
    acc = out; len = len + clips[i].frames / FPS - XFADE;
  }
  const filter = clips.length > 1 ? parts.join(';') + ';[v]format=yuv420p[o]' : '[0:v]format=yuv420p[o]';
  await mkdir(dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inArgs, '-filter_complex', filter, '-map', '[o]', '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', OUT], { stdio: 'inherit' });
  console.log(`encoded ${OUT}: ${len.toFixed(2)} s`);
}

async function main() {
  await mkdir(SCRATCH, { recursive: true });
  if (args.includes('--encode')) return encode();
  const ex = opt('explore');
  if (ex) {
    const g = await openGame();
    try { for (const n of ex.split(',')) await explore(g.page, n, +(opt('seconds') || 23), +(opt('every') || 1)); } finally { await g.close(); }
    return;
  }
  const only = (opt('shots') || '').split(',').filter(Boolean);
  for (const n of Object.keys(SHOTS)) {
    if (only.length && !only.includes(n)) continue;
    console.log('recording', n);
    // a fresh page per shot: caches warmed by an earlier shot would shift the seeded random stream
    const g = await openGame();
    try { await recordShot(g.page, n); } finally { await g.close(); }
  }
  await encode();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
export { openGame, quickRace, SHOTS, PACK, step, shoot, SCRATCH, FPS };

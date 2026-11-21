// Portrait (2:3) CrazyGames preview video: 1080x1620, H.264, 30 fps, ~17.5 s, silent.
//
//   node scripts/media/video-portrait.mjs [outDir] [--only=race,drift,roam,logo] [--probe] [--no-encode]
//
// Real gameplay captured headless. Time is deterministic: an init script replaces performance.now,
// Date.now, requestAnimationFrame and Math.random, so the game only advances when we step it (1/30 s per
// step, under the main.js 0.1 s and race.js / horizon.js 1/20 s dt caps), then each frame is a page
// screenshot (canvas + HUD DOM). The PNGs go to outDir and are encoded with ffmpeg into
// media/video/portrait-1080x1620.mp4. Nothing under src/ is changed; HUD tweaks are injected CSS.
import { serve, chromium } from '../../tests/helpers.mjs';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const OUT = resolve(args.find((a) => !a.startsWith('--')) || join(ROOT, '.video-portrait-frames'));
const ONLY = opt('only', 'race,drift,roam,logo').split(',');
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
  window.__auto = true;   // free-running while the game boots; stepped by hand while recording
  window.__tick = (ms) => {
    t += ms;
    const l = [...q.values()]; q.clear();
    for (const cb of l) { try { cb(t); } catch (e) { console.error('rAF', e && e.stack || e); } }
  };
  window.__steps = (n) => { for (let i = 0; i < n; i++) window.__tick(1000 / 30); };
  setInterval(() => { if (window.__auto) window.__tick(1000 / 30); }, 20);
  let s = 20261121;
  Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.clear(); localStorage.setItem('turbotour.save.v1', save); } catch (e) { /* */ }
}

// HUD: injected CSS only (see report). Empty until the portrait layout has been checked.
const HUD_CSS = `
  .hz-hint, .hz-mapbtn, #touch-ui, .touch-controls { display: none !important; }
`;

let frameNo = 0;
async function shoot(page, dir) {
  const f = join(dir, `f${String(frameNo++).padStart(4, '0')}.png`);
  await page.screenshot({ path: f, animations: 'allow', caret: 'hide' });
  return f;
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
async function record(page, dir, n, perFrame) {
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (perFrame) await page.evaluate(perFrame, i);
    await step(page, 1);
    await shoot(page, dir);
    if (i % 30 === 0) process.stdout.write(`  frame ${frameNo} (${((Date.now() - t0) / (i + 1) / 1000).toFixed(2)} s/frame)\n`);
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
async function startRace(page, { track, ai, car, laps = 3, difficulty = 3, afterGo = 0 }) {
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
  await page.evaluate(() => { const p = window.app.race.players[0]; p.autopilot = true; p.aiSkill = 0.95; });
  if (afterGo > 0) await warm(page, Math.round(afterGo * FPS));
}

async function shotRace(page, dir, n) {
  await startRace(page, { track: 'coastal', ai: 7, car: 'super', afterGo: 2.5 });
  await record(page, dir, n);
}

async function main() {
  if (existsSync(OUT) && !PROBE) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const srv = await serve(ROOT, PORT);
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await newPage(browser, srv.url);
    if (ONLY.includes('race')) { console.log('race'); await shotRace(page, OUT, PROBE ? 4 : 165); }
    await ctx.close();
  } finally {
    await browser.close();
    srv.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

export { newPage, startRace, warm, step, shoot, record, serve, chromium, ROOT, PORT };

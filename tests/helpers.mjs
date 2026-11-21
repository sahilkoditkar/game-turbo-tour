// Shared helpers for the headless platform tests (Playwright, which this environment has pre-installed; nothing
// is installed in the repository). The static server is built in, so the tests need no npm packages.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };

/** Serve `dir` on 127.0.0.1:port (no caching). Resolves to { url, stop }. */
export function serve(dir, port) {
  const root = normalize(dir);
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(root, p));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}/`, stop: () => srv.close() }));
  });
}

// collects console errors / warnings, page errors and every requested URL
export function watch(page) {
  const w = { errors: [], warnings: [], requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') w.errors.push(m.text()); if (m.type() === 'warning') w.warnings.push(m.text()); });
  page.on('pageerror', (e) => w.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => w.requests.push(r.url()));
  return w;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(page, fn, arg, timeout = 120_000, what = String(fn)) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); } catch (e) { throw new Error('timed out waiting for ' + what); }
}

/** The main menu is up (the game has booted). */
export const atMenu = (page, what = 'menu') => until(page, () => !!(window.app && document.querySelector('[data-go="quick"]')), null, 120_000, what);

/** Main menu -> Quick Race setup -> Start Race, then wait for the green light. */
export async function quickRace(page) {
  await page.click('[data-go="quick"]');
  await page.click('[data-start]');
  await until(page, () => window.app.race && window.app.race.state === 'racing', null, 120_000, 'race (racing)');
}

/** Every player crosses the line now; resolves when the results screen is up. */
export async function finishRace(page) {
  await until(page, () => window.app.race && window.app.race.state === 'racing' && !window.app.paused, null, 120_000, 'racing before finish');
  await page.evaluate(() => { const r = window.app.race; for (const p of r.players) { p.finished = true; p.finishTime = r.time + 60; } });
  await until(page, () => !!document.querySelector('[data-continue]'), null, 60_000, 'results screen');
  await sleep(200);
}

export function check(cond, msg, results) {
  results.push((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) process.exitCode = 1;
}

// Web build (the repository as GitHub Pages serves it): menu -> race -> pause -> finish -> retry, saves in
// localStorage, no console / page errors, no request to any CrazyGames host.  usage: node tests/web.test.mjs [dir] [port]
import { fileURLToPath } from 'node:url';
import { chromium, serve, watch, until, atMenu, quickRace, finishRace, check } from './helpers.mjs';

const dir = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[3] || 8471);
const results = [];
const srv = await serve(dir, port);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const w = watch(page);
  await page.goto(srv.url);
  await atMenu(page);
  check(await page.evaluate(() => window.__platform.name === 'web'), 'platform is web', results);
  check(await page.evaluate(() => !!document.querySelector('#about [data-web-only]')), 'About keeps the web-only FAQ and links', results);
  await quickRace(page);
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => window.app.paused), 'Esc pauses', results);
  await page.click('[data-resume]');
  await finishRace(page);
  await page.evaluate(() => window.app.save());
  const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  check(!!ls['turbotour.save.v1'] && !!JSON.parse(ls['turbotour.save.v1']).bestLaps, 'career saved in localStorage', results);
  check(!Object.keys(ls).some((k) => k.includes('__')), 'no platform bookkeeping keys on web', results);
  // Race again is instant on web (no break, no veil)
  await page.click('[data-retry]');
  await until(page, () => window.app.race && window.app.race.state === 'countdown', null, 30_000, 'retry countdown');
  check(await page.evaluate(() => !document.getElementById('adVeil')), 'race again: no ad break on web', results);
  await page.keyboard.press('Escape'); await page.click('[data-quit]');
  await atMenu(page, 'menu again');
  const log = await page.evaluate(() => window.__platform.log);
  console.log('platform log:', log.join(' '));
  const gp = log.filter((x) => x.startsWith('gameplay'));
  check(JSON.stringify(gp) === JSON.stringify(['gameplayStart', 'gameplayStop', 'gameplayStart', 'gameplayStop']), 'gameplay start/stop on GO, pause, resume, finish (no-ops on web)', results);
  check(log.includes('happytime'), 'happytime on a win', results);
  check(w.requests.filter((u) => /crazygames/i.test(u)).length === 0, 'no request to a CrazyGames host', results);
  check(w.requests.every((u) => u.startsWith(srv.url)), 'every request is same-origin (' + w.requests.length + ' requests)', results);
  check(w.errors.length === 0, 'no console/page errors' + (w.errors.length ? ': ' + w.errors.join(' | ') : ''), results);
} finally {
  await browser.close(); srv.stop();
  console.log(results.join('\n'));
}

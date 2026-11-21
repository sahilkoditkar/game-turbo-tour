// The game inside a cross-origin iframe on a long, scrollable parent page (like a portal's game page):
// click focuses it, game keys never scroll the parent, Tab while driving keeps focus in the game, the canvas
// follows iframe resizes, no errors.  usage: node tests/iframe.test.mjs [game dir] [port]
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, serve, watch, until, check, sleep } from './helpers.mjs';

const dir = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[3] || 8475);
const results = [];
const game = await serve(dir, port);
const parentDir = mkdtempSync(join(tmpdir(), 'turbotour-parent-'));
const SIZES = [[960, 540], [1280, 720]];
const filler = Array.from({ length: 80 }, (_, i) => `<p>Portal page paragraph ${i + 1}: other games, comments, footer links.</p>`).join('');
writeFileSync(join(parentDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>parent</title>
<body style="margin:0;font:14px sans-serif">${filler.split('</p>').slice(0, 12).join('</p>')}</p>
<iframe id="g" src="${game.url.replace('127.0.0.1', 'localhost')}" style="border:0;display:block" allow="autoplay; fullscreen; gamepad"></iframe>
<a href="#" id="after">a link after the game</a>
${filler}</body>`);
const parent = await serve(parentDir, port + 1);
const browser = await chromium.launch();
try {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w + 40, height: 900 } });
    const wp = watch(page);
    await page.goto(parent.url);
    await page.evaluate(([w, h]) => { const f = document.getElementById('g'); f.style.width = w + 'px'; f.style.height = h + 'px'; }, [w, h]);
    let frame = null; // a cross-origin iframe gets its own Frame once it has navigated
    for (let i = 0; i < 300 && !frame; i++) { frame = page.frames().find((f) => f.url().includes(':' + port + '/')); if (!frame) await sleep(100); }
    await until(frame, () => !!(window.app && document.querySelector('[data-go="quick"]')), null, 120_000, 'menu in iframe');
    await page.evaluate(() => { const f = document.getElementById('g'); window.scrollTo(0, f.offsetTop - 10); });
    const y0 = await page.evaluate(() => window.scrollY);
    const box = await (await page.$('#g')).boundingBox();
    await page.mouse.click(box.x + 8, box.y + box.height - 8); // a click on the canvas corner, away from the menu
    check(await frame.evaluate(() => document.hasFocus()), `${w}x${h}: clicking the game focuses the iframe`, results);
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowDown', 'Space']) await page.keyboard.press(k);
    let y1 = await page.evaluate(() => window.scrollY);
    check(y1 === y0, `${w}x${h}: menu keys do not scroll the parent (${y0} -> ${y1})`, results);
    // race: hold the throttle and steer (player 1 drives with WASD)
    await frame.click('[data-go="quick"]');
    await frame.click('[data-start]');
    await until(frame, () => window.app.race && window.app.race.state === 'racing', null, 120_000, 'race in iframe');
    await frame.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA'); await page.keyboard.press('Space');
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(k);
    await sleep(1500);
    await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
    y1 = await page.evaluate(() => window.scrollY);
    const speed = await frame.evaluate(() => window.app.race.players[0].speed);
    check(y1 === y0 && speed > 0.5, `${w}x${h}: driving keys reach the game (speed ${speed.toFixed(1)}) and do not scroll the parent`, results);
    for (const k of ['PageDown', 'End', 'PageUp', 'Home']) await page.keyboard.press(k);
    y1 = await page.evaluate(() => window.scrollY);
    check(y1 === y0, `${w}x${h}: PageUp/PageDown/Home/End do not scroll the parent (${y0} -> ${y1})`, results);
    await page.keyboard.press('Tab');
    const inGame = await frame.evaluate(() => document.hasFocus());
    const parentFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check(inGame && parentFocus !== 'after', `${w}x${h}: Tab while driving keeps focus in the game`, results);
    // resize the iframe: the renderer follows
    const nw = Math.round(w * 0.75), nh = Math.round(h * 0.8);
    await page.evaluate(([w, h]) => { const f = document.getElementById('g'); f.style.width = w + 'px'; f.style.height = h + 'px'; }, [nw, nh]);
    await sleep(800);
    const sz = await frame.evaluate(() => { const c = document.getElementById('game'); return { cw: c.clientWidth, ch: c.clientHeight, iw: innerWidth, ih: innerHeight }; });
    check(sz.cw === sz.iw && sz.ch === sz.ih && sz.iw === nw, `${w}x${h}: canvas follows an iframe resize (${sz.cw}x${sz.ch})`, results);
    check(wp.errors.length === 0, `${w}x${h}: no console/page errors` + (wp.errors.length ? ': ' + wp.errors.join(' | ') : ''), results);
    await page.close();
  }
} finally {
  await browser.close(); game.stop(); parent.stop();
  console.log(results.join('\n'));
}

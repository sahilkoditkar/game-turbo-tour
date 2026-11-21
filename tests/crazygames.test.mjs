// CrazyGames build, run from the unzipped dist/turbotour-crazygames.zip with the SDK URL served by tests/cg-sdk-mock.js.
// usage: node tests/crazygames.test.mjs <unzipped dir> [port]
import { readFileSync } from 'node:fs';
import { chromium, serve, watch, until, atMenu, quickRace, finishRace, check, sleep } from './helpers.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tests/crazygames.test.mjs <unzipped build dir> [port]'); process.exit(1); }
const port = Number(process.argv[3] || 8473);
const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const MOCK = readFileSync(new URL('./cg-sdk-mock.js', import.meta.url), 'utf8');
const results = [];
const srv = await serve(dir, port);
const browser = await chromium.launch();
const EXPECTED_NOISE = /Failed to load resource|ERR_FAILED|ERR_BLOCKED/;

// game.* / ad.* / init calls since index `from` (happytime is checked on its own)
const calls = (page, from = 0) => page.evaluate((f) => window.__cgCalls.slice(f).filter((c) => /^(init|game\.|ad\.)/.test(c) && c !== 'game.happytime'), from);
const callCount = (page) => page.evaluate(() => window.__cgCalls.length);
const veilOn = (page) => page.evaluate(() => { const v = document.getElementById('adVeil'); return !!v && getComputedStyle(v).display !== 'none'; });
const silent = (page) => page.evaluate(() => window.app.audio.forcedMute === true && (!window.app.audio.master || window.app.audio.master.gain.value === 0));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function context(cfg, { block = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript((c) => { window.__cgMockConfig = c.cfg; window.__TURBOTOUR_AD_POLICY = c.policy; }, { cfg, policy: { minGapMs: 0, skipRuns: 1, requestTimeoutMs: 3000 } });
  await ctx.route(SDK_URL, (r) => (block ? r.abort('blockedbyclient') : r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK })));
  return ctx;
}

try {
  // ------------------------------------------------------------------ full session with the SDK
  {
    const ctx = await context({ env: 'crazygames', ads: ['finish', 'error', 'hang', 'finish'] });
    const page = await ctx.newPage();
    const w = watch(page);
    // a returning GitHub-Pages-era player: a save and a ghost lap already in localStorage (seeded before the first boot)
    await page.goto(srv.url + 'style.css');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('turbotour.save.v1', JSON.stringify({ name: 'You', money: 7777, cars: ['classic'], selected: 'classic' }));
      localStorage.setItem('turbotour.ghost.test:classic', JSON.stringify({ step: 0.05, samples: [], lapTime: 60 }));
      localStorage.setItem('unrelated.key', '1');
    });
    await page.goto(srv.url);
    await atMenu(page);
    let seq = await calls(page);
    check(same(seq, ['init', 'ad.hasAdblock', 'game.loadingStart', 'game.addSettingsChangeListener', 'game.loadingStop']), 'boot: ' + seq.join(' > '), results);
    const mig = await page.evaluate(() => ({ save: JSON.parse(localStorage.getItem('cgmock:turbotour.save.v1') || 'null'), ghost: localStorage.getItem('cgmock:turbotour.ghost.test:classic'), unrelated: localStorage.getItem('cgmock:unrelated.key'), flag: localStorage.getItem('cgmock:turbotour.__migrated'), money: window.app.profile.money }));
    check(mig.save && mig.save.money === 7777 && !!mig.flag && !mig.unrelated, 'migration copied the career save into the Data module (only turbotour.* keys)', results);
    check(!mig.ghost, 'ghost laps stay in localStorage (not sent to the Data module)', results);
    check(mig.money === 7777, 'game reads the migrated career (7777 cr)', results);
    check(await page.evaluate(() => !document.querySelector('#about [data-web-only]')), 'About: web-only FAQ and links removed', results);

    // --- race 1: start, pause, resume, finish
    let n = await callCount(page);
    await quickRace(page);
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => window.app.paused), 'Esc pauses', results);
    await page.click('[data-resume]');
    await finishRace(page);
    seq = await calls(page, n);
    check(same(seq, ['game.gameplayStart', 'game.gameplayStop', 'game.gameplayStart', 'game.gameplayStop']), 'race 1 GO/pause/resume/finish: ' + seq.join(' > '), results);
    check(await page.evaluate(() => window.__cgCalls.includes('game.happytime')), 'happytime on a win', results);
    await page.evaluate(() => { window.app.profile.money += 1; window.app.save(); });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cgmock:turbotour.save.v1')).money);
    check(saved === 7778, 'career saves go through the Data module', results);

    // --- Race again after the session's first race: no break (skipRuns)
    n = await callCount(page);
    await page.click('[data-retry]');
    await until(page, () => window.app.race && window.app.race.state === 'countdown', null, 30_000, 'countdown 2');
    check(!(await page.evaluate(() => !!document.getElementById('adVeil'))), 'first race of the session: no ad break', results);
    await until(page, () => window.app.race.state === 'racing', null, 30_000, 'racing 2');
    await finishRace(page);
    seq = await calls(page, n);
    check(same(seq, ['game.gameplayStart', 'game.gameplayStop']), 'race 2: ' + seq.join(' > '), results);

    // --- Race again: a midgame ad that finishes
    n = await callCount(page);
    await page.click('[data-retry]');
    await until(page, () => window.__platform.log.includes('midgame:started'), null, 5000, 'ad started');
    await sleep(300);
    check(await page.evaluate(() => !!document.querySelector('[data-retry]') && window.app.race.state === 'finished'), 'during ad: still on the results screen', results);
    check(await silent(page), 'during ad: audio muted', results);
    check(await veilOn(page), 'during ad: "Back in a moment" veil shown', results);
    await page.keyboard.press('Escape'); await page.mouse.click(480, 270);
    check(await page.evaluate(() => !!document.querySelector('[data-retry]')), 'during ad: input swallowed', results);
    await until(page, () => window.app.race && window.app.race.state === 'countdown', null, 10_000, 'countdown after ad');
    check(!(await silent(page)) && !(await veilOn(page)), 'after adFinished: sound back, veil gone, next race counting down', results);
    await until(page, () => window.app.race.state === 'racing', null, 30_000, 'racing 3');
    await finishRace(page);
    seq = await calls(page, n);
    check(same(seq, ['ad.requestAd:midgame:finish', 'game.gameplayStart', 'game.gameplayStop']), 'race again + ad(finished): ' + seq.join(' > '), results);

    // --- player turns sound off; Race again: ad errors; the player's own setting survives the break
    await page.evaluate(() => window.app.audio.setEnabled(false));
    n = await callCount(page);
    await page.click('[data-retry]');
    await until(page, () => window.app.race && window.app.race.state === 'countdown', null, 10_000, 'retry after adError');
    check(await page.evaluate(() => window.app.audio.enabled === false && window.app.audio.forcedMute === false && window.app.audio.master.gain.value === 0), 'after adError: player sound-off kept', results);
    await page.evaluate(() => window.app.audio.setEnabled(true));
    await until(page, () => window.app.race.state === 'racing', null, 30_000, 'racing 4');
    await finishRace(page);
    seq = await calls(page, n);
    check(same(seq, ['ad.requestAd:midgame:error', 'game.gameplayStart', 'game.gameplayStop']), 'race again + ad(error): ' + seq.join(' > '), results);

    // --- Main menu: an ad that never calls back -> the timeout guard carries on
    n = await callCount(page);
    const t0 = Date.now();
    await page.click('[data-continue]');
    await until(page, () => window.__platform.log.includes('midgame:request') && !!document.getElementById('adVeil'), null, 5000, 'hanging ad');
    await atMenu(page, 'menu after timeout');
    const waited = Date.now() - t0;
    check(waited >= 2500 && waited < 9000, `never-returning ad: carried on after the timeout (${waited} ms)`, results);
    check(!(await silent(page)), 'after timeout: sound back', results);
    seq = await calls(page, n);
    check(same(seq, ['ad.requestAd:midgame:hang']), 'main menu + ad(hang): ' + seq.join(' > '), results);

    // --- portal mute (settings.muteAudio) wins over the in-game setting without changing it
    await page.evaluate(() => window.__cgSetMute(true));
    check(await page.evaluate(() => window.app.audio.forcedMute === true && window.app.profile.settings.sound === true), 'settings.muteAudio=true mutes (player setting untouched)', results);
    await page.evaluate(() => window.__cgSetMute(false));
    check(await page.evaluate(() => window.app.audio.forcedMute === false), 'settings.muteAudio=false restores sound', results);

    // --- Free Roam: loading while the world builds, gameplay while driving, stop for the map and pause
    n = await callCount(page);
    await page.click('[data-go="horizon"]');
    await page.click('[data-start]');
    await until(page, () => !!window.app.horizon && window.__cgCalls.lastIndexOf('game.gameplayStart') > window.__cgCalls.lastIndexOf('game.loadingStop'), null, 120_000, 'free roam');
    await page.evaluate(() => { window.app.ui.worldPanelClose && window.app.ui.worldPanelClose(); if (window.app.paused) window.app.togglePause(); }); // first-drive guide, if any
    await sleep(300);
    await page.evaluate(() => window.app.openMap());
    await sleep(300);
    await page.evaluate(() => window.app.closeMap());
    await sleep(300);
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.click('[data-quit-roam]');
    await atMenu(page, 'menu after free roam');
    seq = await calls(page, n);
    const want = ['game.loadingStart', 'game.loadingStop', 'game.gameplayStart', 'game.gameplayStop', 'game.gameplayStart', 'game.gameplayStop'];
    check(same(seq, want), 'free roam drive/map/drive/pause/quit: ' + seq.join(' > '), results);

    // --- reload: the Data module is the source of truth, migration does not run again
    const before = await page.evaluate(() => ({ flag: localStorage.getItem('cgmock:turbotour.__migrated'), money: JSON.parse(localStorage.getItem('cgmock:turbotour.save.v1')).money }));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('turbotour.save.v1')); s.money = 1; localStorage.setItem('turbotour.save.v1', JSON.stringify(s)); }); // a stale local copy
    await page.reload();
    await atMenu(page, 'menu after reload');
    const after = await page.evaluate(() => ({ flag: localStorage.getItem('cgmock:turbotour.__migrated'), money: window.app.profile.money, sets: window.__cgCalls.filter((c) => c === 'data.setItem:turbotour.__migrated').length }));
    check(after.flag === before.flag && after.sets === 0, 'reload: migration ran once only', results);
    check(after.money === before.money, `reload: career from the Data module (${after.money} cr)`, results);
    check(w.errors.length === 0, 'no console/page errors' + (w.errors.length ? ': ' + w.errors.join(' | ') : ''), results);
    await ctx.close();
  }

  // ------------------------------------------------------------------ SDK blocked (ad-blocker)
  {
    const ctx = await context({}, { block: true });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(srv.url);
    await atMenu(page, 'menu (blocked)');
    await quickRace(page);
    await finishRace(page);
    await page.click('[data-retry]'); // race 1: no break anyway; the second Race again would try one
    await until(page, () => window.app.race.state === 'racing', null, 30_000, 'racing (blocked)');
    await finishRace(page);
    await page.click('[data-retry]');
    await until(page, () => window.app.race && window.app.race.state === 'countdown', null, 10_000, 'retry (blocked)');
    await page.evaluate(() => window.app.save());
    const r = await page.evaluate(() => ({ save: localStorage.getItem('turbotour.save.v1'), cg: Object.keys(localStorage).filter((k) => k.startsWith('cgmock:')).length, sdk: !!window.CrazyGames }));
    check(!r.sdk && !!r.save && r.cg === 0, 'SDK blocked: game starts, plays and saves to localStorage', results);
    check(!(await page.evaluate(() => !!document.getElementById('adVeil'))), 'SDK blocked: no ad break attempted', results);
    check(w.warnings.some((x) => x.includes('running without the SDK')), 'SDK blocked: one clear console warning', results);
    const errs = w.errors.filter((e) => !EXPECTED_NOISE.test(e));
    check(errs.length === 0, 'SDK blocked: no errors besides the blocked request' + (errs.length ? ': ' + errs.join(' | ') : ''), results);
    await ctx.close();
  }

  // ------------------------------------------------------------------ init failure, disabled environment
  for (const [label, cfg] of [['init() rejects', { initFail: true }], ['environment disabled', { env: 'disabled' }]]) {
    const ctx = await context(cfg);
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(srv.url);
    await atMenu(page, 'menu: ' + label);
    const c = await page.evaluate(() => window.__cgCalls.filter((x) => x !== 'init'));
    check(c.length === 0 && w.errors.length === 0, `${label}: menu reached, no further SDK calls, no errors`, results);
    await ctx.close();
  }
} finally {
  await browser.close(); srv.stop();
  console.log(results.join('\n'));
}

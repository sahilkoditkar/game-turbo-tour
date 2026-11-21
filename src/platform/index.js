// Platform layer: the only portal-facing module the game imports. One small interface, one adapter per portal
// (web.js, crazygames.js, ...), chosen at boot and loaded with a dynamic import so other portals' code is never
// downloaded. Every adapter failure degrades to "plain web" behaviour; nothing here can stop the game starting.
//
// Choice: window.TURBOTOUR_PLATFORM (set by a portal build's index.html) > ?platform= (testing) > 'web'.
// Every call is safe at any time: before init resolves, and on an adapter that failed, they do nothing.
// Adding a portal = one entry in ADAPTERS + one adapter file + one target in scripts/build.mjs.
import { localStore } from './localstore.js';
import { AD_POLICY } from './policy.js';

export { localStore }; // device-only storage, for data that should not go to a portal's save API (ghost laps)

const ADAPTERS = {
  web: () => import('./web.js'),
  crazygames: () => import('./crazygames.js'),
};

const noop = () => {};
let impl = null; // the adapter (null until init resolves)
let initP = null;
let playing = false, loading = false, breakBusy = false;
const log = [];
const note = (what) => { log.push(what); if (log.length > 200) log.shift(); };
const warn = (...a) => console.warn('[platform]', ...a);

function requested() {
  let n = null;
  try { n = typeof window.TURBOTOUR_PLATFORM === 'string' ? window.TURBOTOUR_PLATFORM : null; } catch { /* ignore */ }
  if (!n) { try { n = new URLSearchParams(location.search).get('platform'); } catch { /* ignore */ } }
  n = String(n || 'web').toLowerCase();
  return ADAPTERS[n] ? n : 'web';
}

async function fallbackWeb() { return (await import('./web.js')).create(); }

// storage facade with a synchronous, localStorage-like signature (getItem / setItem / removeItem / keys).
// Before init resolves (and on any adapter without its own storage) it is plain localStorage.
export const storage = {
  getItem: (k) => (impl ? impl.storage : localStore).getItem(k),
  setItem: (k, v) => (impl ? impl.storage : localStore).setItem(k, v),
  removeItem: (k) => (impl ? impl.storage : localStore).removeItem(k),
  keys: () => (impl ? impl.storage : localStore).keys(),
};

function call(name, ...a) {
  note(name);
  try { const r = impl && impl[name] && impl[name](...a); if (r && typeof r.catch === 'function') r.catch((e) => warn(name, e)); } catch (e) { warn(name, e); }
}

// a guarded ad break: onDone fires exactly once (finish, error, unfilled, timeout, adapter throw, double call)
function runBreak(kind, { onStart, onDone } = {}) {
  const done = (granted) => { try { if (onDone) onDone(granted); } catch (e) { warn('onDone', e); } };
  if (!impl || !impl.adsAvailable) { done(false); return; }
  if (breakBusy) { note(kind + ':busy'); done(false); return; } // a break is already running: this one is skipped
  breakBusy = true;
  const resumePlay = playing; // breaks belong in natural pauses; if one is asked for mid-play, stop around it
  if (resumePlay) gameplayStop();
  let started = false, over = false;
  let tm = setTimeout(() => finish(false, 'timeout'), AD_POLICY.requestTimeoutMs);
  function start() {
    if (started || over) return;
    started = true; note(kind + ':started');
    clearTimeout(tm); tm = setTimeout(() => finish(false, 'timeout'), AD_POLICY.maxAdMs);
    try { if (onStart) onStart(); } catch (e) { warn('onStart', e); }
  }
  function finish(granted, why) {
    if (over) return;
    over = true; clearTimeout(tm); breakBusy = false;
    note(`${kind}:done:${why || (granted ? 'finished' : 'error')}`);
    if (resumePlay) gameplayStart();
    done(kind === 'rewarded' ? !!granted : granted);
  }
  note(kind + ':request');
  try { impl[kind]({ start, finish }); } catch (e) { warn(kind, e); finish(false, 'throw'); }
}

// ---------------------------------------------------------------- the interface
// resolves when the adapter is ready; never rejects
export function init() {
  if (initP) return initP;
  const want = requested();
  initP = (async () => {
    try { impl = await (await ADAPTERS[want]()).create(); } catch (e) { warn(`adapter "${want}" failed, using web`, e); impl = null; }
    if (!impl) { try { impl = await fallbackWeb(); } catch { impl = null; } }
    if (!impl) impl = { name: 'web', adsAvailable: false, storage: localStore, hasRewarded: () => false, onAudioMute: noop };
    note('init:' + impl.name);
    return platform;
  })();
  return initP;
}

export function loadingStart() { if (loading) return; loading = true; call('loadingStart'); }
export function loadingStop() { if (!loading) return; loading = false; call('loadingStop'); }
// state machine: no duplicate consecutive start / stop; the first start also closes the initial loading
export function gameplayStart() { if (playing) return; if (loading) loadingStop(); playing = true; call('gameplayStart'); }
export function gameplayStop() { if (!playing) return; playing = false; call('gameplayStop'); }
export function happytime() { call('happytime'); }
export function commercialBreak(cb) { runBreak('midgame', cb); }
export function rewardedBreak(cb) { runBreak('rewarded', cb); }
export function hasRewarded() { try { return !!(impl && impl.adsAvailable && impl.hasRewarded()); } catch { return false; } }
// cb(muted) now and whenever the portal asks the game to mute / unmute (CrazyGames settings.muteAudio)
export function onAudioMute(cb) { try { if (impl && impl.onAudioMute) impl.onAudioMute(cb); } catch (e) { warn('onAudioMute', e); } }

export const platform = {
  init, storage, loadingStart, loadingStop, gameplayStart, gameplayStop, happytime,
  commercialBreak, rewardedBreak, hasRewarded, onAudioMute,
  get name() { return impl ? impl.name : requested(); },
  get adsAvailable() { return !!(impl && impl.adsAvailable); },
  get playing() { return playing; },
  get log() { return log.slice(); }, // test hook: the platform calls made so far
};
if (typeof window !== 'undefined') window.__platform = platform;

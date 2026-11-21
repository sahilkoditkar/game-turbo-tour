// CrazyGames HTML5 SDK v3 adapter.
// Surface used: SDK.init(), SDK.environment ('local' | 'crazygames' | 'disabled'),
// SDK.game.loadingStart/loadingStop/gameplayStart/gameplayStop/happytime, SDK.game.settings.muteAudio +
// SDK.game.addSettingsChangeListener, SDK.ad.requestAd('midgame' | 'rewarded', { adStarted, adFinished, adError }),
// SDK.ad.hasAdblock(), SDK.data.getItem/setItem/removeItem (same API as localStorage).
//
// Degrades to a no-op adapter with localStorage saves when: the SDK script is blocked (ad-blocker) or slow,
// init() throws or hangs, the environment is 'disabled' (any non-CrazyGames domain: SDK calls would throw),
// or the Data module is unusable. The game never waits on any of this for longer than SDK_TIMEOUTS.
import { localStore } from './localstore.js';
import { SDK_TIMEOUTS, DATA_LIMIT_CHARS } from './policy.js';

export const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const PREFIX = 'turbotour.'; // the game's own keys (kept unchanged)
const INDEX_KEY = 'turbotour.__keys'; // the Data module cannot enumerate keys, so we keep a key index
const MIGRATED_KEY = 'turbotour.__migrated'; // one-time copy of existing localStorage saves into the Data module
// keys that belong in the Data module: the game's own, minus bookkeeping and ghost laps (device-only, large)
const synced = (k) => k.startsWith(PREFIX) && !k.startsWith(PREFIX + '__') && !k.startsWith(PREFIX + 'ghost.');
const warn = (...a) => console.warn('[crazygames]', ...a);

const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

function loadSdk() {
  const have = () => window.CrazyGames && window.CrazyGames.SDK;
  if (have()) return Promise.resolve(have()); // the build's <script> tag in <head> already ran
  // the build's (blocking) tag ran and failed: blocked by an ad-blocker or offline, a retry would fail too
  if (document.querySelector(`script[src="${SDK_URL}"]`)) return Promise.reject(new Error('SDK script blocked or unreachable'));
  // no tag (?platform=crazygames on a page without it): load it once, bounded
  return timeout(new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SDK_URL; s.async = true;
    s.onload = () => (have() ? res(have()) : rej(new Error('SDK script loaded without window.CrazyGames.SDK')));
    s.onerror = () => rej(new Error('SDK script blocked or unreachable'));
    document.head.appendChild(s);
  }), SDK_TIMEOUTS.loadMs, 'SDK load');
}

function disabledAdapter(reason) {
  warn('running without the SDK:', reason);
  const noop = () => {};
  return {
    name: 'crazygames', sdk: false, reason, adsAvailable: false,
    loadingStart: noop, loadingStop: noop, gameplayStart: noop, gameplayStop: noop, happytime: noop,
    midgame: ({ finish }) => finish(false), rewarded: ({ finish }) => finish(false), hasRewarded: () => false,
    onAudioMute: noop, storage: localStore,
  };
}

// Data-module storage: an in-memory mirror (reads are synchronous and cheap), written through to SDK.data and,
// best effort, to localStorage, so a later session with the SDK blocked still finds recent saves.
// Keys that are not `synced` (ghost laps) bypass the Data module and live in localStorage only.
function dataStorage(data) {
  const cache = new Map();
  let size = 0;
  const parseIdx = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter((k) => typeof k === 'string') : []; } catch { return []; } };
  for (const k of parseIdx(data.getItem(INDEX_KEY))) {
    const v = data.getItem(k);
    if (v != null) { cache.set(k, String(v)); size += k.length + String(v).length; }
  }
  const writeIndex = () => data.setItem(INDEX_KEY, JSON.stringify([...cache.keys()]));
  const put = (k, v) => {
    const old = cache.get(k);
    if (old === v) return; // Free Roam saves every few seconds: unchanged values are not sent again
    const grow = k.length + v.length - (old == null ? 0 : k.length + old.length);
    if (size + grow > DATA_LIMIT_CHARS) { const e = new Error('CrazyGames data limit reached'); e.name = 'QuotaExceededError'; throw e; }
    data.setItem(k, v);
    cache.set(k, v); size += grow;
    if (old == null) writeIndex();
  };
  // one-time migration of saves made before the SDK (GitHub Pages era, or sessions with the SDK blocked)
  let migrated = 0;
  if (!data.getItem(MIGRATED_KEY)) {
    for (const k of localStore.keys()) {
      if (!synced(k) || cache.has(k)) continue; // the portal copy wins
      const v = localStore.getItem(k);
      if (v == null) continue;
      try { put(k, v); migrated++; } catch (e) { warn('migration skipped', k, e && e.message); }
    }
    data.setItem(MIGRATED_KEY, String(Date.now()));
  }
  return {
    migrated,
    getItem: (k) => (!synced(k) ? localStore.getItem(k) : cache.has(k) ? cache.get(k) : null),
    setItem(k, v) {
      v = String(v);
      if (!synced(k)) { localStore.setItem(k, v); return; }
      put(k, v);
      try { localStorage.setItem(k, v); } catch { /* mirror only */ }
    },
    removeItem(k) {
      if (cache.has(k)) { const v = cache.get(k); cache.delete(k); size -= k.length + v.length; try { data.removeItem(k); } catch (e) { warn('removeItem', e); } writeIndex(); }
      localStore.removeItem(k);
    },
    keys: () => [...new Set([...cache.keys(), ...localStore.keys().filter((k) => !synced(k))])],
  };
}

export async function create() {
  let sdk;
  try { sdk = await loadSdk(); } catch (e) { return disabledAdapter(e.message); }
  try { await timeout(Promise.resolve().then(() => sdk.init()), SDK_TIMEOUTS.initMs, 'SDK init'); } catch (e) { return disabledAdapter('init failed: ' + (e && e.message)); }
  const env = sdk.environment;
  // 'disabled' = not on a CrazyGames domain (and not localhost / ?useLocalSdk=true): every SDK call would throw
  if (env !== 'crazygames' && env !== 'local') return disabledAdapter('environment ' + env);

  let storage = localStore, migrated = 0;
  try { storage = dataStorage(sdk.data); migrated = storage.migrated; } catch (e) { warn('Data module unavailable, saving locally', e); storage = localStore; }

  let adblock = false;
  try { Promise.resolve(sdk.ad.hasAdblock()).then((v) => { adblock = !!v; }, () => {}); } catch { /* older SDK */ }

  const safe = (fn) => () => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch((e) => warn(e)); } catch (e) { warn(e); } };
  const errCode = (e) => (e && typeof e === 'object' ? e.code || e.message : e) || 'other';
  const request = (type) => ({ start, finish }) => {
    sdk.ad.requestAd(type, {
      adStarted: () => start(),
      adFinished: () => finish(true),
      // 'unfilled' | 'adblock' | 'adCooldown' | 'other': all mean "carry on"; a rewarded ad grants nothing
      adError: (e) => { const c = errCode(e); if (c === 'adblock') adblock = true; finish(false, 'adError:' + c); },
    });
  };

  return {
    name: 'crazygames', sdk: true, environment: env, migrated,
    // ads only exist on CrazyGames itself (and their QA tool); on localhost ('local') requests return adError
    adsAvailable: true,
    loadingStart: safe(() => sdk.game.loadingStart()),
    loadingStop: safe(() => sdk.game.loadingStop()),
    gameplayStart: safe(() => sdk.game.gameplayStart()),
    gameplayStop: safe(() => sdk.game.gameplayStop()),
    happytime: safe(() => sdk.game.happytime()),
    midgame: request('midgame'),
    rewarded: request('rewarded'),
    hasRewarded: () => !adblock,
    // settings.muteAudio takes priority over the in-game sound setting
    onAudioMute(cb) {
      const read = () => !!(sdk.game.settings && sdk.game.settings.muteAudio);
      try { cb(read()); } catch (e) { warn(e); }
      try { sdk.game.addSettingsChangeListener((s) => { try { cb(s && 'muteAudio' in s ? !!s.muteAudio : read()); } catch (e) { warn(e); } }); } catch (e) { warn('settings listener', e); }
    },
    storage,
  };
}

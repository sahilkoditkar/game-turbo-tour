// Stand-in for https://sdk.crazygames.com/crazygames-sdk-v3.js in headless tests (served via Playwright route).
// Implements the documented v3 surface the game uses and records every call in window.__cgCalls.
// Behaviour is set before load through window.__cgMockConfig:
//   env: 'crazygames' | 'local' | 'disabled'   initFail: true   muteAudio: bool
//   ads: ['finish' | 'error' | 'unfilled' | 'hang', ...]  (one per requestAd, default 'finish'); adMs: ad length
// Data persists in localStorage under 'cgmock:' so reloads see the "cloud" save.
(function () {
  const cfg = window.__cgMockConfig || {};
  const calls = (window.__cgCalls = window.__cgCalls || []);
  const rec = (n, a) => calls.push(a === undefined ? n : n + ':' + a);
  const NS = 'cgmock:';
  const settings = { muteAudio: !!cfg.muteAudio, disableChat: false };
  const listeners = [];
  let inited = false;
  const guard = (n) => { if (!inited) throw new Error('CrazySDK: ' + n + ' before init'); if (cfg.env === 'disabled') throw new Error('CrazySDK is disabled on this domain'); };
  const game = {};
  for (const n of ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'happytime']) game[n] = () => { guard(n); rec('game.' + n); return Promise.resolve(); };
  game.settings = settings;
  game.addSettingsChangeListener = (f) => { rec('game.addSettingsChangeListener'); listeners.push(f); };
  game.removeSettingsChangeListener = (f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); };
  let adN = 0;
  const ad = {
    requestAd(type, cb) {
      guard('requestAd');
      const mode = (cfg.ads || [])[adN++] || 'finish';
      rec('ad.requestAd', type + ':' + mode);
      if (mode === 'hang') return; // never calls back
      if (mode === 'unfilled') { setTimeout(() => { rec('cb.adError', 'unfilled'); cb.adError && cb.adError({ code: 'unfilled', message: 'No ad available' }); }, 50); return; }
      setTimeout(() => {
        rec('cb.adStarted'); cb.adStarted && cb.adStarted();
        setTimeout(() => {
          if (mode === 'error') { rec('cb.adError', 'other'); cb.adError && cb.adError({ code: 'other', message: 'mock error' }); }
          else { rec('cb.adFinished'); cb.adFinished && cb.adFinished(); }
        }, cfg.adMs || 1200);
      }, 100);
    },
    hasAdblock() { rec('ad.hasAdblock'); return Promise.resolve(false); },
  };
  const data = {
    getItem(k) { guard('data.getItem'); return localStorage.getItem(NS + k); },
    setItem(k, v) { guard('data.setItem'); rec('data.setItem', k); localStorage.setItem(NS + k, String(v)); },
    removeItem(k) { guard('data.removeItem'); rec('data.removeItem', k); localStorage.removeItem(NS + k); },
    clear() { guard('data.clear'); for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) localStorage.removeItem(k); },
  };
  const SDK = {
    environment: 'uninitialized',
    init() {
      rec('init');
      if (cfg.initFail) return Promise.reject(new Error('mock init failure'));
      inited = true; SDK.environment = cfg.env || 'crazygames';
      return Promise.resolve();
    },
    game, ad, data,
    user: { getUser: () => Promise.resolve(null), showAuthPrompt: () => Promise.resolve() },
  };
  window.__cgSetMute = (m) => { settings.muteAudio = !!m; for (const f of listeners) f({ ...settings }); };
  window.CrazyGames = { SDK };
})();

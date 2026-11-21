// Plain web (GitHub Pages, any static host): no SDK, no ads, saves in localStorage.
import { localStore } from './localstore.js';

export async function create() {
  const noop = () => {};
  return {
    name: 'web',
    adsAvailable: false,
    loadingStart: noop, loadingStop: noop, gameplayStart: noop, gameplayStop: noop, happytime: noop,
    midgame: ({ finish }) => finish(false),
    rewarded: ({ finish }) => finish(false),
    hasRewarded: () => false,
    onAudioMute: noop,
    storage: localStore,
  };
}

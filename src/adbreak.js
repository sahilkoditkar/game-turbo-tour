// Game-side glue for portal breaks: when a mid-game ad may run (policy), what the game does around it
// (freeze the loop, mute, a neutral veil, swallow input) and the portal's own mute request.
// main.js only calls naturalBreak(fn) at natural breaks, noteRunEnd() when a race finishes,
// and asks breakActive() / forcedMute(). On plain web (no ads) naturalBreak(fn) just calls fn() synchronously.
import { platform } from './platform/index.js';
import { AD_POLICY } from './platform/policy.js';

let active = false, portalMuted = false, runs = 0, veil = null, veilTm = 0;
let lastAttempt = performance.now(); // the gap also runs from boot: no break in the first minutes of a session
const muteListeners = [];
const notifyMute = () => { for (const f of muteListeners) { try { f(forcedMute()); } catch (e) { console.warn(e); } } };

export const breakActive = () => active;
// audio must be silent: during a break, or while the portal says so (CrazyGames settings.muteAudio)
export const forcedMute = () => active || portalMuted;
export function onForcedMute(f) { muteListeners.push(f); try { f(forcedMute()); } catch (e) { console.warn(e); } }
platform.onAudioMute((m) => { portalMuted = !!m; notifyMute(); });

export function noteRunEnd() { runs++; }

function policyAllows() {
  if (!platform.adsAvailable) return false;
  if (runs <= AD_POLICY.skipRuns) return false;
  return performance.now() - lastAttempt >= AD_POLICY.minGapMs;
}

// input is swallowed while a break runs (keyup is let through so held keys don't stick)
const BLOCK = ['keydown', 'keypress', 'click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu', 'wheel'];
function swallow(e) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); }

function showVeil(on) {
  clearTimeout(veilTm);
  if (on && !veil) {
    veil = document.createElement('div');
    veil.id = 'adVeil';
    veil.setAttribute('role', 'status');
    veil.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(11,13,18,0.88);color:#f2f4f8;font:600 18px/1.4 system-ui,sans-serif;letter-spacing:0.04em;'
      + 'opacity:0;transition:opacity 0.2s;pointer-events:auto;cursor:default;';
    veil.textContent = 'Back in a moment…';
    document.body.appendChild(veil);
  }
  if (!veil) return;
  veil.style.display = on ? 'flex' : 'none';
  veil.style.opacity = '0';
  if (on) veilTm = setTimeout(() => { if (veil) veil.style.opacity = '1'; }, AD_POLICY.veilDelayMs);
}

function enter() {
  active = true;
  for (const t of BLOCK) window.addEventListener(t, swallow, true);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  showVeil(true);
  notifyMute();
}
function exit() {
  active = false;
  for (const t of BLOCK) window.removeEventListener(t, swallow, true);
  showVeil(false);
  notifyMute(); // restores the player's own sound setting (or the portal's mute)
}

// run fn after a mid-game ad if the policy allows one now, else right away. Natural breaks only:
// leaving a results screen ("Race again", "Back to the island", "Main menu").
export function naturalBreak(fn) {
  if (active) return; // a second press while the break runs
  if (!policyAllows()) { fn(); return; }
  lastAttempt = performance.now(); // one attempt per gap, filled or not (unfilled / adblock / cooldown)
  enter();
  platform.commercialBreak({
    onStart: () => notifyMute(),
    onDone: () => { exit(); fn(); },
  });
}

// TODO(owner): rewarded ads are wired in the platform layer (platform.rewardedBreak / hasRewarded) but no UI
// offers one yet, because it touches the economy. Suggested hook: a "Watch an ad: double the prize" button on
// the Free Roam event results (ui.js results(), ctx.horizonReward), shown only when platform.hasRewarded(), e.g.
//   rewardedBreak(() => { app.profile.money += ctx.horizonReward.credits; app.save(); })
// A rewarded ad also restarts the midgame gap (CrazyGames counts it), so no midgame follows it straight away.
export function rewardedBreak(onGranted) {
  if (active || !platform.hasRewarded()) return false;
  enter();
  platform.rewardedBreak({
    onStart: () => notifyMute(),
    onDone: (granted) => { lastAttempt = performance.now(); exit(); if (granted) onGranted(); },
  });
  return true;
}

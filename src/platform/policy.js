// Every platform timing / pacing number lives here (ad breaks, SDK timeouts, save limits).
//
// Mid-game ad pacing. CrazyGames' requirements say the SDK itself paces midgame ads ("max 1 every 3 minutes",
// counting from the start of the game and from rewarded ads) and an early request just comes back as adError
// 'adCooldown'. We still keep our own gate so the "Back in a moment" veil never flashes for a request the SDK
// would refuse anyway, and so a future portal without SDK pacing gets the same behaviour.
export const AD_POLICY = {
  minGapMs: 180_000, // at most one break attempt per 3 min, counted from the previous attempt or from boot
  skipRuns: 1, // no break when leaving the results screen of the session's first finished race
  requestTimeoutMs: 10_000, // no adStarted within this -> give up and carry on
  maxAdMs: 90_000, // adStarted but no adFinished / adError within this -> give up and carry on
  veilDelayMs: 150, // the veil fades in after this, so an instant "no ad" never flashes it
};

export const SDK_TIMEOUTS = {
  loadMs: 8_000, // SDK <script> load (when it was not already in the page)
  initMs: 8_000, // SDK.init()
};

// CrazyGames Data module: 1 MB per game. Writes past this throw QuotaExceededError like localStorage does.
// Only the career save goes there (a few KB to a few tens of KB); ghost laps stay in localStorage on the
// device (see GHOST_PREFIX in main.js), because one ghost can be several hundred KB.
export const DATA_LIMIT_CHARS = 1_000_000;

// tests may tighten the policy before boot (window.__TURBOTOUR_AD_POLICY = { minGapMs: 0, ... }); not a URL param
if (typeof window !== 'undefined' && window.__TURBOTOUR_AD_POLICY && typeof window.__TURBOTOUR_AD_POLICY === 'object') {
  for (const k of Object.keys(AD_POLICY)) if (typeof window.__TURBOTOUR_AD_POLICY[k] === 'number') AD_POLICY[k] = window.__TURBOTOUR_AD_POLICY[k];
}

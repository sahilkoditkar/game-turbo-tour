# Turbo Tour on CrazyGames

This is the same platform layer as in [game-rally](https://github.com/sahilkoditkar/game-rally) (Dustline),
adapted to Turbo Tour. Check the CrazyGames numbers below (ad pacing, data limit, cover and video sizes)
against the live developer docs and the submission form before you submit.

## How the platform layer works

The game only imports `src/platform/index.js`. That module picks an adapter when the game starts and loads
only that adapter:

1. `window.TURBOTOUR_PLATFORM`, which a portal build sets in its `index.html`
2. otherwise the `?platform=` URL parameter (for testing)
3. otherwise `web`

| File | Role |
| --- | --- |
| `src/boot.js` | The entry point (`index.html` loads it). It waits for `platform.init()` (at most about 16 s), then loads `main.js`. |
| `src/platform/index.js` | The interface: `init`, `loadingStart/Stop`, `gameplayStart/Stop` (repeated calls are ignored), `happytime`, `commercialBreak`, `rewardedBreak`, `hasRewarded`, `onAudioMute`, and `storage` (works like localStorage). Every break calls `onDone` exactly once, with time limits. |
| `src/platform/web.js` | GitHub Pages. Every call does nothing and saves go to localStorage. |
| `src/platform/crazygames.js` | HTML5 SDK v3: `init`, the game events, `requestAd` for midgame and rewarded ads, `settings.muteAudio`, and saves through the Data module. |
| `src/platform/policy.js` | Every pacing number and timeout. |
| `src/platform/embed.js` | Applies only inside an iframe. It focuses the game at boot, stops PageUp, PageDown, Home and End from scrolling the portal page, and stops Tab (the map key) from moving focus out of the game while driving. |
| `src/adbreak.js` | What the game does around an ad: when one may run, freezing the game, muting, the "Back in a moment…" veil and blocking input. |

### Saves

On CrazyGames the career save (`turbotour.save.v1`: wallet, cars, upgrades, championships, Free Roam
progress and position) goes to the SDK Data module, under the same key as on the web. The first time a player
runs the game there, any `turbotour.*` values already in localStorage are copied into the Data module once.
Each write also goes to localStorage, so a later session with the SDK blocked still has recent saves.
Progress made in such a session is not copied back into the Data module later. Free Roam saves every few
seconds; a value that has not changed is not sent again.

Ghost laps (`turbotour.ghost.*`) stay in localStorage on the device on every platform: one ghost can be several
hundred KB, and the Data module has about 1 MB for the whole game.

If the SDK script is blocked or fails to load, or `init()` fails or takes too long, or the environment is
`disabled` (any domain that is not CrazyGames, localhost or `?useLocalSdk=true`), the adapter does nothing,
saves to localStorage, and logs one console warning. The game still starts.

### When the game calls the SDK

| Moment | Call |
| --- | --- |
| Boot, after `init` | `loadingStart` |
| Main menu up | `loadingStop` |
| Free Roam: "Building the world…" until the island is built | `loadingStart` … `loadingStop` |
| A race reaches GO, Free Roam starts, or the player is back to driving (resume from pause, map closed, garage or championship screen left) | `gameplayStart` |
| Pause, the map, a garage or championship screen, a "turn your phone" pause, all players finished, quit to the menu | `gameplayStop` (not when the tab is hidden: CrazyGames handles focus loss) |
| A solo win against AI, a championship title, a new best in Time Trial, a Free Roam level-up | `happytime` |
| "Race again", "Back to the island" or "Main menu" on a results screen | `requestAd('midgame')`, if the policy allows one |

The gameplay state is worked out once per frame in `App._isPlaying()` (`src/main.js`), so a new menu or overlay
only needs to set `app.paused` (as they all do already) to be counted correctly.

Ad policy (`src/platform/policy.js`):

- At most one ad attempt every 3 minutes, counted from boot and from the previous attempt.
- No ad after the session's first finished race.
- If `adStarted` has not arrived after 10 s, the game gives up on the ad and carries on.
- If an ad has started but not finished after 90 s, the game carries on.

No ad plays while the player is driving: only on leaving a results screen. Free Roam drive-up events and
championship rounds end on a results screen, so long Free Roam sessions get a break there too. During a break
the game loop is frozen, the sound is muted (the player's own Sound setting comes back after), and input is
blocked. CrazyGames' `settings.muteAudio` mutes the game on top of the player's setting without changing it.

Rewarded ads work in the platform layer, but the game has no button for them yet. See the TODO in
`src/adbreak.js` (a suggested "double the prize" button on Free Roam event results).

On a portal build the About screen drops the parts that are only true on the web build: the "no ads" and
"saved in your browser" FAQ answers and the links to GitHub (elements marked `data-web-only` in `index.html`).

## Build the zip

```bash
node scripts/build.mjs crazygames
```

```bash
node scripts/build.mjs web
```

These write `dist/turbotour-crazygames.zip` and `dist/turbotour-web.zip` (a plain copy of the game). The build
needs Node 18 or newer and no npm packages. The zip has `index.html` at its root, plus `showroom.html`,
`site.webmanifest`, `style.css`, `src/**`, `vendor/**` and `assets/**` (not `404.html`, `robots.txt` or
`sitemap.xml`, which are for GitHub Pages). The build adds these two tags to that `index.html` only:

```html
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
<script>window.TURBOTOUR_PLATFORM = "crazygames";</script>
```

To add another portal, add one entry to `TARGETS` in `scripts/build.mjs` and one adapter in `src/platform/`.

## Test locally

- **Headless tests** (need Playwright, and nothing installed in the repository):
  - `node tests/web.test.mjs` checks the web build (the repository as it is).
  - For the CrazyGames build, unzip it first, then run `node tests/crazygames.test.mjs <unzipped dir>`. This
    uses the mock SDK in `tests/cg-sdk-mock.js` and checks the boot events, the save migration, gameplay events
    in races and in Free Roam, midgame ads that finish, fail and hang, the portal mute, and a blocked SDK, a
    failed init and a `disabled` environment.
  - `node tests/iframe.test.mjs` checks iframe focus, keys not scrolling the parent page, Tab, and resizing.
- **Real SDK on localhost:** serve the unzipped build and open `http://localhost:<port>/`. On `localhost` and
  `127.0.0.1` the SDK runs in `local` mode, where ads are not available. On any other host, add
  `?useLocalSdk=true`.
- **QA tool:** this is the real check. In the developer portal, upload the zip and open it in the QA tool
  (preview). It runs the game as it would run on CrazyGames, tests the SDK features you implemented (ads,
  events, data) and reports problems against the requirements.

## Submitting

1. Sign in to the CrazyGames developer portal and create a new game. Choose the HTML5 type and upload
   `dist/turbotour-crazygames.zip`.
2. Check the build in the QA tool: the loading and gameplay events, a midgame ad after a few races (with the
   game muted while it plays), saves kept after a reload, and the desktop and mobile embed sizes.
3. Fill in the details page and upload the covers and videos (checklist below), then submit for review.
4. **Basic Launch:** the game goes live without CrazyGames customisation; ads stay disabled even if they are
   integrated, but the gameplay-start event must still fire. The game is measured on its play metrics.
5. **Full Launch:** only if CrazyGames selects the game. It then has to meet every integration requirement,
   including the SDK (game events, ads at natural breaks, honouring `muteAudio`), which this build does.
   Payments, if you ever add any, must use Xsolla.

## Metadata checklist (owner)

- [ ] **Title:** Turbo Tour
- [ ] **Short description** and a **longer description:** an open-world 3D racing game: a 6 km island in free
  roam, 16 circuits and 4 point-to-point stages, 12 cars with upgrades, championships, drifting and 2-player
  split screen.
- [ ] **Controls text:**
  - W A S D to drive (player 2: the arrow keys)
  - Shift or Space for the handbrake
  - R to reset the car onto the road
  - M or Tab for the map in Free Roam, Enter at a marker to start an event
  - Esc to pause
  - Gamepads supported; touch controls on mobile
- [ ] **Category / tags:** Driving, Racing (open world, drift, 3D, 2 player).
- [ ] **Covers** (in `media/covers/`, made from real renders of the game by `scripts/media/`), with no other
  portal's branding:
  - landscape 16:9, 1920×1080: `media/covers/landscape-1920x1080.png`
  - portrait 2:3, 800×1200: `media/covers/portrait-800x1200.png`
  - square 1:1, 800×800: `media/covers/square-800x800.png`
- [ ] **Preview videos** (in `media/video/`): 15–20 s of real gameplay (longer clips are cut at 20 s), at most
  50 MB each, H.264 MP4:
  - landscape 16:9, 1920×1080: `media/video/landscape-1920x1080.mp4`
  - portrait 2:3, 1080×1620: `media/video/portrait-1080x1620.mp4` (2:3 like the portrait cover; the
    uploader has been reported to reject 9:16 portrait clips)
- [ ] **Devices:** desktop and mobile. Split Screen is hidden on phones.
- [ ] **Age rating / content:** no violence, chat, user-generated content or purchases.

// Keyboard + gamepad + touch input. Two keyboard schemes so two players can share a keyboard.

export const SCHEMES = {
  wasd: { name: 'WASD', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], hb: ['ShiftLeft', 'Space'], reset: ['KeyR'] },
  arrows: { name: 'Arrow keys', up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], hb: ['ShiftRight', 'ControlRight', 'Slash'], reset: ['Period'] },
};

/** Touch-control preferences (saved in profile.settings.touch). */
export const TOUCH_DEFAULTS = {
  steer: 'drag',   // layout: 'drag' (slide to steer), 'wheel' (steering wheel), 'tilt' (gyro) or 'thumbs' (two thumbs + gear lever)
  sens: 1,         // steering sensitivity: higher = less thumb travel / rotation / tilt for full lock
  autoGas: false,  // accelerate automatically; the right thumb only brakes and drifts
  size: 1,         // control size
  swap: false,     // left-handed: steer with the right thumb, pedals on the left
  haptics: true,   // short vibrations on brake / drift / gear (Android)
  fullscreen: true, // go full screen when you start driving
  chosen: false,   // the layout chooser has been shown once
  pos: null,       // where the player dragged the controls: { steer, pedals, gear, mbtns } -> [x, y] centre as
                   // fractions of the screen. steer / pedals are stored as if not swapped and mirrored when swapped.
};
export const TOUCH_LAYOUTS = ['drag', 'wheel', 'tilt', 'thumbs'];

const STEER_ZONE_TOP = 150;          // px: a moved steering zone never reaches up into the top buttons / MAP
const PEDALS_W = 194, PEDALS_H = 172; // the pedal block, before scaling (see .tc-pedals in style.css)

/** Fixed control options. Gamepads are added dynamically from `connectedPads()`. */
const BASE_CONTROLS = [
  { id: 'wasd', name: 'Keyboard · WASD', scheme: 'wasd', pad: -1, keys: 'W A S D · Shift' },
  { id: 'arrows', name: 'Keyboard · Arrows', scheme: 'arrows', pad: -1, keys: '↑ ← ↓ → · R-Shift' },
  { id: 'touch', name: 'Touch', scheme: 'none', pad: -1, keys: 'Slide to steer · pedals', touchOnly: true },
];

/** Tidy a gamepad id like "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)". */
function padLabel(gp) {
  let name = (gp.id || 'Gamepad').replace(/\(.*?\)/g, '').replace(/vendor:.*$/i, '').replace(/\s+/g, ' ').trim();
  if (!name || /^[0-9a-f-]+$/i.test(name)) name = 'Gamepad';
  if (name.length > 28) name = name.slice(0, 26) + '…';
  return name;
}

/** Raw diagnostics for the settings screen. */
export function gamepadDiagnostics() {
  const out = { supported: typeof navigator.getGamepads === 'function', secure: window.isSecureContext, focused: document.hasFocus(), pads: [] };
  if (!out.supported) return out;
  try {
    const pads = navigator.getGamepads() || [];
    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp) { out.pads.push(null); continue; }
      out.pads.push({ index: gp.index, id: gp.id, connected: gp.connected, mapping: gp.mapping, axes: Array.from(gp.axes).map(a => +a.toFixed(2)), buttons: Array.from(gp.buttons).map(b => b.pressed ? 1 : (b.value > 0.1 ? +b.value.toFixed(2) : 0)) });
    }
  } catch (e) { out.error = String(e); }
  return out;
}

/** Currently connected gamepads: [{ index, name }]. */
export function connectedPads() {
  const out = [];
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads || []) if (gp && gp.connected !== false) out.push({ index: gp.index, name: padLabel(gp) });
  } catch (e) { /* no gamepad API */ }
  return out;
}

/** All selectable controls right now (keyboard, touch, one entry per connected gamepad). */
export function listControls() {
  const pads = connectedPads().map(p => ({ id: `pad${p.index}`, name: `🎮 ${p.name}`, sub: `#${p.index + 1}`, scheme: 'none', pad: p.index, keys: 'Stick · RT/LT · B' }));
  return [...BASE_CONTROLS.slice(0, 2), ...pads, BASE_CONTROLS[2]];
}

export function getControl(id) {
  const m = /^pad(\d+)$/.exec(id || '');
  if (m) return { id, name: `Gamepad ${+m[1] + 1}`, scheme: 'none', pad: +m[1], keys: 'Stick · RT/LT · B' };
  return BASE_CONTROLS.find(c => c.id === id) || BASE_CONTROLS[0];
}
export function padConnected(i) { return connectedPads().some(p => p.index === i); }

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPressed = new Map();
    const announce = () => window.dispatchEvent(new CustomEvent('controls-changed', { detail: connectedPads() }));
    window.addEventListener('gamepadconnected', (e) => { console.info('[gamepad] connected:', e.gamepad && e.gamepad.id, 'index', e.gamepad && e.gamepad.index); announce(); });
    window.addEventListener('gamepaddisconnected', (e) => { console.info('[gamepad] disconnected:', e.gamepad && e.gamepad.id); announce(); });
    // Some browsers only surface a pad after its first button press; poll lightly as a fallback.
    this._padSig = '';
    setInterval(() => {
      const sig = connectedPads().map(p => p.index + ':' + p.name).join('|');
      if (sig !== this._padSig) { this._padSig = sig; announce(); }
    }, 1500);
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false, pause: false };
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this._buildTouch();
  }

  /** Call once per frame after consuming. */
  endFrame() { this.pressed.clear(); this.touch.reset = false; this.touch.pause = false; }

  justPressed(code) { return this.pressed.has(code); }
  down(code) { return this.keys.has(code); }
  anyDown(codes) { return codes.some(c => this.keys.has(c)); }

  gamepad(i) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return pads && pads[i] ? pads[i] : null;
  }

  /** Read a player's controls. Touch controls are merged into player 0. */
  read(schemeId, padIndex, playerIndex = 0) {
    const s = SCHEMES[schemeId] || null;
    const out = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false, pause: false };
    if (s) {
      if (this.anyDown(s.up)) out.throttle = 1;
      if (this.anyDown(s.down)) out.brake = 1;
      if (this.anyDown(s.left)) out.steer -= 1;
      if (this.anyDown(s.right)) out.steer += 1;
      out.handbrake = this.anyDown(s.hb);
      out.reset = s.reset.some(c => this.pressed.has(c));
    }

    const pad = padIndex >= 0 ? this.gamepad(padIndex) : null;
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.12) out.steer = Math.abs(ax) > Math.abs(out.steer) ? ax : out.steer;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      out.throttle = Math.max(out.throttle, rt, pad.buttons[0]?.pressed ? 1 : 0);
      out.brake = Math.max(out.brake, lt, pad.buttons[2]?.pressed ? 1 : 0);
      out.handbrake = out.handbrake || !!pad.buttons[1]?.pressed || !!pad.buttons[5]?.pressed;
      const start = !!pad.buttons[9]?.pressed;
      const key = `${padIndex}:start`;
      if (start && !this.padPressed.get(key)) out.pause = true;
      this.padPressed.set(key, start);
      const y = !!pad.buttons[3]?.pressed;
      const keyY = `${padIndex}:y`;
      if (y && !this.padPressed.get(keyY)) out.reset = true;
      this.padPressed.set(keyY, y);
    }

    if (playerIndex === 0 && this.touchVisible) {
      const t = this.touch;
      if (this.touchPrefs.steer === 'thumbs') this._gearPedals();
      out.throttle = Math.max(out.throttle, t.throttle);
      out.brake = Math.max(out.brake, t.brake);
      const steer = this.touchPrefs.steer === 'tilt' ? this._tiltSteer() : t.steer;
      if (steer !== 0) out.steer = steer;
      out.handbrake = out.handbrake || t.handbrake;
      out.reset = out.reset || t.reset;
      out.pause = out.pause || t.pause;
    }
    return out;
  }

  // ---------------------------------------------------------------- Touch
  //
  // Built around how a phone is held in landscape: both thumbs pivot from low on the short
  // edges, so the easy reach is an arc a few centimetres in from each edge, not the corners
  // and not the top of the screen. Four layouts (TOUCH_LAYOUTS):
  //
  // - drag:   the left thumb lands anywhere on the left and slides sideways: analog, and the
  //           anchor follows the thumb past full lock so reversing responds at once.
  // - wheel:  an on-screen steering wheel the left thumb turns.
  // - tilt:   turn the phone like a wheel; the left thumb brakes.
  //   These three share one pedal surface for the right thumb, hit-tested as the finger moves:
  //   hold GAS, slide inward onto BRAKE or up onto DRIFT without lifting. Sliding from GAS onto
  //   DRIFT keeps the throttle on, which is how a drift is held in this game.
  // - thumbs: left thumb = turn left, right thumb = turn right. In the middle a gear lever
  //           (D drives on its own, R reverses) and BRAKE, which drops the lever back to N; held
  //           at a stop it reverses. Plus a small DRIFT button.
  //
  // Reset and pause are small and out of the thumbs' way, where they can't be hit by accident.

  _buildTouch() {
    const el = document.createElement('div');
    el.id = 'touch-controls';
    el.className = 'hidden';
    const spokes = [90, 210, 330].map(a => `<line x1="50" y1="50" x2="${50 + 38 * Math.cos(a * Math.PI / 180)}" y2="${50 + 38 * Math.sin(a * Math.PI / 180)}"/>`).join('');
    el.innerHTML = `
      <div class="tc-steer">
        <div class="tc-wheel"><div class="tc-track"><span>◀</span><span>▶</span><i class="tc-knob"></i></div><div class="tc-label">Slide to steer</div></div>
        <div class="tc-sw"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" class="rim"/><g class="spokes">${spokes}</g><circle cx="50" cy="50" r="11" class="hub"/><rect x="46" y="4" width="8" height="9" rx="2" class="mark"/></svg></div>
        <div class="tc-tiltbrake"><b>BRAKE</b><small>Tilt the phone to steer</small></div>
      </div>
      <div class="tc-pedals">
        <div class="tc-pedal drift" data-p="drift"><b>DRIFT</b></div>
        <div class="tc-pedal brake" data-p="brake"><b>BRAKE</b></div>
        <div class="tc-pedal gas" data-p="gas"><b>GAS</b></div>
      </div>
      <div class="tc-turn left" data-dir="-1"><div class="tc-pad">◀</div></div>
      <div class="tc-turn right" data-dir="1"><div class="tc-pad">▶</div></div>
      <div class="tc-gear" aria-label="Gear lever"><span data-g="D">D</span><span data-g="N">N</span><span data-g="R">R</span><i class="tc-gknob">N</i></div>
      <div class="tc-mbtns">
        <div class="tc-pedal drift" data-m="drift"><b>DRIFT</b></div>
        <div class="tc-pedal brake" data-m="brake"><b>BRAKE</b></div>
      </div>
      <div class="tc-sys">
        <button type="button" class="tc-btn" data-tc="reset" aria-label="Reset to track">↺</button>
        <button type="button" class="tc-btn" data-tc="pause" aria-label="Pause">❚❚</button>
      </div>
      <button type="button" class="tc-btn tc-fs" data-tc="fullscreen" aria-label="Full screen">⛶</button>`;
    document.body.appendChild(el);
    this.touchEl = el;
    this.touchVisible = false;
    this.touchPrefs = { ...TOUCH_DEFAULTS };
    this.vf = 0;                 // the player's forward speed (m/s), set by the race / free roam each frame
    this.onFullscreen = null;    // set by the app: what the ⛶ button does
    this._steerPtr = null;       // drag / wheel: { id, ... }
    this._pedalPtrs = new Map(); // pointerId -> { pedal, fromGas }
    this._tilt = null;           // { beta, gamma } from deviceorientation
    this._tiltBrake = new Set();
    this._turns = [];            // thumbs: [{ id, dir }] most recent last
    this._mid = new Map();       // thumbs: pointerId -> 'brake' | 'drift'
    this.gear = 'N';             // thumbs: 'D' | 'N' | 'R'
    this._brakeStop = false;     // thumbs: this brake press started while reversing: it only stops

    const q = (s) => el.querySelector(s);
    const zone = q('.tc-steer');
    const pedals = q('.tc-pedals');
    this._els = {
      zone, pedals, wheel: q('.tc-wheel'), knob: q('.tc-knob'), sw: q('.tc-sw'), swSvg: q('.tc-sw svg'),
      tiltbrake: q('.tc-tiltbrake'), pedalEls: [...pedals.querySelectorAll('[data-p]')],
      gear: q('.tc-gear'), gknob: q('.tc-gknob'), mbtns: q('.tc-mbtns'), turns: [...el.querySelectorAll('.tc-turn')], mid: [...el.querySelectorAll('[data-m]')], fs: q('.tc-fs'),
    };
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    const capture = (target, e) => { try { target.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } };
    const onUp = (target, fn) => { for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) target.addEventListener(ev, fn); };

    // ---- steering zone (drag / wheel / tilt-brake)
    zone.addEventListener('pointerdown', (e) => {
      stop(e);
      const mode = this.touchPrefs.steer;
      if (mode === 'tilt') {
        capture(zone, e);
        this._tiltBrake.add(e.pointerId);
        if (this._tiltBrake.size === 1) this._buzz(8);
        this._applyTouch();
        return;
      }
      if (this._steerPtr) return; // one steering thumb at a time
      capture(zone, e);
      if (mode === 'wheel') {
        const r = this._els.sw.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        this._steerPtr = { id: e.pointerId, cx, cy, last: Math.atan2(e.clientY - cy, e.clientX - cx), rot: 0 };
        this._els.sw.classList.add('active');
        return;
      }
      this._steerPtr = { id: e.pointerId, anchor: e.clientX };
      this._placeWheel(e.clientX, e.clientY);
      this._steerMove(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (this._steerPtr && this._steerPtr.id === e.pointerId) this._steerMove(e.clientX, e.clientY);
    });
    onUp(zone, (e) => {
      if (this._tiltBrake.delete(e.pointerId)) { this._applyTouch(); return; }
      if (!this._steerPtr || this._steerPtr.id !== e.pointerId) return;
      this._steerPtr = null;
      this.touch.steer = 0;
      this._layoutTouch();
      this._applyTouch();
    });

    // ---- pedals: one surface, the finger is hit-tested as it slides
    pedals.addEventListener('pointerdown', (e) => {
      stop(e);
      capture(pedals, e);
      const p = this._pedalAt(e.clientX, e.clientY) || 'gas';
      this._pedalPtrs.set(e.pointerId, { pedal: p, fromGas: p === 'gas' });
      if (p !== 'gas') this._buzz(p === 'drift' ? 14 : 8);
      this._applyTouch();
    });
    pedals.addEventListener('pointermove', (e) => {
      const f = this._pedalPtrs.get(e.pointerId);
      if (!f) return;
      const p = this._pedalAt(e.clientX, e.clientY);
      if (!p || p === f.pedal) return;
      // gas -> drift keeps the throttle on; anything via brake drops it
      if (p === 'drift') f.fromGas = f.pedal === 'gas' || (f.pedal === 'drift' && f.fromGas);
      else f.fromGas = p === 'gas';
      f.pedal = p;
      if (p !== 'gas') this._buzz(p === 'drift' ? 14 : 8);
      this._applyTouch();
    });
    onUp(pedals, (e) => { if (this._pedalPtrs.delete(e.pointerId)) this._applyTouch(); });

    // ---- two thumbs: turn zones
    for (const z of this._els.turns) {
      const dir = +z.dataset.dir;
      z.addEventListener('pointerdown', (e) => {
        stop(e); capture(z, e);
        this._turns = this._turns.filter(t => t.id !== e.pointerId);
        this._turns.push({ id: e.pointerId, dir });
        this._applyTouch();
      });
      onUp(z, (e) => {
        const n = this._turns.length;
        this._turns = this._turns.filter(t => t.id !== e.pointerId);
        if (this._turns.length !== n) this._applyTouch();
      });
    }
    // ---- two thumbs: brake and drift
    for (const b of this._els.mid) {
      const what = b.dataset.m;
      b.addEventListener('pointerdown', (e) => {
        stop(e); capture(b, e);
        this._mid.set(e.pointerId, what);
        if (what === 'brake') {
          // braking drops the lever back to N; a press while reversing only stops the car
          this._brakeStop = this.vf < -0.5;
          this._setGear('N', false);
        }
        this._buzz(what === 'drift' ? 14 : 8);
        this._applyTouch();
      });
      onUp(b, (e) => { if (this._mid.delete(e.pointerId)) this._applyTouch(); });
    }
    // ---- two thumbs: gear lever. Drag (or tap) it: D at the top, N in the middle, R at the bottom.
    const gear = this._els.gear;
    let gearPtr = null;
    const gearAt = (y) => {
      const r = gear.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (y - r.top) / r.height));
      return { f, g: f < 1 / 3 ? 'D' : f < 2 / 3 ? 'N' : 'R' };
    };
    gear.addEventListener('pointerdown', (e) => {
      stop(e); capture(gear, e);
      gearPtr = e.pointerId;
      gear.classList.add('active');
      const { f, g } = gearAt(e.clientY);
      this._els.gknob.style.top = (f * 100) + '%';
      this._setGear(g, true);
    });
    gear.addEventListener('pointermove', (e) => {
      if (e.pointerId !== gearPtr) return;
      const { f, g } = gearAt(e.clientY);
      this._els.gknob.style.top = (f * 100) + '%';
      this._setGear(g, true);
    });
    onUp(gear, (e) => {
      if (e.pointerId !== gearPtr) return;
      gearPtr = null;
      gear.classList.remove('active');
      this._setGear(this.gear, false); // snap the knob to its slot
    });

    // ---- reset / pause / full screen
    el.querySelectorAll('[data-tc]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        if (b.dataset.tc === 'fullscreen') return; // needs a click (a full user gesture) instead
        stop(e);
        if (b.dataset.tc === 'reset') this.touch.reset = true; else this.touch.pause = true;
        b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 150);
      });
    });
    this._els.fs.addEventListener('click', () => { if (this.onFullscreen) this.onFullscreen(); });
    el.addEventListener('contextmenu', stop);

    window.addEventListener('resize', () => { if (this.touchVisible) this._layoutTouch(); });
    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      this._tilt = { beta: e.beta, gamma: e.gamma };
    });
  }

  /** Apply the player's touch preferences (see TOUCH_DEFAULTS). */
  setTouchPrefs(prefs) {
    const p = this.touchPrefs = { ...TOUCH_DEFAULTS, ...(prefs || {}) };
    if (!TOUCH_LAYOUTS.includes(p.steer)) p.steer = 'drag';
    const el = this.touchEl;
    for (const m of TOUCH_LAYOUTS) el.classList.toggle('mode-' + m, p.steer === m);
    el.classList.toggle('swap', !!p.swap);
    el.classList.toggle('autogas', !!p.autoGas);
    el.style.setProperty('--s', String(p.size));
    document.body.classList.toggle('tc-thumbs', p.steer === 'thumbs');
    this._resetTouchState();
    this._layoutTouch();
    this._applyTouch();
  }

  _resetTouchState() {
    this._steerPtr = null; this._pedalPtrs.clear(); this._tiltBrake.clear(); this._turns = []; this._mid.clear();
    this.touch.throttle = 0; this.touch.brake = 0; this.touch.steer = 0; this.touch.handbrake = false;
    this._setGear('N', false);
  }

  /** Show whether the ⛶ button is needed (hidden once the page is full screen). */
  setFullscreenButton(show) { this._els.fs.classList.toggle('hidden', !show); }

  /** Where the steering control rests: in the left thumb's natural reach. */
  _restPoint() {
    const r = this._els.zone.getBoundingClientRect();
    const s = this.touchPrefs.size;
    const c = this._customPos('steer');
    if (c) return { x: c[0], y: c[1], r };
    const fromEdge = Math.min(Math.max(120 * s, r.width * 0.3), r.width * 0.5);
    const x = this.touchPrefs.swap ? r.right - fromEdge : r.left + fromEdge;
    const y = r.bottom - Math.min((this.touchPrefs.steer === 'wheel' ? 90 : 78) * s, r.height * 0.4);
    return { x, y, r };
  }

  _steerRange() { return 62 / (this.touchPrefs.sens || 1); }

  /** Position the drag-steering track, centred on an anchor (screen coordinates). */
  _placeWheel(x, y) {
    const { wheel } = this._els;
    const r = this._els.zone.getBoundingClientRect();
    wheel.style.left = (x - r.left) + 'px';
    wheel.style.top = (y - r.top) + 'px';
  }

  /** A control's centre on screen (px) if the player moved it, else null. */
  _customPos(key) {
    const p = this.touchPrefs.pos && this.touchPrefs.pos[key];
    if (!Array.isArray(p)) return null;
    const mirror = this.touchPrefs.swap && (key === 'steer' || key === 'pedals');
    return [(mirror ? 1 - p[0] : p[0]) * window.innerWidth, p[1] * window.innerHeight];
  }

  /** Put moved controls where the player left them (or back to the default layout). */
  _applyPositions() {
    const { zone, pedals, gear, mbtns } = this._els;
    const H = window.innerHeight, s = this.touchPrefs.size;
    const st = this._customPos('steer');
    if (st) {
      // the steering zone becomes the whole half the control sits in, from a little above it down
      const top = Math.max(STEER_ZONE_TOP, Math.min(H * 0.4, st[1] - 110 * s));
      zone.style.width = '50%'; zone.style.height = (H - top) + 'px';
    } else { zone.style.width = ''; zone.style.height = ''; }
    const place = (e, c, w, h) => {
      if (!c) { for (const k of ['left', 'top', 'right', 'bottom', 'transformOrigin']) e.style[k] = ''; return; }
      Object.assign(e.style, { left: (c[0] - w / 2) + 'px', top: (c[1] - h / 2) + 'px', right: 'auto', bottom: 'auto' });
    };
    place(pedals, this._customPos('pedals'), PEDALS_W, PEDALS_H);
    if (this._customPos('pedals')) pedals.style.transformOrigin = '50% 50%';
    for (const [k, e] of [['gear', gear], ['mbtns', mbtns]]) {
      const c = this._customPos(k);
      if (!c) { place(e, null); e.style.transform = ''; continue; }
      Object.assign(e.style, { left: c[0] + 'px', top: c[1] + 'px', right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' });
    }
  }

  /** The controls that can be moved in the current layout, and their elements. */
  _movables() {
    const e = this._els, m = this.touchPrefs.steer;
    if (m === 'thumbs') return [['gear', e.gear], ['mbtns', e.mbtns]];
    return [['steer', { drag: e.wheel, wheel: e.sw, tilt: e.tiltbrake }[m]], ['pedals', e.pedals]];
  }

  get editing() { return !!this._edit; }

  /** "Move controls": the controls appear over the screen and the player drags them where they
   * like. Dragging the steering or the pedals over the middle swaps the sides.
   * onChange(prefs) is called after each move so the app can save; onDone() when they finish. */
  editLayout({ onChange, onDone } = {}) {
    if (this._edit || !this._els) return;
    const el = this.touchEl;
    const ed = this._edit = { wasHidden: el.classList.contains('hidden'), drag: null };
    el.classList.remove('hidden');
    el.classList.add('editing');
    this._resetTouchState();
    this._layoutTouch();
    this._applyTouch();
    const layer = ed.layer = document.createElement('div');
    layer.className = 'tc-edit';
    layer.innerHTML = `<div class="tc-editbar"><span>Drag the controls where your thumbs rest. Drag across the middle to switch sides.</span>
      <button type="button" class="small" data-e="reset">Reset</button><button type="button" class="small primary" data-e="done">Done</button></div>`;
    el.appendChild(layer);
    const mark = () => {
      for (const e of el.querySelectorAll('.tc-movable')) e.classList.remove('tc-movable');
      for (const [, e] of this._movables()) e.classList.add('tc-movable');
    };
    mark();
    const changed = () => { if (onChange) onChange(this.touchPrefs); };
    layer.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tc-editbar')) return;
      if (e.cancelable) e.preventDefault();
      if (ed.drag) return;
      const pad = 24;
      for (const [k, item] of this._movables()) {
        const r = item.getBoundingClientRect();
        if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) continue;
        ed.drag = { id: e.pointerId, k, item, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2), w: r.width, h: r.height };
        try { layer.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
        item.classList.add('grabbed');
        this._buzz(8);
        break;
      }
    });
    layer.addEventListener('pointermove', (e) => {
      const d = ed.drag;
      if (d && d.id === e.pointerId) this._moveControl(d, e.clientX - d.ox, e.clientY - d.oy);
    });
    const end = (e) => {
      const d = ed.drag;
      if (!d || d.id !== e.pointerId) return;
      d.item.classList.remove('grabbed');
      ed.drag = null;
      changed();
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) layer.addEventListener(ev, end);
    layer.querySelector('[data-e=reset]').addEventListener('click', () => {
      const pos = { ...(this.touchPrefs.pos || {}) };
      for (const [k] of this._movables()) delete pos[k];
      this.touchPrefs.pos = Object.keys(pos).length ? pos : null;
      this._layoutTouch();
      changed();
    });
    layer.querySelector('[data-e=done]').addEventListener('click', () => {
      layer.remove();
      for (const e of el.querySelectorAll('.tc-movable')) e.classList.remove('tc-movable', 'grabbed');
      el.classList.remove('editing');
      if (ed.wasHidden && !this.touchVisible) el.classList.add('hidden');
      this._edit = null;
      this._layoutTouch();
      if (onDone) onDone();
    });
  }

  _moveControl(d, cx, cy) {
    const W = window.innerWidth, H = window.innerHeight, p = this.touchPrefs, m = 8;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const sided = d.k === 'steer' || d.k === 'pedals';
    let swap = p.swap;
    if (d.k === 'steer') swap = cx > W / 2;
    else if (d.k === 'pedals') swap = cx < W / 2;
    const onRight = d.k === 'steer' ? swap : d.k === 'pedals' ? !swap : null;
    // keep it on screen, below the editor bar, and (steering / pedals) on its own half
    cx = clamp(cx, d.w / 2 + m, W - d.w / 2 - m);
    if (onRight === true) cx = Math.max(cx, W / 2);
    if (onRight === false) cx = Math.min(cx, W / 2);
    const minY = d.k === 'steer' ? Math.max(H * 0.4, STEER_ZONE_TOP + 40) : 64 + d.h / 2;
    cy = clamp(cy, Math.min(minY, H - d.h / 2 - m), H - d.h / 2 - m);
    const fx = sided && swap ? 1 - cx / W : cx / W;
    p.pos = { ...(p.pos || {}), [d.k]: [+fx.toFixed(4), +(cy / H).toFixed(4)] };
    if (swap !== p.swap) { p.swap = swap; this.touchEl.classList.toggle('swap', swap); }
    this._layoutTouch();
  }

  _layoutTouch() {
    if (!this._els) return;
    this._applyPositions();
    const { wheel, knob, sw, swSvg, tiltbrake, zone } = this._els;
    wheel.style.setProperty('--range', this._steerRange() + 'px');
    knob.style.transform = 'translate(-50%, -50%)';
    wheel.classList.remove('active');
    sw.classList.remove('active');
    swSvg.style.transform = 'rotate(0deg)';
    const { x, y, r } = this._restPoint();
    this._placeWheel(x, y);
    for (const e of [sw, tiltbrake]) { e.style.left = (x - r.left) + 'px'; e.style.top = (y - r.top) + 'px'; }
    void zone;
  }

  _steerMove(x, y) {
    const st = this._steerPtr;
    if (this.touchPrefs.steer === 'wheel') {
      // turning the wheel: the angle the thumb sweeps round its centre
      const dx = x - st.cx, dy = y - st.cy;
      if (Math.hypot(dx, dy) < 14) return; // too close to the hub to read an angle
      const a = Math.atan2(dy, dx);
      let d = a - st.last;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      st.last = a;
      const full = (110 / (this.touchPrefs.sens || 1)) * Math.PI / 180;
      st.rot = Math.max(-full * 1.15, Math.min(full * 1.15, st.rot + d));
      this._els.swSvg.style.transform = `rotate(${st.rot}rad)`;
      const k = st.rot / full, dz = 0.04;
      this.touch.steer = Math.abs(k) <= dz ? 0 : Math.sign(k) * Math.min(1, (Math.abs(k) - dz) / (1 - dz));
      return;
    }
    // drag: analog around the anchor, which is dragged along past full lock
    const R = this._steerRange();
    let dx = x - st.anchor;
    if (dx > R) { st.anchor = x - R; dx = R; } else if (dx < -R) { st.anchor = x + R; dx = -R; }
    const { wheel, knob } = this._els;
    wheel.classList.add('active');
    const r = this._els.zone.getBoundingClientRect();
    wheel.style.left = (st.anchor - r.left) + 'px';
    knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    const raw = dx / R, dz = 0.06, a = Math.abs(raw);
    // small dead zone, then a gentle curve: fine corrections near the centre, full lock at the edge
    this.touch.steer = a <= dz ? 0 : Math.sign(raw) * Math.pow((a - dz) / (1 - dz), 1.3);
  }

  _pedalAt(x, y) {
    let best = null, bestD = Infinity;
    for (const el of this._els.pedalEls) {
      if (el.offsetParent === null) continue; // hidden (auto gas)
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = el.dataset.p; }
    }
    // in a gap between pedals the nearest one wins; far outside, the finger keeps what it had
    return bestD < 40 ? best : null;
  }

  _setGear(g, buzz) {
    if (g !== this.gear) { this.gear = g; if (buzz) this._buzz(18); }
    const { gear, gknob } = this._els;
    if (!gear.classList.contains('active')) gknob.style.top = { D: 1 / 6, N: 0.5, R: 5 / 6 }[this.gear] * 100 + '%';
    gknob.textContent = this.gear;
    gear.dataset.gear = this.gear;
  }

  /** Two-thumb layout: throttle and brake come from the gear lever and BRAKE, and depend on the
   * car's speed, so they are worked out every frame. */
  _gearPedals() {
    const t = this.touch;
    let thr = 0, brk = 0;
    const braking = [...this._mid.values()].includes('brake');
    if (braking) {
      if (this._brakeStop) { if (this.vf < -0.3) thr = 1; }  // pressed while reversing: just stop
      else brk = 1;                                          // brake, and reverse once stopped
    } else if (this.gear === 'D') thr = 1;
    else if (this.gear === 'R') brk = 1;                     // brake input reverses once stopped
    t.throttle = thr; t.brake = brk;
  }

  _applyTouch() {
    const t = this.touch, p = this.touchPrefs;
    if (p.steer === 'thumbs') {
      t.steer = this._turns.length ? this._turns[this._turns.length - 1].dir : 0;
      t.handbrake = [...this._mid.values()].includes('drift');
      for (const z of this._els.turns) z.classList.toggle('on', this._turns.length > 0 && +z.dataset.dir === t.steer);
      for (const b of this._els.mid) b.classList.toggle('on', [...this._mid.values()].includes(b.dataset.m));
      this._gearPedals();
      return;
    }
    let gas = false, brake = this._tiltBrake.size > 0, drift = false;
    for (const f of this._pedalPtrs.values()) {
      if (f.pedal === 'gas') gas = true;
      else if (f.pedal === 'brake') brake = true;
      else if (f.pedal === 'drift') { drift = true; if (f.fromGas) gas = true; }
    }
    if (p.autoGas) gas = !brake;
    t.throttle = gas ? 1 : 0;
    t.brake = brake ? 1 : 0;
    t.handbrake = drift;
    for (const el of this._els.pedalEls) {
      const k = el.dataset.p;
      el.classList.toggle('on', k === 'gas' ? gas && !p.autoGas : k === 'brake' ? brake : drift);
    }
    this._els.tiltbrake.classList.toggle('on', this._tiltBrake.size > 0);
  }

  _buzz(ms) {
    if (!this.touchPrefs.haptics || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (e) { /* not allowed */ }
  }

  /** Steering from the phone's tilt, like turning a wheel. Uses the direction of gravity in the
   * plane of the screen, so it works however far back the phone is tipped. */
  _tiltSteer() {
    const t = this._tilt;
    if (!t) return 0;
    const D = Math.PI / 180, b = t.beta * D, g = t.gamma * D;
    // gravity in device coordinates (W3C deviceorientation, Z-X'-Y'' Euler angles)
    const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b);
    let ang = 0;
    try { ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0; } catch (e) { ang = window.orientation || 0; }
    const th = ((+ang || 0) + 360) % 360 * D;
    const sx = dx * Math.cos(th) - dy * Math.sin(th);      // along the screen's right
    const sd = -(dx * Math.sin(th) + dy * Math.cos(th));   // along the screen's down
    if (Math.hypot(sx, sd) < 0.25) return 0;              // lying flat: no reliable reading
    const deg = Math.atan2(sx, sd) / D;                    // + when the phone is turned clockwise
    const full = 26 / (this.touchPrefs.sens || 1), dz = 2.5;
    const a = Math.abs(deg);
    return a <= dz ? 0 : Math.sign(deg) * Math.min(1, (a - dz) / (full - dz));
  }

  /** Show the on-screen controls. `where` is 'race' or 'roam' (the free-roam HUD has a MAP button). */
  setTouchVisible(on, where = 'race') {
    this.touchVisible = on && this.isTouchDevice;
    this.touchEl.classList.toggle('hidden', !this.touchVisible);
    this.touchEl.classList.toggle('roam', where === 'roam');
    document.body.classList.toggle('touch-ui', this.touchVisible);
    this._resetTouchState();
    if (this.touchVisible) { this._layoutTouch(); this._applyTouch(); }
  }
}

/** iOS asks before a page may read the motion sensors; must be called from a tap. */
export async function requestTiltPermission() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission !== 'function') return true;
  try { return (await DOE.requestPermission()) === 'granted'; } catch (e) { return false; }
}

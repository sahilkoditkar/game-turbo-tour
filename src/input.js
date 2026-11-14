// Keyboard + gamepad + touch input. Two keyboard schemes so two players can share a keyboard.

export const SCHEMES = {
  wasd: { name: 'WASD', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], hb: ['ShiftLeft', 'Space'], reset: ['KeyR'] },
  arrows: { name: 'Arrow keys', up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], hb: ['ShiftRight', 'ControlRight', 'Slash'], reset: ['Period'] },
};

/** Touch-control preferences (saved in profile.settings.touch). */
export const TOUCH_DEFAULTS = {
  steer: 'drag',   // 'drag' (analog slide), 'buttons' (left/right rocker) or 'tilt'
  sens: 1,         // steering sensitivity: higher = less thumb travel / tilt for full lock
  autoGas: false,  // accelerate automatically; the right thumb only brakes and drifts
  size: 1,         // pedal and steering size
  swap: false,     // left-handed: steer with the right thumb, pedals on the left
  haptics: true,   // short vibrations on brake / drift (Android)
};

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
  // Built around how a phone is held in landscape: both thumbs pivot from the lower part of
  // the short edges, so the easy reach is an arc a few centimetres in from each edge, not the
  // corners and not the top of the screen.
  //
  // - Steering (left thumb) is a large invisible zone, not two small buttons. In "drag" mode
  //   the thumb lands anywhere in it and slides sideways: analog, and the anchor follows the
  //   thumb past full lock so reversing the steering responds at once. "Buttons" mode is one
  //   left/right rocker the thumb can slide across, "tilt" steers with the phone and turns the
  //   zone into a big brake pedal.
  // - Pedals (right thumb) are one surface: the finger is hit-tested as it moves, so the thumb
  //   slides from GAS to BRAKE or up onto DRIFT without lifting. Sliding from GAS onto DRIFT
  //   keeps the throttle on, which is how a handbrake drift is held in this game.
  // - Reset and pause are small and out of the thumbs' way, where they can't be hit by accident.

  _buildTouch() {
    const el = document.createElement('div');
    el.id = 'touch-controls';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="tc-steer">
        <div class="tc-wheel"><div class="tc-track"><span>◀</span><span>▶</span><i class="tc-knob"></i></div><div class="tc-label">Slide to steer</div></div>
        <div class="tc-rocker"><span data-side="-1">◀</span><span data-side="1">▶</span></div>
        <div class="tc-tiltbrake"><b>BRAKE</b><small>Tilt the phone to steer</small></div>
      </div>
      <div class="tc-pedals">
        <div class="tc-pedal drift" data-p="drift"><b>DRIFT</b></div>
        <div class="tc-pedal brake" data-p="brake"><b>BRAKE</b></div>
        <div class="tc-pedal gas" data-p="gas"><b>GAS</b></div>
      </div>
      <div class="tc-sys">
        <button type="button" class="tc-btn" data-tc="reset" aria-label="Reset to track">↺</button>
        <button type="button" class="tc-btn" data-tc="pause" aria-label="Pause">❚❚</button>
      </div>
      <div class="tc-rotate">↻ Turn your phone sideways to drive</div>`;
    document.body.appendChild(el);
    this.touchEl = el;
    this.touchVisible = false;
    this.touchPrefs = { ...TOUCH_DEFAULTS };
    this._steerPtr = null;     // { id, anchor, x, side }
    this._pedalPtrs = new Map(); // pointerId -> { pedal, fromGas }
    this._tilt = null;           // { beta, gamma } from deviceorientation
    this._tiltBrake = new Set();

    const zone = el.querySelector('.tc-steer');
    const wheel = el.querySelector('.tc-wheel');
    const knob = el.querySelector('.tc-knob');
    const rocker = el.querySelector('.tc-rocker');
    const pedals = el.querySelector('.tc-pedals');
    const pedalEls = [...pedals.querySelectorAll('[data-p]')];
    this._els = { zone, wheel, knob, rocker, pedals, pedalEls };
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    const capture = (target, e) => { try { target.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } };

    // ---- steering zone
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
      this._steerPtr = { id: e.pointerId, anchor: e.clientX, x: e.clientX, y: e.clientY, side: 0 };
      if (mode === 'drag') this._placeWheel(e.clientX, e.clientY);
      this._steerMove(e.clientX);
    });
    zone.addEventListener('pointermove', (e) => {
      if (this._steerPtr && this._steerPtr.id === e.pointerId) this._steerMove(e.clientX);
    });
    const zoneUp = (e) => {
      if (this._tiltBrake.delete(e.pointerId)) { this._applyTouch(); return; }
      if (!this._steerPtr || this._steerPtr.id !== e.pointerId) return;
      this._steerPtr = null;
      this.touch.steer = 0;
      this._layoutTouch();
      this._applyTouch();
    };
    zone.addEventListener('pointerup', zoneUp);
    zone.addEventListener('pointercancel', zoneUp);
    zone.addEventListener('lostpointercapture', zoneUp);

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
    const pedalUp = (e) => { if (this._pedalPtrs.delete(e.pointerId)) this._applyTouch(); };
    pedals.addEventListener('pointerup', pedalUp);
    pedals.addEventListener('pointercancel', pedalUp);
    pedals.addEventListener('lostpointercapture', pedalUp);

    // ---- reset / pause
    el.querySelectorAll('[data-tc]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        stop(e);
        if (b.dataset.tc === 'reset') this.touch.reset = true; else this.touch.pause = true;
        b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 150);
      });
    });
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
    const el = this.touchEl;
    el.classList.remove('mode-drag', 'mode-buttons', 'mode-tilt');
    el.classList.add('mode-' + p.steer);
    el.classList.toggle('swap', !!p.swap);
    el.classList.toggle('autogas', !!p.autoGas);
    el.style.setProperty('--s', String(p.size));
    this._steerPtr = null; this._tiltBrake.clear(); this.touch.steer = 0;
    this._layoutTouch();
    this._applyTouch();
  }

  /** Where the steering control rests: in the left thumb's natural reach. */
  _restPoint() {
    const r = this._els.zone.getBoundingClientRect();
    const s = this.touchPrefs.size;
    const fromEdge = Math.min(Math.max(120 * s, r.width * 0.3), r.width * 0.5);
    const x = this.touchPrefs.swap ? r.right - fromEdge : r.left + fromEdge;
    const y = r.bottom - Math.min(78 * s, r.height * 0.4);
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

  _layoutTouch() {
    if (!this._els) return;
    const { wheel, knob, rocker, zone } = this._els;
    const R = this._steerRange();
    wheel.style.setProperty('--range', R + 'px');
    knob.style.transform = 'translate(-50%, -50%)';
    wheel.classList.remove('active');
    zone.querySelectorAll('.tc-rocker span').forEach(s => s.classList.remove('on'));
    const { x, y } = this._restPoint();
    this._placeWheel(x, y);
    const r = zone.getBoundingClientRect();
    for (const e of [rocker, zone.querySelector('.tc-tiltbrake')]) { e.style.left = (x - r.left) + 'px'; e.style.top = (y - r.top) + 'px'; }
  }

  _steerMove(x) {
    const st = this._steerPtr;
    st.x = x;
    if (this.touchPrefs.steer === 'buttons') {
      const rr = this._els.rocker.getBoundingClientRect();
      const side = x < rr.left + rr.width / 2 ? -1 : 1;
      if (side !== st.side) { st.side = side; this._buzz(6); }
      this._els.rocker.querySelectorAll('span').forEach(s => s.classList.toggle('on', +s.dataset.side === side));
      this.touch.steer = side;
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

  _applyTouch() {
    const t = this.touch, p = this.touchPrefs;
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
    this._els.zone.querySelector('.tc-tiltbrake').classList.toggle('on', this._tiltBrake.size > 0);
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
    this._steerPtr = null; this._pedalPtrs.clear(); this._tiltBrake.clear();
    this.touch.throttle = 0; this.touch.brake = 0; this.touch.steer = 0; this.touch.handbrake = false;
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

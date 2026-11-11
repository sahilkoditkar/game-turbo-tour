// Tiny procedural audio: engine hum per player (with wind and tyre noise), the engines of the
// nearest other cars, skids, impacts and UI tones.

const CROWD_VOICES = 3;    // other cars heard at once (the nearest)
const CROWD_RANGE = 90;    // metres: further cars are silent

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engines = [];
    this.crowd = new Map();   // car key -> engine voice, for the nearest other cars
    this.spare = [];          // crowd voices not in use (silent, kept for reuse)
    this.volume = 0.7;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.enabled ? v : 0; }
  setEnabled(on) { this.enabled = on; this.setVolume(this.volume); }

  /** One second of white noise, made once. */
  _noiseBuffer() {
    if (!this.noiseBuf) {
      const c = this.ctx, buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  /** A looping noise source through a filter into a silent gain; returns { src, filter, gain }. */
  _noise(type, freq, q, out) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this._noiseBuffer(); src.loop = true;
    const filter = c.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = c.createGain(); gain.gain.value = 0;
    src.connect(filter); filter.connect(gain); gain.connect(out);
    src.start(0, Math.random());   // different offsets, so layers of the same noise don't line up
    return { src, filter, gain };
  }

  /**
   * Create an engine voice; returns handle.
   * o.skid: a skid-noise layer (players); o.road: wind and tyre layers (players);
   * o.pan: a stereo panner (other cars); o.detune: pitch factor, so cars don't all sound alike.
   */
  createEngine(o = {}) {
    if (!this.ctx) return null;
    const { skid = true, road = false, pan = false, detune = 1 } = o;
    const c = this.ctx;
    let out = this.master, panner = null;
    if (pan && c.createStereoPanner) { panner = c.createStereoPanner(); panner.connect(this.master); out = panner; }
    const gain = c.createGain(); gain.gain.value = 0;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 2;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const o3 = c.createOscillator(); o3.type = 'triangle';
    const g2 = c.createGain(); g2.gain.value = 0.4;
    const g3 = c.createGain(); g3.gain.value = 0.25;
    o1.connect(filter); o2.connect(g2); g2.connect(filter); o3.connect(g3); g3.connect(filter);
    filter.connect(gain); gain.connect(out);
    o1.start(); o2.start(); o3.start();
    const h = { gain, filter, o1, o2, o3, g2, panner, rpm: 0.12, t: 0, detune, layers: [] };
    if (skid) { h.skid = this._noise('bandpass', 1800, 0.8, out); h.layers.push(h.skid); }
    if (road) {
      // wind: a soft rushing band that opens up and grows with speed
      h.wind = this._noise('bandpass', 500, 0.6, out);
      // tyres: a low rumble on tarmac, a brighter crunch on gravel and grass
      h.tarmac = this._noise('lowpass', 160, 0.7, out);
      h.gravel = this._noise('bandpass', 1100, 0.9, out);
      h.layers.push(h.wind, h.tarmac, h.gravel);
    }
    this.engines.push(h);
    return h;
  }

  /**
   * Update an engine voice. speedFrac in [0,1], throttle in [0,1].
   *
   * Standing still the engine idles: low revs, a soft low burble well below the driving
   * sound (it used to sit at the revs of a fresh gear change, nearly as loud as cruising).
   * Throttle while stopped revs it up. On the move the revs climb through six gears; the
   * engine is louder under throttle than coasting, and brighter and harsher at high revs.
   */
  updateEngine(h, speedFrac, throttle, skid, distanceGain = 1) {
    if (!h || !this.ctx) return;
    const t = this.ctx.currentTime;
    const dt = h.t ? Math.min(0.1, Math.max(0, t - h.t)) : 1 / 60;
    h.t = t;
    const gears = 6;
    const g = Math.min(gears - 1, Math.floor(speedFrac * gears));
    const within = speedFrac * gears - g;
    const moving = Math.min(1, speedFrac / 0.06);          // 0 standing still, 1 from about 6% of top speed
    const idleRpm = 0.12 + throttle * 0.5;                  // revving in place
    const driveRpm = 0.3 + within * 0.7;
    const rpm = idleRpm + (driveRpm - idleRpm) * moving;
    h.rpm += (rpm - h.rpm) * (1 - Math.exp(-dt * 15));      // the same response at any frame rate
    const f = (40 + h.rpm * 180 + g * 6 * moving) * h.detune;
    h.o1.frequency.setTargetAtTime(f, t, 0.03);
    h.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    h.o3.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    h.g2.gain.setTargetAtTime(0.12 + h.rpm * 0.3, t, 0.05);              // the square's buzz grows with revs
    h.filter.frequency.setTargetAtTime(260 + h.rpm * 1900 + throttle * 500, t, 0.05);
    const load = 0.6 + 0.4 * throttle;                                    // quieter off the throttle
    h.gain.gain.setTargetAtTime((0.02 + h.rpm * 0.17) * load * distanceGain, t, 0.05);
    if (h.skid) h.skid.gain.gain.setTargetAtTime(skid ? 0.09 * distanceGain : 0, t, 0.08);
  }

  /**
   * Wind and tyre noise for a player's voice. speed in m/s; rough: on gravel, grass or a dirt road.
   * Wind is silent below ~30 km/h and rises with the square of speed; tyres rumble from walking
   * pace, louder and brighter off the tarmac.
   */
  updateRoad(h, speed, rough, gain = 1) {
    if (!h || !h.wind || !this.ctx) return;
    const t = this.ctx.currentTime, v = Math.max(0, speed);
    const w = Math.max(0, (v - 8) / 62);                                  // 0 at ~30 km/h, 1 at ~250 km/h
    h.wind.gain.gain.setTargetAtTime(Math.min(1.2, w * w) * 0.05 * gain, t, 0.15);
    h.wind.filter.frequency.setTargetAtTime(350 + v * 14, t, 0.15);
    const roll = Math.min(1, v / 25);
    h.tarmac.gain.gain.setTargetAtTime((rough ? 0.3 : 1) * roll * 0.08 * gain, t, 0.1);
    h.tarmac.filter.frequency.setTargetAtTime(120 + v * 3, t, 0.1);
    h.gravel.gain.gain.setTargetAtTime(rough ? Math.min(1, v / 18) * 0.05 * gain : 0, t, 0.1);
    h.gravel.filter.frequency.setTargetAtTime(800 + v * 12, t, 0.1);
  }

  /**
   * The engines of the other cars nearest the listener: up to CROWD_VOICES within CROWD_RANGE
   * metres, fading with distance and panned to the side they are on.
   * cars: [{ key, x, z, speedFrac, throttle }]; listener: { x, z, rx, rz } (position and its right-hand unit vector).
   */
  updateCrowd(cars, listener, gain = 1) {
    if (!this.ctx) return;
    const near = [];
    for (const c of cars) {
      const dx = c.x - listener.x, dz = c.z - listener.z, d = Math.hypot(dx, dz);
      if (d < CROWD_RANGE) near.push({ c, d, dx, dz });
    }
    near.sort((a, b) => a.d - b.d);
    near.length = Math.min(near.length, CROWD_VOICES);
    const keep = new Set(near.map(n => n.c.key));
    for (const [key, h] of this.crowd) if (!keep.has(key)) { this.crowd.delete(key); this.spare.push(h); }
    const t = this.ctx.currentTime;
    for (const { c, d, dx, dz } of near) {
      let h = this.crowd.get(c.key);
      if (!h) {
        h = this.spare.pop() || this.createEngine({ skid: false, pan: true });
        if (!h) return;
        h.detune = 0.88 + (hashKey(c.key) % 1000) / 1000 * 0.24;   // each car its own pitch
        this.crowd.set(c.key, h);
      }
      const fade = 1 - d / CROWD_RANGE;   // loud alongside, a twelfth as loud by 50 m
      this.updateEngine(h, c.speedFrac, c.throttle, false, Math.pow(fade, 2.5) * 0.9 * gain);
      if (h.panner) h.panner.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, (dx * listener.rx + dz * listener.rz) / Math.max(4, d))), t, 0.05);
    }
    for (const h of this.spare) h.gain.gain.setTargetAtTime(0, t, 0.08);   // spare voices fall silent
  }

  stopEngines() {
    for (const h of this.engines) {
      // the noise layers loop forever unless they are stopped too (they kept running after every race and pause)
      try {
        h.o1.stop(); h.o2.stop(); h.o3.stop(); h.gain.disconnect();
        for (const l of h.layers) { l.src.stop(); l.gain.disconnect(); }
        if (h.panner) h.panner.disconnect();
      } catch (e) { /* ignore */ }
    }
    this.engines = [];
    this.crowd.clear();
    this.spare = [];
  }

  /** Silence everything while the page is hidden (another tab, phone locked); carry on when it is back. */
  setHidden(hidden) {
    if (!this.ctx) return;
    (hidden ? this.ctx.suspend() : this.ctx.resume()).catch(() => { /* resumed by the next tap instead */ });
  }

  beep(freq = 880, dur = 0.12, type = 'square', vol = 0.25) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  /** A soft tone: quick fade-in (no click), smooth fade-out. */
  tone(freq, dur, vol, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  impact(strength = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const len = 0.18;
    const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.value = Math.min(0.6, 0.15 + strength * 0.03);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }

  /**
   * Start countdown: 3, 2, 1 are soft round blips; GO is a bright two-note chime (a fifth
   * and its octave) instead of the old half-second square-wave buzz.
   */
  countdown(n) {
    if (n !== 0) { this.tone(660, 0.22, 0.2, 'triangle'); this.tone(1320, 0.12, 0.04); return; }
    this.tone(880, 0.55, 0.13);
    this.tone(1320, 0.6, 0.11, 'sine', 0.06);
    this.tone(1760, 0.5, 0.05, 'triangle', 0.06);
  }
  lap() { this.beep(1046, 0.1, 'sine', 0.25); setTimeout(() => this.beep(1568, 0.16, 'sine', 0.25), 110); }
  click() { this.beep(520, 0.05, 'triangle', 0.12); }
  finish() { [0, 120, 240, 360].forEach((d, i) => setTimeout(() => this.beep([784, 988, 1175, 1568][i], 0.25, 'triangle', 0.25), d)); }
}

function hashKey(k) {
  const s = String(k);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

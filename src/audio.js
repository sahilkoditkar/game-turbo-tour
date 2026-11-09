// Tiny procedural audio: engine hum per player, skids, impacts and UI beeps.

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engines = [];
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

  /** Create an engine voice; returns handle. */
  createEngine() {
    if (!this.ctx) return null;
    const c = this.ctx;
    const gain = c.createGain(); gain.gain.value = 0;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 2;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const o3 = c.createOscillator(); o3.type = 'triangle';
    const g2 = c.createGain(); g2.gain.value = 0.4;
    const g3 = c.createGain(); g3.gain.value = 0.25;
    o1.connect(filter); o2.connect(g2); g2.connect(filter); o3.connect(g3); g3.connect(filter);
    filter.connect(gain); gain.connect(this.master);
    o1.start(); o2.start(); o3.start();
    // skid noise (one looping white-noise buffer shared by every voice)
    const noise = c.createBufferSource();
    noise.buffer = this._noiseBuffer(); noise.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0;
    noise.connect(nf); nf.connect(ng); ng.connect(this.master);
    noise.start();
    const h = { gain, filter, o1, o2, o3, g2, noise, ng, rpm: 0.12, t: 0 };
    this.engines.push(h);
    return h;
  }

  /** One second of white noise, made once. */
  _noiseBuffer() {
    if (!this.noiseBuf) {
      const c = this.ctx, buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
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
    const f = 40 + h.rpm * 180 + g * 6 * moving;
    h.o1.frequency.setTargetAtTime(f, t, 0.03);
    h.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    h.o3.frequency.setTargetAtTime(f * 2.01, t, 0.03);
    h.g2.gain.setTargetAtTime(0.12 + h.rpm * 0.3, t, 0.05);              // the square's buzz grows with revs
    h.filter.frequency.setTargetAtTime(260 + h.rpm * 1900 + throttle * 500, t, 0.05);
    const load = 0.6 + 0.4 * throttle;                                    // quieter off the throttle
    h.gain.gain.setTargetAtTime((0.02 + h.rpm * 0.17) * load * distanceGain, t, 0.05);
    h.ng.gain.setTargetAtTime(skid ? 0.09 : 0, t, 0.08);
  }

  stopEngines() {
    for (const h of this.engines) {
      // the skid noise loops forever unless it is stopped too (it kept running after every race and pause)
      try { h.o1.stop(); h.o2.stop(); h.o3.stop(); h.noise.stop(); h.gain.disconnect(); h.ng.disconnect(); } catch (e) { /* ignore */ }
    }
    this.engines = [];
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

  countdown(n) { this.beep(n === 0 ? 1320 : 660, n === 0 ? 0.5 : 0.18, 'square', 0.22); }
  lap() { this.beep(1046, 0.1, 'sine', 0.25); setTimeout(() => this.beep(1568, 0.16, 'sine', 0.25), 110); }
  click() { this.beep(520, 0.05, 'triangle', 0.12); }
  finish() { [0, 120, 240, 360].forEach((d, i) => setTimeout(() => this.beep([784, 988, 1175, 1568][i], 0.25, 'triangle', 0.25), d)); }
}

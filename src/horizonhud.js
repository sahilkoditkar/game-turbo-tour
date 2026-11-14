// Free Roam HUD: speed, radar minimap with its compass bezel, waypoint, event prompt,
// live drift/speed-zone score, XP, and popups/toasts for skills and discoveries.
import { levelForXp, CITY } from './worlddef.js';
import { terrainLayer, MAP_EXTENT, ROAD_STYLE, ROUTE_COLOR, MARKER_COLORS, drawMarkerIcon, drawPin, drawPlayerArrow, drawPropFootprints } from './worldmap.js';

const RADAR_NEAR = 320, RADAR_FAR = 680;   // metres shown top to bottom, standing still → flat out
const RADAR_KINDS = ['dirt', 'lane', 'street', 'road', 'highway'];

export class HorizonHUD {
  constructor(hz) {
    this.hz = hz;
    this.layer = document.getElementById('hud-layer');
    this.center = document.getElementById('hud-center');
    this.divider = document.getElementById('hud-divider');
    this.el = document.getElementById('hud-0');
    this.other = document.getElementById('hud-1');
    this.live = null;
    this.msgTimer = 0;
    this.regionTimer = 0;
    this.show();
  }

  show() {
    this.layer.classList.remove('hidden');
    this.other.classList.add('hidden');
    this.divider.className = 'hidden';
    this.el.className = 'hud';
    this.el.classList.remove('hidden');
    this.el.innerHTML = `
      <div class="hz-top-left">
        <div class="hz-mode">TURBO TOUR</div>
        <div class="hz-region">—</div>
        <div class="hz-road"></div>
      </div>
      <div class="hz-top-right">
        <div class="hz-level">LEVEL <b>1</b></div>
        <div class="hz-xpbar"><i style="width:0%"></i></div>
        <div class="hz-xptext">0 / 1,500 XP</div>
        <div class="hz-wallet"><span>WALLET</span><b class="hz-money">0 cr</b><i class="hz-gain"></i></div>
      </div>
      <div class="bottom-right hz-br">
        <div class="speed"><b>0</b><small>km/h</small></div>
        <div class="gear-bar"><i style="width:0%"></i></div>
      </div>
      <div class="hz-radarbox"><canvas class="hz-radar"></canvas><div class="hz-radarcap"><b class="hz-capregion"></b><span class="hz-caproad"></span></div></div>
      <div class="hz-waypoint hidden"><span class="turn"></span><div><div class="instr"></div><div class="info"><b></b> · <span class="name"></span></div></div></div>
      <div class="hz-prompt hidden"></div>
      <div class="hz-guide hidden"><div><b></b><span></span></div><button class="small ghost">Skip tour</button></div>
      <div class="hz-live hidden"><div class="label"></div><div class="score"></div></div>
      <div class="msg"><span class="main"></span><span class="sub"></span></div>
      <div class="hz-toasts"></div>
      <button class="hz-mapbtn">MAP</button>
      <div class="hz-hint"><kbd>M</kbd> map · <kbd>Enter</kbd> at a marker · <kbd>R</kbd> back to road · <kbd>Esc</kbd> pause</div>`;
    // Touch and mouse: tapping the prompt starts the event, the MAP button opens the map.
    this.el.querySelector('.hz-prompt').addEventListener('click', () => { if (this.hz.prompt && this.hz.promptCooldown <= 0) this.hz.onEvent(this.hz.prompt); });
    this.el.querySelector('.hz-mapbtn').addEventListener('click', () => { this.hz.requestMap = true; });
    this.el.querySelector('.hz-guide button').addEventListener('click', () => this.hz.skipGuide());
    const q = (s) => this.el.querySelector(s);
    this.q = {
      region: q('.hz-region'), road: q('.hz-road'), capRegion: q('.hz-capregion'), capRoad: q('.hz-caproad'), level: q('.hz-level b'), xp: q('.hz-xpbar i'), money: q('.hz-money'),
      speed: q('.speed b'), bar: q('.gear-bar i'), radar: q('.hz-radar'), wp: q('.hz-waypoint'), wpTurn: q('.hz-waypoint .turn'), wpInstr: q('.hz-waypoint .instr'), wpDist: q('.hz-waypoint .info b'), wpName: q('.hz-waypoint .name'),
      prompt: q('.hz-prompt'), live: q('.hz-live'), liveLabel: q('.hz-live .label'), liveScore: q('.hz-live .score'),
      msg: q('.msg'), msgMain: q('.msg .main'), msgSub: q('.msg .sub'), toasts: q('.hz-toasts'),
      topRight: q('.hz-top-right'), xptext: q('.hz-xptext'), guide: q('.hz-guide'), guideTitle: q('.hz-guide b'), guideText: q('.hz-guide span'), gain: q('.hz-gain'),
    };
    this.regionTimer = 0;
  }

  hide() { this.layer.classList.add('hidden'); }
  layout() { /* single viewport */ }

  popup(main, sub = '') {
    this.q.msgMain.textContent = main; this.q.msgSub.textContent = sub;
    this.q.msg.classList.add('show');
    this.msgTimer = 2.6;
  }

  toast(text) {
    const t = document.createElement('div');
    t.className = 'hz-toast'; t.textContent = text;
    this.q.toasts.appendChild(t);
    while (this.q.toasts.children.length > 4) this.q.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 1800);
    setTimeout(() => t.remove(), 2300);
  }

  update(dt) {
    const hz = this.hz, car = hz.car, W = hz.world;
    const q = this.q;
    const kmh = Math.round(car.speed * 3.6);
    q.speed.textContent = kmh;
    q.bar.style.width = `${Math.min(100, (car.speed / car.stats.maxSpeed) * 100)}%`;

    this.regionTimer -= dt;
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.5;
      const reg = W.regionAt(car.pos.x, car.pos.z);
      q.region.textContent = q.capRegion.textContent = reg.name;
      const s = W.samples[car.trackIdx];
      const onRoad = Math.abs(W.lateral(car.pos, car.trackIdx)) < s.hw + 3;
      q.road.textContent = q.capRoad.textContent = onRoad ? W.roadOf(car.trackIdx).name : (car.offroad ? 'off-road' : '');
      const lv = levelForXp(hz.prog.xp);
      q.level.textContent = lv.level;
      q.xp.style.width = `${Math.round((lv.into / lv.need) * 100)}%`;
      q.xptext.textContent = `${Math.round(lv.into).toLocaleString()} / ${lv.need.toLocaleString()} XP to level ${lv.level + 1}`;
      q.money.textContent = `${Math.round(hz.profile.money).toLocaleString()} cr`;
      // the guide banner
      const g = hz.guideText();
      q.guide.classList.toggle('hidden', !g);
      if (g && q.guideTitle.textContent !== g.title) { q.guideTitle.textContent = g.title; q.guideText.textContent = g.text; }
    }
    // a "+N cr" pop beside the wallet whenever money comes in
    const money = Math.round(hz.profile.money);
    if (this.lastMoney !== undefined && money > this.lastMoney) {
      q.gain.textContent = `+${(money - this.lastMoney).toLocaleString()} cr → wallet`;
      q.gain.classList.remove('pop'); void q.gain.offsetWidth; q.gain.classList.add('pop');
      q.money.textContent = `${money.toLocaleString()} cr`;
    }
    this.lastMoney = money;

    // Level and wallet step back while you drive and come forward when they change, when you slow
    // down or at a marker: at speed the road gets the attention.
    const xp = Math.round(hz.prog.xp);
    if (xp !== this.lastXp || money !== this.lastMoneyShown || car.speed < 8 || hz.prompt) this.quietIn = 4;
    this.lastXp = xp; this.lastMoneyShown = money;
    this.quietIn = (this.quietIn ?? 4) - dt;
    const quiet = this.quietIn <= 0;
    if (quiet !== this.quiet) { this.quiet = quiet; q.topRight.classList.toggle('quiet', quiet); }

    // Waypoint: turn-by-turn from the GPS route
    if (hz.waypoint) {
      const fmt = (d) => d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
      const g = hz.routeGuide();
      const total = hz.route ? hz.route.length : Math.hypot(hz.waypoint.x - car.pos.x, hz.waypoint.z - car.pos.z);
      q.wp.classList.remove('hidden');
      const turn = g ? g.turn : 'ahead';
      q.wpTurn.className = `turn t-${turn}`;
      q.wpTurn.textContent = { left: '↰', right: '↱', ahead: '↑', back: '↶', arrive: '◎' }[turn];
      q.wpInstr.textContent = g ? (g.dist > 0 && turn !== 'back' ? `${g.text} · ${fmt(g.dist)}` : g.text) : 'Head to the waypoint';
      q.wpDist.textContent = fmt(total);
      q.wpName.textContent = hz.waypoint.kind === 'custom' ? 'Waypoint' : hz.waypoint.name;
    } else q.wp.classList.add('hidden');

    // Prompt at an event ring, a championship venue or a garage pad
    if (hz.prompt) {
      const e = hz.prompt;
      q.prompt.classList.remove('hidden');
      // on a touch screen the prompt itself is the button
      const touch = document.body.classList.contains('touch-ui');
      const key = touch ? '<kbd class="tap">Tap</kbd>' : '<kbd>Enter</kbd>';
      let html;
      if (e.kind === 'garage') html = e.type === 'dealer' ? `${key} Browse cars at <b>${e.name}</b> · buy and drive away`
        : e.type === 'tuning' ? `${key} Upgrade your car at <b>${e.name}</b>`
        : `${key} Open the garage at <b>${e.name}</b> · switch car, paint, upgrade`;
      else if (e.kind === 'series') {
        const st = hz.seriesStatus(e.series);
        html = st.locked ? `🔒 <b>${e.name}</b> · ${st.text.replace('Locked: ', '')} <span class="meta">(${touch ? 'tap' : 'Enter'} for details)</span>`
          : `${key} <b>${e.name}</b> · ${st.text}${st.next ? ` · next: ${st.nextName || ''}` : ''}`;
      } else html = `${key} Start <b>${e.name}</b> · ${e.track.kind === 'stage' ? 'point-to-point stage' : `${e.laps} laps`} · ${e.ai} rivals${hz.prog.events[e.id] ? ` · best P${hz.prog.events[e.id]}` : ''}`;
      if (q.prompt.innerHTML !== html) q.prompt.innerHTML = html;
    } else q.prompt.classList.add('hidden');
    this.el.classList.toggle('has-prompt', !!hz.prompt);

    // Live zone score
    if (this.live) { q.live.classList.remove('hidden'); q.liveLabel.textContent = this.live.label; q.liveScore.textContent = this.live.value; }
    else q.live.classList.add('hidden');

    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) q.msg.classList.remove('show'); }

    this._drawRadar(car);
  }

  /** GTA-style radar: heading-up terrain, roads by class, the GPS route, and markers clamped to the edge. */
  _drawRadar(car) {
    const c = this.q.radar, hz = this.hz, W = hz.world;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = c.clientWidth || 210, ch = c.clientHeight || 210;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const ctx = c.getContext('2d');
    if (!this.terrain) this.terrain = terrainLayer(W);
    // zoom out with speed so there is time to read the junction coming up
    this.radarSpan = (this.radarSpan || RADAR_NEAR) + ((RADAR_NEAR + (RADAR_FAR - RADAR_NEAR) * Math.min(1, car.speed / 55)) - (this.radarSpan || RADAR_NEAR)) * 0.04;
    const sc = ch / this.radarSpan;
    // round radar: the car sits a little below the middle so more of the road ahead shows
    const R = Math.min(cw, ch) / 2 - 1;
    this._ring = { ox: cw / 2, oy: ch / 2, R };
    const cx = cw / 2, cy = ch / 2 + R * 0.18;
    const th = car.heading + Math.PI, cos = Math.cos(th), sin = Math.sin(th);
    const toR = (x, z) => { const dx = x - car.pos.x, dz = z - car.pos.z; return { x: cx + (dx * cos - dz * sin) * sc, y: cy + (dx * sin + dz * cos) * sc }; };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgb(38,104,168)'; ctx.fillRect(0, 0, cw, ch);
    // world layer
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(th); ctx.scale(sc, sc); ctx.translate(-car.pos.x, -car.pos.z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain, -MAP_EXTENT, -MAP_EXTENT, MAP_EXTENT * 2, MAP_EXTENT * 2);
    const reach = this.radarSpan * 0.95;
    if (Math.abs(car.pos.x - CITY.cx) < 900 && Math.abs(car.pos.z - CITY.cz) < 900) {
      for (const b of W.buildings) {
        if (Math.abs(b.x - car.pos.x) > reach || Math.abs(b.z - car.pos.z) > reach) continue;
        ctx.save(); ctx.translate(b.x, b.z); ctx.rotate(-b.rot);
        ctx.fillStyle = '#a9adb8'; ctx.fillRect(-b.hw, -b.hd, b.w, b.d);
        ctx.restore();
      }
    }
    drawPropFootprints(ctx, W.props, { x0: car.pos.x - reach, z0: car.pos.z - reach, x1: car.pos.x + reach, z1: car.pos.z + reach }, sc);
    // roads from the grid cells in reach, batched by class
    const cell = W.cell, CR = Math.ceil(reach / cell);
    const gx = Math.floor(car.pos.x / cell), gz = Math.floor(car.pos.z / cell);
    const segs = Object.fromEntries(RADAR_KINDS.map(k => [k, []]));
    for (let dx = -CR; dx <= CR; dx++) for (let dz = -CR; dz <= CR; dz++) {
      const list = W.grid.get(`${gx + dx},${gz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const s = W.samples[i];
        if (s.li % 2) continue;
        const road = W.roads[s.road];
        const j = W.roadWrap(road, i + 2);
        if (j < 0) continue;
        segs[road.kind].push(s.p, W.samples[j].p);
      }
    }
    ctx.lineCap = 'round';
    for (const pass of ['casing', 'fill']) for (const kind of RADAR_KINDS) {
      const list = segs[kind];
      if (!list.length) continue;
      const st = ROAD_STYLE[kind];
      const wpx = Math.max(st.min * 1.2, { highway: 20, road: 14, street: 13, lane: 10, dirt: 9 }[kind] * sc);
      ctx.lineWidth = (pass === 'casing' ? wpx + 2.4 : wpx) / sc;
      ctx.strokeStyle = pass === 'casing' ? st.casing : st.fill;
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 2) { ctx.moveTo(list[k].x, list[k].z); ctx.lineTo(list[k + 1].x, list[k + 1].z); }
      ctx.stroke();
    }
    // GPS route
    if (hz.routeIdx && hz.routeIdx.length > 1) {
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (const i of hz.routeIdx) {
        const p = W.samples[i].p;
        const near = Math.abs(p.x - car.pos.x) < reach * 1.3 && Math.abs(p.z - car.pos.z) < reach * 1.3;
        if (!near) { pen = false; continue; }
        if (pen) ctx.lineTo(p.x, p.z); else { ctx.moveTo(p.x, p.z); pen = true; }
      }
      ctx.strokeStyle = 'rgba(30,8,48,0.7)'; ctx.lineWidth = 8.5 / sc; ctx.stroke();
      ctx.strokeStyle = ROUTE_COLOR; ctx.lineWidth = 5.5 / sc; ctx.stroke();
    }
    ctx.restore();

    // markers (screen space so icons stay upright)
    const inset = 12;
    const inside = (p, m = 0) => Math.hypot(p.x - cw / 2, p.y - ch / 2) < R - m;
    for (const b of W.boards) {
      if (!hz.boardMeshes.has(b.id)) continue;
      const p = toR(b.x, b.z);
      if (inside(p, 4)) drawMarkerIcon(ctx, p.x, p.y, b, {}, 5);
    }
    for (const t of hz.traffic.cars) {
      const p = toR(t.pos.x, t.pos.z);
      if (!inside(p)) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const m of W.markers) {
      const p = toR(m.x, m.z);
      const done = m.kind === 'event' ? !!hz.prog.events[m.id] : false;
      if (inside(p, 6)) drawMarkerIcon(ctx, p.x, p.y, m, { done, locked: m.kind !== 'hub' && !hz.prog.discovered.includes(m.id) }, 7.5);
      else if (m.kind === 'event' || m.kind === 'hub' || m.kind === 'series' || m.kind === 'garage') {
        // nearby events peek in at the edge, like the games' radar blips
        const d = Math.hypot(m.x - car.pos.x, m.z - car.pos.z);
        if (d < this.radarSpan * 1.6) { const e = this._edge(cx, cy, p, inset); ctx.globalAlpha = 0.75; drawMarkerIcon(ctx, e.x, e.y, m, {}, 5.5); ctx.globalAlpha = 1; }
      }
    }
    // waypoint: pin, or clamped to the edge with its distance
    if (hz.waypoint) {
      const wp = hz.waypoint, p = toR(wp.x, wp.z);
      if (inside(p, 8)) drawPin(ctx, p.x, p.y, 6, MARKER_COLORS.custom);
      else {
        const e = this._edge(cx, cy, p, inset + 2);
        ctx.fillStyle = MARKER_COLORS.custom; ctx.strokeStyle = '#2a2000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(e.x, e.y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2a2000'; ctx.beginPath(); ctx.arc(e.x, e.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    drawPlayerArrow(ctx, cx, cy, 0, 8);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cw / 2, ch / 2, R, 0, Math.PI * 2); ctx.stroke();
    this._drawBezel(ctx, car, toR, cx, cy, cw, ch);
  }

  /** The compass, built into the radar like the open-world games do it: N / E / S / W ride the ring
   * as the radar turns, and a heading readout ("NW 315°") sits on the rim as a tab at the top. A rim letter that
   * would sit under the readout is left out: the readout already says it. */
  _drawBezel(ctx, car, toR, cx, cy, cw, ch) {
    const small = ch < 150;
    const r = small ? 6.5 : 8;
    const font = (px) => `900 ${px}px Segoe UI, Arial`;
    // compass bearing: 0° north (-z), 90° east (+x)
    const bearing = ((180 - car.heading * 180 / Math.PI) % 360 + 360) % 360;
    const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
    const label = `${card} ${String(Math.round(bearing) % 360).padStart(3, '0')}°`;
    ctx.font = font(small ? 9 : 11);
    const tw = ctx.measureText(label).width + (small ? 12 : 16), th = small ? 15 : 19;
    const tx = cw / 2 - tw / 2, ty = 0;   // a tab sitting on the rim
    const D = 10000;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [l, dx, dz] of [['N', 0, -D], ['E', D, 0], ['S', 0, D], ['W', -D, 0]]) {
      const e = this._edge(cx, cy, toR(car.pos.x + dx, car.pos.z + dz), r + 3);
      if (e.y < ty + th + r && Math.abs(e.x - cw / 2) < tw / 2 + r) continue;
      ctx.fillStyle = l === 'N' ? 'rgba(10,14,22,0.9)' : 'rgba(10,14,22,0.7)';
      ctx.beginPath(); ctx.arc(e.x, e.y, l === 'N' ? r : r - 1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = l === 'N' ? '#ff5a1f' : 'rgba(255,255,255,0.9)';
      ctx.font = font(l === 'N' ? (small ? 9 : 10) : (small ? 8 : 9));
      ctx.fillText(l, e.x, e.y + 0.5);
    }
    // heading readout on the top edge, with a notch pointing down the way you face
    ctx.fillStyle = 'rgba(10,14,22,0.85)';
    ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, th / 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cw / 2 - 4, ty + th); ctx.lineTo(cw / 2 + 4, ty + th); ctx.lineTo(cw / 2, ty + th + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = card === 'N' ? '#ff5a1f' : '#fff';
    ctx.font = font(small ? 9 : 11);
    ctx.fillText(label, cw / 2, ty + th / 2 + 0.5);
  }

  /** Where the ray from the car (cx, cy) toward p meets the radar's ring (inset by m), or p itself
   * if it is inside. Markers out of range and the compass letters sit on that ring. */
  _edge(cx, cy, p, m) {
    const { ox, oy, R } = this._ring, r = R - m;
    const dx = p.x - cx, dy = p.y - cy, fx = cx - ox, fy = cy - oy;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return { x: cx, y: cy };
    const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    const t = Math.min(1, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a));
    return { x: cx + dx * t, y: cy + dy * t };
  }

  dispose() {
    this.layer.classList.add('hidden');
    this.center.innerHTML = '';
    this.el.innerHTML = '';
  }
}

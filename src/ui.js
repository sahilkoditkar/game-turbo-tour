import { TRACKS, getTrack } from './tracks.js';
import { CARS, SERIES, UPGRADES, PLAYER_COLORS, PAINT_NAMES, PAINT_COST, getCar, getSeries, upgradeCost, effectiveStats } from './data.js';
import { listControls, getControl, connectedPads, gamepadDiagnostics, TOUCH_DEFAULTS, requestTiltPermission } from './input.js';
import { seriesState, seriesLock, standings, canBuyUpgrade, paintOf, setPaint } from './career.js';
import { levelForXp } from './worlddef.js';
import { fmtTime } from './race.js';
import { WorldMap } from './worldmap.js';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const money = (n) => `${Math.round(n).toLocaleString()} cr`;
const ORD = (n) => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// Browser-tab titles. The main menu keeps the full SEO title from index.html; other screens get
// "<label> – Turbo Tour" via UI.show(html, { title }) and, while driving, from the race mode (UI.hide).
const SEO_TITLE = document.title;
const RACE_TITLES = { quick: 'Quick Race', split: 'Split Screen', timetrial: 'Time Trial', career: 'Championship', horizon: 'Free Roam Event' };
const MODE_TITLES = { quick: 'Quick Race', split: 'Split Screen', timetrial: 'Time Trial' };

export class UI {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('screen');
    this.rerender = null; // re-render function for screens that show a controls chooser
    window.addEventListener('controls-changed', (e) => {
      const pads = e.detail || [];
      if (this._padCount !== undefined && pads.length !== this._padCount) {
        this.toast(pads.length > this._padCount ? `🎮 ${pads[pads.length - 1].name} connected` : 'Gamepad disconnected');
      }
      this._padCount = pads.length;
      if (this.rerender && !this.el.classList.contains('empty')) this.rerender();
    });
    this.initAbout();
  }

  /** Set the browser-tab title: '' restores the SEO title (main menu). */
  setTitle(label) {
    this._title = label;
    document.title = label ? `${label} – Turbo Tour` : SEO_TITLE;
  }

  /** Title while a race or the open world is running (no menu on screen). */
  _liveTitle() {
    const app = this.app;
    if (app.race) return RACE_TITLES[app.raceCtx && app.raceCtx.mode] || 'Race';
    if (app.horizon) return 'Free Roam';
    return this._title;
  }

  // ------------------------------------------------------------ About
  /**
   * The static <section id="about"> in index.html (crawlable, readable without JavaScript) is hidden
   * by main.js on start-up and shown as an overlay from the main menu's "About Turbo Tour" button.
   */
  initAbout() {
    const about = this.aboutEl = document.getElementById('about');
    if (!about) return;
    about.classList.add('hidden');
    const panel = about.querySelector('.about-panel');
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'small ghost about-back'; back.textContent = '← Back';
    const done = document.createElement('div');
    done.className = 'row end about-done';
    done.innerHTML = '<button type="button" class="primary">Back to the menu</button>';
    panel.prepend(back);
    panel.append(done);
    for (const b of [back, done.firstElementChild]) b.addEventListener('click', () => { this.app.audio.click(); this.closeAbout(); });
    about.addEventListener('click', (e) => { if (e.target === about) this.closeAbout(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.aboutOpen) { e.preventDefault(); this.closeAbout(); } });
  }

  openAbout() {
    if (!this.aboutEl) return;
    this.aboutOpen = true;
    this.aboutEl.classList.remove('hidden');
    this.aboutEl.scrollTop = 0;
    document.title = 'About – Turbo Tour';
    const back = this.aboutEl.querySelector('.about-back');
    if (back) back.focus({ preventScroll: true });
  }

  closeAbout() {
    if (!this.aboutEl || !this.aboutOpen) return;
    this.aboutOpen = false;
    this.aboutEl.classList.add('hidden');
    this.setTitle(this._title);
  }

  /** Remove listeners the last screen added outside its own DOM (e.g. the garage's arrow keys). */
  _cleanupScreen() { if (this._screenCleanup) { const f = this._screenCleanup; this._screenCleanup = null; f(); } }

  hide() {
    if (this.worldMap) { this.worldMap.dispose(); this.worldMap = null; }
    this._cleanupScreen();
    this.el.innerHTML = ''; this.el.className = 'screen empty'; this.rerender = null; this.mapOpen = false;
    this.closeAbout();
    // the caller usually starts or resumes a race / the world right after hiding the menu
    queueMicrotask(() => { if (this.el.classList.contains('empty')) this.setTitle(this._liveTitle()); });
  }

  show(html, { transparent = false, title, cls = '' } = {}) {
    if (this.worldMap) { this.worldMap.dispose(); this.worldMap = null; }
    this._cleanupScreen();
    if (title !== undefined) this.setTitle(title);
    this.el.className = 'screen' + (transparent ? ' transparent' : '') + (cls ? ' ' + cls : '');
    this.el.innerHTML = html;
    this.el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => this.app.audio.click()));
  }

  on(selector, event, fn) {
    this.el.querySelectorAll(selector).forEach(el => el.addEventListener(event, (e) => fn(e, el)));
  }

  toast(msg, ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ------------------------------------------------------------ Main menu
  mainMenu() {
    this.rerender = null;
    this.show(`
      <div class="panel narrow">
        <div class="logo">TURBO <span>TOUR</span></div>
        <div class="tagline">3D arcade racing · open world · split screen</div>
        ${this._walletBar()}
        <div class="menu">
          <button class="primary" data-go="horizon">Play <span class="hint" style="color:#fff;opacity:.85">Open-world career · championships, events, garage</span></button>
          <div class="menu-label">Arcade <span>· all cars unlocked, no rewards</span></div>
          <button data-go="quick">Quick Race <span class="hint">Single player vs AI</span></button>
          <button data-go="split">Split Screen <span class="hint">2 players, one screen</span></button>
          <button data-go="timetrial">Time Trial <span class="hint">Beat your best laps</span></button>
          <button data-go="settings" class="ghost">Settings &amp; Controls</button>
          <button data-go="about" class="ghost">About Turbo Tour <span class="hint">Features, controls, FAQ</span></button>
        </div>
        <div class="footer-note">
          <div class="keys-row"><span>Player 1</span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>steer</span><kbd>Shift</kbd><span>drift</span></div>
          <div class="keys-row"><span>Player 2</span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd><span>steer</span><kbd>R-Shift</kbd><span>drift</span></div>
          <div class="keys-row"><span>Any</span><kbd>Esc</kbd><span>pause</span><kbd>R</kbd><span>reset</span><span>· gamepads and touch supported</span></div>
          <a href="./showroom.html">Car showroom: see every car up close →</a>
        </div>
      </div>`, { title: '' });
    this.on('[data-go]', 'click', (e, el) => {
      const go = el.dataset.go;
      if (go === 'horizon') this.horizonIntro();
      else if (go === 'settings') this.settings();
      else if (go === 'about') this.openAbout();
      else this.raceSetup(go);
    });
  }

  /** One wallet for the whole game: credits, level, cars, championship titles. */
  _walletBar() {
    const p = this.app.profile;
    const lv = levelForXp((p.horizon || {}).xp || 0).level;
    const titles = SERIES.filter(s => (p.series[s.id] || {}).finalRank === 1).length;
    return `<div class="wallet-bar">
      <div><span>Wallet</span><b class="money">${money(p.money)}</b></div>
      <div><span>Level</span><b>${lv}</b></div>
      <div><span>Cars</span><b>${p.cars.length}<small>/${CARS.length}</small></b></div>
      <div><span>Titles</span><b>${titles}<small>/${SERIES.length}</small></b></div>
    </div>`;
  }

  // ------------------------------------------------------------ Race setup
  raceSetup(mode) {
    const app = this.app;
    const p = app.profile;
    const st = app.setup = app.setup || {
      trackId: 'sunrise', laps: 3, aiCount: 5, difficulty: 1,
      players: [
        { name: 'Player 1', carId: 'classic', colorIndex: 0, control: p.settings.p1Control || 'wasd' },
        { name: 'Player 2', carId: 'hornet', colorIndex: 1, control: p.settings.p2Control || 'arrows' },
      ],
    };
    st.mode = mode;
    const nPlayers = mode === 'split' ? 2 : 1;
    const title = { quick: 'Quick Race', split: 'Split Screen', timetrial: 'Time Trial' }[mode] + ' <span class="badge" title="Arcade: all cars unlocked, no rewards">Arcade: all cars unlocked, no rewards</span>';
    const render = () => {
      const tr = getTrack(st.trackId);
      this.show(`
        <div class="panel">
          <div class="row between"><h2>${title}</h2><button class="small ghost" data-back>← Back</button></div>
          ${this._trackSection('Real-world circuits', 'Layouts inspired by famous tracks, with their elevation changes', TRACKS.filter(t => t.kind === 'real'), st.trackId)}
          ${this._trackSection('Original circuits', 'Fictional tracks designed for this game', TRACKS.filter(t => t.kind === 'original'), st.trackId)}
          ${this._trackSection('Point-to-point stages', 'Long one-way runs: start to finish, no laps', TRACKS.filter(t => t.kind === 'stage'), st.trackId)}
          <div class="grid-2" style="margin-top:16px">
            ${tr.open ? `<div class="field"><label>Stage</label><div>Single run, start to finish · ${tr.lengthKm ? tr.lengthKm + ' km' : 'long'}</div></div>` : `<div class="field"><label>Laps: <b id="lapsv">${st.laps}</b></label><input type="range" min="1" max="10" value="${st.laps}" data-field="laps"></div>`}
            ${mode !== 'timetrial' ? `
            <div class="field"><label>AI opponents: <b id="aiv">${st.aiCount}</b></label><input type="range" min="0" max="11" value="${st.aiCount}" data-field="aiCount"></div>
            <div class="field"><label>AI difficulty</label><div class="chips">
              ${['Easy', 'Medium', 'Hard', 'Dynamic'].map((d, i) => `<div class="chip ${st.difficulty === i ? 'active' : ''}" data-diff="${i}">${d}</div>`).join('')}
            </div><div class="meta" style="margin-top:6px">${['Club-level opponents.', 'Quick, consistent drivers.', 'Elite pace, no mistakes.', 'The AI reads your pace in real time and races around you: a couple just ahead, most just behind. Works on stages too.'][st.difficulty]}</div></div>` : `<div class="field"><label>Best lap here</label><div>${this._bestLapLine(tr.id)}</div><div class="meta" style="margin-top:6px">Your best lap is replayed as a ghost car. Beat it to record a new one.</div></div>`}
          </div>
          <div class="grid-2">
            ${st.players.slice(0, nPlayers).map((pl, i) => `
              <div class="card">
                <h4>${nPlayers > 1 ? `Player ${i + 1}` : 'Your car'}</h4>
                <div class="field"><label>Name</label><input type="text" maxlength="14" value="${pl.name}" data-name="${i}"></div>
                <div class="field"><label>Controls</label>${this._controlChips(pl.control, `data-control="${i}"`, i)}</div>
                <div class="field"><label>Car</label><select data-car="${i}">${CARS.map(c => `<option value="${c.id}" ${c.id === pl.carId ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
                ${this._statBars(effectiveStats(getCar(pl.carId), { engine: 2, tires: 2, brakes: 2, aero: 2 }))}
                <div class="field"><label>Colour</label><div class="chips">${PLAYER_COLORS.map((c, ci) => `<div class="swatch ${pl.colorIndex === ci ? 'active' : ''}" data-color="${i}:${ci}" style="background:${hex(c)}"></div>`).join('')}</div></div>
              </div>`).join('')}
          </div>
          <div class="row end" style="margin-top:18px"><button class="primary" data-start style="min-width:220px">Start Race</button></div>
        </div>`, { title: MODE_TITLES[mode] });
      this.on('[data-back]', 'click', () => this.mainMenu());
      this.on('[data-track]', 'click', (e, el) => { st.trackId = el.dataset.track; render(); });
      this.on('[data-field]', 'input', (e, el) => { st[el.dataset.field] = parseInt(el.value, 10); const v = document.getElementById(el.dataset.field === 'laps' ? 'lapsv' : 'aiv'); if (v) v.textContent = el.value; });
      this.on('[data-diff]', 'click', (e, el) => { st.difficulty = parseInt(el.dataset.diff, 10); render(); });
      this.on('[data-name]', 'input', (e, el) => { st.players[+el.dataset.name].name = el.value.trim() || `Player ${+el.dataset.name + 1}`; });
      this.on('[data-car]', 'change', (e, el) => { st.players[+el.dataset.car].carId = el.value; render(); });
      this.on('[data-control]', 'click', (e, el) => {
        if (el.classList.contains('disabled')) return;
        const i = +el.dataset.control, id = el.dataset.id;
        const other = st.players[1 - i];
        if (other && other.control === id && nPlayers > 1) other.control = st.players[i].control; // swap
        st.players[i].control = id;
        p.settings[i === 0 ? 'p1Control' : 'p2Control'] = id; app.save();
        render();
      });
      this.on('[data-color]', 'click', (e, el) => { const [i, ci] = el.dataset.color.split(':').map(Number); st.players[i].colorIndex = ci; render(); });
      this.on('[data-start]', 'click', () => app.startQuickRace(mode));
      this.rerender = render;
    };
    render();
  }

  _trackSection(title, sub, tracks, selectedId) {
    return `<h3>${title} <span class="meta" style="text-transform:none;letter-spacing:0;font-weight:400">· ${sub}</span></h3>
      <div class="grid-3">
        ${tracks.map(t => `<div class="card ${t.id === selectedId ? 'selected' : ''}" data-track="${t.id}" style="cursor:pointer">
          <h4>${t.name}</h4><div class="meta">${t.desc}</div>
          <div class="meta" style="margin-top:6px">${'★'.repeat(t.difficulty)}${'☆'.repeat(4 - t.difficulty)} · ${t.theme}${t.lengthKm ? ' · ' + t.lengthKm + ' km' : ''}${t.kind === 'real' ? ' · <span class="badge">real</span>' : t.kind === 'stage' ? ' · <span class="badge done">stage</span>' : ' · <span class="badge" style="opacity:.7">original</span>'}</div></div>`).join('')}
      </div>`;
  }

  _controlChips(current, attr, playerIndex = 0) {
    const touch = this.app.input.isTouchDevice;
    const list = listControls().filter(c => !c.touchOnly || (touch && playerIndex === 0));
    const pads = connectedPads();
    const selectedMissing = /^pad\d+$/.test(current || '') && !list.some(c => c.id === current);
    const chips = list.map(c => `<div class="chip ${current === c.id ? 'active' : ''}" ${attr} data-id="${c.id}" title="${c.keys}">${c.name}${c.sub ? ` <span class="badge done">${c.sub}</span>` : ''}</div>`);
    if (selectedMissing) chips.push(`<div class="chip active" ${attr} data-id="${current}" title="Reconnect the controller">🎮 ${getControl(current).name} <span class="badge locked">disconnected</span></div>`);
    const hint = pads.length === 0
      ? '<div class="meta" style="margin-top:6px">No gamepad detected. Plug one in and press any button on it; it will appear here.</div>'
      : `<div class="meta" style="margin-top:6px">${pads.length} gamepad${pads.length > 1 ? 's' : ''} detected.</div>`;
    return `<div class="chips">${chips.join('')}</div>${hint}`;
  }

  _bestLapLine(trackId) {
    const bl = this.app.profile.bestLaps;
    const entries = Object.entries(bl).filter(([k]) => k.startsWith(trackId + ':'));
    if (!entries.length) return '<span class="meta">No time set yet</span>';
    return entries.map(([k, t]) => `<div>${getCar(k.split(':')[1]).name}: <b>${fmtTime(t)}</b></div>`).join('');
  }

  _statBars(s) {
    const rows = [['Top speed', s.maxSpeed / 95], ['Acceleration', s.accel / 32], ['Grip', s.grip / 12.5], ['Braking', s.brake / 62]];
    return rows.map(([n, v]) => `<div class="stat-row"><span>${n}</span><span>${Math.round(v * 100)}</span></div><div class="stat-bar"><i style="width:${Math.min(100, v * 100)}%"></i></div>`).join('');
  }

  // ------------------------------------------------------------ Championship (opened at its venue in the world)
  seriesPanel(id, { onClose, onRace }) {
    const app = this.app, p = app.profile;
    const s = getSeries(id), st = seriesState(p, id), lock = seriesLock(p, s);
    const car = getCar(p.selected);
    const rows = standings(p, id);
    const myRank = rows.findIndex(r => r.isPlayer) + 1;
    const next = !lock && !st.complete ? s.events[st.event] : null;
    const badge = lock ? '<span class="badge locked">Locked</span>'
      : st.complete ? `<span class="badge ${st.finalRank === 1 ? 'gold' : 'done'}">${st.finalRank === 1 ? '🏆 Champion' : 'Finished ' + ORD(st.finalRank)}</span>`
      : st.event > 0 ? `<span class="badge">Round ${st.event + 1}/${s.events.length}${myRank ? ' · ' + ORD(myRank) + ' in standings' : ''}</span>` : '<span class="badge">Not started</span>';
    const rankNeed = s.requires ? `finish ${s.requireRank === 1 ? '1st' : 'top ' + s.requireRank} in ${getSeries(s.requires).name}` : '';
    const needs = [rankNeed, (s.level || 1) > 1 ? `reach level ${s.level}` : ''].filter(Boolean);
    const myLevel = levelForXp((p.horizon || {}).xp || 0).level;
    this.rerender = null;
    this.show(`
      <div class="panel">
        <div class="row between"><div><div class="meta eyebrow">Championship</div><h2 style="margin:2px 0 0">${s.name} ${badge}</h2></div>
          <div style="text-align:right"><div class="money" style="font-size:22px">${money(p.money)}</div><div class="meta">your wallet</div></div></div>
        <p>${s.desc}</p>
        <div class="meta">${s.aiCount} opponents · ${s.events.length} rounds · prize up to ${money(s.prize[0])} a race · title bonus ${money(s.bonus)}${needs.length ? ` · needs: ${needs.join(' and ')}` : ''}</div>
        ${lock ? `<div class="notice" style="margin-top:12px">🔒 To enter: ${[lock.rank ? rankNeed : '', lock.level ? `reach level ${s.level} (you are level ${myLevel})` : ''].filter(Boolean).join(' and ')}. Earn XP from events, skills, bonus boards and discoveries around the island.</div>` : ''}
        <div class="grid-2" style="margin-top:14px">
          <div class="card"><h4>Rounds</h4>
            ${s.events.map((e, i) => {
              const res = (st.results || []).find(r => r.event === i);
              const state = res ? `<b>${ORD(res.position)}</b>` : i === st.event && !st.complete ? '<span class="badge gold">next</span>' : '<span class="meta">–</span>';
              return `<div class="row between round-row"><span>${i + 1}. ${getTrack(e.track).name} <span class="meta">· ${e.laps} laps</span></span>${state}</div>`;
            }).join('')}
          </div>
          <div class="card"><h4>Standings</h4>${st.event > 0 ? this._standingsTable(id, 8) : '<div class="meta">No rounds raced yet.</div>'}</div>
        </div>
        <div class="meta" style="margin-top:12px">Driving: <b>${car.name}</b> · change car or upgrade at Festival HQ (pause → Go to garage)</div>
        <div class="row end" style="margin-top:16px">
          <button class="ghost" data-close>Close <kbd>Esc</kbd></button>
          ${st.complete ? '<button data-restart>Replay series</button>' : ''}
          ${next ? `<button class="primary" data-race style="min-width:240px">Race round ${st.event + 1}: ${getTrack(next.track).name}</button>` : ''}
        </div>
      </div>`, { title: s.name });
    this.on('[data-close]', 'click', () => onClose());
    this.on('[data-race]', 'click', () => onRace());
    this.on('[data-restart]', 'click', () => {
      if (confirm('Replay this series from round 1? Standings will be reset (your credits and cars are kept).')) { app.restartSeries(id); this.seriesPanel(id, { onClose, onRace }); }
    });
  }

  _standingsTable(seriesId, limit = 12) {
    const rows = standings(this.app.profile, seriesId).slice(0, limit);
    return `<table style="margin-top:12px"><tr><th>#</th><th>Driver</th><th class="num">Points</th></tr>
      ${rows.map((r, i) => `<tr class="${r.isPlayer ? 'you' : ''}"><td>${i + 1}</td><td>${r.name}</td><td class="num">${r.points}</td></tr>`).join('')}</table>`;
  }

  // ------------------------------------------------------------ Garage
  /**
   * A garage in the world, drawn over its 3D room (opts.stage, a GarageStage): the car on a
   * turntable, a side panel and a strip of cars along the bottom. opts.mode:
   *  'dealer' (Turbo Motors: every car, pick a colour, buy; a new car is the one you drive away in),
   *  'hq'     (Festival HQ: your own cars only: switch car, paint, upgrades; no buying),
   *  'tuning' (upgrades for the car you came in).
   * opts.onClose drives away.
   */
  garage(opts = {}) {
    const app = this.app, p = app.profile, stage = opts.stage;
    const mode = opts.mode || 'hq';
    this.rerender = null;
    const eyebrow = { hq: 'Garage', dealer: 'Dealership', tuning: 'Tuning shop' }[mode];
    const elsewhere = {
      hq: 'New cars are sold at Turbo Motors in Turbo City. Tuning shops do upgrades too.',
      dealer: 'Paint, switch cars and upgrade at Festival HQ · upgrades at any tuning shop.',
      tuning: 'Switch cars and paint at Festival HQ · buy new cars at Turbo Motors.',
    }[mode];
    // what the strip offers: the dealer every car, Festival HQ the ones you own, a tuning shop the one you came in
    const listFor = () => mode === 'dealer' ? CARS : mode === 'hq' ? CARS.filter(c => p.cars.includes(c.id)) : [getCar(p.selected)];
    const st = { carId: p.selected, preview: {} };
    // showroom paint for cars you don't own yet: a different colour on each so the floor looks stocked
    const dealerPaint = (c) => CARS.indexOf(c) % PLAYER_COLORS.length;
    // st.preview: a colour tried on the turntable (dealer: the one you'll buy in; Festival HQ: not paid for until you respray)
    const paintFor = (c) => st.preview[c.id] ?? (p.cars.includes(c.id) ? paintOf(p, c.id) : dealerPaint(c));
    const pips = (lvl, max) => `<span class="gx-pips">${Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>`;
    const chips = (active, attr) => `<div class="chips gx-paint">${PLAYER_COLORS.map((c, ci) => `<div class="swatch ${active === ci ? 'active' : ''}" ${attr}="${ci}" style="background:${hex(c)}" title="${PAINT_NAMES[ci]}"></div>`).join('')}</div>`;
    const upgrades = (car) => {
      const lv = p.upgrades[car.id] || {};
      return `<h3>Upgrades</h3><div class="gx-ups">${UPGRADES.map(u => {
        const lvl = lv[u.id] || 0, r = canBuyUpgrade(p, car.id, u.id);
        return `<div class="gx-up"><div><b>${u.name}</b> ${pips(lvl, u.maxLevel)}<div class="meta">${u.desc}</div></div>
          ${r.reason === 'MAX' ? '<span class="badge gold">MAX</span>' : `<button class="small primary" data-up="${u.id}" ${r.ok ? '' : 'disabled'}>${money(r.cost)}</button>`}</div>`;
      }).join('')}</div>`;
    };

    const render = () => {
      const list = listFor();
      if (!list.some(c => c.id === st.carId)) st.carId = list[0].id;
      const car = getCar(st.carId), sel = getCar(p.selected);
      const owned = p.cars.includes(car.id), driving = car.id === p.selected;
      const paint = paintFor(car);
      if (stage) stage.show(car.shape, PLAYER_COLORS[paint]);
      const badge = driving ? '<span class="badge gold">Driving</span>' : owned ? '<span class="badge done">Owned</span>' : `<span class="badge">${money(car.price)}</span>`;
      let section = '';
      if (mode === 'dealer') {
        section = owned
          ? `<div class="gx-note">${driving ? 'You are driving this one.' : 'In your garage. Switch to it at Festival HQ.'}</div>`
          : `<h3>Colour · <span class="gx-pname">${PAINT_NAMES[paint]}</span></h3>${chips(paint, 'data-preview')}
             <button class="primary gx-buy" data-buy="${car.id}" ${p.money < car.price ? 'disabled' : ''}>Buy · ${money(car.price)}</button>
             ${p.money < car.price ? `<div class="gx-note">You need ${money(car.price - p.money)} more. Win events and championships to earn it.</div>` : ''}`;
      } else if (mode === 'hq') {
        const trying = paint !== paintOf(p, car.id);
        section = `${driving ? '' : `<button class="primary gx-buy" data-select="${car.id}">Drive this one</button>`}
          <h3>Paint · <span class="gx-pname">${PAINT_NAMES[paint]}</span>${trying ? '<span class="gx-cost">preview</span>' : `<span class="gx-cost">respray ${money(PAINT_COST)}</span>`}</h3>${chips(paint, 'data-paint')}
          ${trying ? `<div class="gx-respray">
              <button class="primary" data-respray ${p.money < PAINT_COST ? 'disabled' : ''}>Respray · ${money(PAINT_COST)}</button>
              <button class="ghost" data-unpaint>Cancel</button></div>
            <div class="gx-note">${p.money < PAINT_COST ? `You need ${money(PAINT_COST - p.money)} more for a respray.` : `Now ${PAINT_NAMES[paintOf(p, car.id)]}. Pick a colour to try it, then respray to keep it.`}</div>` : ''}
          ${upgrades(car)}`;
      } else {
        section = upgrades(car);
      }
      const strip = list.length > 1 ? `<div class="gx-strip">
          <button class="small gx-arrow" data-step="-1" aria-label="Previous car">‹</button>
          <div class="gx-cars">${list.map(c => {
            const own = p.cars.includes(c.id);
            const sub = c.id === p.selected ? 'Driving' : own ? 'Owned' : money(c.price);
            return `<button class="gx-car ${c.id === car.id ? 'on' : ''}" data-car="${c.id}"><b>${c.name}</b><span>${sub}</span></button>`;
          }).join('')}</div>
          <button class="small gx-arrow" data-step="1" aria-label="Next car">›</button></div>` : '';
      this.show(`
        <div class="gx gx-${mode}">
          <div class="gx-top">
            <div><div class="meta eyebrow">${eyebrow}</div><h2>${opts.name || 'Festival HQ'}</h2></div>
            <div class="gx-wallet"><div class="money">${money(p.money)}</div><div class="meta">your wallet</div></div>
          </div>
          <div class="gx-side">
            <div class="row between gx-head"><h1>${car.name}</h1>${badge}</div>
            <div class="gx-info"><p class="gx-desc">${car.desc}</p>
            ${this._statBars(effectiveStats(car, p.upgrades[car.id] || {}))}</div>
            <div class="gx-act">${section}</div>
            <div class="meta gx-else">${elsewhere}</div>
          </div>
          <div class="gx-bottom">
            ${strip}
            <div class="gx-actions"><span class="meta gx-hint">Drag to turn the car · scroll to zoom${list.length > 1 ? ' · <kbd>←</kbd> <kbd>→</kbd> change car' : ''}</span>
              <button class="primary" data-back>Drive away in the ${sel.name} <kbd>Esc</kbd></button></div>
          </div>
        </div>`, { title: eyebrow, transparent: true, cls: 'garage3d' });
      const on = this.el.querySelector('.gx-car.on');
      if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
      this._frameGarageCar(stage);
      // changing car at Festival HQ drops any colour you were only trying (nothing was paid)
      const goTo = (id) => { if (mode === 'hq') st.preview = {}; st.carId = id; render(); };
      const step = (d) => { const i = list.findIndex(c => c.id === st.carId); goTo(list[(i + d + list.length) % list.length].id); };
      const keys = (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') step(-1);
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') step(1);
      };
      const reframe = () => this._frameGarageCar(stage);
      if (list.length > 1) addEventListener('keydown', keys);
      addEventListener('resize', reframe);
      this._screenCleanup = () => { removeEventListener('keydown', keys); removeEventListener('resize', reframe); };
      this.on('[data-back]', 'click', () => (opts.onClose ? opts.onClose() : this.mainMenu()));
      this.on('[data-car]', 'click', (e, el) => goTo(el.dataset.car));
      this.on('[data-step]', 'click', (e, el) => step(+el.dataset.step));
      this.on('[data-preview]', 'click', (e, el) => { st.preview[car.id] = +el.dataset.preview; render(); });
      this.on('[data-paint]', 'click', (e, el) => {   // try a colour: free, only on the turntable
        const ci = +el.dataset.paint;
        if (ci === paintOf(p, car.id)) delete st.preview[car.id]; else st.preview[car.id] = ci;
        render();
      });
      this.on('[data-unpaint]', 'click', () => { delete st.preview[car.id]; render(); });
      this.on('[data-respray]', 'click', () => {
        if (!setPaint(p, car.id, paint)) { this.toast(`A respray costs ${money(PAINT_COST)}`); return; }
        delete st.preview[car.id];
        this.toast(`Resprayed ${PAINT_NAMES[paint]} · −${money(PAINT_COST)}`);
        if (car.id === p.selected) app._refreshIdleCars();
        render();
      });
      this.on('[data-select]', 'click', (e, el) => { p.selected = el.dataset.select; app.save(); app._refreshIdleCars(); render(); });
      this.on('[data-buy]', 'click', () => {
        if (app.buyCar(car.id, paint)) this.toast(`Bought the ${car.name}! It's the one you'll drive away in.`);
        render();
      });
      this.on('[data-up]', 'click', (e, el) => { if (app.buyUpgrade(car.id, el.dataset.up)) this.toast('Upgrade installed'); render(); });
    };
    render();
  }

  /** Tell the garage's 3D room which part of the screen the menus cover, so the car is framed in the rest. */
  _frameGarageCar(stage) {
    if (!stage) return;
    const side = this.el.querySelector('.gx-side'), bottom = this.el.querySelector('.gx-bottom');
    if (!side) return;
    const r = side.getBoundingClientRect(), b = bottom ? bottom.getBoundingClientRect() : { top: innerHeight };
    // same breakpoint as the .gx layout in style.css: side panel on the left, or a sheet along the bottom
    const narrow = matchMedia('(max-width: 900px), (max-height: 520px) and (max-width: 1100px)').matches;
    if (!narrow) stage.setInset(r.right, innerHeight - b.top);
    else stage.setInset(0, innerHeight - Math.min(r.top, b.top));
  }

  // ------------------------------------------------------------ Settings
  settings() {
    const app = this.app, s = app.profile.settings;
    const keyRow = (label, keys) => `<tr><td>${label}</td><td>${keys.map(k => `<kbd>${k}</kbd>`).join(' ')}</td></tr>`;
    this.show(`
      <div class="panel">
        <div class="row between"><h2>Settings</h2><button class="small ghost" data-back>← Back</button></div>
        <div class="grid-2">
          <div>
            <div class="field"><label>Graphics quality</label><div class="chips">
              <div class="chip ${s.quality === 'high' ? 'active' : ''}" data-q="high">High (shadows)</div>
              <div class="chip ${s.quality === 'low' ? 'active' : ''}" data-q="low">Low (fast)</div></div></div>
            <div class="field"><label>Sound: ${s.sound ? 'on' : 'off'}</label><div class="chips">
              <div class="chip ${s.sound ? 'active' : ''}" data-sound="1">On</div><div class="chip ${!s.sound ? 'active' : ''}" data-sound="0">Off</div></div></div>
            <div class="field"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-vol></div>
            <div class="field"><label>Player 1 controls (default)</label>${this._controlChips(s.p1Control || 'wasd', 'data-ctl="p1Control"', 0)}</div>
            <div class="field"><label>Player 2 controls (default)</label>${this._controlChips(s.p2Control || 'arrows', 'data-ctl="p2Control"', 1)}</div>
            ${app.input.isTouchDevice ? `<h3>Touch controls</h3>${this._touchFields()}` : ''}
            <button class="small" data-fullscreen>Toggle fullscreen</button>
          </div>
          <div>
            <h3>Controls</h3>
            <table class="controls-table">
              ${keyRow('Accelerate', ['W', '↑', 'Pad: RT / A'])}
              ${keyRow('Brake / reverse', ['S', '↓', 'Pad: LT / X'])}
              ${keyRow('Steer', ['A', 'D', '←', '→', 'Pad: left stick'])}
              ${keyRow('Handbrake (drift)', ['Shift', 'Space', 'R-Shift', 'R-Ctrl', 'Pad: B / RB'])}
              ${keyRow('Reset to track', ['R', '.', 'Pad: Y'])}
              ${keyRow('Pause', ['Esc', 'Pad: Start'])}
            </table>
            <p>Gamepad 1 drives Player 1, gamepad 2 drives Player 2. Keyboard always works too.</p>
            <h3>Controller test</h3>
            <div id="pad-diag" class="card" style="font-size:13px"></div>
            <h3>Save data</h3>
            <button class="small" data-reset style="border-color:var(--bad);color:var(--bad)">Reset career progress</button>
          </div>
        </div>
      </div>`, { title: 'Settings' });
    this.rerender = () => this.settings();
    this._startPadDiag();
    this.on('[data-back]', 'click', () => this.mainMenu());
    this.on('[data-q]', 'click', (e, el) => { s.quality = el.dataset.q; app.save(); this.settings(); });
    this.on('[data-sound]', 'click', (e, el) => { s.sound = el.dataset.sound === '1'; app.audio.setEnabled(s.sound); app.save(); this.settings(); });
    this.on('[data-vol]', 'input', (e, el) => { s.volume = parseFloat(el.value); app.audio.setVolume(s.volume); app.save(); });
    this.on('[data-ctl]', 'click', (e, el) => { s[el.dataset.ctl] = el.dataset.id; if (app.setup) { app.setup.players[0].control = s.p1Control; app.setup.players[1].control = s.p2Control; } app.save(); this.settings(); });
    this.on('[data-fullscreen]', 'click', () => app.toggleFullscreen());
    this._bindTouchFields(() => this.settings());
    this.on('[data-reset]', 'click', () => { if (confirm('Delete all career progress, cars and best laps?')) { app.resetProfile(); this.toast('Progress reset'); this.settings(); } });
  }

  // ------------------------------------------------------------ Touch controls
  /** A small landscape-phone diagram of where each touch layout puts the controls. */
  _layoutIcon(id) {
    const phone = '<rect x="2" y="2" width="116" height="60" rx="9" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.35)" stroke-width="2"/>';
    const G = '#3ddc84', R = '#ff5a5a', O = '#ff7a3d', W = 'rgba(255,255,255,.75)';
    const pedals = `<rect x="96" y="26" width="15" height="30" rx="4" fill="${G}" opacity=".8"/><rect x="79" y="36" width="14" height="20" rx="4" fill="${R}" opacity=".8"/><rect x="79" y="24" width="14" height="9" rx="3" fill="${O}" opacity=".8"/>`;
    const parts = {
      drag: `<rect x="9" y="38" width="44" height="13" rx="6.5" fill="none" stroke="${W}" stroke-width="1.5"/><circle cx="38" cy="44.5" r="6" fill="${W}"/><path d="M22 44.5h-8m0 0l3-3m-3 3l3 3M44 30h6m0 0l-2.5-2.5M50 30l-2.5 2.5" stroke="${W}" stroke-width="1.3" fill="none"/>${pedals}`,
      wheel: `<circle cx="28" cy="40" r="14" fill="none" stroke="${W}" stroke-width="3"/><path d="M28 40V54M28 40L16 33M28 40L40 33" stroke="${W}" stroke-width="2"/><circle cx="28" cy="40" r="3.5" fill="${W}"/>${pedals}`,
      tilt: `<path d="M44 14a24 24 0 0 1 32 0" fill="none" stroke="${W}" stroke-width="1.6"/><path d="M76 14l-5-1m5 1l-1 -5M44 14l5-1m-5 1l1-5" stroke="${W}" stroke-width="1.6"/><rect x="12" y="30" width="22" height="22" rx="5" fill="${R}" opacity=".8"/><rect x="96" y="26" width="15" height="30" rx="4" fill="${G}" opacity=".8"/><rect x="79" y="40" width="14" height="16" rx="3" fill="${O}" opacity=".8"/>`,
      thumbs: `<circle cx="19" cy="42" r="11" fill="rgba(255,255,255,.15)" stroke="${W}" stroke-width="1.5"/><path d="M22 37l-7 5 7 5z" fill="${W}"/><circle cx="101" cy="42" r="11" fill="rgba(255,255,255,.15)" stroke="${W}" stroke-width="1.5"/><path d="M98 37l7 5-7 5z" fill="${W}"/><rect x="43" y="26" width="9" height="30" rx="3" fill="rgba(0,0,0,.3)" stroke="${W}" stroke-width="1.2"/><rect x="42" y="27" width="11" height="9" rx="2.5" fill="${G}"/><rect x="66" y="40" width="12" height="16" rx="3" fill="${R}" opacity=".8"/><rect x="66" y="31" width="12" height="7" rx="2" fill="${O}" opacity=".8"/><path d="M57 50c1-6 4-9 3-14" stroke="rgba(255,255,255,.25)" stroke-width="1" fill="none"/>`,
    };
    return `<svg viewBox="0 0 120 64" aria-hidden="true">${phone}${parts[id]}</svg>`;
  }

  /** Touch-control options (Settings, the pause menu and the first-drive chooser). */
  _touchFields() {
    const t = { ...TOUCH_DEFAULTS, ...(this.app.profile.settings.touch || {}) };
    const chip = (key, val, label) => `<div class="chip ${t[key] === val ? 'active' : ''}" data-touch="${key}" data-val="${val}">${label}</div>`;
    const layouts = [
      ['drag', 'Slide', 'Slide your thumb to steer · gas, brake, drift pedals'],
      ['wheel', 'Steering wheel', 'Turn a wheel with your thumb · pedals'],
      ['tilt', 'Tilt (gyro)', 'Turn the phone to steer · thumbs on the pedals'],
      ['thumbs', 'Two thumbs', 'Left / right buttons · gear lever and brake'],
    ];
    const help = {
      drag: 'Put your left thumb anywhere on the left side and slide it. The further you slide, the more you steer. Right thumb: hold GAS, slide onto BRAKE, or up onto DRIFT (keeps the gas on), without lifting.',
      wheel: 'Turn the wheel with your left thumb, round its rim or anywhere on the left side. It springs back when you let go. Right thumb: hold GAS, slide onto BRAKE, or up onto DRIFT.',
      tilt: 'Turn the phone like a steering wheel. Left thumb: BRAKE. Right thumb: hold GAS, slide up onto DRIFT.',
      thumbs: 'Hold the left side to turn left, the right side to turn right. Push the lever up to D once and the car drives itself: you only steer. BRAKE drops the lever back to N; keep holding it at a stop to reverse. Pull the lever down to R to back up. DRIFT is the handbrake.',
    }[t.steer];
    const pedalLayout = t.steer !== 'thumbs';
    return `
      <div class="field"><label>Control layout</label>
        <div class="layout-cards">${layouts.map(([id, name, sub]) => `<button type="button" class="layout-card ${t.steer === id ? 'active' : ''}" data-touch="steer" data-val="${id}">${this._layoutIcon(id)}<b>${name}</b><span>${sub}</span></button>`).join('')}</div>
        <div class="meta" style="margin-top:8px">${help}</div></div>
      ${t.steer !== 'thumbs' ? `<div class="field"><label>Steering sensitivity: <b id="tsens">${Math.round(t.sens * 100)}%</b></label><input type="range" min="0.6" max="1.6" step="0.1" value="${t.sens}" data-trange="sens"></div>` : ''}
      ${pedalLayout ? `<div class="field"><label>Accelerator</label><div class="chips">${chip('autoGas', false, 'Hold GAS')}${chip('autoGas', true, 'Automatic')}</div>
        ${t.autoGas ? '<div class="meta" style="margin-top:6px">The car accelerates by itself; your right thumb only brakes and drifts.</div>' : ''}</div>` : ''}
      <div class="field"><label>Control size: <b id="tsize">${Math.round(t.size * 100)}%</b></label><input type="range" min="0.8" max="1.3" step="0.05" value="${t.size}" data-trange="size"></div>
      <div class="field"><label>Position</label>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="small" data-tmove>✥ Move controls</button>${t.pos ? '<button type="button" class="small ghost" data-tposreset>Reset positions</button>' : ''}</div>
        <div class="meta" style="margin-top:6px">${t.steer === 'thumbs' ? 'Drag the gear lever and the brake / drift buttons wherever you like.' : 'Drag the steering and the pedals wherever your thumbs rest, either side of the screen.'}</div></div>
      ${pedalLayout ? `<div class="field"><label>Sides</label><div class="chips">${chip('swap', false, t.steer === 'tilt' ? 'Brake left · pedals right' : 'Steer left · pedals right')}${chip('swap', true, t.steer === 'tilt' ? 'Brake right · pedals left' : 'Steer right · pedals left')}</div></div>` : ''}
      <div class="field"><label>Full screen</label><div class="chips">${chip('fullscreen', true, 'When I start driving')}${chip('fullscreen', false, 'Off')}</div>
        ${this.app.fullscreenSupported() ? '' : '<div class="meta" style="margin-top:6px">iPhone browsers can’t go full screen from a page: tap Share → “Add to Home Screen” and start Turbo Tour from there.</div>'}</div>
      ${navigator.vibrate ? `<div class="field"><label>Vibration</label><div class="chips">${chip('haptics', true, 'On')}${chip('haptics', false, 'Off')}</div></div>` : ''}`;
  }

  _bindTouchFields(rerender) {
    const app = this.app, s = app.profile.settings;
    const set = (k, v) => { s.touch = { ...TOUCH_DEFAULTS, ...(s.touch || {}), [k]: v }; app.input.setTouchPrefs(s.touch); app.save(); };
    this.on('[data-touch]', 'click', async (e, el) => {
      const k = el.dataset.touch, raw = el.dataset.val;
      const v = raw === 'true' ? true : raw === 'false' ? false : raw;
      if (k === 'steer' && v === 'tilt' && !(await requestTiltPermission())) { this.toast('Motion sensors are not available, so tilt steering is off'); return; }
      if (k === 'fullscreen' && v === true) app.enterFullscreen();
      set(k, v); rerender();
    });
    this.on('[data-tposreset]', 'click', () => { set('pos', null); rerender(); });
    this.on('[data-tmove]', 'click', () => {
      if (app._portraitMQ && app._portraitMQ.matches) { this.toast('Turn your phone sideways first: the controls are laid out for landscape.'); return; }
      this.hide();
      app.input.editLayout({
        onChange: (p) => { s.touch = { ...TOUCH_DEFAULTS, ...(s.touch || {}), pos: p.pos, swap: p.swap }; app.save(); },
        onDone: () => rerender(),
      });
    });
    this.on('[data-trange]', 'input', (e, el) => {
      const k = el.dataset.trange, v = parseFloat(el.value);
      set(k, v);
      const out = document.getElementById(k === 'sens' ? 'tsens' : 'tsize'); if (out) out.textContent = Math.round(v * 100) + '%';
    });
  }

  /** Touch-control settings over a paused race: from the pause menu, or the first time someone
   * drives on a touch screen (firstRun) so they pick a layout before starting. */
  touchSettings(opts = {}) {
    const first = !!opts.firstRun;
    this.show(`
      <div class="panel">
        <div class="row between"><h2>${first ? 'Choose your controls' : 'Touch controls'}</h2>${first ? '' : '<button class="small ghost" data-back>← Back</button>'}</div>
        ${first ? '<div class="meta" style="margin:-4px 0 10px">You can change this any time from the pause menu (❚❚).</div>' : ''}
        ${this._touchFields()}
        <div class="row end" style="margin-top:14px"><button class="primary" data-resume data-drive style="min-width:200px">${first ? 'Start driving' : 'Resume'}</button></div>
      </div>`, { title: 'Touch controls' });
    this.on('[data-back]', 'click', () => this.pause());
    this.on('[data-resume]', 'click', () => this.app.togglePause());
    this._bindTouchFields(() => this.touchSettings(opts));
  }

  /** Live gamepad readout on the settings screen; stops itself when the panel goes away. */
  _startPadDiag() {
    clearInterval(this._padDiagTimer);
    const render = () => {
      const box = document.getElementById('pad-diag');
      if (!box) { clearInterval(this._padDiagTimer); return; }
      const d = gamepadDiagnostics();
      const pads = d.pads.filter(Boolean);
      let html = `<div class="meta">Gamepad API: <b>${d.supported ? 'available' : 'NOT available'}</b> · secure context: <b>${d.secure ? 'yes' : 'no'}</b> · page focused: <b>${d.focused ? 'yes' : 'no'}</b> · slots: ${d.pads.length}</div>`;
      if (!pads.length) {
        html += `<div style="margin-top:8px">No controller reported by the browser.</div>
          <div class="meta" style="margin-top:6px">Browsers hide controllers until you press a button on them while this tab is focused. Click anywhere on this page, then press A / X or a trigger. If nothing appears after that, the browser itself doesn't see the controller: check it works in another app, try a different USB port or cable, or a different browser.</div>`;
      } else {
        for (const p of pads) {
          const pressed = p.buttons.map((b, i) => b ? `B${i}${b === 1 ? '' : ':' + b}` : null).filter(Boolean).join(' ') || '—';
          html += `<div style="margin-top:8px"><b>#${p.index + 1}</b> ${p.id}<br><span class="meta">mapping: ${p.mapping || 'none'} · connected: ${p.connected}</span><br>axes: <code>${p.axes.join(' ')}</code><br>pressed: <code>${pressed}</code></div>`;
        }
        html += `<div class="meta" style="margin-top:6px">Move the sticks and press buttons: the values above should change. Steering uses axis 0; gas is B7 (right trigger) or B0; brake is B6 or B2.</div>`;
      }
      if (d.error) html += `<div class="meta">error: ${d.error}</div>`;
      box.innerHTML = html;
    };
    render();
    this._padDiagTimer = setInterval(render, 200);
  }

  // ------------------------------------------------------------ Pause
  pause() {
    const app = this.app;
    const inEvent = !!(app.race && app.horizon);
    const roaming = !!(app.horizon && !app.race);
    this.show(`
      <div class="panel narrow">
        <h2>Paused</h2>
        <div class="menu">
          <button class="primary" data-resume>Resume</button>
          ${app.input.touchVisible ? '<button data-touchset>Touch controls <span class="hint">Layout: slide, wheel, tilt, two thumbs</span></button>' : ''}
          ${roaming ? '<button data-map>Map <span class="hint">Waypoints, fast travel, progress</span></button><button data-garage>Go to garage <span class="hint">Fast travel to Festival HQ: cars, upgrades, paint</span></button>' : '<button data-restart>Restart race</button>'}
          ${inEvent ? '<button data-quit>Back to Free Roam</button>' : roaming ? '<button data-quit-roam>Quit to menu <span class="hint">Position is saved</span></button>' : '<button data-quit>Quit to menu</button>'}
        </div>
      </div>`, { title: 'Paused' });
    this.on('[data-resume]', 'click', () => app.togglePause());
    this.on('[data-touchset]', 'click', () => this.touchSettings());
    this.on('[data-restart]', 'click', () => app.restartRace());
    this.on('[data-map]', 'click', () => { this.horizonMap(true); });
    this.on('[data-garage]', 'click', () => app.goToGarage());
    this.on('[data-quit]', 'click', () => app.quitRace());
    this.on('[data-quit-roam]', 'click', () => app.quitHorizon());
  }

  // ------------------------------------------------------------ Free Roam
  horizonIntro() {
    const app = this.app, p = app.profile;
    const car = getCar(p.selected);
    const hz = p.horizon || {};
    const lv = levelForXp(hz.xp || 0);
    this.rerender = () => this.horizonIntro();
    this.show(`
      <div class="panel">
        <div class="row between"><h2>Turbo Tour</h2><button class="small ghost" data-back>← Back</button></div>
        <p>Your career is the island. Race drive-up events, take on the four championships at their venues, hunt speed traps, drift zones and bonus boards,
        and spend what you win on new cars at Turbo Motors in Turbo City and on upgrades at Festival HQ or the tuning shops.</p>
        ${this._walletBar()}
        <div class="grid-2">
          <div class="card">
            <h4>Your car: ${car.name}</h4>
            <div class="meta">${car.desc}</div>
            ${this._statBars(effectiveStats(car, p.upgrades[car.id] || {}))}
            <div class="meta" style="margin-top:6px">Buy cars at Turbo Motors in Turbo City · switch, paint and upgrade them at Festival HQ (or pause → Go to garage).</div>
          </div>
          <div class="card">
            <h4>Championships</h4>
            ${SERIES.map(s => {
              const st = seriesState(p, s.id), lock = seriesLock(p, s);
              const tag = lock ? `<span class="badge locked">${lock.level ? 'Level ' + s.level : 'Locked'}</span>`
                : st.complete ? `<span class="badge ${st.finalRank === 1 ? 'gold' : 'done'}">${st.finalRank === 1 ? '🏆' : ORD(st.finalRank)}</span>`
                : st.event > 0 ? `<span class="badge">Round ${st.event + 1}/${s.events.length}</span>` : '<span class="badge">Open</span>';
              return `<div class="row between" style="padding:3px 0">${s.name}${tag}</div>`;
            }).join('')}
            <div class="meta" style="margin-top:6px">Level ${lv.level} · ${(hz.xp || 0).toLocaleString()} XP · ${(hz.discovered || []).length} places discovered · ${((hz.stats || {}).distance || 0).toFixed(1)} km driven</div>
            <div class="field" style="margin-top:10px"><label>Controls</label>${this._controlChips(p.settings.p1Control || 'wasd', 'data-ctl="1"', 0)}</div>
            <div class="meta"><kbd>M</kbd> map · <kbd>Enter</kbd> at a marker · <kbd>R</kbd> back to the road · <kbd>Esc</kbd> pause</div>
          </div>
        </div>
        <div class="row end" style="margin-top:18px">
          ${hz.pos ? '<button data-fresh>Start at Festival HQ</button>' : ''}
          <button class="primary" data-start style="min-width:240px">${hz.pos ? 'Continue' : 'Drive'}</button>
        </div>
      </div>`, { title: 'Free Roam' });
    this.on('[data-back]', 'click', () => this.mainMenu());
    this.on('[data-ctl]', 'click', (e, el) => { p.settings.p1Control = el.dataset.id; app.save(); this.horizonIntro(); });
    this.on('[data-fresh]', 'click', () => { p.horizon.pos = null; app.save(); this._launchHorizon(); });
    this.on('[data-start]', 'click', () => this._launchHorizon());
  }

  _launchHorizon() {
    this.show(`<div class="panel narrow" style="text-align:center"><div class="logo" style="font-size:40px">TURBO <span>TOUR</span></div><div class="tagline" style="margin:14px 0 0">Building the world…</div></div>`, { title: 'Free Roam' });
    setTimeout(() => this.app.startHorizon(), 40);
  }

  /** Full-screen world map: pan/zoom, GPS waypoints, fast travel and progress. */
  horizonMap(fromPause = false) {
    const app = this.app, hz = app.horizon;
    if (!hz) return;
    if (this.worldMap) this.worldMap.dispose();
    this.mapOpen = true;
    this.rerender = null;
    this.show('', { transparent: true, title: 'Map' });
    this.el.classList.add('fullbleed');
    this.worldMap = new WorldMap(this.el, {
      hz, app, fromPause,
      onClose: () => { this.worldMap = null; if (fromPause) { this.mapOpen = false; this.el.classList.remove('fullbleed'); this.pause(); } else app.closeMap(); },
    });
  }

  // ------------------------------------------------------------ Results
  results(results, ctx) {
    const app = this.app;
    const winner = results[0];
    const top3 = results.slice(0, 3);
    const players = results.filter(r => r.isPlayer);
    const heading = ctx.mode === 'timetrial' ? 'Time Trial Complete'
      : players.length === 1 ? `${ORD(players[0].rank)} place`
      : `${players.sort((a, b) => a.rank - b.rank)[0].name} wins the duel!`;
    const bestOverall = Math.min(...results.filter(r => r.bestLap).map(r => r.bestLap));
    let careerHtml = '';
    if (ctx.career) {
      const c = ctx.career;
      careerHtml = `<div class="card" style="margin-top:14px">
        <h4>Championship update</h4>
        <div class="row" style="gap:24px">
          <div><div class="meta">Points earned</div><div style="font-size:24px;font-weight:800">+${c.pointsEarned}</div></div>
          <div><div class="meta">Prize money → wallet</div><div class="money" style="font-size:24px">+${money(c.money)}</div></div>
          ${c.championBonus ? `<div><div class="meta">Title bonus → wallet</div><div class="money" style="font-size:24px">+${money(c.championBonus)}</div></div>` : ''}
        </div>
        ${c.seriesComplete ? `<div class="notice" style="margin-top:10px">Series complete — you finished <b>${ORD(c.finalRank)}</b> overall.${c.unlocked ? ` <b>${c.unlocked.name}</b> unlocked!` : ''}</div>` : ''}
        ${this._standingsTable(ctx.seriesId, 6)}
      </div>`;
    }
    const rewardHtml = ctx.horizonReward ? `<div class="notice" style="margin-top:12px">Reward: <b class="money">+${money(ctx.horizonReward.credits)} → wallet</b> · <b>+${ctx.horizonReward.xp} XP</b></div>` : '';
    this.show(`
      <div class="panel">
        <h1>${heading}</h1>
        <div class="tagline">${ctx.trackName} · ${ctx.stage ? 'point-to-point stage' : `${ctx.laps} lap${ctx.laps === 1 ? '' : 's'}`}${ctx.dynamic ? ' · dynamic AI' : ''}</div>
        ${ctx.mode !== 'timetrial' ? `<div class="podium">${top3.map(r => `<div class="step p${r.rank}"><div class="n">${r.rank}</div><div class="who"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${hex(r.color)};margin-right:5px"></span>${r.name}</div></div>`).join('')}</div>` : ''}
        <table>
          <tr><th>#</th><th>Driver</th><th class="num">Time</th><th class="num">${ctx.stage ? 'Stage time' : 'Best lap'}</th></tr>
          ${results.map(r => `<tr class="${r.isPlayer ? 'you' : ''}"><td>${r.rank}</td><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${hex(r.color)};margin-right:8px"></span>${r.name}</td>
            <td class="num">${r.finished ? (r.rank === 1 || !winner.finished ? fmtTime(r.time) : '+' + (r.time - winner.time).toFixed(3)) : (r.stagePct !== null && r.stagePct !== undefined ? `${r.stagePct}% of stage` : `${r.laps}/${ctx.laps} laps`)}</td>
            <td class="num" style="${r.bestLap === bestOverall ? 'color:var(--accent-2);font-weight:700' : ''}">${fmtTime(r.bestLap)}</td></tr>`).join('')}
        </table>
        ${ctx.newBest ? `<div class="notice" style="margin-top:12px">🏁 New personal best ${ctx.stage ? 'stage time' : 'lap'}: <b>${fmtTime(ctx.newBest)}</b>${ctx.ghostSaved ? ' · saved as your ghost' : ''}</div>` : ''}
        ${rewardHtml}
        ${careerHtml}
        <div class="row end" style="margin-top:18px">
          ${ctx.mode !== 'career' ? '<button data-retry>Race again</button>' : ''}
          <button class="primary" data-continue>${ctx.mode === 'horizon' || (ctx.mode === 'career' && app.horizon) ? 'Back to the island' : ctx.mode === 'career' ? 'Continue' : 'Main menu'}</button>
        </div>
      </div>`, { title: 'Results' });
    this.on('[data-retry]', 'click', () => app.restartRace());
    this.on('[data-continue]', 'click', () => app.leaveRace(ctx.mode === 'career' ? 'career' : ctx.mode === 'horizon' ? 'horizon' : 'menu'));
  }
}

// Car models. Each one is modelled on a real car's dimensions, proportions and signature
// details, built from the primitives in carkit.js. Templates are built once per shape and
// cloned per car, with paint, livery colours, brake lights and race numbers swapped per car.
import * as THREE from 'three';
import { Kit, detail, sharedMaterials, rect, quad, ellipse, roundRect, ellipsePts } from './carkit.js';

const MODELS = {};

/* ------------------------------------------------------------------ shared helpers */

/** Dark arch liner so you never see through an arch into the body. */
function liner(k, loft, z, r, x) {
  const a = loft.arches.find(a => Math.abs(a.z - z) < 0.01);
  if (!a) return;
  const x1 = loft.params(z).w + 0.01;
  const g = new THREE.CylinderGeometry(a.R - 0.01, a.R - 0.01, x1 - a.xIn, 20, 1, true, -0.25, Math.PI + 0.5);
  g.rotateZ(Math.PI / 2);
  const m = k.mesh(g, k.M.liner);
  m.position.set(Math.sign(x) * (a.xIn + x1) / 2, a.y, z);
  m.castShadow = false;
}

/** Four wheels plus arch liners. */
function wheelSet(k, body, o) {
  const list = [
    [o.fx, o.fz, o.fr, o.fw, true, o.rimF ?? o.rim], [-o.fx, o.fz, o.fr, o.fw, true, o.rimF ?? o.rim],
    [o.rx, o.rz, o.rr, o.rw, false, o.rimR ?? o.rim], [-o.rx, o.rz, o.rr, o.rw, false, o.rimR ?? o.rim],
  ];
  for (const [x, z, r, w, front, rim] of list) {
    k.wheel({ x, z, r, w, rim, front, style: o.style, rimMat: o.rimMat, caliper: o.caliper, band: o.band, accentMat: o.accentMat, nutMat: o.nutMat });
    if (body) liner(k, body, z, r, x);
  }
}

/** Rolled lip following each wheel-arch edge (gives the opening real thickness). */
function archLips(k, loft, mat, rad = 0.016) {
  for (const a of loft.arches) for (const s of [-1, 1]) {
    const pts = [];
    const sill = loft.params(a.z + a.R).sill, sill2 = loft.params(a.z - a.R).sill;
    pts.push([s * (loft.sideX(a.z + a.R + 0.004, sill + 0.01) - rad * 0.6), sill + 0.01, a.z + a.R + 0.004]);
    for (let i = 0; i <= 28; i++) {
      const t = Math.PI * i / 28, z = a.z + a.R * Math.cos(t), y = a.y + a.R * Math.sin(t);
      pts.push([s * (loft.sideX(z, y) - rad * 0.6), y, z]);
    }
    pts.push([s * (loft.sideX(a.z - a.R - 0.004, sill2 + 0.01) - rad * 0.6), sill2 + 0.01, a.z - a.R - 0.004]);
    k.tube(pts, rad, mat, 32, false, 6);
  }
}

/** Thin shut line on the body side. */
const shut = (k, loft, z, y0, y1, tilt = 0) => k.side(loft, quad([z - 0.003, y0], [z + 0.003, y0], [z - 0.003 + tilt, y1], [z + 0.003 + tilt, y1]), k.M.trim, { off: 0.0035, nu: 1, nv: 6 });

/** Louvred panel on a top surface: grille base plus slats. */
function louvres(k, loft, z0, z1, x0, x1, n, o = {}) {
  k.top(loft, rect(z0, z1, x0, x1), k.M.grille, { off: 0.003, mirror: o.mirror });
  const d = (z1 - z0) / n;
  for (let i = 0; i < n; i++) k.top(loft, rect(z0 + i * d, z0 + i * d + d * 0.35, x0, x1), o.mat || k.M.paint, { off: 0.007, nu: 1, nv: 4, mirror: o.mirror });
}

const sym = (f) => { f(1); f(-1); };

/** Horizontal side band from z0 to z1, split so it never crosses a wheel opening. */
function band(k, loft, z0, z1, y0, y1, mat, o = {}) {
  const cuts = loft.arches.filter(a => y0 < a.y + a.R).map(a => [a.z - a.R - 0.01, a.z + a.R + 0.01]).sort((a, b) => a[0] - b[0]);
  let z = z0;
  for (const [c0, c1] of [...cuts, [z1, z1]]) {
    const e = Math.min(c0, z1);
    if (e - z > 0.02) k.side(loft, rect(z, e, y0, y1), mat, { nu: Math.max(2, Math.ceil((e - z) / 0.06)), nv: 2, ...o });
    z = Math.max(z, c1);
  }
}

/** Tube that follows the body surface along a (z, y) path; X(z, y) gives the surface x. */
function surfaceTube(k, pts, X, r, mat, side = 1, n = 80) {
  const c = new THREE.CatmullRomCurve3(pts.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
  const out = c.getPoints(n).map(p => [side * X(p.z, p.y), p.y, p.z]);
  k.tube(out, r, mat, n, false, 8);
}

/* ================================================================ Supercar
 * Modelled on the Lamborghini Huracán EVO: 4.52 m long, 1.93 m wide, 1.17 m tall, 2.62 m wheelbase. */
MODELS.super = (k) => {
  const M = k.M;
  const W = { fz: 1.31, rz: -1.31, fr: 0.33, rr: 0.345, fx: 0.815, rx: 0.805, fw: 0.25, rw: 0.31 };
  const body = k.loft([
    [-2.20, 0.84, 0.34, 0.70, 0.90, 6],
    [-2.17, 0.93, 0.28, 0.67, 0.93, 6],
    [-2.00, 0.965, 0.20, 0.64, 0.95, 6, 0.03],
    [-1.31, 0.98, 0.16, 0.60, 0.97, 6, 0.08],
    [-0.60, 0.955, 0.15, 0.56, 0.93, 6, 0.05],
    [0.30, 0.95, 0.15, 0.55, 0.84, 6, 0.03],
    [0.90, 0.955, 0.15, 0.55, 0.79, 6, 0.06],
    [1.31, 0.97, 0.15, 0.55, 0.74, 6, 0.12],
    [1.90, 0.935, 0.13, 0.44, 0.58, 6, 0.07],
    [2.18, 0.85, 0.11, 0.36, 0.46, 6, 0.03],
    [2.30, 0.64, 0.12, 0.31, 0.385, 5],
  ], {
    arches: [k.arch(W.fz, W.fr, W.fx, W.fw), k.arch(W.rz, W.rr, W.rx, W.rw)],
    dents: [{ z0: -1.0, z1: -0.52, y0: 0.3, y1: (z) => 0.64 - (z + 1.0) * 0.35, depth: 0.09, s: 0.025 }],
  });
  k.skin(body, M.paint);
  const cab = k.loft([
    [-1.55, 0.48, 0.80, 0.86, 0.90, 3],
    [-1.00, 0.60, 0.78, 0.87, 1.02, 3],
    [-0.35, 0.64, 0.76, 0.87, 1.155, 3.2],
    [0.10, 0.66, 0.74, 0.86, 1.16, 3.2],
    [0.50, 0.70, 0.72, 0.84, 1.05, 3],
    [0.97, 0.745, 0.70, 0.80, 0.81, 3],
    [1.04, 0.72, 0.70, 0.79, 0.79, 3],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  // glass
  k.top(cab, quad([0.13, -0.52], [1.0, -0.72], [0.13, 0.52], [1.0, 0.72]), M.glass);
  k.side(cab, quad([-0.42, 0.975], [0.9, 0.84], [-0.36, 1.075], [0.16, 1.105]), M.glass);
  k.top(cab, rect(-1.5, -0.78, -0.40, 0.40), M.grille, { off: 0.003 });
  for (let i = 0; i < 6; i++) k.top(cab, rect(-1.47 + i * 0.12, -1.44 + i * 0.12, -0.40, 0.40), M.gloss, { off: 0.009, nu: 1 });
  // doors, sills, side intake
  shut(k, body, 0.74, 0.24, 0.8, -0.05); shut(k, body, -0.52, 0.24, 0.9, 0.02);
  k.side(body, rect(-0.95, 0.92, 0.14, 0.24), M.carbon, { off: 0.006 });
  k.side(body, quad([-1.0, 0.31], [-0.52, 0.31], [-1.0, 0.63], [-0.68, 0.6]), M.grille, { off: 0.002 });
  // headlights: slim and swept with a Y-shaped daytime light
  sym(s => {
    k.top(body, quad([2.12, s * 0.3], [2.24, s * 0.56], [1.95, s * 0.4], [2.08, s * 0.84]), M.lens, { off: 0.006 });
    k.top(body, quad([2.0, s * 0.42], [2.12, s * 0.8], [1.97, s * 0.43], [2.09, s * 0.82]), M.drl, { off: 0.011 });
    k.top(body, quad([2.13, s * 0.33], [2.2, s * 0.49], [2.11, s * 0.35], [2.18, s * 0.51]), M.drl, { off: 0.011 });
  });
  // front: corner intakes with a centre blade, centre intake, splitter
  k.side(body, quad([1.96, 0.14], [2.27, 0.14], [2.0, 0.34], [2.22, 0.32]), M.grille, { off: 0.003 });
  k.side(body, quad([2.08, 0.14], [2.12, 0.14], [2.1, 0.34], [2.13, 0.33]), M.paint, { off: 0.008, nu: 1 });
  k.fascia(roundRect(-0.44, 0.15, 0.44, 0.29, 0.03), 2.30, 1, M.grille, 0.04);
  k.plate([[-0.9, 2.0], [0.9, 2.0], [0.86, 2.2], [0.55, 2.33], [-0.55, 2.33], [-0.86, 2.2]], 0.075, 0.025, M.trim);
  // rear: mesh panel, light blades, hex exhausts, diffuser, ducktail
  k.fascia(roundRect(-0.8, 0.37, 0.8, 0.68, 0.05), -2.20, -1, M.grille, 0.04);
  k.fascia2([[0.22, 0.755], [0.8, 0.755], [0.83, 0.80], [0.24, 0.80]], -2.20, -1, M.tail, 0.03);
  k.fascia2([[0.60, 0.62], [0.64, 0.62], [0.71, 0.755], [0.67, 0.755]], -2.20, -1, M.tail, 0.03);
  sym(s => {
    k.cyl(0.075, 0.075, 0.12, s * 0.17, 0.56, -2.21, M.chrome, 'z', 6, true).rotation.z = Math.PI / 6;
    k.cyl(0.06, 0.06, 0.02, s * 0.17, 0.56, -2.16, M.grille, 'z', 6).rotation.z = Math.PI / 6;
  });
  k.plate([[-0.82, -2.26], [0.82, -2.26], [0.85, -1.6], [-0.85, -1.6]], 0.1, 0.02, M.trim);
  for (let i = -3; i <= 3; i++) k.box(0.012, 0.22, 0.5, i * 0.22, 0.22, -1.99, M.carbon);
  k.prof([[-2.25, 0.885], [-2.03, 0.935], [-2.03, 0.965], [-2.23, 0.925]], 1.62, 0, M.paint, 0.01);
  k.mirrorPod(1.02, 0.84, 0.64, 0.2, 0.075, 0.12);
  wheelSet(k, body, { ...W, rim: 0.7, style: 'y', rimMat: M.gunmetal, caliper: M.caliperYellow });
};

/* ================================================================ V12 targa supercar
 * Modelled on the Ferrari F50: 4.48 m long, 1.99 m wide, 1.12 m tall, 2.58 m wheelbase,
 * 18-inch wheels. Covered headlamps on the front wings, twin bonnet vents, narrow canopy
 * with a black hardtop, twin humps over a slatted engine cover, deep side intakes, a
 * full-width wing growing out of the rear wings and four round lamps in a black mesh tail. */
MODELS.v12 = (k) => {
  const M = k.M;
  k.style = 'arcade';
  const W = { fz: 1.25, rz: -1.33, fr: 0.315, rr: 0.335, fx: 0.81, rx: 0.8, fw: 0.245, rw: 0.335 };
  const body = k.loft([
    [-2.24, 0.86, 0.32, 0.70, 0.86, 6],
    [-2.20, 0.95, 0.26, 0.70, 0.90, 6],
    [-2.00, 0.985, 0.20, 0.68, 0.935, 6, 0.05],
    [-1.33, 0.993, 0.15, 0.63, 0.95, 6, 0.11],
    [-0.70, 0.97, 0.14, 0.58, 0.90, 6, 0.10],
    [0.00, 0.95, 0.14, 0.54, 0.78, 6, 0.06],
    [0.70, 0.955, 0.14, 0.52, 0.72, 6, 0.07],
    [1.25, 0.975, 0.14, 0.52, 0.70, 6, 0.13],
    [1.80, 0.94, 0.13, 0.45, 0.58, 6, 0.09],
    [2.10, 0.84, 0.12, 0.38, 0.47, 5, 0.05],
    [2.24, 0.62, 0.14, 0.32, 0.38, 4],
  ], {
    arches: [k.arch(W.fz, W.fr, W.fx, W.fw), k.arch(W.rz, W.rr, W.rx, W.rw)],
    dents: [{ z0: -1.02, z1: -0.5, y0: 0.3, y1: (z) => 0.62 - (z + 1.02) * 0.2, depth: 0.1, s: 0.025 }],
  });
  k.skin(body, M.paint);
  archLips(k, body, M.paint, 0.012);
  const cab = k.loft([
    [-0.95, 0.56, 0.78, 0.86, 0.93, 3],
    [-0.55, 0.60, 0.76, 0.87, 1.06, 3],
    [-0.20, 0.62, 0.74, 0.86, 1.115, 3.2],
    [0.15, 0.64, 0.72, 0.85, 1.12, 3.2],
    [0.50, 0.68, 0.70, 0.83, 1.03, 3],
    [0.95, 0.73, 0.68, 0.78, 0.80, 3],
    [1.02, 0.70, 0.68, 0.77, 0.77, 3],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  // glass and the black hardtop
  k.top(cab, quad([0.16, -0.54], [0.98, -0.7], [0.16, 0.54], [0.98, 0.7]), M.glass);
  k.side(cab, quad([-0.5, 0.95], [0.9, 0.82], [-0.42, 1.05], [0.16, 1.09]), M.glass);
  k.top(cab, rect(-0.62, 0.17, -0.5, 0.5), M.gloss, { off: 0.003 });
  // twin humps behind the seats flowing back over the engine cover
  sym(s => k.prof([[-0.52, 0.92], [-0.64, 1.01], [-0.9, 1.005], [-1.45, 0.965], [-1.96, 0.93], [-1.96, 0.84], [-0.52, 0.84]], 0.27, s * 0.27, M.paint, 0.1));
  // slatted engine cover between the humps
  k.top(body, rect(-1.95, -0.98, -0.12, 0.12), M.grille, { off: 0.004 });
  for (let i = 0; i < 7; i++) k.top(body, rect(-1.92 + i * 0.135, -1.87 + i * 0.135, -0.12, 0.12), M.gloss, { off: 0.012, nu: 1 });
  // doors, sills, deep side intakes, small intake on the rear wing
  shut(k, body, 0.86, 0.22, 0.7, -0.06); shut(k, body, -0.45, 0.22, 0.86, 0.03);
  k.side(body, rect(-0.95, 0.95, 0.13, 0.21), M.carbon, { off: 0.006 });
  k.side(body, quad([-1.02, 0.31], [-0.5, 0.31], [-1.02, 0.62], [-0.72, 0.58]), M.grille, { off: 0.002 });
  sym(s => k.top(body, quad([-1.15, s * 0.74], [-0.8, s * 0.72], [-1.15, s * 0.9], [-0.8, s * 0.86]), M.grille, { off: 0.003 }));
  // front: lamps under clear covers on the wings, twin bonnet vents, oval mouth, splitter
  sym(s => {
    k.top(body, ellipse(1.98, s * 0.64, 0.2, 0.13, s * -0.2), M.lens, { off: 0.006, nu: 8, nv: 24 });
    k.top(body, ellipse(2.05, s * 0.6, 0.065, 0.06), M.lamp, { off: 0.011, nu: 4, nv: 16 });
    k.top(body, ellipse(1.92, s * 0.69, 0.065, 0.06), M.lamp, { off: 0.011, nu: 4, nv: 16 });
    k.top(body, ellipse(1.52, s * 0.27, 0.3, 0.085, s * 0.12), M.grille, { off: 0.006, nu: 8, nv: 24 });
    for (const t of [-0.12, 0, 0.12]) k.top(body, ellipse(1.52 + t, s * (0.27 + t * 0.12), 0.012, 0.075, s * 0.12), M.paint, { off: 0.01, nu: 2, nv: 12 });
    k.top(body, ellipse(2.12, s * 0.48, 0.05, 0.03), M.amber, { off: 0.008, nu: 3, nv: 12 });
  });
  k.fascia(ellipsePts(0, 0.25, 0.44, 0.085, 28), 2.24, 1, M.grille, 0.05, [], 0.004);
  sym(s => k.fascia(ellipsePts(s * 0.62, 0.23, 0.12, 0.06, 18), 2.1, 1, M.grille, 0.05, [], 0.03));
  k.plate([[-0.88, 1.9], [0.88, 1.9], [0.82, 2.15], [0.5, 2.27], [-0.5, 2.27], [-0.82, 2.15]], 0.085, 0.02, M.trim);
  // rear: black mesh panel, four round lamps, plate, twin centre exhausts, diffuser
  const RZ = -2.24;
  k.fascia(roundRect(-0.86, 0.36, 0.86, 0.80, 0.09), RZ, -1, M.grille, 0.04);
  sym(s => {
    for (const x of [0.43, 0.67]) {
      k.fascia(ellipsePts(s * x, 0.645, 0.098, 0.098, 24), RZ, -1, M.trim, 0.03, [], 0.012);
      k.fascia(ellipsePts(s * x, 0.645, 0.082, 0.082, 24), RZ, -1, M.tail, 0.03, [], 0.02);
    }
    k.glow(s * 0.55, 0.645, RZ, 0.7, 0.42, -1);
    k.cyl(0.055, 0.055, 0.14, s * 0.1, 0.43, -2.26, M.chrome, 'z', 16, true);
  });
  k.decal(0.36, 0.11, 0, 0.54, RZ - 0.025, M.plate, 'z', -1);
  k.plate([[-0.84, -2.3], [0.84, -2.3], [0.86, -1.7], [-0.86, -1.7]], 0.11, 0.02, M.trim);
  for (let i = -2; i <= 2; i++) k.box(0.012, 0.2, 0.45, i * 0.26, 0.22, -2.05, M.carbon);
  // full-width wing rising out of the rear wings
  k.foil(0.4, 0.1, 1.86, 0, 1.0, -2.02, 0.07, M.paint);
  sym(s => k.prof([[-2.24, 0.88], [-1.82, 0.93], [-1.84, 1.02], [-2.22, 1.04]], 0.07, s * 0.9, M.paint, 0.02));
  k.mirrorPod(1.0, 0.84, 0.55, 0.18, 0.08, 0.12);
  wheelSet(k, body, { ...W, rim: 0.68, style: 'five', rimMat: M.alu, caliper: M.caliperBlack });
};

/* ================================================================ Hot hatch
 * Modelled on the VW Golf GTI (Mk7.5): 4.28 m long, 1.79 m wide, 1.45 m tall, 2.63 m wheelbase. */
MODELS.hatch = (k) => {
  const M = k.M;
  const W = { fz: 1.33, rz: -1.30, fr: 0.318, rr: 0.318, fx: 0.775, rx: 0.765, fw: 0.225, rw: 0.225 };
  const body = k.loft([
    [-2.06, 0.80, 0.36, 0.74, 1.00, 4],
    [-2.02, 0.87, 0.29, 0.71, 1.02, 4.5],
    [-1.85, 0.89, 0.23, 0.68, 1.03, 5, 0.02],
    [-1.30, 0.895, 0.21, 0.66, 1.02, 5, 0.02],
    [-0.40, 0.885, 0.21, 0.65, 1.0, 5],
    [0.60, 0.885, 0.21, 0.64, 0.98, 5],
    [0.85, 0.885, 0.21, 0.63, 0.96, 5, 0.02],
    [1.33, 0.89, 0.22, 0.62, 0.89, 5, 0.03],
    [1.85, 0.875, 0.24, 0.60, 0.81, 5, 0.02],
    [2.08, 0.84, 0.25, 0.58, 0.775, 5],
    [2.18, 0.77, 0.27, 0.57, 0.755, 5],
    [2.24, 0.66, 0.29, 0.56, 0.74, 5],
  ], { arches: [k.arch(W.fz, W.fr, W.fx, W.fw, 0.05), k.arch(W.rz, W.rr, W.rx, W.rw, 0.05)] });
  k.skin(body, M.paint);
  const cab = k.loft([
    [-1.94, 0.60, 0.9, 1.0, 1.04, 3.2],
    [-1.80, 0.65, 0.9, 1.0, 1.18, 3.4],
    [-1.60, 0.69, 0.9, 1.01, 1.33, 3.5],
    [-1.35, 0.72, 0.9, 1.02, 1.41, 3.5],
    [-1.00, 0.74, 0.9, 1.02, 1.44, 3.5],
    [-0.40, 0.75, 0.9, 1.02, 1.455, 3.5],
    [0.10, 0.75, 0.9, 1.01, 1.45, 3.5],
    [0.45, 0.77, 0.9, 1.0, 1.27, 3.5],
    [0.87, 0.80, 0.9, 0.99, 0.975, 3.5],
    [0.92, 0.78, 0.9, 0.98, 0.965, 3.5],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  k.top(cab, quad([0.12, -0.6], [0.87, -0.7], [0.12, 0.6], [0.87, 0.7]), M.glass);
  k.side(cab, quad([-1.0, 1.06], [0.8, 1.04], [-0.82, 1.38], [0.12, 1.405]), M.glass);
  k.side(cab, quad([-1.36, 1.07], [-1.08, 1.065], [-1.2, 1.3], [-1.08, 1.34]), M.glass);
  k.side(cab, rect(-0.36, -0.28, 1.05, 1.41), M.gloss, { off: 0.008, nu: 1 });
  k.top(cab, quad([-1.9, -0.52], [-1.5, -0.6], [-1.9, 0.52], [-1.5, 0.6]), M.glass);
  k.prof([[-1.3, 1.43], [-1.58, 1.36], [-1.64, 1.32], [-1.4, 1.415]], 1.26, 0, M.paint, 0.01);
  // shut lines, sill trim
  shut(k, body, 0.84, 0.25, 0.97); shut(k, body, -0.25, 0.25, 1.0); shut(k, body, -1.0, 0.3, 1.0, 0.05);
  k.side(body, rect(-0.95, 0.9, 0.2, 0.27), M.gloss, { off: 0.006 });
  // front: headlights wrapping the corners, thin grille with the red pinstripe, honeycomb intake
  const hl = [[0.36, 0.615], [0.66, 0.60], [0.70, 0.655], [0.64, 0.705], [0.37, 0.70]];
  k.fascia2(hl.map(([x, y]) => [x * 0.93, y]), 2.24, 1, M.lens, 0.04);
  k.fascia2([[0.40, 0.62], [0.62, 0.61], [0.64, 0.625], [0.41, 0.635]], 2.24, 1, M.drl, 0.04, [], 0.012);
  k.fascia2(ellipsePts(0.5, 0.665, 0.05, 0.028, 14), 2.24, 1, M.lamp, 0.04, [], 0.012);
  k.side(body, quad([2.02, 0.61], [2.2, 0.60], [2.03, 0.70], [2.19, 0.70]), M.lens, { off: 0.004 });
  k.fascia(roundRect(-0.36, 0.615, 0.36, 0.69, 0.02), 2.24, 1, M.gloss, 0.04);
  k.fascia([[-0.62, 0.625], [0.62, 0.625], [0.62, 0.635], [-0.62, 0.635]], 2.24, 1, M.caliperRed, 0.04, [], 0.014);
  k.fascia(roundRect(-0.46, 0.33, 0.46, 0.5, 0.05), 2.24, 1, M.grille, 0.05);
  k.fascia2(roundRect(0.52, 0.34, 0.66, 0.46, 0.03), 2.24, 1, M.grille, 0.05);
  k.plate([[-0.7, 2.0], [0.7, 2.0], [0.66, 2.27], [-0.66, 2.27]], 0.26, 0.02, M.gloss);
  // rear: split tail lights, diffuser, twin exhausts
  const tl = [[0.46, 0.83], [0.80, 0.84], [0.82, 0.93], [0.47, 0.92]];
  k.fascia2(tl, -2.06, -1, M.tail, 0.04);
  k.fascia2([[0.5, 0.855], [0.78, 0.86], [0.785, 0.875], [0.5, 0.87]], -2.06, -1, M.drl, 0.04, [], 0.012);
  k.side(body, quad([-2.05, 0.84], [-1.92, 0.84], [-2.05, 0.93], [-1.95, 0.93]), M.tail, { off: 0.004 });
  k.fascia(roundRect(-0.26, 0.6, 0.26, 0.72, 0.02), -2.06, -1, M.gloss, 0.03);
  k.fascia(roundRect(-0.7, 0.3, 0.7, 0.44, 0.04), -2.06, -1, M.gloss, 0.03);
  sym(s => k.cyl(0.045, 0.045, 0.12, s * 0.55, 0.35, -2.07, M.chrome, 'z', 14, true));
  k.mirrorPod(0.98, 1.08, 0.86, 0.2, 0.11, 0.13);
  wheelSet(k, body, { ...W, rim: 0.72, style: 'twin', rimMat: M.alu, caliper: M.caliperRed });
};

/* ================================================================ Muscle car
 * Modelled on the 1967 Ford Mustang fastback (restomod stance): 4.61 m long, 1.79 m wide. */
MODELS.muscle = (k) => {
  const M = k.M;
  k.style = 'arcade';
  const W = { fz: 1.47, rz: -1.27, fr: 0.345, rr: 0.355, fx: 0.745, rx: 0.745, fw: 0.26, rw: 0.3 };
  const body = k.loft([
    [-2.16, 0.80, 0.40, 0.72, 0.93, 6],
    [-2.12, 0.87, 0.34, 0.70, 0.955, 6],
    [-1.90, 0.89, 0.28, 0.68, 0.965, 6],
    [-1.27, 0.895, 0.25, 0.67, 0.975, 6, 0.01],
    [-0.30, 0.885, 0.24, 0.67, 0.96, 6],
    [0.70, 0.885, 0.24, 0.67, 0.95, 6],
    [1.47, 0.89, 0.25, 0.68, 0.93, 6, 0.02],
    [2.25, 0.87, 0.29, 0.67, 0.91, 6, 0.02],
    [2.40, 0.85, 0.32, 0.66, 0.90, 6],
    [2.45, 0.79, 0.34, 0.64, 0.88, 6],
  ], {
    arches: [k.arch(W.fz, W.fr, W.fx, W.fw, 0.05), k.arch(W.rz, W.rr, W.rx, W.rw, 0.05)],
    dents: [{ z0: -0.72, z1: -0.34, y0: 0.5, y1: 0.66, depth: 0.05, s: 0.03 }],
  });
  k.skin(body, M.paint);
  archLips(k, body, M.paint, 0.014);
  const cab = k.loft([
    [-2.0, 0.60, 0.85, 0.94, 0.965, 3],
    [-1.6, 0.66, 0.85, 0.96, 1.08, 3.2],
    [-0.8, 0.70, 0.85, 0.98, 1.26, 3.5],
    [-0.3, 0.71, 0.85, 0.98, 1.31, 3.5],
    [0.15, 0.72, 0.85, 0.98, 1.31, 3.5],
    [0.45, 0.74, 0.85, 0.97, 1.17, 3.5],
    [0.72, 0.76, 0.85, 0.96, 0.955, 3.5],
    [0.76, 0.74, 0.85, 0.955, 0.95, 3.5],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  k.top(cab, quad([0.16, -0.6], [0.73, -0.71], [0.16, 0.6], [0.73, 0.71]), M.glass);
  k.side(cab, quad([-0.78, 1.0], [0.68, 0.99], [-0.36, 1.23], [0.14, 1.27]), M.glass);
  k.side(cab, quad([-1.18, 1.0], [-0.95, 1.0], [-0.95, 1.08], [-0.86, 1.14]), M.trim, { off: 0.005 });
  k.top(cab, quad([-1.9, -0.5], [-0.85, -0.56], [-1.9, 0.5], [-0.85, 0.56]), M.glass);
  // Shelby-style twin stripes over the whole car
  sym(s => {
    const [a, b] = s > 0 ? [0.09, 0.3] : [-0.3, -0.09];
    k.top(body, rect(0.74, 2.46, a, b), M.accent, { off: 0.005, nu: 30, nv: 3 });
    k.top(body, rect(-2.13, -1.92, a, b), M.accent, { off: 0.005, nu: 4, nv: 3 });
    k.top(cab, rect(-0.82, 0.17, a, b), M.accent, { off: 0.005, nu: 16, nv: 3 });
    k.top(cab, rect(-2.0, -1.9, a, b), M.accent, { off: 0.005, nu: 3, nv: 3 });
  });
  k.side(body, rect(-1.9, 2.3, 0.27, 0.34), M.accent, { off: 0.005, nu: 40, nv: 2 });
  // side scoop, shut lines, chrome
  k.side(body, quad([-0.7, 0.51], [-0.36, 0.51], [-0.7, 0.65], [-0.4, 0.65]), M.grille, { off: 0.002 });
  shut(k, body, 0.68, 0.28, 0.93); shut(k, body, -0.76, 0.28, 0.95);
  // front: recessed grille with chrome surround, round headlights, chrome bumper
  const grille = roundRect(-0.6, 0.48, 0.6, 0.82, 0.08);
  k.fascia(grille, 2.45, 1, M.chrome, 0.05, [roundRect(-0.57, 0.5, 0.57, 0.8, 0.07)], 0.01);
  k.fascia(roundRect(-0.57, 0.5, 0.57, 0.8, 0.07), 2.45, 1, M.grille, 0.06, [], 0.004);
  for (let i = 0; i < 6; i++) k.fascia([[-0.56, 0.52 + i * 0.05], [0.56, 0.52 + i * 0.05], [0.56, 0.528 + i * 0.05], [-0.56, 0.528 + i * 0.05]], 2.45, 1, M.gunmetal, 0.02, [], 0.008);
  sym(s => {
    k.fascia(ellipsePts(s * 0.7, 0.72, 0.085, 0.085, 20), 2.45, 1, M.chrome, 0.03, [ellipsePts(s * 0.7, 0.72, 0.07, 0.07, 20)], 0.012);
    k.fascia(ellipsePts(s * 0.7, 0.72, 0.072, 0.072, 20), 2.45, 1, M.lamp, 0.03, [], 0.004);
    k.fascia(ellipsePts(s * 0.44, 0.65, 0.045, 0.045, 14), 2.45, 1, M.amber, 0.03, [], 0.004);
  });
  k.tube([[-0.86, 0.38, 2.3], [-0.8, 0.38, 2.46], [0, 0.38, 2.5], [0.8, 0.38, 2.46], [0.86, 0.38, 2.3]], 0.05, M.chrome, 40, false, 10);
  // rear: black tail panel, triple lamps, gas cap, bumper, exhausts
  k.fascia(roundRect(-0.8, 0.56, 0.8, 0.84, 0.05), -2.16, -1, M.accent2, 0.03);   // tail panel in a deeper shade of the paint
  // big triple-bar lamps in a chrome bezel, with a glow halo
  sym(s => {
    const x0 = s > 0 ? 0.255 : -0.685, x1 = s > 0 ? 0.685 : -0.255;
    k.fascia(roundRect(x0, 0.575, x1, 0.835, 0.04), -2.16, -1, M.chrome, 0.03, [roundRect(x0 + 0.02, 0.595, x1 - 0.02, 0.815, 0.03)], 0.01);
    for (let i = 0; i < 3; i++) k.fascia(roundRect(s * (0.33 + i * 0.14) - 0.06, 0.6, s * (0.33 + i * 0.14) + 0.06, 0.81, 0.025), -2.16, -1, M.tail, 0.03, [], 0.014);
    k.glow(s * 0.47, 0.705, -2.16, 0.8, 0.55, -1);
  });
  k.fascia(ellipsePts(0, 0.7, 0.07, 0.07, 18), -2.16, -1, M.chrome, 0.03, [], 0.012);
  k.tube([[-0.86, 0.42, -2.0], [-0.8, 0.42, -2.18], [0, 0.42, -2.22], [0.8, 0.42, -2.18], [0.86, 0.42, -2.0]], 0.045, M.chrome, 40, false, 10);
  sym(s => k.cyl(0.045, 0.045, 0.2, s * 0.5, 0.3, -2.16, M.chrome, 'z', 14, true));
  k.prof([[-1.1, 0.9], [-1.3, 0.96], [-1.55, 0.99], [-1.56, 1.0], [-1.1, 0.97]], 0.35, 0, M.paint, 0.01);
  k.prof([[1.1, 0.93], [1.65, 0.93], [1.66, 1.0], [1.35, 0.99]], 0.42, 0, M.paint, 0.02); // hood scoop
  k.fascia(roundRect(-0.17, 0.935, 0.17, 0.985, 0.02), 1.66, 1, M.grille, 0.02, [], 0.004);
  k.mirrorPod(0.93, 1.04, 0.62, 0.12, 0.08, 0.12, M.chrome);
  wheelSet(k, body, { ...W, rim: 0.7, style: 'five', rimMat: M.brightChrome, caliper: M.caliperRed });
};

/* ================================================================ Classic roadster
 * Modelled on the 1961 Jaguar E-Type roadster: 4.45 m long, 1.66 m wide, 2.44 m wheelbase. */
MODELS.classic = (k) => {
  const M = k.M;
  const W = { fz: 1.10, rz: -1.34, fr: 0.33, rr: 0.33, fx: 0.64, rx: 0.64, fw: 0.185, rw: 0.185 };
  const body = k.loft([
    [-2.33, 0.56, 0.42, 0.60, 0.70, 2.6],
    [-2.25, 0.70, 0.34, 0.58, 0.77, 2.8],
    [-1.90, 0.79, 0.27, 0.56, 0.82, 3, 0.02],
    [-1.34, 0.83, 0.23, 0.55, 0.85, 3, 0.04],
    [-0.70, 0.81, 0.22, 0.54, 0.82, 3.2],
    [0.00, 0.81, 0.22, 0.54, 0.81, 3.2],
    [0.40, 0.81, 0.22, 0.54, 0.82, 3.2],
    [1.10, 0.80, 0.23, 0.53, 0.80, 3.2, -0.05],
    [1.70, 0.74, 0.25, 0.49, 0.74, 3, -0.04],
    [2.00, 0.60, 0.28, 0.44, 0.64, 2.7],
    [2.12, 0.42, 0.31, 0.42, 0.55, 2.5],
  ], { arches: [k.arch(W.fz, W.fr, W.fx, W.fw, 0.07), k.arch(W.rz, W.rr, W.rx, W.rw, 0.07)] });
  k.skin(body, M.paint);
  archLips(k, body, M.paint, 0.012);
  // open cockpit with seats, wheel and a chrome-framed screen
  k.top(body, rect(-1.0, 0.36, -0.6, 0.6), M.interior, { off: 0.003, nu: 16, nv: 12 });
  k.tube([[-0.62, 0.81, 0.36], [-0.66, 0.815, -0.4], [-0.5, 0.82, -1.02], [0, 0.82, -1.08], [0.5, 0.82, -1.02], [0.66, 0.815, -0.4], [0.62, 0.81, 0.36]], 0.022, M.leather, 50);
  sym(s => {
    k.ellipsoid(0.2, 0.2, 0.06, s * 0.3, 0.92, -0.74, M.leather, 14).rotation.x = -0.2;
    k.ellipsoid(0.2, 0.05, 0.22, s * 0.3, 0.79, -0.52, M.leather, 14);
  });
  const sw = new THREE.TorusGeometry(0.17, 0.014, 6, 24);
  const swm = k.mesh(sw, M.wood); swm.position.set(0.3, 0.98, 0.12); swm.rotation.x = -0.45;
  k.box(0.02, 0.02, 0.2, 0.3, 0.92, 0.2, M.chrome, -0.45);
  const scr = k.mesh(new THREE.PlaneGeometry(1.26, 0.3), M.glass);
  scr.position.set(0, 0.97, 0.42); scr.rotation.x = -0.55;
  k.tube([[-0.64, 0.82, 0.5], [-0.62, 1.1, 0.33], [0, 1.12, 0.32], [0.62, 1.1, 0.33], [0.64, 0.82, 0.5]], 0.012, M.chrome, 30);
  // bonnet louvres and power bulge edge
  sym(s => { for (let i = 0; i < 5; i++) k.top(body, rect(1.0 + i * 0.07, 1.03 + i * 0.07, s * 0.28, s * 0.44), M.grille, { off: 0.003, nu: 1, nv: 3 }); });
  // covered headlamps, oval mouth with chrome bar, bumperettes
  sym(s => {
    k.top(body, ellipse(1.93, s * 0.47, 0.14, 0.085, s * -0.35), M.lens, { off: 0.004, nu: 8, nv: 20 });
    k.top(body, ellipse(1.94, s * 0.47, 0.055, 0.045, 0), M.chrome, { off: 0.009, nu: 4, nv: 16 });
    k.top(body, ellipse(1.94, s * 0.47, 0.03, 0.025, 0), M.lamp, { off: 0.012, nu: 3, nv: 12 });
  });
  k.fascia(ellipsePts(0, 0.43, 0.3, 0.1, 28), 2.12, 1, M.grille, 0.04);
  k.fascia(ellipsePts(0, 0.43, 0.32, 0.115, 28), 2.12, 1, M.chrome, 0.03, [ellipsePts(0, 0.43, 0.3, 0.1, 28)], 0.004);
  k.box(0.62, 0.02, 0.02, 0, 0.43, 2.13, M.chrome);
  sym(s => {
    k.tube([[s * 0.2, 0.35, 2.1], [s * 0.35, 0.34, 2.08], [s * 0.5, 0.34, 1.98]], 0.02, M.chrome, 12);
    k.tube([[s * 0.3, 0.44, -2.3], [s * 0.5, 0.44, -2.24], [s * 0.66, 0.44, -2.08]], 0.02, M.chrome, 12);
    k.dome(body, 'side', -2.24, 0.64, 0.05, 0.05, 0.03, M.tail);
    k.dome(body, 'side', -2.19, 0.55, 0.035, 0.035, 0.025, M.amber);
    k.cyl(0.028, 0.028, 0.2, s * 0.08, 0.32, -2.28, M.chrome, 'z', 12, true);
  });
  k.mirrorPod(0.0, 1.13, 0.3, 0.14, 0.05, 0.06, M.chrome, false);
  wheelSet(k, body, { ...W, rim: 0.58, style: 'wire', rimMat: M.chrome, caliper: M.caliperBlack });
};

/* ================================================================ GT
 * Modelled on the Porsche 911 GT3 RS (992): 4.57 m long, 1.90 m wide, 1.32 m tall, 2.46 m wheelbase. */
MODELS.gt = (k) => {
  const M = k.M;
  const W = { fz: 1.22, rz: -1.24, fr: 0.35, rr: 0.367, fx: 0.81, rx: 0.78, fw: 0.275, rw: 0.335 };
  const body = k.loft([
    [-2.33, 0.82, 0.36, 0.74, 0.93, 4.5],
    [-2.29, 0.90, 0.30, 0.72, 0.95, 4.5],
    [-2.10, 0.94, 0.25, 0.70, 0.96, 4.5, 0.02],
    [-1.24, 0.965, 0.22, 0.67, 0.97, 4.5, 0.05],
    [-0.55, 0.93, 0.21, 0.66, 0.97, 5, 0.03],
    [0.20, 0.91, 0.21, 0.65, 0.96, 5],
    [0.75, 0.915, 0.21, 0.64, 0.93, 5, 0.05],
    [1.22, 0.955, 0.21, 0.63, 0.88, 5, 0.17],
    [1.85, 0.935, 0.19, 0.58, 0.80, 5, 0.18],
    [2.12, 0.86, 0.19, 0.52, 0.67, 4.5, 0.08],
    [2.24, 0.70, 0.21, 0.46, 0.57, 4],
  ], { arches: [k.arch(W.fz, W.fr, W.fx, W.fw), k.arch(W.rz, W.rr, W.rx, W.rw)] });
  k.skin(body, M.paint);
  const cab = k.loft([
    [-2.32, 0.52, 0.80, 0.9, 0.95, 3],
    [-2.05, 0.60, 0.82, 0.93, 1.02, 3.2],
    [-1.60, 0.64, 0.84, 0.96, 1.10, 3.4],
    [-1.20, 0.67, 0.86, 0.99, 1.20, 3.5],
    [-0.50, 0.70, 0.86, 1.0, 1.31, 3.5],
    [0.10, 0.71, 0.86, 1.0, 1.32, 3.5],
    [0.45, 0.73, 0.86, 0.98, 1.18, 3.5],
    [0.82, 0.76, 0.86, 0.95, 0.94, 3.5],
    [0.86, 0.73, 0.86, 0.94, 0.935, 3.5],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  k.top(cab, quad([0.18, -0.56], [0.83, -0.71], [0.18, 0.56], [0.83, 0.71]), M.glass);
  k.side(cab, quad([-1.12, 1.01], [0.76, 1.0], [-0.62, 1.22], [0.12, 1.275]), M.glass);
  k.top(cab, quad([-1.52, -0.42], [-0.72, -0.55], [-1.52, 0.42], [-0.72, 0.55]), M.glass);
  louvres(k, cab, -2.1, -1.66, -0.38, 0.38, 6, { mat: M.gloss });
  // hood nostrils and fender louvres (GT3 RS signatures)
  sym(s => k.top(body, quad([1.55, s * 0.08], [1.95, s * 0.06], [1.55, s * 0.34], [1.95, s * 0.3]), M.grille, { off: 0.003 }));
  sym(s => { k.top(body, rect(1.0, 1.45, s * 0.62, s * 0.86), M.grille, { off: 0.003 }); for (let i = 0; i < 6; i++) k.top(body, rect(1.02 + i * 0.075, 1.045 + i * 0.075, s * 0.62, s * 0.86), M.paint, { off: 0.008, nu: 1, nv: 5 }); });
  shut(k, body, 0.72, 0.25, 0.92); shut(k, body, -0.62, 0.25, 0.97, 0.03);
  k.side(body, rect(-0.85, 0.9, 0.2, 0.27), M.carbon, { off: 0.006 });
  // oval headlights with four-point daytime lights
  sym(s => {
    k.top(body, ellipse(1.96, s * 0.66, 0.21, 0.155, 0), M.gloss, { off: 0.004, nu: 6, nv: 28 });
    k.dome(body, 'top', 1.96, s * 0.66, 0.135, 0.1, 0.035, M.lens);
    for (const [dz, dx] of [[0.07, 0.055], [0.07, -0.055], [-0.05, 0.055], [-0.05, -0.055]]) k.dome(body, 'top', 1.96 + dz, s * (0.66 + dx), 0.03, 0.022, 0.03, M.drl);
    k.dome(body, 'top', 1.97, s * 0.66, 0.04, 0.035, 0.03, M.lamp);
  });
  // front bumper intakes and splitter
  k.fascia(roundRect(-0.42, 0.24, 0.42, 0.42, 0.04), 2.24, 1, M.grille, 0.05);
  k.side(body, quad([1.98, 0.22], [2.22, 0.22], [2.0, 0.44], [2.2, 0.42]), M.grille, { off: 0.003 });
  k.plate([[-0.86, 2.0], [0.86, 2.0], [0.84, 2.22], [0.6, 2.28], [-0.6, 2.28], [-0.84, 2.22]], 0.14, 0.025, M.trim);
  // rear: full-width light bar, black lower bumper, diffuser, twin centre exhausts
  k.fascia([[-0.86, 0.9], [0.86, 0.9], [0.84, 0.93], [-0.84, 0.93]], -2.33, -1, M.tail, 0.04);
  k.fascia([[-0.66, 0.84], [0.66, 0.84], [0.66, 0.885], [-0.66, 0.885]], -2.33, -1, M.gloss, 0.03);
  k.fascia(roundRect(-0.84, 0.3, 0.84, 0.52, 0.05), -2.33, -1, M.carbon, 0.03);
  sym(s => k.cyl(0.055, 0.055, 0.12, s * 0.1, 0.42, -2.34, M.alu, 'z', 16, true));
  for (let i = -3; i <= 3; i++) k.box(0.012, 0.18, 0.4, i * 0.2, 0.26, -2.12, M.carbon);
  k.plate([[-0.8, -2.34], [0.8, -2.34], [0.8, -1.9], [-0.8, -1.9]], 0.17, 0.02, M.carbon);
  // swan-neck wing
  k.foil(0.4, 0.12, 1.72, 0, 1.47, -2.15, 0.12, M.carbon);
  k.foil(0.16, 0.1, 1.72, 0, 1.54, -2.36, 0.5, M.carbon);
  sym(s => {
    k.prof([[-1.98, 1.4], [-2.44, 1.42], [-2.44, 1.6], [-2.02, 1.58]], 0.015, s * 0.87, M.carbon, 0.003);
    k.prof([[-1.62, 1.03], [-1.8, 1.02], [-2.02, 1.4], [-2.1, 1.56], [-2.28, 1.56], [-2.3, 1.52], [-2.14, 1.52], [-2.0, 1.44], [-1.8, 1.1]], 0.02, s * 0.33, M.carbon, 0.004);
  });
  k.mirrorPod(0.99, 1.04, 0.66, 0.2, 0.09, 0.12);
  wheelSet(k, body, { ...W, rimF: 0.72, rimR: 0.72, style: 'ten', rimMat: M.gunmetal, caliper: M.caliperRed, nutMat: M.caliperRed });
};

/* ================================================================ Rally car
 * Modelled on the Toyota GR Yaris Rally1 in gravel trim: 4.23 m long, 1.88 m wide, 2.63 m wheelbase. */
MODELS.rally = (k) => {
  const M = k.M;
  const W = { fz: 1.30, rz: -1.33, fr: 0.34, rr: 0.34, fx: 0.80, rx: 0.80, fw: 0.22, rw: 0.22 };
  const body = k.loft([
    [-2.08, 0.82, 0.42, 0.78, 1.02, 5],
    [-2.02, 0.88, 0.37, 0.76, 1.05, 5],
    [-1.85, 0.925, 0.33, 0.74, 1.06, 5, 0.03],
    [-1.33, 0.955, 0.31, 0.72, 1.06, 5, 0.07],
    [-0.75, 0.885, 0.31, 0.70, 1.05, 5],
    [0.30, 0.88, 0.31, 0.70, 1.04, 5],
    [0.85, 0.89, 0.31, 0.70, 1.02, 5, 0.02],
    [1.30, 0.955, 0.31, 0.70, 0.96, 5, 0.07],
    [1.85, 0.925, 0.31, 0.66, 0.87, 5, 0.03],
    [2.08, 0.87, 0.32, 0.63, 0.81, 5],
    [2.15, 0.77, 0.34, 0.61, 0.78, 5],
  ], { arches: [k.arch(W.fz, W.fr, W.fx, W.fw, 0.06), k.arch(W.rz, W.rr, W.rx, W.rw, 0.06)] });
  k.skin(body, M.paint);
  archLips(k, body, M.paint, 0.02);
  const cab = k.loft([
    [-1.90, 0.58, 0.95, 1.04, 1.08, 3.2],
    [-1.70, 0.63, 0.95, 1.05, 1.2, 3.4],
    [-1.20, 0.69, 0.95, 1.06, 1.36, 3.5],
    [-0.60, 0.72, 0.95, 1.06, 1.445, 3.5],
    [0.05, 0.73, 0.95, 1.05, 1.47, 3.5],
    [0.55, 0.75, 0.95, 1.05, 1.29, 3.5],
    [0.90, 0.78, 0.95, 1.03, 1.04, 3.5],
    [0.95, 0.76, 0.95, 1.03, 1.03, 3.5],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  k.top(cab, quad([0.22, -0.62], [0.91, -0.73], [0.22, 0.62], [0.91, 0.73]), M.glass);
  k.top(cab, quad([0.22, -0.6], [0.34, -0.62], [0.22, 0.6], [0.34, 0.62]), M.gloss, { off: 0.007, nu: 2 });
  k.side(cab, quad([-1.28, 1.08], [0.84, 1.07], [-0.9, 1.34], [0.22, 1.42]), M.glass);
  k.top(cab, quad([-1.85, -0.52], [-1.3, -0.6], [-1.85, 0.52], [-1.3, 0.6]), M.glass);
  // livery: diagonal sweeps, contrasting roof, door plates
  k.side(body, quad([-2.0, 0.35], [0.4, 0.35], [-2.0, 0.62], [-0.6, 0.98]), M.accent, { off: 0.004 });
  k.side(body, quad([-2.0, 0.35], [-0.2, 0.35], [-2.0, 0.5], [-0.9, 0.8]), M.accent2, { off: 0.006 });
  k.side(body, quad([1.2, 0.36], [2.12, 0.36], [1.5, 0.62], [2.12, 0.6]), M.accent, { off: 0.004, nu: 16, nv: 6 });
  k.top(cab, rect(-1.25, 0.25, -0.6, 0.6), M.accent, { off: 0.004 });
  k.side(body, rect(0.62, -0.1, 0.62, 0.9), M.plate, { off: 0.007, nu: 8, nv: 6, keep: true });
  // roof scoop, antennae, wing with tall endplates
  k.prof([[0.05, 1.46], [0.32, 1.465], [0.3, 1.54], [0.08, 1.545]], 0.3, 0, M.gloss, 0.02);
  k.fascia(roundRect(-0.12, 1.475, 0.12, 1.53, 0.015), 0.32, 1, M.grille, 0.02, [], 0.002);
  k.cyl(0.006, 0.006, 0.25, -0.2, 1.58, -0.6, M.gloss, 'y', 6);
  k.foil(0.4, 0.1, 1.74, 0, 1.36, -2.08, 0.1, M.gloss);
  k.foil(0.16, 0.1, 1.74, 0, 1.42, -2.3, 0.45, M.gloss);
  sym(s => k.prof([[-1.85, 1.3], [-2.4, 1.3], [-2.42, 1.48], [-1.98, 1.47]], 0.018, s * 0.87, M.gloss, 0.004));
  sym(s => k.box(0.02, 0.26, 0.2, s * 0.45, 1.2, -1.95, M.gloss));
  // front: small headlights, big grille, canards, splitter, red tow strap
  sym(s => {
    k.fascia([[0.5, 0.66], [0.8, 0.64], [0.78, 0.72], [0.54, 0.735]], 2.15, 1, M.lens, 0.04);
    k.fascia([[0.55, 0.675], [0.76, 0.66], [0.75, 0.675], [0.56, 0.69]], 2.15, 1, M.drl, 0.04, [], 0.012);
    k.side(body, quad([1.96, 0.64], [2.12, 0.63], [1.97, 0.73], [2.11, 0.73]), M.lens, { off: 0.004 });
    k.box(0.3, 0.012, 0.18, s * 0.78, 0.45, 2.1, M.gloss, 0, s * 0.2, s * 0.12);
    k.box(0.012, 0.3, 0.4, s * 0.93, 0.47, -1.85, M.trim);
  });
  k.fascia(roundRect(-0.46, 0.38, 0.46, 0.62, 0.06), 2.15, 1, M.grille, 0.05);
  k.fascia2(roundRect(0.52, 0.38, 0.7, 0.56, 0.04), 2.15, 1, M.grille, 0.05);
  k.plate([[-0.86, 1.95], [0.86, 1.95], [0.82, 2.24], [-0.82, 2.24]], 0.3, 0.025, M.gloss);
  k.plate([[-0.55, 0.8], [0.55, 0.8], [0.6, 2.0], [-0.6, 2.0]], 0.24, 0.02, M.alu);
  k.tube([[-0.12, 0.34, 2.16], [0, 0.3, 2.22], [0.12, 0.34, 2.16]], 0.012, M.caliperRed, 10);
  // mud flaps
  sym(s => { k.box(0.24, 0.26, 0.01, s * 0.80, 0.19, 0.86, M.trim); k.box(0.24, 0.26, 0.01, s * 0.80, 0.19, -1.8, M.trim); });
  // rear
  sym(s => {
    k.fascia([[0.5, 0.86], [0.8, 0.86], [0.82, 0.96], [0.52, 0.97]], -2.08, -1, M.tail, 0.04);
    k.side(body, quad([-2.07, 0.86], [-1.95, 0.86], [-2.07, 0.97], [-1.97, 0.97]), M.tail, { off: 0.004 });
  });
  k.fascia(roundRect(-0.8, 0.42, 0.8, 0.6, 0.04), -2.08, -1, M.gloss, 0.03);
  k.cyl(0.06, 0.06, 0.2, 0.55, 0.42, -2.12, M.alu, 'z', 14, true);
  k.mirrorPod(0.97, 1.1, 0.8, 0.2, 0.1, 0.13, M.accent);
  wheelSet(k, body, { ...W, rim: 0.56, style: 'rally', rimMat: M.whiteRim, caliper: M.caliperRed });
};

/* ================================================================ Group B rally legend
 * Modelled on the 1985 Audi Sport quattro S1 E2: 4.16 m long, 1.86 m wide, 2.22 m wheelbase. */
MODELS.groupb = (k) => {
  const M = k.M;
  const W = { fz: 1.18, rz: -1.04, fr: 0.33, rr: 0.33, fx: 0.775, rx: 0.775, fw: 0.25, rw: 0.25 };
  const body = k.loft([
    [-2.00, 0.84, 0.38, 0.78, 0.97, 8, 0, 0.03],
    [-1.96, 0.905, 0.33, 0.76, 0.99, 8, 0, 0.03],
    [-1.04, 0.935, 0.30, 0.75, 1.0, 8, 0.02, 0.03],
    [-0.50, 0.87, 0.28, 0.74, 0.98, 8, 0, 0.03],
    [0.55, 0.87, 0.28, 0.74, 0.98, 8, 0, 0.03],
    [1.18, 0.935, 0.28, 0.73, 0.93, 8, 0.02, 0.03],
    [1.85, 0.925, 0.28, 0.72, 0.87, 8, 0, 0.03],
    [2.00, 0.90, 0.28, 0.70, 0.85, 8],
    [2.04, 0.84, 0.30, 0.68, 0.83, 8],
  ], { arches: [k.arch(W.fz, W.fr, W.fx, W.fw, 0.06), k.arch(W.rz, W.rr, W.rx, W.rw, 0.06)], n: 70 });
  k.skin(body, M.paint);
  archLips(k, body, M.paint, 0.022);
  const cab = k.loft([
    [-1.70, 0.66, 0.9, 0.99, 1.02, 4],
    [-1.55, 0.70, 0.9, 1.0, 1.16, 4.5],
    [-1.05, 0.72, 0.9, 1.0, 1.34, 5],
    [-0.10, 0.73, 0.9, 1.0, 1.345, 5],
    [0.25, 0.75, 0.9, 1.0, 1.18, 5],
    [0.60, 0.78, 0.9, 0.99, 0.99, 5],
    [0.64, 0.76, 0.9, 0.985, 0.985, 5],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  k.top(cab, quad([-0.02, -0.64], [0.61, -0.74], [-0.02, 0.64], [0.61, 0.74]), M.glass);
  k.side(cab, quad([-1.0, 1.03], [0.55, 1.02], [-1.0, 1.3], [-0.05, 1.31]), M.glass);
  k.side(cab, rect(-0.42, -0.36, 1.02, 1.32), M.gloss, { off: 0.008, nu: 1 });
  k.top(cab, quad([-1.66, -0.55], [-1.12, -0.6], [-1.66, 0.55], [-1.12, 0.6]), M.glass);
  // Audi Sport style side bands and door plates
  const stripe = (y0, y1, mat, off) => band(k, body, -1.95, 2.0, y0, y1, mat, { off });
  stripe(0.36, 0.40, M.accent2, 0.005); stripe(0.40, 0.43, M.accent, 0.005); stripe(0.43, 0.46, M.gloss, 0.005);
  k.side(body, rect(0.48, -0.2, 0.52, 0.8), M.plate, { off: 0.007, nu: 8, nv: 6, keep: true });
  shut(k, body, 0.56, 0.3, 0.97); shut(k, body, -0.62, 0.3, 0.98);
  // bonnet vents and roof vent
  sym(s => k.top(body, rect(1.2, 1.55, s * 0.12, s * 0.42), M.grille, { off: 0.003 }));
  k.prof([[-0.5, 1.34], [-0.2, 1.345], [-0.22, 1.39], [-0.45, 1.39]], 0.36, 0, M.paint, 0.015);
  // front: quad rectangular lamps, grille, big shovel splitter with fences
  sym(s => {
    k.fascia(roundRect(s > 0 ? 0.36 : -0.8, 0.62, s > 0 ? 0.8 : -0.36, 0.76, 0.015), 2.04, 1, M.chrome, 0.03);
    k.fascia(roundRect(s > 0 ? 0.38 : -0.58, 0.635, s > 0 ? 0.58 : -0.38, 0.745, 0.01), 2.04, 1, M.lamp, 0.03, [], 0.012);
    k.fascia(roundRect(s > 0 ? 0.6 : -0.78, 0.635, s > 0 ? 0.78 : -0.6, 0.745, 0.01), 2.04, 1, M.lamp, 0.03, [], 0.012);
    k.prof([[1.95, 0.14], [2.26, 0.14], [2.24, 0.34], [2.0, 0.36]], 0.02, s * 0.88, M.paint, 0.004);
  });
  k.fascia(roundRect(-0.34, 0.6, 0.34, 0.78, 0.02), 2.04, 1, M.grille, 0.03);
  k.fascia(roundRect(-0.8, 0.33, 0.8, 0.54, 0.03), 2.04, 1, M.grille, 0.04);
  k.plate([[-0.9, 1.95], [0.9, 1.95], [0.9, 2.26], [-0.9, 2.26]], 0.13, 0.025, M.gloss);
  // rear: full-width tail panel, huge rear wing
  k.fascia(roundRect(-0.84, 0.7, 0.84, 0.86, 0.02), -2.0, -1, M.tail, 0.04);
  k.fascia(roundRect(-0.3, 0.72, 0.3, 0.84, 0.02), -2.0, -1, M.gloss, 0.04, [], 0.012);
  k.fascia(roundRect(-0.84, 0.36, 0.84, 0.5, 0.03), -2.0, -1, M.gloss, 0.03);
  k.cyl(0.06, 0.06, 0.2, -0.5, 0.36, -2.04, M.alu, 'z', 14, true);
  k.foil(0.5, 0.1, 1.82, 0, 1.25, -2.02, 0.16, M.paint);
  sym(s => {
    k.prof([[-1.7, 0.98], [-2.32, 1.1], [-2.3, 1.36], [-1.8, 1.32]], 0.02, s * 0.91, M.paint, 0.004);
    k.box(0.02, 0.24, 0.12, s * 0.5, 1.1, -1.9, M.gloss);
    k.box(0.24, 0.28, 0.01, s * 0.775, 0.19, 0.72, M.gloss); k.box(0.24, 0.28, 0.01, s * 0.775, 0.19, -1.5, M.gloss);
  });
  k.mirrorPod(0.97, 1.08, 0.5, 0.18, 0.1, 0.12);
  wheelSet(k, body, { ...W, rim: 0.62, style: 'six', rimMat: M.alu, caliper: M.caliperRed });
};

/* ================================================================ Endurance prototype
 * Modelled on a Le Mans Hypercar (Toyota GR010 / Porsche 963 class): 5.0 m long, 2.0 m wide, 3.05 m wheelbase. */
MODELS.proto = (k) => {
  const M = k.M;
  const W = { fz: 1.55, rz: -1.50, fr: 0.355, rr: 0.36, fx: 0.82, rx: 0.8, fw: 0.31, rw: 0.345 };
  const body = k.loft([
    [-2.45, 0.90, 0.30, 0.55, 0.76, 6, 0.10],
    [-2.40, 0.965, 0.24, 0.52, 0.85, 6, 0.18],
    [-1.50, 1.0, 0.12, 0.45, 0.93, 7, 0.34],
    [-0.60, 0.94, 0.10, 0.42, 0.74, 6, 0.12],
    [0.40, 0.93, 0.10, 0.42, 0.68, 6, 0.10],
    [1.55, 1.0, 0.10, 0.45, 0.93, 7, 0.38],
    [2.20, 0.98, 0.08, 0.36, 0.74, 6, 0.30],
    [2.48, 0.92, 0.07, 0.25, 0.46, 5, 0.12],
    [2.55, 0.80, 0.07, 0.20, 0.34, 4],
  ], { arches: [k.arch(W.fz, W.fr, W.fx, W.fw, 0.04), k.arch(W.rz, W.rr, W.rx, W.rw, 0.04)], n: 80 });
  k.skin(body, M.paint);
  const cab = k.loft([
    [-2.30, 0.18, 0.5, 0.58, 0.64, 3],
    [-1.40, 0.36, 0.5, 0.62, 0.87, 3],
    [-0.60, 0.52, 0.5, 0.66, 1.03, 3],
    [0.10, 0.55, 0.5, 0.68, 1.05, 3],
    [0.60, 0.55, 0.5, 0.68, 0.96, 3],
    [1.10, 0.50, 0.5, 0.64, 0.75, 3],
    [1.40, 0.40, 0.5, 0.58, 0.60, 3],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.paint);
  k.top(cab, quad([0.0, -0.44], [1.18, -0.5], [0.0, 0.44], [1.18, 0.5]), M.glass);
  k.top(cab, quad([0.0, -0.42], [0.12, -0.44], [0.0, 0.42], [0.12, 0.44]), M.gloss, { off: 0.007, nu: 2 });
  k.side(cab, quad([-0.5, 0.76], [0.62, 0.74], [-0.25, 0.95], [0.18, 0.98]), M.glass);
  // shark fin
  k.prof([[-0.45, 0.99], [-2.3, 0.62], [-2.38, 1.08], [-1.0, 1.08]], 0.018, 0, M.paint, 0.004);
  // livery: dark lower body, accent flashes, number panels
  band(k, body, -2.44, 2.54, 0.08, 0.3, M.accent2, { off: 0.004 });
  k.side(body, quad([-1.0, 0.3], [1.0, 0.3], [-0.6, 0.38], [0.6, 0.42]), M.accent, { off: 0.005, nu: 20, nv: 3 });
  k.side(body, rect(0.3, -0.35, 0.22, 0.52), M.plate, { off: 0.006, nu: 8, nv: 6, keep: true });
  // fender louvres
  sym(s => { louvres(k, body, 1.2, 1.75, s * 0.55, s * 0.85, 7, { mat: M.carbon, mirror: false }); louvres(k, body, -1.85, -1.2, s * 0.55, s * 0.85, 7, { mat: M.carbon, mirror: false }); });
  // headlights: slim LED blades on the fender noses
  sym(s => {
    k.top(body, quad([2.28, s * 0.5], [2.36, s * 0.52], [2.12, s * 0.88], [2.22, s * 0.9]), M.lens, { off: 0.006, mirror: false });
    k.top(body, quad([2.3, s * 0.54], [2.33, s * 0.55], [2.17, s * 0.84], [2.2, s * 0.85]), M.drl, { off: 0.01, nu: 8, nv: 2, mirror: false });
  });
  // splitter, canards, diffuser, rear light bar, rain light, wing
  k.plate([[-0.98, 2.1], [0.98, 2.1], [0.95, 2.55], [0.6, 2.63], [-0.6, 2.63], [-0.95, 2.55]], 0.05, 0.025, M.trim);
  sym(s => k.box(0.22, 0.01, 0.2, s * 0.86, 0.3, 2.38, M.carbon, 0, 0, s * 0.18));
  k.fascia(roundRect(-0.85, 0.3, 0.85, 0.72, 0.05), -2.45, -1, M.grille, 0.04);
  k.plate([[-0.9, -2.55], [0.9, -2.55], [0.95, -1.7], [-0.95, -1.7]], 0.08, 0.02, M.carbon);
  for (let i = -3; i <= 3; i++) k.box(0.012, 0.24, 0.6, i * 0.25, 0.2, -2.2, M.carbon);
  k.fascia([[-0.9, 0.74], [0.9, 0.74], [0.9, 0.76], [-0.9, 0.76]], -2.45, -1, M.tail, 0.04, [], 0.01);
  k.box(0.1, 0.1, 0.03, 0, 0.5, -2.46, M.tail);
  k.foil(0.34, 0.1, 1.86, 0, 1.03, -2.36, 0.14, M.carbon);
  sym(s => k.prof([[-1.85, 0.7], [-2.62, 0.72], [-2.62, 1.14], [-2.1, 1.14]], 0.02, s * 0.94, M.paint, 0.004));
  k.prof([[-2.22, 0.8], [-2.52, 0.8], [-2.48, 1.02], [-2.26, 1.02]], 0.02, 0, M.carbon, 0.004);
  k.mirrorPod(0.9, 0.86, 0.95, 0.16, 0.07, 0.1);
  wheelSet(k, body, { ...W, rim: 0.64, style: 'mesh', rimMat: M.blackRim, caliper: M.caliperBlack, nutMat: M.caliperRed });
};

/* ================================================================ Hypercar
 * Modelled on the Bugatti Chiron: 4.54 m long, 2.04 m wide, 1.21 m tall, 2.71 m wheelbase. */
MODELS.hyper = (k) => {
  const M = k.M;
  const W = { fz: 1.36, rz: -1.35, fr: 0.34, rr: 0.358, fx: 0.85, rx: 0.84, fw: 0.285, rw: 0.355 };
  const body = k.loft([
    [-2.18, 0.86, 0.34, 0.66, 0.92, 4],
    [-2.14, 0.96, 0.28, 0.64, 0.96, 4],
    [-1.95, 1.0, 0.22, 0.62, 0.99, 4, 0.04],
    [-1.35, 1.03, 0.17, 0.60, 1.02, 4, 0.10],
    [-0.60, 0.99, 0.16, 0.57, 0.97, 4, 0.05],
    [0.30, 0.98, 0.16, 0.56, 0.89, 4, 0.03],
    [0.85, 0.99, 0.16, 0.56, 0.85, 4, 0.08],
    [1.36, 1.01, 0.16, 0.56, 0.81, 4, 0.14],
    [1.95, 0.97, 0.15, 0.50, 0.71, 4, 0.10],
    [2.25, 0.86, 0.16, 0.44, 0.60, 3.6, 0.04],
    [2.36, 0.66, 0.18, 0.40, 0.52, 3.2],
  ], {
    arches: [k.arch(W.fz, W.fr, W.fx, W.fw), k.arch(W.rz, W.rr, W.rx, W.rw)],
    dents: [{ z0: -0.92, z1: -0.5, y0: 0.32, y1: 0.86, depth: 0.1, s: 0.04 }],
  });
  k.skin(body, M.paint);
  const cab = k.loft([
    [-1.55, 0.50, 0.85, 0.93, 0.98, 3],
    [-1.10, 0.60, 0.85, 0.94, 1.10, 3],
    [-0.40, 0.66, 0.84, 0.94, 1.20, 3.2],
    [0.05, 0.68, 0.82, 0.93, 1.21, 3.2],
    [0.50, 0.72, 0.80, 0.91, 1.10, 3],
    [0.98, 0.76, 0.78, 0.87, 0.86, 3],
    [1.04, 0.72, 0.78, 0.86, 0.855, 3],
  ], { n: 32, kb: 22, ka: 3 });
  k.skin(cab, M.carbon);
  k.top(cab, quad([0.18, -0.56], [0.99, -0.74], [0.18, 0.56], [0.99, 0.74]), M.glass);
  k.side(cab, quad([-0.42, 0.97], [0.92, 0.9], [-0.25, 1.1], [0.2, 1.15]), M.glass);
  k.top(cab, rect(-1.5, -0.62, -0.4, 0.4), M.grille, { off: 0.003 });
  // centre spine running from the windscreen to the tail
  k.prof([[0.3, 1.19], [0.3, 1.215], [-0.3, 1.235], [-1.2, 1.12], [-1.62, 1.0], [-1.6, 0.97], [-1.2, 1.08], [-0.3, 1.2]], 0.04, 0, M.paint, 0.01);
  // the signature C-line, polished aluminium, with the side intake behind it
  const X = (z, y) => Math.max(body.sideX(z, y), y > 0.86 ? cab.sideX(z, y) : 0) + 0.012;
  sym(s => surfaceTube(k, [[0.45, 1.1], [0.05, 1.15], [-0.4, 1.09], [-0.72, 0.95], [-0.88, 0.7], [-0.84, 0.44], [-0.55, 0.28], [0.1, 0.24], [0.58, 0.27]], X, 0.02, M.chrome, s, 90));
  k.side(body, quad([-0.92, 0.34], [-0.52, 0.34], [-0.9, 0.84], [-0.6, 0.84]), M.grille, { off: 0.002 });
  // horseshoe grille, quad LED headlights, big corner intakes
  const horse = [[-0.17, 0.5], ...ellipsePts(0, 0.36, 0.17, 0.16, 32).filter(p => p[1] < 0.37).sort((a, b) => a[0] - b[0]), [0.17, 0.5]];
  k.fascia(horse, 2.36, 1, M.grille, 0.05);
  k.tube([[-0.17, 0.5, 2.37], [-0.175, 0.36, 2.37], [-0.12, 0.23, 2.37], [0, 0.2, 2.37], [0.12, 0.23, 2.37], [0.175, 0.36, 2.37], [0.17, 0.5, 2.37], [0, 0.505, 2.37]], 0.014, M.chrome, 48, true, 6);
  sym(s => {
    k.top(body, quad([2.08, s * 0.40], [2.24, s * 0.58], [1.9, s * 0.62], [2.06, s * 0.86]), M.lens, { off: 0.006, mirror: false });
    for (let i = 0; i < 4; i++) k.top(body, ellipse(2.14 - i * 0.055, s * (0.52 + i * 0.075), 0.03, 0.022, 0.9), M.drl, { off: 0.011, nu: 2, nv: 10, mirror: false });
  });
  k.side(body, quad([1.93, 0.17], [2.3, 0.18], [1.98, 0.40], [2.24, 0.38]), M.grille, { off: 0.003 });
  k.plate([[-0.94, 2.0], [0.94, 2.0], [0.9, 2.24], [0.6, 2.38], [-0.6, 2.38], [-0.9, 2.24]], 0.1, 0.025, M.trim);
  // rear: full-width light bar, mesh panel, centre quad exhaust, deployed airbrake wing, diffuser
  k.fascia([[-0.8, 0.83], [0.8, 0.83], [0.82, 0.86], [-0.82, 0.86]], -2.18, -1, M.tail, 0.04, [], 0.01);
  for (let i = -8; i <= 8; i++) k.fascia([[i * 0.09 - 0.004, 0.827], [i * 0.09 + 0.004, 0.827], [i * 0.09 + 0.004, 0.864], [i * 0.09 - 0.004, 0.864]], -2.18, -1, M.gloss, 0.04, [], 0.012);
  k.fascia(roundRect(-0.86, 0.38, 0.86, 0.8, 0.06), -2.18, -1, M.grille, 0.04);
  k.fascia(roundRect(-0.2, 0.36, 0.2, 0.56, 0.06), -2.18, -1, M.chrome, 0.05, [], 0.015);
  sym(s => { for (const y of [0.41, 0.51]) k.cyl(0.04, 0.04, 0.03, s * 0.09, y, -2.2, M.grille, 'z', 12); });
  k.top(body, rect(-2.14, -1.62, -0.82, 0.82), M.carbon, { off: 0.012, nu: 10, nv: 16 });
  k.plate([[-0.95, -2.28], [0.95, -2.28], [0.95, -1.6], [-0.95, -1.6]], 0.1, 0.02, M.carbon);
  for (let i = -4; i <= 4; i++) k.box(0.012, 0.24, 0.55, i * 0.2, 0.22, -2.0, M.carbon);
  k.mirrorPod(1.06, 0.88, 0.7, 0.2, 0.08, 0.12);
  wheelSet(k, body, { ...W, rimF: 0.75, rimR: 0.745, style: 'ten', rimMat: M.alu, caliper: M.caliperBlue });
};

/* ================================================================ Formula 1
 * Modelled on a 2022+ ground-effect F1 car: 5.6 m long, 2.0 m wide, 3.6 m wheelbase, 18" wheels. */
MODELS.formula = (k) => {
  const M = k.M;
  const W = { fz: 1.8, rz: -1.8, fr: 0.36, rr: 0.36, fx: 0.80, rx: 0.79, fw: 0.305, rw: 0.405 };
  // survival cell and nose
  const tub = k.loft([
    [-0.95, 0.34, 0.06, 0.5, 0.86, 3],
    [-0.30, 0.40, 0.06, 0.5, 0.72, 3.5],
    [0.50, 0.36, 0.07, 0.5, 0.72, 3.5],
    [1.00, 0.30, 0.10, 0.45, 0.68, 3.2],
    [1.80, 0.20, 0.17, 0.38, 0.58, 3],
    [2.40, 0.13, 0.19, 0.30, 0.42, 2.8],
    [2.85, 0.075, 0.21, 0.26, 0.31, 2.6],
  ], { n: 30, kb: 18, ka: 3 });
  k.skin(tub, M.paint);
  // engine cover and airbox
  const cover = k.loft([
    [-2.35, 0.05, 0.22, 0.3, 0.36, 3],
    [-2.10, 0.10, 0.20, 0.35, 0.45, 3],
    [-1.40, 0.22, 0.20, 0.5, 0.72, 3],
    [-0.70, 0.30, 0.30, 0.62, 0.97, 3],
    [-0.30, 0.20, 0.50, 0.78, 1.0, 3],
    [-0.24, 0.17, 0.52, 0.8, 0.98, 3],
  ], { n: 26, kb: 18, ka: 3 });
  k.skin(cover, M.paint);
  k.fascia(ellipsePts(0, 0.9, 0.11, 0.075, 20), -0.24, 1, M.grille, 0.03);
  // sidepods (downwash style) with inlets
  const pod = k.loft([
    [-1.45, 0.05, 0.14, 0.18, 0.2, 3],
    [-1.20, 0.12, 0.13, 0.25, 0.3, 3],
    [-0.50, 0.23, 0.12, 0.40, 0.55, 4],
    [0.20, 0.26, 0.14, 0.46, 0.64, 4],
    [0.52, 0.23, 0.2, 0.47, 0.63, 4],
    [0.56, 0.21, 0.22, 0.47, 0.62, 4],
  ], { n: 24, kb: 16, ka: 3 });
  sym(s => {
    k.skin(pod, M.paint, s * 0.52);
    k.fascia(roundRect(s * 0.52 - 0.17, 0.3, s * 0.52 + 0.17, 0.58, 0.05), 0.56, 1, M.grille, 0.03);
    k.top(pod, rect(-1.0, 0.3, 0.02, 0.2), M.accent, { off: 0.005, x: s * 0.52, mirror: false });
  });
  // livery stripes on nose and engine cover
  k.top(tub, rect(1.0, 2.86, -0.07, 0.07), M.accent, { off: 0.004, nu: 24, nv: 4 });
  k.top(cover, rect(-2.3, -0.7, -0.06, 0.06), M.accent, { off: 0.004, nu: 20, nv: 4 });
  k.side(cover, quad([-2.2, 0.36], [-1.0, 0.5], [-2.2, 0.44], [-1.0, 0.72]), M.accent2, { off: 0.004, nu: 16, nv: 4 });
  // cockpit, driver, halo, T-cam, fin
  k.top(tub, rect(-0.55, 0.4, -0.27, 0.27), M.grille, { off: 0.003, nu: 12, nv: 10 });
  k.ellipsoid(0.13, 0.14, 0.15, 0, 0.83, -0.2, M.helmet, 20);
  k.ellipsoid(0.132, 0.045, 0.12, 0, 0.845, -0.16, M.glass, 16).rotation.x = 0.15;
  k.box(0.26, 0.03, 0.02, 0, 0.9, -0.1, M.accent);
  k.tube([[-0.4, 0.73, -0.4], [-0.42, 0.9, -0.15], [-0.32, 0.96, 0.18], [0, 0.97, 0.32], [0.32, 0.96, 0.18], [0.42, 0.9, -0.15], [0.4, 0.73, -0.4]], 0.035, M.carbon, 48, false, 10);
  k.tube([[0, 0.97, 0.32], [0, 0.88, 0.52], [0, 0.72, 0.6]], 0.03, M.carbon, 12, false, 8);
  k.box(0.1, 0.05, 0.12, 0, 1.02, -0.3, M.caliperYellow);
  k.prof([[-0.7, 0.96], [-2.2, 0.44], [-2.3, 0.62], [-1.4, 0.82], [-0.75, 0.99]], 0.012, 0, M.paint, 0.003);
  k.decal(0.3, 0.2, 0.012, 0.74, -1.55, M.num, 'x', 1); k.decal(0.3, 0.2, -0.012, 0.74, -1.55, M.num, 'x', -1);
  k.decal(0.16, 0.16, 0, 0.44, 2.4, M.num, 'y', 1, -0.2);
  // mirrors on stalks
  sym(s => { k.ellipsoid(0.08, 0.04, 0.05, s * 0.5, 0.72, 0.42, M.paint, 12); k.box(0.2, 0.015, 0.03, s * 0.38, 0.7, 0.42, M.carbon); });
  // floor with edge wings
  k.plate([[-0.62, 1.05], [0.62, 1.05], [0.82, 0.5], [0.9, -1.2], [0.62, -1.45], [0.62, -2.15], [-0.62, -2.15], [-0.62, -1.45], [-0.9, -1.2], [-0.82, 0.5]], 0.04, 0.025, M.trim);
  k.plate([[-0.5, -2.15], [0.5, -2.15], [0.5, -2.4], [-0.5, -2.4]], 0.08, 0.02, M.trim);
  for (let i = -2; i <= 2; i++) k.box(0.01, 0.22, 0.55, i * 0.22, 0.18, -2.15, M.carbon);
  // front wing: four elements sweeping up to the nose, endplates
  const fw = [[0.34, 0.07, 2.72, 0.12, 0.0], [0.2, 0.12, 2.52, 0.2, 0.25], [0.16, 0.17, 2.4, 0.26, 0.45], [0.12, 0.22, 2.3, 0.31, 0.65]];
  sym(s => {
    for (const [chord, t, z, y, a] of fw) k.foil(chord, t * 0.9, 0.78, s * 0.56, y, z, a, a > 0.5 ? M.paint : M.carbon);
    k.prof([[2.25, 0.06], [2.95, 0.06], [2.95, 0.16], [2.6, 0.3], [2.3, 0.3]], 0.015, s * 0.96, M.carbon, 0.003);
  });
  k.foil(0.34, 0.07, 0.4, 0, 0.1, 2.75, 0.0, M.carbon);
  // rear wing, beam wing, pylon, rain light
  k.foil(0.36, 0.1, 1.0, 0, 0.83, -2.4, 0.12, M.carbon);
  k.foil(0.18, 0.1, 1.0, 0, 0.93, -2.58, 0.5, M.paint);
  k.foil(0.2, 0.1, 0.9, 0, 0.4, -2.35, 0.2, M.carbon);
  sym(s => k.prof([[-2.22, 0.62], [-2.7, 0.66], [-2.74, 0.98], [-2.6, 1.02], [-2.26, 1.0], [-2.2, 0.9]], 0.015, s * 0.5, M.paint, 0.003));
  k.prof([[-2.2, 0.3], [-2.45, 0.3], [-2.5, 0.8], [-2.35, 0.82]], 0.02, 0, M.carbon, 0.004);
  k.box(0.08, 0.06, 0.02, 0, 0.3, -2.42, M.tail);
  // suspension: wishbones and push/pull rods
  sym(s => {
    for (const [z0, zw] of [[1.9, 1.8], [-1.6, -1.8]]) {
      const x0 = s * 0.2, x1 = s * 0.62;
      k.tube([[x0, 0.25, z0 + 0.2], [x1, 0.28, zw]], 0.018, M.carbon, 2, false, 6);
      k.tube([[x0, 0.25, z0 - 0.2], [x1, 0.28, zw]], 0.018, M.carbon, 2, false, 6);
      k.tube([[x0, 0.5, z0 + 0.15], [x1, 0.5, zw]], 0.016, M.carbon, 2, false, 6);
      k.tube([[x0, 0.5, z0 - 0.15], [x1, 0.5, zw]], 0.016, M.carbon, 2, false, 6);
      k.tube([[x0, 0.55, z0], [x1, 0.3, zw]], 0.014, M.carbon, 2, false, 6);
    }
    // wheel-wake deflectors over the front tyres
    const d = new THREE.TorusGeometry(0.42, 0.012, 4, 20, Math.PI * 0.55);
    d.rotateY(Math.PI / 2);
    const dm = k.mesh(d, M.carbon); dm.position.set(s * 0.8, 0.36, 1.8); dm.rotation.x = -Math.PI * 0.05;
  });
  wheelSet(k, null, { ...W, rim: 0.635, style: 'f1', rimMat: M.blackRim, caliper: M.caliperBlack, band: M.pirelliRed, accentMat: M.accent });
};

/* ================================================================ instances */

const TEMPLATES = new Map();
function template(shape, quality) {
  const key = shape + ':' + quality;
  if (!TEMPLATES.has(key)) {
    detail.f = quality === 'low' ? 0.6 : 1;
    const k = new Kit();
    (MODELS[shape] || MODELS.hatch)(k);
    TEMPLATES.set(key, k.finish());
    detail.f = 1;
  }
  return TEMPLATES.get(key);
}

function numberTexture(n, plate) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = plate ? 160 : 256;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (plate) {
    x.fillStyle = '#ffffff';
    x.fillRect(6, 6, 244, 148);
    x.lineWidth = 8; x.strokeStyle = '#111'; x.strokeRect(6, 6, 244, 148);
    x.fillStyle = '#111'; x.font = 'bold 112px Arial, sans-serif';
    x.fillText(String(n), 128, 86);
  } else {
    x.font = 'italic bold 180px Arial, sans-serif';
    x.lineWidth = 16; x.strokeStyle = '#111'; x.strokeText(String(n), 128, 136);
    x.fillStyle = '#fff'; x.fillText(String(n), 128, 136);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function instanceMaterials(color, style) {
  const S = sharedMaterials();
  const c = new THREE.Color(color);
  const hsl = {}; c.getHSL(hsl);
  const light = hsl.l > 0.62 || (hsl.h > 0.1 && hsl.h < 0.2 && hsl.l > 0.45);
  const arcade = style === 'arcade';
  const paint = S.paint.clone(); paint.color.copy(c);
  // arcade: candy-gloss paint that keeps its colour (low metalness), lamps that glow
  if (arcade) { paint.metalness = 0.1; paint.roughness = 0.42; paint.clearcoat = 0.6; paint.clearcoatRoughness = 0.12; paint.envMapIntensity = 0.55; }
  else { paint.metalness = 0.45; paint.roughness = 0.3; paint.clearcoatRoughness = 0.06; }
  const accent = S.accent.clone(); accent.color.set(light ? 0x15171c : 0xf3f3f1); accent.metalness = arcade ? 0.05 : 0.2;
  const accent2 = S.accent2.clone(); accent2.color.copy(c).offsetHSL(0, 0, light ? -0.3 : -0.18); accent2.metalness = arcade ? 0.1 : 0.4;
  const tail = S.tail.clone();
  tail.userData.idle = 0.8; tail.userData.brake = 3.5;
  // arcade lamps skip tone mapping so they stay a deep, saturated red instead of washing out to orange
  if (arcade) { tail.color.set(0x5a0000); tail.emissive.set(0xff1808); tail.toneMapped = false; tail.userData.idle = 0.85; tail.userData.brake = 1.6; tail.emissiveIntensity = 0.85; }
  const glow = S.glow.clone();
  glow.userData.idle = 0.55; glow.userData.brake = 1.0; glow.opacity = 0.55;
  const n = (Math.imul(color >>> 0, 2654435761) >>> 0) % 98 + 2;
  const plate = S.plate.clone(); plate.map = numberTexture(n, true);
  const num = S.num.clone(); num.map = numberTexture(n, false);
  return { paint, accent, accent2, tail, glow, plate, num };
}

/** Switch a car's brake lights (lamps and their glow halos) on or off. */
export function setBrakeLights(list, on) {
  for (const l of list) {
    const m = l.material, v = on ? m.userData.brake : m.userData.idle;
    if (m.isMeshBasicMaterial) m.opacity = v; else m.emissiveIntensity = v;
  }
}

/** Build a car mesh. quality: 'high' | 'low'. userData: { wheels, frontWheels, body, brakeLights }. */
export function buildCarMesh(shape, color, quality = 'high') {
  const g = template(shape, quality).clone(true);
  const mats = instanceMaterials(color, g.userData.style);
  const wheels = [], frontWheels = [], brakeLights = [];
  let body = null;
  g.traverse((o) => {
    const tag = o.userData.tag;
    if (tag === 'body') body = o;
    else if (tag === 'spin') wheels.push(o);
    if (tag === 'steer') frontWheels.push(o);
    if (o.isMesh) {
      const r = o.material.userData.role;
      if (r && mats[r]) o.material = mats[r];
      if (r === 'tail' || r === 'glow') brakeLights.push(o);
    }
  });
  g.userData = { wheels, frontWheels, body, brakeLights };
  return g;
}

export const MODEL_IDS = Object.keys(MODELS);

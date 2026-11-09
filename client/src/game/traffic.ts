// Circulation : véhicules bas poly (berline, citadine, SUV, taxi, utilitaire, camion, bus) qui roulent
// à droite sur les voies rapides, les avenues et la grille des rues (d'intersection en intersection,
// avec feux tricolores et file d'attente), rames de métro / RER articulées, péniches et bateaux-mouches.
// Les véhicules ne sont simulés et dessinés qu'autour de la caméra (fenêtre glissante) : la densité
// visible est réaliste pour un coût constant. Densité selon l'heure (pointes du matin et du soir) et
// l'activité économique.
// Dès que la bibliothèque de modèles Blender est chargée (cityModels.ts), chaque type de véhicule, les rames
// et les bateaux sont dessinés avec leur modèle (instances fines dynamiques, phares et feux arrière intégrés) ;
// les modèles procéduraux ci-dessous restent le repli (chargement en cours, GLB manquant).
import { Color3, Mesh, StandardMaterial, VertexData, type ArcRotateCamera, type Scene } from '@babylonjs/core';
import { mulberry32 } from '../../../shared/noise';
import { urbanDensity } from '../../../shared/sim/country';
import type { CountryDef } from '../../../shared/sim/types';
import { ENV, type Grid } from './terrain';
import { CLOCK, LANES, getNetwork, hasSignal, occAt, sampleAt, signalState, surfaceY, type NetPath } from './roads';
import { setThinCount } from './thin';
import { whenModels } from './cityModels';
import { createThinInstances, type ThinInstanceBuffer } from './modelLibrary';

// ---------- modèles ----------
type RGB = [number, number, number];
class VGeo {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; idx: number[] = [];
  /** Hexaèdre : 4 coins bas puis 4 coins hauts (x, z) avec y0 / y1, faces planes. */
  hexa(bot: number[][], y0: number, top: number[][], y1: number, c: RGB) {
    const P = [...bot.map(([x, z]) => [x, y0, z]), ...top.map(([x, z]) => [x, y1, z])];
    const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const f of faces) {
      const [a, b, cc] = [P[f[0]], P[f[1]], P[f[2]]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const base = this.pos.length / 3;
      for (const k of f) { this.pos.push(...P[k]); this.nrm.push(nx, ny, nz); this.col.push(c[0], c[1], c[2], 1); }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB) {
    const r = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
    this.hexa(r, y0, r, y1, c);
  }
  /** Bloc à section trapézoïdale (pare-brise et lunette inclinés). */
  cabin(w0: number, w1: number, y0: number, y1: number, zb0: number, zb1: number, zt0: number, zt1: number, c: RGB) {
    this.hexa([[-w0, zb0], [-w0, zb1], [w0, zb1], [w0, zb0]], y0, [[-w1, zt0], [-w1, zt1], [w1, zt1], [w1, zt0]], y1, c);
  }
  wheels(W: number, zs: number[], r: number) {
    for (const z of zs) for (const s of [-1, 1]) this.box(s * W / 2 - (s > 0 ? 0.26 : 0), s * W / 2 + (s < 0 ? 0.26 : 0), 0, r * 2, z - r, z + r, [0.06, 0.06, 0.07]);
  }
  mesh(name: string, scene: Scene, scale = 0.001) {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos.map((v) => v * scale);
    vd.normals = this.nrm; vd.colors = this.col; vd.indices = this.idx;
    vd.applyToMesh(m);
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    return m;
  }
}
const PAINT: RGB = [1, 1, 1];
const GLASS: RGB = [0.07, 0.08, 0.1];
const DARK: RGB = [0.13, 0.13, 0.14];
const HEAD: RGB = [1, 1, 0.95];
const TAIL: RGB = [0.75, 0.06, 0.05];

interface VType { name: string; L: number; W: number; light: number; share: number; build: (g: VGeo) => void }
const car = (L: number, W: number, H: number, body: number, cb: [number, number], ct: [number, number], extra?: (g: VGeo) => void) => (g: VGeo) => {
  g.wheels(W - 0.08, [L / 2 - 0.85, -L / 2 + 0.8], 0.31);
  g.box(-W / 2, W / 2, 0.22, body, -L / 2, L / 2, PAINT);
  g.box(-W / 2 - 0.01, W / 2 + 0.01, 0.22, 0.42, L / 2 - 0.12, L / 2 + 0.03, DARK);
  g.box(-W / 2 - 0.01, W / 2 + 0.01, 0.22, 0.42, -L / 2 - 0.03, -L / 2 + 0.12, DARK);
  g.cabin(W * 0.47, W * 0.4, body, H - 0.05, cb[0] * L, cb[1] * L, ct[0] * L, ct[1] * L, GLASS);
  g.cabin(W * 0.4, W * 0.39, H - 0.05, H, ct[0] * L, ct[1] * L, ct[0] * L + 0.05, ct[1] * L - 0.05, PAINT);
  for (const s of [-1, 1]) {
    g.box(s * (W / 2 - 0.45) - 0.2, s * (W / 2 - 0.45) + 0.2, body - 0.2, body - 0.06, L / 2 - 0.02, L / 2 + 0.02, HEAD);
    g.box(s * (W / 2 - 0.35) - 0.18, s * (W / 2 - 0.35) + 0.18, body - 0.18, body - 0.04, -L / 2 - 0.02, -L / 2 + 0.02, TAIL);
  }
  extra?.(g);
};
const van = (g: VGeo) => {
  g.wheels(1.92, [1.75, -1.8], 0.34);
  g.box(-1, 1, 0.3, 2.45, -2.65, 1.75, PAINT);
  g.box(-1, 1, 0.3, 1.15, 1.75, 2.65, PAINT);
  g.cabin(0.98, 0.96, 1.15, 2.3, 1.75, 2.62, 1.75, 1.95, GLASS);
  g.box(-1.01, 1.01, 1.3, 2.05, 1.2, 1.75, GLASS);
  g.box(-1.01, 1.01, 0.3, 0.5, 2.55, 2.68, DARK);
  for (const s of [-1, 1]) { g.box(s * 0.7 - 0.18, s * 0.7 + 0.18, 0.85, 1.0, 2.64, 2.68, HEAD); g.box(s * 0.85 - 0.1, s * 0.85 + 0.1, 0.6, 1.1, -2.69, -2.64, TAIL); }
};
const lorry = (g: VGeo, L: number) => {
  const h = L / 2;
  g.wheels(2.4, [h - 1.4, -h + 2.8, -h + 1.5], 0.5);
  g.box(-1.1, 1.1, 0.55, 1.0, -h, h, DARK);
  g.box(-1.25, 1.25, 0.55, 3.0, h - 2.3, h, PAINT);
  g.box(-1.26, 1.26, 1.9, 2.8, h - 0.6, h + 0.02, GLASS);
  g.box(-1.25, 1.25, 1.0, 3.75, -h, h - 2.5, [0.94, 0.94, 0.94]);
  for (const s of [-1, 1]) { g.box(s * 0.95 - 0.2, s * 0.95 + 0.2, 0.75, 0.95, h - 0.01, h + 0.03, HEAD); g.box(s * 1.05 - 0.12, s * 1.05 + 0.12, 0.8, 1.2, -h - 0.03, -h + 0.01, TAIL); }
};
const TYPES: VType[] = [
  { name: 'berline', L: 4.7, W: 1.82, light: 0.68, share: 0.29, build: car(4.7, 1.82, 1.45, 0.82, [-0.36, 0.17], [-0.26, 0.02]) },
  { name: 'citadine', L: 3.9, W: 1.72, light: 0.65, share: 0.27, build: car(3.9, 1.72, 1.5, 0.8, [-0.47, 0.17], [-0.43, -0.04]) },
  { name: 'suv', L: 4.6, W: 1.9, light: 0.85, share: 0.17, build: car(4.6, 1.9, 1.72, 1.0, [-0.46, 0.16], [-0.44, -0.02], (g) => { for (const s of [-1, 1]) g.box(s * 0.62 - 0.03, s * 0.62 + 0.03, 1.72, 1.78, -1.7, 0.6, DARK); }) },
  { name: 'taxi', L: 4.7, W: 1.82, light: 0.68, share: 0.05, build: car(4.7, 1.82, 1.45, 0.82, [-0.36, 0.17], [-0.26, 0.02], (g) => g.box(-0.3, 0.3, 1.45, 1.62, -0.6, -0.4, [1, 1, 1])) },
  { name: 'utilitaire', L: 5.3, W: 2.0, light: 0.9, share: 0.09, build: (g) => van(g) },
  { name: 'camion', L: 10, W: 2.5, light: 1.0, share: 0.045, build: (g) => lorry(g, 10) },
  {
    name: 'bus', L: 12, W: 2.55, light: 0.95, share: 0.03, build: (g) => {
      g.wheels(2.45, [3.9, -2.8], 0.5);
      g.box(-1.27, 1.27, 0.35, 3.0, -6, 6, PAINT);
      g.box(-1.285, 1.285, 1.25, 2.55, -5.6, 5.4, GLASS);
      g.box(-1.1, 1.1, 0.9, 2.75, 5.9, 6.02, GLASS);
      g.box(-0.9, 0.9, 3.0, 3.3, -4, 3, [0.75, 0.75, 0.75]);
      g.box(-1.28, 1.28, 0.35, 0.6, -6, 6, DARK);
      for (const s of [-1, 1]) { g.box(s * 1.0 - 0.18, s * 1.0 + 0.18, 0.7, 0.88, 6.0, 6.04, HEAD); g.box(s * 1.1 - 0.1, s * 1.1 + 0.1, 0.8, 1.3, -6.04, -6.0, TAIL); }
    },
  },
  { name: 'semi', L: 16.6, W: 2.55, light: 1.0, share: 0.025, build: (g) => lorry(g, 16.6) },
  { name: 'police', L: 4.7, W: 1.82, light: 0.68, share: 0.012, build: car(4.7, 1.82, 1.45, 0.82, [-0.36, 0.17], [-0.26, 0.02], (g) => g.box(-0.5, 0.5, 1.45, 1.58, -0.5, -0.3, [0.15, 0.3, 1])) },
  { name: 'ambulance', L: 5.3, W: 2.0, light: 0.9, share: 0.008, build: (g) => van(g) },
];
const TAXI = 3, TRUCK = 5, BUS = 6, SEMI = 7, POLICE = 8, AMBU = 9;
const heavy = (t: number) => t === TRUCK || t === SEMI;
/** Modèle de la bibliothèque pour chaque type (même ordre que TYPES). */
const LIB_ID = ['berline', 'citadine', 'suv', 'taxi', 'utilitaire', 'camion_porteur', 'bus_articule', 'semi_remorque', 'police', 'ambulance'];

/** Destination des matrices d'un type : modèle procédural (Mesh) ou instances de la bibliothèque. */
interface Sink { buf: Float32Array; col: Float32Array | null; mesh: Mesh | null; thin: ThinInstanceBuffer | null }
function flushSink(s: Sink, n: number) {
  if (s.thin) {
    if (n || s.thin.count) { s.thin.count = n; s.thin.commit(); }
  } else if (s.mesh) {
    setThinCount(s.mesh, n);
    if (n) { s.mesh.thinInstanceBufferUpdated('matrix'); if (s.col) s.mesh.thinInstanceBufferUpdated('color'); }
  }
}
// teintes de carrosserie réalistes (beaucoup de blanc, gris, noir)
const COLORS: [RGB, number][] = [
  [[0.92, 0.92, 0.91], 0.23], [[0.7, 0.71, 0.73], 0.16], [[0.42, 0.43, 0.45], 0.16], [[0.09, 0.09, 0.1], 0.18],
  [[0.1, 0.16, 0.33], 0.07], [[0.58, 0.07, 0.06], 0.06], [[0.72, 0.66, 0.54], 0.03], [[0.14, 0.3, 0.2], 0.03],
  [[0.32, 0.21, 0.14], 0.02], [[0.45, 0.62, 0.78], 0.04], [[0.85, 0.5, 0.1], 0.02],
];
function pickColor(rnd: () => number): RGB {
  let r = rnd();
  for (const [c, w] of COLORS) { if (r < w) return c; r -= w; }
  return COLORS[0][0];
}

// ---------- simulation ----------
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
interface Veh {
  type: number; col: RGB; mode: 0 | 1 | 2;
  p: number; s: number; dir: number; lane: number; lat: number;
  kx: number; kz: number; d: number; t: number; next: number; glane: number;
  v: number; v0: number; stuck: number;
  x: number; y: number; z: number; hx: number; hz: number;
}

export function createTraffic(scene: Scene, grid: Grid, country: CountryDef, maxCars: number) {
  const net = getNetwork(grid, country);
  const rnd = mulberry32(country.seed + 77);
  const RMAX = maxCars <= 1500 ? 1.9 : maxCars <= 3500 ? 2.7 : 3.4;

  // maillages des véhicules
  const meshes = TYPES.map((t) => { const g = new VGeo(); t.build(g); return g.mesh('veh_' + t.name, scene); });
  const vMat = new StandardMaterial('vehMat', scene);
  vMat.diffuseColor = Color3.White();
  vMat.specularColor = new Color3(0.35, 0.35, 0.35);
  vMat.specularPower = 48;
  for (const m of meshes) m.material = vMat;
  // phares et feux arrière (une paire par instance, lumineux la nuit)
  const lightPair = (name: string, c: Color3) => {
    const g = new VGeo();
    for (const s of [-0.5, 0.5]) g.box(s - 0.16, s + 0.16, -0.13, 0.13, -0.05, 0.05, [1, 1, 1]);
    const m = g.mesh(name, scene, 0.001);
    // la largeur est donnée par l'échelle x de l'instance (km) : on remet x en unités
    const pos = m.getVerticesData('position')!;
    for (let i = 0; i < pos.length; i += 3) pos[i] *= 1000;
    m.setVerticesData('position', pos);
    const mat = new StandardMaterial(name + 'Mat', scene);
    mat.disableLighting = true;
    mat.diffuseColor = c;
    mat.emissiveColor = c;
    m.material = mat;
    return { m, mat };
  };
  const heads = lightPair('phares', new Color3(1, 0.95, 0.82));
  const tails = lightPair('feuxArriere', new Color3(1, 0.06, 0.04));

  // véhicules
  const cars: Veh[] = [];
  const cap = new Array(TYPES.length).fill(0);
  for (let i = 0; i < maxCars; i++) {
    let r = rnd(), type = 0;
    for (let k = 0; k < TYPES.length; k++) { if (r < TYPES[k].share) { type = k; break; } r -= TYPES[k].share; }
    const col: RGB = type === TAXI ? [0.95, 0.78, 0.15] : type === BUS ? (rnd() < 0.7 ? [0.12, 0.48, 0.42] : [0.92, 0.92, 0.9]) : heavy(type) ? (rnd() < 0.5 ? [0.92, 0.92, 0.92] : pickColor(rnd)) : type === POLICE || type === AMBU ? [0.95, 0.95, 0.97] : pickColor(rnd);
    cap[type]++;
    cars.push({ type, col, mode: 0, p: 0, s: 0, dir: 1, lane: 0, lat: 0, kx: 0, kz: 0, d: 0, t: 0, next: -1, glane: 0, v: 0, v0: 0, stuck: 0, x: 0, y: 0, z: 0, hx: 0, hz: 1 });
  }
  const bufs = cap.map((n) => new Float32Array(Math.max(1, n) * 16));
  const cols = cap.map((n) => new Float32Array(Math.max(1, n) * 4));
  meshes.forEach((m, k) => { m.thinInstanceSetBuffer('matrix', bufs[k], 16, false); m.thinInstanceSetBuffer('color', cols[k], 4, false); setThinCount(m, 0); });
  const sinks: Sink[] = meshes.map((m, k) => ({ buf: bufs[k], col: cols[k], mesh: m, thin: null }));
  const LMAX = maxCars + 400;
  const headBuf = new Float32Array(LMAX * 16), tailBuf = new Float32Array(LMAX * 16);
  heads.m.thinInstanceSetBuffer('matrix', headBuf, 16, false);
  tails.m.thinInstanceSetBuffer('matrix', tailBuf, 16, false);
  setThinCount(heads.m, 0); setThinCount(tails.m, 0);

  // index spatial des voies routières (seaux de 250 m)
  const roadPaths = net.paths.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'autoroute' || p.kind === 'nationale');
  const pidx = new Map<number, number[]>();
  const pkey = (x: number, z: number) => (Math.floor(x / 0.25) + 200) * 1000 + Math.floor(z / 0.25) + 200;
  for (const { p, i } of roadPaths) for (let k = 0; k < p.n; k++) {
    const key = pkey(p.x[k], p.z[k]);
    let l = pidx.get(key); if (!l) pidx.set(key, (l = []));
    l.push(i * 65536 + k);
    if (p.kind === 'autoroute') l.push(i * 65536 + k); // plus de voies, plus de véhicules
  }

  // arêtes de la grille des rues
  const edgeCache = new Map<number, boolean>();
  const edgeOK = (kx: number, kz: number, d: number) => {
    const [dx, dz] = DIRS[d];
    const ax = d >= 2 ? kx + dx : kx, az = d >= 2 ? kz + dz : kz; // nœud de départ canonique
    const axis = d % 2;
    const key = ((ax + 300) * 1000 + (az + 300)) * 2 + axis;
    let ok = edgeCache.get(key);
    if (ok === undefined) {
      ok = true;
      const x0 = ax * 0.2, z0 = az * 0.2;
      const mx = x0 + (axis ? 0 : 0.1), mz = z0 + (axis ? 0.1 : 0);
      if (urbanDensity(country, mx, mz) < 0.28 || grid.sample(mx, mz) < 0.027) ok = false;
      for (let k = 0; ok && k <= 16; k++) {
        const x = x0 + (axis ? 0 : k * 0.0125), z = z0 + (axis ? k * 0.0125 : 0);
        if (occAt(net, x, z) & 2) ok = false;
      }
      edgeCache.set(key, ok);
    }
    return ok;
  };
  const isB = (k: number) => k % 5 === 0;
  // demi-chaussée de la rue sur laquelle on roule (direction d, nœud kx,kz)
  const laneOff = (v: Veh, d: number, kx: number, kz: number) => {
    const onLine = d % 2 ? kx : kz; // déplacement selon x : ligne z = kz
    return isB(onLine) ? (v.glane ? 0.0068 : 0.0038) : 0.0023;
  };
  const crossHalf = (d: number, kx: number, kz: number) => (isB(d % 2 ? kz : kx) ? 0.0102 : 0.0046) + 0.0016;

  const tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  let wx = 1e9, wz = 1e9, R = 1.5;

  const placeGrid = (v: Veh, x: number, z: number) => {
    const kx = Math.round(x / 0.2), kz = Math.round(z / 0.2);
    const start = Math.floor(rnd() * 4);
    for (let q = 0; q < 4; q++) {
      const d = (start + q) % 4;
      if (!edgeOK(kx, kz, d)) continue;
      v.mode = 2; v.kx = kx; v.kz = kz; v.d = d; v.t = 0.01 + rnd() * 0.17; v.next = -1;
      v.glane = rnd() < 0.5 ? 1 : 0;
      v.v0 = (isB(d % 2 ? kx : kz) ? 0.032 : 0.025) * (0.85 + rnd() * 0.3);
      v.v = v.v0 * 0.6;
      return true;
    }
    return false;
  };
  const placeLink = (v: Veh, x: number, z: number) => {
    const l = pidx.get(pkey(x, z));
    if (!l || !l.length) return false;
    const e = l[Math.floor(rnd() * l.length)];
    const pi = e >> 16, k = e & 65535;
    const p = net.paths[pi];
    if (v.type === BUS && p.kind === 'autoroute') return false;
    v.mode = 1; v.p = pi; v.s = p.cum[k] + rnd() * 0.03; v.dir = rnd() < 0.5 ? 1 : -1;
    const lanes = p.kind === 'autoroute' ? 3 : 2;
    v.lane = heavy(v.type) || v.type === BUS ? 0 : Math.floor(rnd() * lanes);
    v.lat = (p.kind === 'autoroute' ? LANES.autoroute : LANES.nationale)[v.lane];
    const base = p.kind === 'autoroute' ? 0.068 : 0.04;
    v.v0 = base * (1.05 - v.lane * -0.06 - (heavy(v.type) ? 0.2 : 0)) * (0.9 + rnd() * 0.2);
    v.v = v.v0 * 0.8;
    return true;
  };
  const spawn = (v: Veh, annulus: boolean) => {
    const linkFirst = rnd() < 0.22;
    for (let a = 0; a < 10; a++) {
      const ang = rnd() * Math.PI * 2;
      const r = annulus ? R * (0.82 + rnd() * 0.18) : R * Math.sqrt(rnd());
      const x = wx + Math.cos(ang) * r, z = wz + Math.sin(ang) * r;
      if ((linkFirst !== a >= 6) ? placeLink(v, x, z) : placeGrid(v, x, z)) { v.stuck = 0; return; }
    }
    v.mode = 0;
  };

  // trains : rames articulées sur les voies ferrées
  const rails = net.paths.filter((p) => p.kind === 'rail');
  const trainCars = (() => {
    const mid = new VGeo(), cab = new VGeo();
    for (const g of [mid, cab]) {
      g.box(-1.45, 1.45, 0.45, 3.85, -7.6, 7.6, PAINT);
      g.box(-1.46, 1.46, 1.55, 2.6, -7.0, 7.0, GLASS);
      g.box(-1.1, 1.1, 3.85, 4.1, -6.5, 6.5, [0.6, 0.6, 0.62]);
      g.box(-1.3, 1.3, 0.1, 0.6, -6.2, -4.2, DARK);
      g.box(-1.3, 1.3, 0.1, 0.6, 4.2, 6.2, DARK);
      for (const z of [-4.6, -1.6, 1.6, 4.6]) g.box(-1.47, 1.47, 0.7, 2.7, z - 0.65, z + 0.65, [0.55, 0.57, 0.6]); // portes
    }
    cab.cabin(1.45, 1.25, 0.45, 3.7, 7.6, 9.2, 7.6, 8.0, GLASS);
    cab.box(-1.3, 1.3, 0.45, 1.3, 7.6, 9.25, PAINT);
    return [mid.mesh('rameMilieu', scene), cab.mesh('rameMotrice', scene)];
  })();
  trainCars.forEach((m) => (m.material = vMat));
  const CARL = 0.0185, GAPL = 0.0007;
  // longueurs des voitures de tête et intermédiaires (km) : remplacées par celles des modèles de la bibliothèque
  const carLen = { end: CARL, mid: CARL };
  const LINE_COLORS: RGB[] = [[0.95, 0.95, 0.97], [0.85, 0.9, 0.98], [0.98, 0.93, 0.85], [0.9, 0.97, 0.92], [0.97, 0.88, 0.9]];
  const trains = rails.flatMap((p, k) => {
    const n = Math.max(1, Math.round(p.len / 2.6));
    const cars = k < 5 ? 6 : 4;
    return Array.from({ length: n }, (_, j) => ({ p, sig: (j / n) * 2 * p.len + rnd() * 0.3, v: 0.075 * (0.9 + rnd() * 0.15), cars, col: LINE_COLORS[k % LINE_COLORS.length] }));
  });
  const nTrainCars = trains.reduce((s, t) => s + t.cars, 0);
  const tBufM = new Float32Array(Math.max(1, nTrainCars) * 16), tBufC = new Float32Array(Math.max(1, trains.length * 2) * 16);
  const tColM = new Float32Array(Math.max(1, nTrainCars) * 4), tColC = new Float32Array(Math.max(1, trains.length * 2) * 4);
  trainCars[0].thinInstanceSetBuffer('matrix', tBufM, 16, false); trainCars[0].thinInstanceSetBuffer('color', tColM, 4, false);
  trainCars[1].thinInstanceSetBuffer('matrix', tBufC, 16, false); trainCars[1].thinInstanceSetBuffer('color', tColC, 4, false);
  const trainSinks: Sink[] = [{ buf: tBufM, col: tColM, mesh: trainCars[0], thin: null }, { buf: tBufC, col: tColC, mesh: trainCars[1], thin: null }];

  // bateaux : péniches et bateaux-mouches sur les rivières
  const boatPaths = net.rivers.map((r) => {
    let i0 = 0; while (i0 < r.x.length - 1 && !r.ok[i0]) i0++;
    let i1 = r.x.length - 1; while (i1 > i0 && !r.ok[i1]) i1--;
    const n = i1 - i0 + 1;
    const x = new Float64Array(n), z = new Float64Array(n), y = new Float64Array(n), g = new Float64Array(n), cum = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = r.x[i0 + i]; z[i] = r.z[i0 + i]; y[i] = r.w[i0 + i] + 0.0003; if (i) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); }
    return { kind: 'rail', link: -1, n, closed: false, half: 0, stone: false, x, z, g, y, cum, len: cum[n - 1] } as NetPath;
  }).filter((p) => p.n > 3 && p.len > 1);
  const boatMeshes = (() => {
    const barge = new VGeo(), tour = new VGeo();
    barge.box(-2.55, 2.55, -0.6, 1.0, -19, 19, [0.12, 0.13, 0.15]);
    barge.cabin(2.55, 0.2, -0.6, 1.0, 19, 21, 19, 19.2, [0.12, 0.13, 0.15]);
    barge.box(-2.3, 2.3, 1.0, 1.9, -11, 16, [0.42, 0.26, 0.14]);
    barge.box(-1.8, 1.8, 1.0, 3.6, -18, -14, [0.92, 0.92, 0.9]);
    barge.box(-1.81, 1.81, 2.6, 3.2, -17.8, -14.2, GLASS);
    tour.box(-3, 3, -0.5, 0.9, -15, 14, [0.95, 0.95, 0.95]);
    tour.cabin(3, 0.3, -0.5, 0.9, 14, 16, 14, 14.2, [0.95, 0.95, 0.95]);
    tour.box(-2.7, 2.7, 0.9, 2.6, -12, 11, GLASS);
    tour.box(-2.8, 2.8, 2.6, 2.75, -12.2, 11.2, [0.92, 0.92, 0.92]);
    return [barge.mesh('peniches', scene), tour.mesh('bateauxMouches', scene)];
  })();
  boatMeshes.forEach((m) => (m.material = vMat));
  const boats = boatPaths.flatMap((p) => Array.from({ length: Math.max(2, Math.round(p.len / 7)) }, (_, j) => ({ p, sig: rnd() * 2 * p.len, v: 0.012 + rnd() * 0.006, type: j % 2 })));
  const bBufs = [0, 1].map((k) => new Float32Array(Math.max(1, boats.filter((b) => b.type === k).length) * 16));
  boatMeshes.forEach((m, k) => m.thinInstanceSetBuffer('matrix', bBufs[k], 16, false));
  const boatSinks: Sink[] = boatMeshes.map((m, k) => ({ buf: bBufs[k], col: null, mesh: m, thin: null }));
  const boatCap = [0, 1].map((k) => boats.filter((b) => b.type === k).length);
  let libTrains = false, libBoats = false;

  // ---- bascule vers les modèles de la bibliothèque (asynchrone ; repli procédural par type) ----
  whenModels((lib) => {
    if (scene.isDisposed) return;
    TYPES.forEach((t, k) => {
      const tpl = lib.get(LIB_ID[k]);
      if (!tpl) return;
      const paint = !!tpl.info.peignable;
      const thin = createThinInstances(tpl, Math.max(1, cap[k]), { colors: paint, dynamic: true, name: 'vehicules_' + t.name });
      sinks[k] = { buf: thin.matrices, col: thin.colors, mesh: null, thin };
      meshes[k].dispose();
    });
    const head = lib.get('rame_tete'), mid = lib.get('rame_intermediaire');
    if (head && mid) {
      const nEnd = trains.length * 2;
      const tm = createThinInstances(mid, Math.max(1, nTrainCars - nEnd), { dynamic: true, name: 'rames_intermediaires' });
      const tc = createThinInstances(head, Math.max(1, nEnd), { dynamic: true, name: 'rames_tete' });
      trainSinks[0] = { buf: tm.matrices, col: null, mesh: null, thin: tm };
      trainSinks[1] = { buf: tc.matrices, col: null, mesh: null, thin: tc };
      carLen.end = head.sizeKm.z; carLen.mid = mid.sizeKm.z;
      for (const m of trainCars) m.dispose();
      libTrains = true;
    }
    const barge = lib.get('peniche'), tour = lib.get('bateau_mouche');
    if (barge && tour) {
      [barge, tour].forEach((tpl, k) => {
        const thin = createThinInstances(tpl, Math.max(1, boatCap[k]), { dynamic: true, name: k ? 'bateaux_mouches' : 'peniches' });
        boatSinks[k] = { buf: thin.matrices, col: null, mesh: null, thin };
        boatMeshes[k].dispose();
      });
      libBoats = true;
    }
  });

  // écriture rapide d'une matrice (lacet + translation, échelle x optionnelle)
  const write = (buf: Float32Array, k: number, x: number, y: number, z: number, hx: number, hz: number, sx = 1) => {
    const o = k * 16;
    buf[o] = hz * sx; buf[o + 1] = 0; buf[o + 2] = -hx * sx; buf[o + 3] = 0;
    buf[o + 4] = 0; buf[o + 5] = 1; buf[o + 6] = 0; buf[o + 7] = 0;
    buf[o + 8] = hx; buf[o + 9] = 0; buf[o + 10] = hz; buf[o + 11] = 0;
    buf[o + 12] = x; buf[o + 13] = y; buf[o + 14] = z; buf[o + 15] = 1;
  };

  let activity = 1;
  const occ = new Map<number, number>();
  const ckey = (x: number, z: number) => (Math.floor(x / 0.0065) + 10000) * 30000 + Math.floor(z / 0.0065) + 10000;
  const demand = () => {
    const h = ENV.time * 24;
    const peak = Math.max(Math.exp(-(((h - 8.2) / 1.4) ** 2)), Math.exp(-(((h - 18) / 1.7) ** 2)));
    return Math.min(1, 0.16 + 0.84 * peak + 0.42 * Math.exp(-(((h - 13) / 3) ** 2)));
  };

  // position sur la grille (avec virage en courbe de Bézier dans le carrefour)
  const gridPos = (v: Veh) => {
    const [hx, hz] = DIRS[v.d];
    const nx1 = v.kx + hx, nz1 = v.kz + hz;
    const o1 = laneOff(v, v.d, v.kx, v.kz);
    const rIn = crossHalf(v.d, nx1, nz1);
    const zoneStart = 0.2 - rIn;
    if (v.t <= zoneStart || v.next < 0) {
      v.x = v.kx * 0.2 + hx * v.t + hz * o1;
      v.z = v.kz * 0.2 + hz * v.t - hx * o1;
      v.hx = hx; v.hz = hz;
      return;
    }
    const d2 = v.next;
    const [gx, gz] = DIRS[d2];
    const o2 = laneOff(v, d2, nx1, nz1);
    const rOut = crossHalf(d2, nx1, nz1);
    const Nx = nx1 * 0.2, Nz = nz1 * 0.2;
    const Ex = Nx - hx * rIn + hz * o1, Ez = Nz - hz * rIn - hx * o1;
    const Xx = Nx + gx * rOut + gz * o2, Xz = Nz + gz * rOut - gx * o2;
    const L = turnLen(v);
    const u = Math.min(1, (v.t - zoneStart) / L);
    let Kx: number, Kz: number;
    if (d2 === v.d) { Kx = (Ex + Xx) / 2; Kz = (Ez + Xz) / 2; }
    else if (d2 === (v.d + 2) % 4) { Kx = Nx + hx * 0.008; Kz = Nz + hz * 0.008; }
    else { Kx = Nx + hz * o1 + gz * o2; Kz = Nz - hx * o1 - gx * o2; }
    const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    v.x = w0 * Ex + w1 * Kx + w2 * Xx;
    v.z = w0 * Ez + w1 * Kz + w2 * Xz;
    let tx = 2 * (1 - u) * (Kx - Ex) + 2 * u * (Xx - Kx), tz = 2 * (1 - u) * (Kz - Ez) + 2 * u * (Xz - Kz);
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    v.hx = tx; v.hz = tz;
  };
  const turnLen = (v: Veh) => {
    const [hx, hz] = DIRS[v.d];
    const rIn = crossHalf(v.d, v.kx + hx, v.kz + hz), rOut = crossHalf(v.next, v.kx + hx, v.kz + hz);
    return v.next === v.d ? rIn + rOut : v.next === (v.d + 2) % 4 ? 0.02 : (rIn + rOut) * 0.85;
  };
  const chooseNext = (v: Veh) => {
    const [hx, hz] = DIRS[v.d];
    const nx1 = v.kx + hx, nz1 = v.kz + hz;
    const opts: number[] = [];
    const w: number[] = [];
    for (const [dd, wt] of [[v.d, 0.6], [(v.d + 1) % 4, 0.2], [(v.d + 3) % 4, 0.2]]) if (edgeOK(nx1, nz1, dd)) { opts.push(dd); w.push(wt); }
    if (!opts.length) return (v.d + 2) % 4;
    let r = rnd() * w.reduce((a, b) => a + b, 0);
    for (let k = 0; k < opts.length; k++) { if (r < w[k]) return opts[k]; r -= w[k]; }
    return opts[0];
  };

  const update = (dt: number) => {
    dt = Math.max(0, Math.min(0.1, dt)); // horloge robuste (onglet en veille, saut d'heure)
    CLOCK.t += dt;
    const cam = scene.activeCamera as ArcRotateCamera | null;
    if (!cam) return;
    const tg = cam.target ?? cam.position;
    const radius = cam.radius ?? 10;
    const hide = radius > 24;
    const newR = Math.min(RMAX, Math.max(0.9, radius * 1.05));
    const jump = Math.hypot(tg.x - wx, tg.z - wz) > R * 0.9 || Math.abs(newR - R) > R * 0.5;
    wx = tg.x; wz = tg.z; R = newR;
    const N = hide ? 0 : Math.round(cars.length * Math.min(1, demand() * activity));
    // occupation de la chaussée (image précédente)
    occ.clear();
    for (let i = 0; i < N; i++) { const v = cars[i]; if (v.mode) occ.set(ckey(v.x, v.z), i); }
    const blockedAt = (i: number, v: Veh, dist: number) => {
      const j = occ.get(ckey(v.x + v.hx * dist, v.z + v.hz * dist));
      if (j === undefined || j === i) return false;
      const o = cars[j];
      return o.hx * v.hx + o.hz * v.hz > 0.3 && Math.abs(o.y - v.y) < 0.004;
    };
    const counts = new Array(TYPES.length).fill(0);
    let nl = 0;
    const night = ENV.night > 0.08 && radius < 9;
    for (let i = 0; i < cars.length; i++) {
      const v = cars[i];
      if (i >= N) { v.mode = 0; continue; }
      if (!Number.isFinite(v.x + v.z + v.v)) v.mode = 0;
      if (v.mode === 0 || jump) spawn(v, !jump && v.mode !== 0 ? true : false);
      else if (Math.hypot(v.x - wx, v.z - wz) > R * 1.08) spawn(v, true);
      if (v.mode === 0) continue;
      // vitesse cible
      let target = v.v0;
      if (blockedAt(i, v, 0.0058)) target = 0;
      else if (blockedAt(i, v, 0.011)) target = Math.min(target, v.v * 0.6);
      if (v.mode === 2) {
        const [hx, hz] = DIRS[v.d];
        const nx1 = v.kx + hx, nz1 = v.kz + hz;
        const stopT = 0.2 - crossHalf(v.d, nx1, nz1) - 0.0008;
        if (v.t < stopT + 0.0002 && hasSignal(nx1, nz1)) {
          const st = signalState(nx1, nz1, v.d % 2);
          if (st === 2 || (st === 1 && stopT - v.t > 0.006)) target = Math.min(target, Math.max(0, (stopT - v.t) * 4));
        }
        if (v.next >= 0 && v.next !== v.d && v.t > stopT - 0.01) target = Math.min(target, 0.014);
      }
      if (target === 0) v.stuck += dt; else v.stuck = 0;
      if (v.stuck > 7) { target = v.v0 * 0.5; } // évite les blocages définitifs
      v.v += Math.max(-0.08 * dt, Math.min(0.025 * dt, target - v.v));
      if (v.v < 0) v.v = 0;
      const ds = v.v * dt;
      if (v.mode === 1) {
        const p = net.paths[v.p];
        v.s += ds * v.dir;
        if (!p.closed && (v.s <= 0.001 || v.s >= p.len - 0.001)) {
          // fin de la voie : on rejoint la grille des rues si possible
          sampleAt(p, v.s, tmp);
          if (!placeGrid(v, tmp.x, tmp.z)) { spawn(v, true); if ((v.mode as number) === 0) continue; }
        } else {
          const lanes = p.kind === 'autoroute' ? LANES.autoroute : LANES.nationale;
          // changement de voie pour dépasser
          if (target < v.v0 * 0.7 && v.stuck < 7 && rnd() < dt * 2) {
            const nlane = v.lane + 1 < lanes.length ? v.lane + 1 : v.lane - 1;
            if (nlane >= 0 && !heavy(v.type) && v.type !== BUS) v.lane = nlane;
          } else if (v.lane > 0 && rnd() < dt * 0.05) v.lane--;
          v.lat += (lanes[v.lane] - v.lat) * Math.min(1, dt * 1.5);
          sampleAt(p, v.s, tmp);
          v.hx = tmp.tx * v.dir; v.hz = tmp.tz * v.dir;
          v.x = tmp.x + v.hz * v.lat; v.z = tmp.z - v.hx * v.lat; v.y = tmp.y;
        }
      }
      if (v.mode === 2) {
        v.t += ds;
        const [hx, hz] = DIRS[v.d];
        const nx1 = v.kx + hx, nz1 = v.kz + hz;
        const zoneStart = 0.2 - crossHalf(v.d, nx1, nz1);
        if (v.next < 0 && v.t > zoneStart - 0.03) v.next = chooseNext(v);
        if (v.next >= 0 && v.t >= zoneStart + turnLen(v)) {
          const d2 = v.next;
          v.kx = nx1; v.kz = nz1; v.d = d2; v.next = -1;
          v.t = crossHalf(d2, nx1, nz1);
          v.v0 = (isB(d2 % 2 ? nx1 : nz1) ? 0.032 : 0.025) * (0.85 + rnd() * 0.3);
        }
        gridPos(v);
        v.y = surfaceY(grid, v.x, v.z) + 0.0003;
      }
      // écriture de l'instance
      const T = v.type, k = counts[T]++, sk = sinks[T];
      write(sk.buf, k, v.x, v.y, v.z, v.hx, v.hz);
      const cl = sk.col;
      if (cl) { cl[k * 4] = v.col[0]; cl[k * 4 + 1] = v.col[1]; cl[k * 4 + 2] = v.col[2]; cl[k * 4 + 3] = 1; }
      if (night && nl < LMAX && !sk.thin) {
        const ty = TYPES[T], hl = ty.L * 0.0005 + 0.00003, w = ty.W * 0.001 - 0.0006, y = v.y + ty.light * 0.001;
        write(headBuf, nl, v.x + v.hx * hl, y, v.z + v.hz * hl, v.hx, v.hz, w);
        write(tailBuf, nl, v.x - v.hx * hl, y, v.z - v.hz * hl, v.hx, v.hz, w);
        nl++;
      }
    }
    sinks.forEach((sk, k) => flushSink(sk, counts[k]));

    // trains
    let km = 0, kc = 0;
    const [tsM, tsC] = trainSinks;
    for (const t of trains) {
      t.sig = (t.sig + t.v * dt) % (2 * t.p.len);
      let back = 0; // distance de l'avant de la rame à l'arrière de la voiture précédente
      for (let c = 0; c < t.cars; c++) {
        const end = c === 0 || c === t.cars - 1;
        const len = end ? carLen.end : carLen.mid;
        let sg = t.sig - back - len / 2;
        back += len + GAPL;
        sg = ((sg % (2 * t.p.len)) + 2 * t.p.len) % (2 * t.p.len);
        const fwd = sg < t.p.len;
        const s = fwd ? sg : 2 * t.p.len - sg;
        const dir = fwd ? 1 : -1;
        sampleAt(t.p, s + (dir * len) / 2, tmp);
        const ax = tmp.x, az = tmp.z, ay = tmp.y;
        sampleAt(t.p, s - (dir * len) / 2, tmp);
        let hx = ax - tmp.x, hz = az - tmp.z;
        const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
        const off = 0.002;
        const x = (ax + tmp.x) / 2 + hz * off, z = (az + tmp.z) / 2 - hx * off, y = (ay + tmp.y) / 2;
        if (end) {
          const fh = c === 0 ? 1 : -1;
          write(tsC.buf, kc, x, y, z, hx * fh, hz * fh);
          tsC.col?.set([t.col[0], t.col[1], t.col[2], 1], kc * 4);
          kc++;
          if (night && nl < LMAX && radius < 9 && !libTrains) {
            const hl = CARL / 2 + 0.0016;
            if (c === 0) write(headBuf, nl, x + hx * hl, y + 0.001, z + hz * hl, hx, hz, 0.0019);
            else write(headBuf, nl, x - hx * 0.01, y - 1, z, hx, hz, 0.0019);
            write(tailBuf, nl, c === 0 ? x : x - hx * hl, c === 0 ? y - 1 : y + 0.001, c === 0 ? z : z - hz * hl, -hx, -hz, 0.0019);
            nl++;
          }
        } else {
          write(tsM.buf, km, x, y, z, hx, hz);
          tsM.col?.set([t.col[0], t.col[1], t.col[2], 1], km * 4);
          km++;
        }
      }
    }
    flushSink(tsM, km); flushSink(tsC, kc);

    // bateaux
    const bc = [0, 0];
    for (const b of boats) {
      b.sig = (b.sig + b.v * dt) % (2 * b.p.len);
      const fwd = b.sig < b.p.len;
      const s = fwd ? b.sig : 2 * b.p.len - b.sig;
      sampleAt(b.p, s, tmp);
      const hx = tmp.tx * (fwd ? 1 : -1), hz = tmp.tz * (fwd ? 1 : -1);
      const off = 0.07;
      write(boatSinks[b.type].buf, bc[b.type]++, tmp.x + hz * off, tmp.y, tmp.z - hx * off, hx, hz);
      if (night && nl < LMAX && !libBoats) {
        write(headBuf, nl, tmp.x + hz * off + hx * 0.019, tmp.y + 0.0025, tmp.z - hx * off + hz * 0.019, hx, hz, 0.004);
        write(tailBuf, nl, tmp.x + hz * off - hx * 0.019, tmp.y + 0.0025, tmp.z - hx * off - hz * 0.019, hx, hz, 0.004);
        nl++;
      }
    }
    boatSinks.forEach((sk, k) => flushSink(sk, bc[k]));

    setThinCount(heads.m, nl); setThinCount(tails.m, nl);
    if (nl) { heads.m.thinInstanceBufferUpdated('matrix'); tails.m.thinInstanceBufferUpdated('matrix'); }
    const n = ENV.night;
    heads.mat.emissiveColor.set(1.0 * n, 0.95 * n, 0.82 * n);
    tails.mat.emissiveColor.set(1.0 * n, 0.06 * n, 0.04 * n);
    vMat.emissiveColor.set(0.04 * n, 0.04 * n, 0.05 * n);
  };
  return { update, setActivity: (a: number) => { activity = Math.max(0.3, Math.min(1.4, a)); } };
}

// Aéroport international : plan masse (pistes parallèles, voies de circulation, aires de stationnement),
// terminal à jetées et passerelles, tour de contrôle, hangars, zone fret, parkings, marquages et balisage
// lumineux. Le plan masse est partagé avec airsea.ts (avions garés et cycle des mouvements).
// Repère local : u selon l'axe des pistes, v perpendiculaire ; tourné de `infra.rot` autour de Y.
import { Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { mulberry32 } from '../../../shared/noise';
import type { Infra } from '../../../shared/sim/types';
import { Kit, M, PLANES, addInst, addLight, applyInst, buildLights, carMesh, newInst, newLights, type LightSet } from './infraModels';
import type { Grid } from './terrain';

export type Lane = 'N' | 'C' | 'S';
export interface Stand { u: number; v: number; dir: 1 | -1; cls: number; lane: Lane | null; cargo?: boolean }
export interface Runway { u0: number; u1: number; v: number; w: number }
export interface AirportLayout {
  inf: Infra;
  big: boolean;
  y: number; // altitude de la plateforme
  rot: number;
  toWorld: (u: number, v: number) => [number, number];
  half: [number, number];
  rwys: Runway[]; // rwys[0] : atterrissages vers +u ; rwys[rwys.length-1] : décollages vers +u
  laneV: Record<Lane, number>;
  /** sortie rapide : de la piste d'atterrissage jusqu'à la voie parallèle */
  exitPath: [number, number][];
  /** de la voie parallèle jusqu'au début (extrémité est) de chaque voie de desserte */
  toLane: Partial<Record<Lane, [number, number][]>>;
  /** départ : extrémité de voie de desserte à rejoindre puis cheminement jusqu'à l'alignement */
  fromLane: Partial<Record<Lane, { end: number; path: [number, number][] }>>;
  lineup: [number, number];
  stands: Stand[];
}

export function airportLayout(inf: Infra, grid: Grid): AirportLayout {
  const big = inf.capacity >= 2e7;
  const rot = inf.rot;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const toWorld = (u: number, v: number): [number, number] => [inf.x + u * cs + v * sn, inf.z - u * sn + v * cs];
  const half: [number, number] = big ? [2.3, 1.1] : [1.5, 0.5];
  // plateforme horizontale : altitude maximale du terrain sur l'emprise
  let ymax = 0;
  for (let a = -1; a <= 1.001; a += 0.125) for (let b = -1; b <= 1.001; b += 0.25) {
    const [x, z] = toWorld(a * half[0], b * half[1]);
    ymax = Math.max(ymax, grid.y(x, z));
  }
  const y = Math.max(ymax, 0.035) + 0.0015;
  const rnd = mulberry32(inf.id * 977 + 13);
  const stands: Stand[] = [];
  // génère une rangée de postes le long d'une façade
  const row = (u0: number, u1: number, face: number, dir: 1 | -1, lane: Lane, classes: number[]) => {
    let u = u0;
    for (;;) {
      const cls = classes[Math.floor(rnd() * classes.length)];
      const sp = PLANES[cls].span;
      if (u + sp > u1) break;
      const L = PLANES[cls].len;
      stands.push({ u: u + sp / 2, v: face + dir * -1 * (0.004 + L / 2), dir, cls, lane });
      u += sp + 0.009;
    }
  };
  if (big) {
    row(-0.66, 0.9, 0.26, -1, 'N', [0, 0, 0, 1, 1, 2]);
    row(-0.66, 0.9, 0.22, 1, 'C', [0, 0, 1, 0, 3]);
    row(-0.66, 0.9, -0.22, -1, 'C', [0, 0, 1, 0, 3]);
    row(-0.66, 0.9, -0.26, 1, 'S', [0, 0, 1, 1, 2]);
    // postes fret (gros porteurs) devant les entrepôts
    for (let k = 0; k < 4; k++) stands.push({ u: 1.22 + k * 0.085 * 2, v: -0.3 + 0.004 + PLANES[1].len / 2 + 0.002, dir: -1, cls: 1, lane: null, cargo: true });
    // dir = sens du nez selon v (le nez pointe vers la façade)
    return {
      inf, big, y, rot, toWorld, half,
      rwys: [{ u0: -1.9, u1: 1.7, v: 0.8, w: 0.06 }, { u0: -1.6, u1: 2.0, v: -0.8, w: 0.06 }],
      laneV: { N: 0.42, C: 0, S: -0.42 },
      exitPath: [[0.3, 0.8], [0.52, 0.69], [0.72, 0.62], [1.0, 0.62]],
      toLane: { N: [[1.0, 0.62], [1.0, 0.42]], C: [[1.0, 0.62], [1.0, 0]], S: [[1.0, 0.62], [1.0, -0.42]] },
      fromLane: {
        N: { end: 1.0, path: [[1.0, 0.42], [1.0, -0.62], [-1.57, -0.62], [-1.57, -0.8]] },
        C: { end: 1.0, path: [[1.0, 0], [1.0, -0.62], [-1.57, -0.62], [-1.57, -0.8]] },
        S: { end: -0.6, path: [[-0.6, -0.42], [-0.6, -0.62], [-1.57, -0.62], [-1.57, -0.8]] },
      },
      lineup: [-1.5, -0.8],
      stands,
    };
  }
  row(-0.32, 0.32, 0.0, -1, 'N', [3, 3, 0]);
  for (const s of stands) { s.v = 0.004 + PLANES[s.cls].len / 2; s.dir = -1; }
  return {
    inf, big, y, rot, toWorld, half,
    rwys: [{ u0: -1.3, u1: 1.3, v: 0.36, w: 0.045 }],
    laneV: { N: 0.1, C: 0.1, S: 0.1 },
    exitPath: [[0.75, 0.36], [0.95, 0.27], [1.05, 0.22]],
    toLane: { N: [[1.05, 0.22], [0.4, 0.22], [0.4, 0.1]] },
    fromLane: { N: { end: 0.4, path: [[0.4, 0.1], [0.4, 0.22], [-1.28, 0.22], [-1.28, 0.36]] } },
    lineup: [-1.22, 0.36],
    stands,
  };
}

// ---------- Glyphes des numéros de piste (segments) ----------
const SEG: Record<string, number[][]> = {
  // segments [x0,y0,x1,y1] dans une case 1 × 2 (x vers la droite, y vers le haut)
  a: [[0, 2, 1, 2]], b: [[1, 2, 1, 1]], c: [[1, 1, 1, 0]], d: [[0, 0, 1, 0]], e: [[0, 0, 0, 1]], f: [[0, 1, 0, 2]], g: [[0, 1, 1, 1]],
};
const DIGITS: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', L: 'fed', C: 'afed', R: 'abfge' };

export function runwayNumber(rot: number, towardPlusU: boolean) {
  // cap magnétique (nord = +z, est = +x) de la direction d'atterrissage
  const dx = Math.cos(rot) * (towardPlusU ? 1 : -1), dz = -Math.sin(rot) * (towardPlusU ? 1 : -1);
  let h = Math.round(((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360 / 10);
  if (h === 0) h = 36;
  return String(h).padStart(2, '0');
}

/** Construit l'aéroport (maillage fusionné + feux + voitures garées). */
export function buildAirport(scene: Scene, grid: Grid, inf: Infra, L: AirportLayout, lights: LightSet, pools: LightSet) {
  const k = new Kit();
  const { y, half, big } = L;
  k.frame(inf.x, y, inf.z, inf.rot);
  const yG = 0, yT = 0.0006, yR = 0.0012, yM = 0.0019; // couches : herbe, voies, piste, marquages
  const rnd = mulberry32(inf.id * 31 + 7);
  const W = (u: number, v: number) => {
    const [x, z] = L.toWorld(u, v);
    const inside = Math.abs(u) < half[0] && Math.abs(v) < half[1];
    return [x, inside ? y + 0.0025 : grid.y(x, z) + 0.002, z] as const;
  };
  const light = (u: number, v: number, c: string, s = 1) => { const [x, yy, z] = W(u, v); addLight(lights, x, yy, z, c, s); };

  // plateforme engazonnée et talus
  const [hu, hv] = half;
  k.rect(0, yG, 0, hu * 2, hv * 2, '#859056', M.grass);
  {
    let ymin = y;
    for (let a = -1; a <= 1.001; a += 0.25) for (let b = -1; b <= 1.001; b += 0.5) { const [x, z] = L.toWorld(a * hu * 1.1, b * hv * 1.2); ymin = Math.min(ymin, grid.y(x, z)); }
    const dy = -(y - ymin) - 0.006, e = Math.max(0.3, (y - ymin) * 12);
    const c = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
    for (let s = 0; s < 4; s++) {
      const [a0, b0] = c[s], [a1, b1] = c[(s + 1) % 4];
      const o0 = [a0 + Math.sign(a0) * e, b0 + Math.sign(b0) * e], o1 = [a1 + Math.sign(a1) * e, b1 + Math.sign(b1) * e];
      k.quad([a0, 0, b0], [a1, 0, b1], [o1[0], dy, o1[1]], [o0[0], dy, o0[1]], '#8c9258', M.grass);
    }
  }

  // route de service et clôture périphériques
  {
    const ih = hu - 0.04, iv = hv - 0.04;
    const ring: [number, number][] = [[-ih, -iv], [ih, -iv], [ih, iv], [-ih, iv], [-ih, -iv]];
    for (let q = 0; q < 4; q++) {
      k.strip(ring[q][0], ring[q][1], ring[q + 1][0], ring[q + 1][1], 0.007, yT - 0.0003, '#6a6c6e', M.asphalt);
      const [a0, b0] = ring[q], [a1, b1] = ring[q + 1];
      const f = 0.02 / Math.max(ih, iv);
      k.beam(new Vector3(a0 * (1 + f), yG + 0.001, b0 * (1 + f)), new Vector3(a1 * (1 + f), yG + 0.001, b1 * (1 + f)), 0.0003, 0.0022, '#8f969c');
    }
  }

  // ---- pistes ----
  L.rwys.forEach((r, ri) => {
    const len = r.u1 - r.u0, cu = (r.u0 + r.u1) / 2;
    k.rect(cu, yT, r.v, len + 0.12, r.w + 0.03, '#7b7d78', M.asphalt); // accotements et prolongements d'arrêt
    k.rect(cu, yR, r.v, len, r.w, '#55575a', M.asphalt);
    // traces de gomme aux zones de toucher
    for (const [a, b] of [[r.u0 + 0.25, r.u0 + 0.9], [r.u1 - 0.9, r.u1 - 0.25]]) k.rect((a + b) / 2, yR + 0.0002, r.v, b - a, r.w * 0.45, '#3a3b3d', M.asphalt);
    const white = '#f2f2ee';
    // bords
    for (const s of [-1, 1]) k.rect(cu, yM, r.v + s * (r.w / 2 - 0.0012), len, 0.0012, white);
    // axe : tirets de 30 m, intervalles de 20 m
    for (let u = r.u0 + 0.12; u < r.u1 - 0.12; u += 0.05) k.rect(u + 0.015, yM, r.v, 0.03, 0.0012, white);
    const letters = L.rwys.length > 1 ? (ri === 0 ? ['L', 'R'] : ['R', 'L']) : ['', ''];
    for (const end of [0, 1]) {
      const sgn = end === 0 ? 1 : -1; // direction d'atterrissage depuis ce seuil
      const t0 = end === 0 ? r.u0 : r.u1;
      // seuil : bandes « touches de piano »
      const n = 8;
      for (let s = 0; s < n; s++) for (const side of [-1, 1]) {
        const off = 0.0035 + s * 0.0035;
        k.rect(t0 + sgn * 0.021, yM, r.v + side * off, 0.03, 0.0018, white);
      }
      // ligne de seuil
      k.rect(t0 + sgn * 0.003, yM, r.v, 0.002, r.w - 0.004, white);
      // numéro + lettre (lus depuis l'approche)
      const num = runwayNumber(L.rot, sgn > 0) ;
      const text = letters[end] ? [letters[end], ...num.split('')] : num.split('');
      // lettre près du seuil puis numéro
      const gh = 0.009, gw = 0.0045, st = 0.0011;
      const drawGlyph = (ch: string, baseU: number, centerV: number) => {
        for (const sname of DIGITS[ch] ?? '') {
          for (const [x0, y0, x1, y1] of SEG[sname]) {
            // glyphe : x vers la droite du pilote (= -v pour sgn>0), y vers l'avant (= +u)
            const P = (gx: number, gy: number): [number, number] => [baseU + sgn * gy * (gh / 2), centerV - sgn * (gx - 0.5) * gw];
            const [ua, va] = P(x0, y0), [ub, vb] = P(x1, y1);
            k.strip(ua, va, ub, vb, st, yM, white);
          }
        }
        if (ch === 'R') { const P = (gx: number, gy: number): [number, number] => [baseU + sgn * gy * (gh / 2), centerV - sgn * (gx - 0.5) * gw]; const [ua, va] = P(0.3, 1), [ub, vb] = P(1, 0); k.strip(ua, va, ub, vb, st, yM, white); }
      };
      let bu = t0 + sgn * 0.05;
      if (letters[end]) { drawGlyph(text[0], bu, r.v); bu += sgn * (gh + 0.006); }
      const digits = letters[end] ? text.slice(1) : text;
      drawGlyph(digits[0], bu, r.v + sgn * (gw * 0.75));
      drawGlyph(digits[1], bu, r.v - sgn * (gw * 0.75));
      // zone de toucher et point de visée
      for (const [d, nb] of [[0.15, 3], [0.3, 3], [0.45, 2], [0.6, 2], [0.75, 1], [0.9, 1]] as const) {
        for (const side of [-1, 1]) for (let q = 0; q < nb; q++) k.rect(t0 + sgn * (d + 0.0115), yM, r.v + side * (0.0065 + q * 0.0035), 0.0225, 0.0018, white);
      }
      for (const side of [-1, 1]) k.rect(t0 + sgn * (0.4 + 0.0225), yM, r.v + side * 0.0135, 0.045, 0.006, white);
      // feux d'approche (rampe de 900 m + barre transversale à 300 m)
      for (let d = 0.03; d <= 0.9; d += 0.03) {
        const u = t0 - sgn * d;
        for (const dv of [-0.0015, 0, 0.0015]) light(u, r.v + dv, '#fff4d6', 1.1);
        if (Math.abs(d - 0.3) < 0.01) for (let q = -5; q <= 5; q++) light(u, r.v + q * 0.0035, '#fff4d6', 1.1);
      }
      // seuil vert / extrémité rouge
      for (let q = -6; q <= 6; q++) { light(t0 - sgn * 0.002, r.v + q * 0.0045, '#44ff66', 1); light(t0 + sgn * 0.002, r.v + q * 0.0045, '#ff3030', 0.8); }
    }
    // feux de bord (blancs) et d'axe
    for (let u = r.u0; u <= r.u1 + 1e-6; u += 0.06) for (const s of [-1, 1]) light(u, r.v + s * (r.w / 2 + 0.002), '#fff8e8', 0.9);
    for (let u = r.u0 + 0.015; u <= r.u1; u += 0.03) light(u, r.v, (r.u1 - u) < 0.3 ? '#ff4040' : (r.u1 - u) < 0.9 && Math.round(u / 0.03) % 2 ? '#ff4040' : '#ffffff', 0.6);
  });

  // ---- voies de circulation ----
  const taxiCol = '#626468';
  const taxi = (pts: [number, number][], w = 0.023) => {
    for (let q = 0; q < pts.length - 1; q++) {
      const [u0, v0] = pts[q], [u1, v1] = pts[q + 1];
      const dl = Math.hypot(u1 - u0, v1 - v0) || 1;
      const ext = w / 2 / dl;
      const ua = u0 - (u1 - u0) * ext, va = v0 - (v1 - v0) * ext, ub = u1 + (u1 - u0) * ext, vb = v1 + (v1 - v0) * ext;
      k.strip(ua, va, ub, vb, w + 0.014, yT - 0.0002, '#7d7f7a', M.asphalt);
      k.strip(ua, va, ub, vb, w, yT, taxiCol, M.asphalt);
      k.strip(u0, v0, u1, v1, 0.0009, yT + 0.0005, '#e9c46a');
      // balisage : axe vert, bords bleus
      const n = Math.max(1, Math.floor(dl / 0.03));
      for (let s = 0; s <= n; s++) {
        const t = s / n, u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
        light(u, v, '#30ff70', 0.55);
        if (s % 2 === 0) for (const sd of [-1, 1]) light(u - ((v1 - v0) / dl) * sd * (w / 2 + 0.002), v + ((u1 - u0) / dl) * sd * (w / 2 + 0.002), '#3060ff', 0.7);
      }
    }
  };
  const apron = (u0: number, u1: number, v0: number, v1: number) => k.rect((u0 + u1) / 2, yT - 0.0001, (v0 + v1) / 2, u1 - u0, v1 - v0, '#c9c6bf', M.concrete);

  if (big) {
    const [A, B] = L.rwys;
    // voies parallèles et bretelles
    taxi([[A.u0 + 0.03, A.v], [A.u0 + 0.03, 0.62], [A.u1 - 0.03, 0.62], [A.u1 - 0.03, A.v]]);
    taxi([[B.u0 + 0.03, B.v], [B.u0 + 0.03, -0.62], [B.u1 - 0.03, -0.62], [B.u1 - 0.03, B.v]]);
    for (const u of [-1.0, -0.2]) { taxi([[u, 0.62], [u, A.v]]); taxi([[u, -0.62], [u, B.v]]); }
    taxi(L.exitPath.slice(0, 3) as [number, number][]);
    taxi([[1.15, 0.8], [1.37, 0.69], [1.52, 0.62]]);
    taxi([[0.6, -0.62], [0.82, -0.69], [1.0, -0.8]]);
    // voie transversale, liaisons et voies de desserte
    taxi([[1.0, 0.62], [1.0, -0.62]]);
    taxi([[-0.6, 0.42], [-0.6, 0.62]]); taxi([[-0.6, -0.42], [-0.6, -0.62]]);
    for (const v of [0.42, 0, -0.42]) taxi([[-0.66, v], [1.0, v]]);
    taxi([[1.9, 0.62], [1.9, -0.62]]);
    // aires de stationnement
    apron(-0.7, 1.0, 0.26, 0.47);
    apron(-0.7, 1.0, -0.22, 0.22);
    apron(-0.7, 1.0, -0.47, -0.26);
    apron(1.04, 1.95, 0.2, 0.3);
    apron(1.04, 1.95, -0.3, -0.12);
    // lignes de guidage des postes
    for (const s of L.stands) {
      const lv = s.cargo ? -0.21 : L.laneV[s.lane!];
      const nose = s.v + s.dir * PLANES[s.cls].len / 2;
      k.strip(s.u, lv, s.u, nose, 0.0008, yT + 0.0005, '#e9c46a');
      k.rect(s.u, yT + 0.0005, nose + s.dir * 0.0015, 0.008, 0.0008, '#f2f2ee');
    }

    // ---- terminal ----
    const tH = 0.02;
    k.box(-0.975, yT, 0, 0.55, tH, 0.66, '#ffffff', { mat: M.glass });
    k.box(-0.975, yT + tH, 0, 0.58, 0.0018, 0.7, '#d7dade', { mat: M.metal });
    for (let s = 0; s < 4; s++) k.vault(-1.17 + s * 0.13, yT + tH + 0.0018, 0, 0.12, 0.68, 0.014, '#e9ecef', { mat: M.metal, seg: 8 });
    // façade côté ville : auvent du dépose-minute
    k.box(-1.27, yT + 0.008, 0, 0.035, 0.0012, 0.6, '#cfd4da', { mat: M.metal });
    // jetées vitrées
    for (const pv of [0.24, -0.24]) {
      k.box(0.1, yT, pv, 1.6, 0.012, 0.04, '#ffffff', { mat: M.glass });
      k.box(0.1, yT + 0.012, pv, 1.62, 0.0015, 0.046, '#d7dade', { mat: M.metal });
      for (let u = -0.6; u < 0.9; u += 0.11) k.box(u, yT + 0.0135, pv, 0.012, 0.0025, 0.012, '#aab1b8');
      // racine vers le terminal
      k.box(-0.7, yT, pv, 0.02, 0.012, 0.06, '#ffffff', { mat: M.glass });
    }
    // passerelles d'embarquement
    for (const s of L.stands) {
      if (s.cargo) continue;
      const P = PLANES[s.cls];
      const face = s.lane === 'N' ? 0.26 : s.lane === 'S' ? -0.26 : s.v > 0 ? 0.22 : -0.22;
      const noseV = s.v + s.dir * P.len / 2;
      // porte avant gauche : à gauche du nez (gauche = rotation de la direction du nez)
      const doorU = s.u - s.dir * P.r * 1.1, doorV = noseV - s.dir * P.len * 0.12;
      const rotU = s.u - s.dir * 0.016, rotV = face;
      const hy = yT + 0.0045;
      k.cyl(rotU, yT, rotV - s.dir * 0.003, 0.0022, 0.0022, 0.0065, '#cfd4da', { tess: 8 });
      k.beam(new Vector3(rotU, hy, rotV - s.dir * 0.003), new Vector3(doorU, hy - 0.0006, doorV), 0.0032, 0.003, '#d5d9de', M.metal);
      k.box(doorU - (doorU - rotU) * 0.15, yT, doorV - (doorV - rotV) * 0.15, 0.0012, 0.0035, 0.0012, '#6c757d');
    }

    // tour de contrôle
    k.cyl(-0.95, yT, 0.52, 0.0075, 0.0055, 0.075, '#e6e2da', { tess: 12, mat: M.concrete });
    k.cyl(-0.95, yT + 0.075, 0.52, 0.009, 0.013, 0.004, '#cfd4da', { tess: 12 });
    k.cyl(-0.95, yT + 0.079, 0.52, 0.013, 0.012, 0.006, '#203040', { tess: 12, glow: 1 });
    k.cyl(-0.95, yT + 0.085, 0.52, 0.0135, 0.008, 0.002, '#e9ecef', { tess: 12 });
    k.cyl(-0.95, yT + 0.087, 0.52, 0.0006, 0.0003, 0.012, '#adb5bd', { tess: 5 });
    k.box(-0.95, yT + 0.0985, 0.52, 0.0012, 0.001, 0.0012, '#ff2020', { glow: 3 });
    k.box(-0.9, yT, 0.52, 0.05, 0.012, 0.03, '#ffffff', { mat: M.office });

    // côté ville : routes, parkings silos, hôtel
    const road = '#46484b';
    k.rect(-1.3, yT, 0, 0.03, 0.68, road, M.asphalt);
    k.box(-1.31, yT + 0.007, 0, 0.022, 0.0012, 0.64, '#b9b6ae', { mat: M.concrete }); // voie haute des départs
    for (let v = -0.3; v <= 0.3; v += 0.06) k.box(-1.31, yT, v, 0.003, 0.007, 0.003, '#a8a59d', { mat: M.concrete });
    k.strip(-1.3, 0.32, -2.3, 0.32, 0.022, yT, road, M.asphalt);
    k.strip(-1.3, -0.32, -2.3, -0.32, 0.022, yT, road, M.asphalt);
    k.strip(-1.3, 0, -2.6, 0, 0.03, yT + 0.0001, road, M.asphalt);
    k.strip(-1.75, 0.32, -1.75, -0.32, 0.016, yT, road, M.asphalt);
    for (const pv of [0.18, -0.18]) {
      const lv = 5;
      for (let q = 0; q < lv; q++) {
        k.box(-1.56, yT + q * 0.0032, pv, 0.27, 0.0022, 0.2, '#5d6166');
        k.box(-1.56, yT + q * 0.0032 + 0.0022, pv, 0.272, 0.001, 0.202, '#bdbab3', { mat: M.concrete });
      }
      k.box(-1.43, yT, pv - 0.09, 0.02, lv * 0.0032 + 0.004, 0.02, '#a9a59c', { mat: M.concrete });
    }
    k.box(-1.6, yT, 0.47, 0.06, 0.055, 0.035, '#ffffff', { mat: M.office });
    k.box(-1.6, yT + 0.055, 0.47, 0.062, 0.002, 0.037, '#9aa0a6');
    // parkings de surface
    for (const pv of [0.47, -0.47, 0.6, -0.6]) k.rect(-1.98, yT, pv * 0.85, 0.42, 0.11, '#505255', M.asphalt);

    // maintenance : hangars voûtés
    for (let q = 0; q < 3; q++) {
      const hu2 = 1.18 + q * 0.24;
      k.box(hu2, yT, 0.37, 0.19, 0.022, 0.12, '#e8ecef', { mat: M.steel });
      k.vault(hu2, yT + 0.022, 0.37, 0.19, 0.12, 0.016, '#cfd6dc', { mat: M.steel, ry: Math.PI / 2 });
      k.box(hu2, yT, 0.309, 0.17, 0.02, 0.002, '#3b4652', { mat: M.steel });
    }
    // fret
    for (let q = 0; q < 2; q++) {
      k.box(1.3 + q * 0.36, yT, -0.42, 0.32, 0.017, 0.1, '#9fb3c8', { mat: M.steel });
      k.box(1.3 + q * 0.36, yT + 0.017, -0.42, 0.33, 0.0012, 0.105, '#cfd4da', { mat: M.metal });
      for (let d = -0.14; d <= 0.14; d += 0.02) k.box(1.3 + q * 0.36 + d, yT, -0.369, 0.012, 0.007, 0.002, '#3d4a57');
    }
    // dépôt pétrolier, caserne, radar
    for (let q = 0; q < 6; q++) k.cyl(2.04 + (q % 3) * 0.04, yT, -0.07 + Math.floor(q / 3) * 0.07, 0.014, 0.014, 0.013, '#e9ecef', { tess: 16 });
    k.box(0.2, yT, 0.52, 0.06, 0.009, 0.03, '#c1121f');
    for (let q = 0; q < 4; q++) k.box(0.18 + q * 0.012, yT, 0.504, 0.008, 0.006, 0.002, '#f1faee');
    k.cyl(2.15, yT, 0.35, 0.004, 0.003, 0.025, '#e9ecef', { tess: 8 });
    k.box(2.15, yT + 0.026, 0.35, 0.012, 0.004, 0.002, '#dee2e6', { ry: 0.4 });
    // mâts d'éclairage des aires
    const mast = (u: number, v: number) => {
      k.cyl(u, yT, v, 0.0006, 0.0004, 0.03, '#9aa0a6', { tess: 5 });
      k.box(u, yT + 0.03, v, 0.004, 0.0012, 0.004, '#ffd9a0', { glow: 1 });
      const [x, z] = L.toWorld(u, v);
      addLight(pools, x, y + yT + 0.0009, z, '#ffc27a', 0.1);
      addLight(lights, x, y + yT + 0.031, z, '#ffd9a0', 1.6);
    };
    for (let u = -0.6; u <= 0.95; u += 0.155) { mast(u, 0.465); mast(u, -0.465); mast(u, 0.0); }
    for (let u = 1.1; u <= 1.9; u += 0.16) { mast(u, 0.205); mast(u, -0.125); }
    // véhicules de piste (bus, citernes, tracteurs)
    for (const s of L.stands) {
      if (rnd() < 0.5) continue;
      const side = s.dir;
      const P = PLANES[s.cls];
      k.box(s.u + P.r * 3, yT, s.v - side * P.len * 0.1, 0.008, 0.0025, 0.0028, rnd() < 0.5 ? '#f4d35e' : '#f1faee');
      if (rnd() < 0.5) k.box(s.u - P.r * 4, yT, s.v + side * P.len * 0.15, 0.006, 0.0022, 0.0024, '#e63946');
    }
    // antennes ILS en bout de piste
    for (const r of L.rwys) for (let q = -6; q <= 6; q++) k.box(r.u1 + 0.25, yG, r.v + q * 0.004, 0.001, 0.003, 0.001, '#c1121f');
  } else {
    const [A] = L.rwys;
    taxi([[A.u0 + 0.02, A.v], [A.u0 + 0.02, 0.22], [A.u1 - 0.02, 0.22], [A.u1 - 0.02, A.v]]);
    taxi(L.exitPath as [number, number][]);
    taxi([[0.4, 0.22], [0.4, 0.1]]);
    taxi([[-0.36, 0.1], [0.4, 0.1]]);
    apron(-0.4, 0.45, 0.0, 0.14);
    for (const s of L.stands) { const nose = s.v + s.dir * PLANES[s.cls].len / 2; k.strip(s.u, 0.1, s.u, nose, 0.0008, yT + 0.0005, '#e9c46a'); }
    k.box(0, yT, -0.03, 0.5, 0.012, 0.06, '#ffffff', { mat: M.glass });
    k.box(0, yT + 0.012, -0.03, 0.52, 0.0015, 0.064, '#d7dade', { mat: M.metal });
    k.vault(0, yT + 0.0135, -0.03, 0.12, 0.06, 0.008, '#e9ecef', { mat: M.metal, ry: Math.PI / 2 });
    k.cyl(0.32, yT, -0.04, 0.005, 0.004, 0.035, '#e6e2da', { tess: 10, mat: M.concrete });
    k.cyl(0.32, yT + 0.035, -0.04, 0.008, 0.009, 0.005, '#203040', { tess: 10, glow: 1 });
    k.box(0.6, yT, 0.05, 0.12, 0.018, 0.08, '#e8ecef', { mat: M.steel });
    k.rect(0, yT, -0.17, 0.5, 0.14, '#505255', M.asphalt);
    k.strip(0, -0.24, 0, -0.5, 0.02, yT, '#46484b', M.asphalt);
    for (let u = -0.35; u <= 0.45; u += 0.16) { k.cyl(u, yT, 0.145, 0.0005, 0.0004, 0.022, '#9aa0a6', { tess: 5 }); k.box(u, yT + 0.022, 0.145, 0.004, 0.001, 0.004, '#ffd9a0', { glow: 1 }); }
  }

  const mesh = k.build('aeroport', scene);
  mesh.receiveShadows = true;
  mesh.freezeWorldMatrix();
  // voitures garées (parkings de surface et toits des silos)
  const cars = newInst();
  const pal = ['#e63946', '#f1faee', '#457b9d', '#1d3557', '#adb5bd', '#2b2d42', '#8d99ae', '#ffffff', '#6c757d', '#ffb703'];
  const putCar = (u: number, v: number, yy: number, ry: number) => {
    const [x, z] = L.toWorld(u, v);
    addInst(cars, x, y + yy, z, L.rot + ry, 1, 1, 1, pal[Math.floor(rnd() * pal.length)]);
  };
  if (big) {
    for (const pv of [0.47, -0.47, 0.6, -0.6]) for (let u = -2.18; u < -1.78; u += 0.0028) for (const dv of [-0.04, -0.03, -0.01, 0.0, 0.03, 0.04]) if (rnd() < 0.8) putCar(u, pv * 0.85 + dv, yT, Math.PI / 2);
    for (const pv of [0.18, -0.18]) for (let u = -1.68; u < -1.44; u += 0.0028) for (let dv = -0.09; dv <= 0.09; dv += 0.012) if (rnd() < 0.6) putCar(u, pv + dv, yT + 5 * 0.0032, Math.PI / 2);
  } else {
    for (let u = -0.24; u < 0.24; u += 0.0028) for (let dv = -0.22; dv <= -0.12; dv += 0.012) if (rnd() < 0.7) putCar(u, dv, yT, Math.PI / 2);
  }
  const carM = applyInst(carMesh(scene, 'aeroport-voitures'), cars);
  return { mesh, extra: carM ? [carM] : ([] as Mesh[]) };
}

export { buildLights };

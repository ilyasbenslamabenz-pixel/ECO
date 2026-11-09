// Grand port : terre-plein gagné sur la mer, terminal à conteneurs (quais, portiques de quai et de parc,
// milliers de conteneurs en instances fines), darse, terminal vraquier et pétrolier (appontement,
// réservoirs), digue à carapace d'accropodes, feux de port et mâts d'éclairage chauds.
// La mer est à l'ouest : le modèle suit le trait de côte (`coastX`) quelle que soit l'orientation.
// Le plan (postes à quai et chenaux) est partagé avec airsea.ts.
import { Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { mulberry32 } from '../../../shared/noise';
import { coastX } from '../../../shared/sim/country';
import type { Infra } from '../../../shared/sim/types';
import { Kit, M, SHIP_DIM, addInst, addLight, applyInst, newInst, unitBox, type Inst, type LightSet, type ShipKind } from './infraModels';
import type { Grid } from './terrain';

export const SEA_Y = 0.03;
/** Portique placé (monde, km) : yaw = cap de la flèche (STS) ou de la portée (RTG), modèle avant selon +Z. */
export interface CranePose { x: number; y: number; z: number; yaw: number; ph: number }
export interface PortCranes { mesh: Mesh | null; sts: CranePose[]; rtg: CranePose[] }
/** Portiques des ports construits (par identifiant d'équipement) ; la version change à chaque reconstruction. */
export const PORT_CRANES = new Map<number, PortCranes>();
export const PORT_CRANES_VERSION = { v: 0 };
export interface Berth { x: number; z: number; yaw: number; kind: ShipKind; approach: [number, number][]; depart: [number, number][]; reverseOut: number }
export interface PortLayout { inf: Infra; big: boolean; X0: number; Z: number; yP: number; berths: Berth[]; seaRoute: [number, number][]; seed: number }

const CONTAINER_COLS = ['#b5262d', '#1f4e79', '#2a9d8f', '#e9c46a', '#f4a261', '#6c757d', '#e76f51', '#264653', '#8d99ae', '#457b9d', '#d62828', '#f1f1ef', '#3a5a40', '#9b2226', '#7b6d8d', '#c2a878'];

export function portLayout(inf: Infra, seed: number): PortLayout {
  const big = inf.capacity >= 3e7;
  const X0 = inf.x, Z = inf.z;
  const cx = (z: number) => coastX(seed, z);
  const S = big ? 1 : 0.55;
  // route maritime depuis le large (au sud), toujours en eau libre
  const far: [number, number] = [Math.min(X0 - 2.6, cx(Z - 14) - 2), Z - 14];
  const mid: [number, number] = [Math.min(X0 - 2.4 * S, cx(Z - 6) - 1.2), Z - 6];
  const ent: [number, number] = [X0 - 2.3 * S, Z - 1.9 * S];
  const seaRoute: [number, number][] = [far, mid, [X0 - 2.3 * S, Z - 3 * S], ent];
  const berths: Berth[] = [];
  const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);
  const outRoute = (from: [number, number][]) => [...from, [X0 - 2.25 * S, Z - 1.0 * S], ent, [X0 - 2.3 * S, Z - 3 * S], [mid[0] - 0.4, mid[1]], [far[0] - 0.6, far[1]]] as [number, number][];
  // quai principal (face à l'ouest), navires cap au nord
  const nMain = big ? 4 : 2;
  for (let b = 0; b < nMain; b++) {
    const kind: ShipKind = big ? 'conteneurs' : 'feeder';
    const xb = X0 - 1.4 * S - SHIP_DIM[kind].beam / 2 - 0.004;
    const zb = Z + 0.35 * S + b * 0.34 * S + SHIP_DIM[kind].len / 2 - 0.12;
    berths.push({
      x: xb, z: zb, yaw: yawOf(0, 1), kind, reverseOut: 0,
      approach: [...seaRoute, [X0 - 2.1 * S, Z - 1.0 * S], [X0 - 1.85 * S, zb - 0.55], [xb, zb - 0.14], [xb, zb]],
      depart: outRoute([[xb, zb], [xb - 0.05, zb + 0.2], [X0 - 1.85 * S, zb + 0.42], [X0 - 2.2 * S, zb + 0.12]]),
    });
  }
  if (big) {
    // darse : feeder au nord, vraquier au sud (entrée en marche avant, sortie en marche arrière)
    const dz = Z - 0.075;
    const darse = (kind: ShipKind, xb: number, zb: number) => {
      const path: [number, number][] = [[X0 - 2.0, Z - 0.35], [X0 - 1.85, dz], [X0 - 1.45, dz], [xb - 0.12, zb], [xb, zb]];
      berths.push({
        x: xb, z: zb, yaw: 0, kind, reverseOut: 4,
        approach: [...seaRoute, [X0 - 2.15, Z - 1.0], ...path],
        depart: outRoute([[xb, zb], [xb - 0.12, zb], [X0 - 1.45, dz], [X0 - 1.85, dz], [X0 - 2.15, Z - 0.4]]),
      });
    };
    darse('feeder', X0 - 0.95, Z + 0.15 - SHIP_DIM.feeder.beam / 2 - 0.004);
    darse('vraquier', X0 - 0.55, Z - 0.3 + SHIP_DIM.vraquier.beam / 2 + 0.004);
    // appontement pétrolier
    const xt = X0 - 1.85 - SHIP_DIM.petrolier.beam / 2 - 0.006, zt = Z - 1.25;
    berths.push({
      x: xt, z: zt, yaw: yawOf(0, 1), kind: 'petrolier', reverseOut: 0,
      approach: [...seaRoute, [X0 - 2.05, Z - 1.7], [xt, zt - 0.3], [xt, zt]],
      depart: outRoute([[xt, zt], [xt, zt + 0.3], [X0 - 2.1, Z - 0.65], [X0 - 2.3, Z - 0.9]]),
    });
  }
  return { inf, big, X0, Z, yP: SEA_Y + 0.0075, berths, seaRoute, seed };
}

/** Construit le port (maillage fusionné, conteneurs et accropodes en instances fines, feux). */
export function buildPort(scene: Scene, grid: Grid, inf: Infra, P: PortLayout, lights: LightSet, pools: LightSet) {
  const { X0, Z, big, yP } = P;
  const S = big ? 1 : 0.55;
  const k = new Kit();
  k.frame(X0, 0, Z, 0);
  const rnd = mulberry32(inf.id * 131 + 5);
  const east = (z: number) => coastX(P.seed, Z + z) + 1.3 - X0;
  const lightAt = (x: number, y: number, z: number, c = '#ffc77a', s = 2.2) => addLight(lights, X0 + x, y, Z + z, c, s);
  // portiques (STS et RTG) : maillage séparé, remplaçable par les modèles de la bibliothèque (PORT_CRANES)
  const kc = new Kit();
  kc.frame(X0, 0, Z, 0);
  const cranes: PortCranes = { mesh: null, sts: [], rtg: [] };
  const top = yP;

  // terre-pleins : bandes de 100 m suivant la côte
  const deck = (z0: number, z1: number, xw: number) => {
    for (let z = z0; z < z1 - 1e-6; z += 0.1) {
      const za = z, zb = Math.min(z1, z + 0.1);
      const xe = Math.max(east(za), east(zb)) + 0.05;
      k.box((xw + xe) / 2, -0.012, (za + zb) / 2, xe - xw, top + 0.012, zb - za, '#a9a7a1', { mat: M.concrete });
    }
  };
  const zC0 = 0.15 * S, zC1 = 1.7 * S;
  const xQ = -1.4 * S; // front du quai principal
  deck(zC0, zC1, xQ);
  if (big) {
    deck(-0.3, 0.15, 0.25); // fond de darse
    deck(-1.7, -0.3, -1.0);
  }
  // revêtements : quai en béton, parc en enrobé
  k.rect((xQ + 0.04 + xQ) / 2 + 0.02, top + 0.0003, (zC0 + zC1) / 2, 0.08, zC1 - zC0, '#bebbb4', M.concrete);
  const yardX0 = xQ + 0.09, yardX1 = big ? -0.6 : xQ + 0.45;
  k.rect((yardX0 + yardX1) / 2, top + 0.0002, (zC0 + zC1) / 2, yardX1 - yardX0 + 0.02, zC1 - zC0 - 0.02, '#6b6d70', M.asphalt);
  // bordure de quai, défenses et bollards
  k.box(xQ + 0.0015, top, (zC0 + zC1) / 2, 0.003, 0.0008, zC1 - zC0, '#e9c46a');
  for (let z = zC0 + 0.01; z < zC1; z += 0.025) { k.box(xQ - 0.0006, top - 0.006, z, 0.0012, 0.005, 0.003, '#1f1f1f'); k.cyl(xQ + 0.004, top, z + 0.012, 0.0005, 0.0005, 0.0008, '#2b2d42', { tess: 6 }); }
  // rails des portiques
  for (const dx of [0.006, 0.036]) k.rect(xQ + dx, top + 0.0005, (zC0 + zC1) / 2, 0.0008, zC1 - zC0, '#4a4e54');

  // ---- portiques de quai (STS) ----
  const sts = (qx: number, qz: number, dirX: number, dirZ: number, boomUp: boolean) => {
    // repère du portique : a = vers l'eau (dirX, dirZ), b = le long du quai
    const ax = dirX, az = dirZ, bx = -dirZ, bz = dirX;
    const P3 = (a: number, h: number, b: number) => new Vector3(qx + ax * a + bx * b, top + h, qz + az * a + bz * b);
    const red = '#c8553d', white = '#efefef';
    const ry = Math.atan2(-az, ax);
    cranes.sts.push({ x: X0 + qx + ax * -0.021, y: top, z: Z + qz + az * -0.021, yaw: Math.atan2(ax, az), ph: Math.abs(Math.sin(qx * 91.7 + qz * 47.3)) * 6.28 });
    // jambes et poutres de seuil
    for (const a of [-0.006, -0.036]) for (const b of [-0.009, 0.009]) kc.beam(P3(a, 0, b), P3(a, 0.046, b), 0.0022, 0.0022, red);
    for (const a of [-0.006, -0.036]) kc.beam(P3(a, 0.002, -0.011), P3(a, 0.002, 0.011), 0.002, 0.003, red);
    for (const b of [-0.009, 0.009]) { kc.beam(P3(-0.006, 0.044, b), P3(-0.036, 0.044, b), 0.002, 0.003, red); kc.beam(P3(-0.006, 0.016, b), P3(-0.036, 0.016, b), 0.0015, 0.0015, red); }
    kc.beam(P3(-0.006, 0.046, -0.01), P3(-0.006, 0.046, 0.01), 0.003, 0.003, red);
    kc.beam(P3(-0.036, 0.046, -0.01), P3(-0.036, 0.046, 0.01), 0.003, 0.003, red);
    // flèche (relevée si pas de navire) et contre-flèche
    const tip = boomUp ? P3(0.012, 0.11, 0) : P3(0.066, 0.05, 0);
    for (const b of [-0.003, 0.003]) {
      kc.beam(P3(-0.004, 0.05, b), boomUp ? P3(0.012, 0.11, b) : P3(0.066, 0.05, b), 0.0016, 0.0035, white);
      kc.beam(P3(-0.006, 0.05, b), P3(-0.062, 0.05, b), 0.0016, 0.0035, white);
    }
    // chevalet en A et haubans
    for (const b of [-0.009, 0.009]) { kc.beam(P3(-0.006, 0.046, b), P3(-0.02, 0.088, 0), 0.0018, 0.0018, red); kc.beam(P3(-0.036, 0.046, b), P3(-0.02, 0.088, 0), 0.0018, 0.0018, red); }
    kc.beam(P3(-0.02, 0.088, 0), tip, 0.0008, 0.0008, '#5b5b5b');
    kc.beam(P3(-0.02, 0.088, 0), P3(-0.062, 0.051, 0), 0.0008, 0.0008, '#5b5b5b');
    // salle des machines et cabine
    kc.box(qx + ax * -0.05, top + 0.052, qz + az * -0.05, 0.022, 0.008, 0.01, white, { ry });
    kc.box(qx + ax * 0.01, top + 0.044, qz + az * 0.01 + bz * 0.0045 + 0, 0.004, 0.004, 0.004, '#203040', { ry, glow: 1 });
    if (!boomUp) {
      kc.box(qx + ax * 0.03, top + 0.047, qz + az * 0.03, 0.006, 0.003, 0.008, '#3d3d3d', { ry });
      kc.box(qx + ax * 0.03, top + 0.026, qz + az * 0.03, 0.0024, 0.0012, 0.0122, '#e9c46a', { ry });
    }
    // feux : projecteurs sous la flèche
    for (const a of [-0.03, 0.0, 0.03, 0.055]) { if (boomUp && a > 0) continue; const p = P3(a, 0.047, 0); lightAt(p.x, p.y, p.z, '#ffd9a0', 2.4); }
    const pt = P3(-0.02, 0.089, 0);
    kc.box(pt.x, pt.y, pt.z, 0.0012, 0.001, 0.0012, '#ff2020', { glow: 3 });
  };
  const berthZ = P.berths.filter((b) => b.kind === 'conteneurs' || (b.kind === 'feeder' && !big)).map((b) => b.z);
  const nSts = big ? 11 : 3;
  for (let q = 0; q < nSts; q++) {
    const z = zC0 + 0.08 + (q * (zC1 - zC0 - 0.16)) / Math.max(1, nSts - 1);
    const near = berthZ.some((bz) => Math.abs(bz - (z + Z)) < 0.14);
    sts(xQ, z, -1, 0, !near && rnd() < 0.6);
  }

  // ---- parc à conteneurs ----
  const box = newInst();
  const cars = newInst();
  const put = (x: number, h: number, z: number, ry: number) => addInst(box, X0 + x, top + 0.0004 + h * 0.0026, Z + z, ry, 0.0121, 0.0025, 0.00238, CONTAINER_COLS[Math.floor(rnd() * CONTAINER_COLS.length)]);
  const blockLen = 0.2, aisle = 0.04, rowW = 0.0026, rows = 6;
  for (let x = yardX0 + 0.012; x < yardX1 - 0.02; x += 0.036) {
    for (let z = zC0 + 0.03; z + blockLen < zC1 - 0.02; z += blockLen + aisle) {
      const fill = 0.55 + rnd() * 0.4;
      const hmax = 2 + Math.floor(rnd() * 4);
      for (let b = 0; b < 16; b++) {
        if (rnd() > fill) continue;
        const zz = z + b * 0.0125 + 0.006;
        for (let r = 0; r < rows; r++) {
          const h = Math.floor(rnd() * (hmax + 1));
          for (let j = 0; j < h; j++) put(x + r * rowW, j, zz, Math.PI / 2);
        }
      }
      // portique de parc (RTG) sur pneus
      const zr = z + rnd() * blockLen;
      const xa = x - 0.004, xb = x + rows * rowW + 0.006;
      for (const xx of [xa, xb]) { kc.box(xx, top, zr - 0.004, 0.0012, 0.019, 0.0012, '#f2c14e'); kc.box(xx, top, zr + 0.004, 0.0012, 0.019, 0.0012, '#f2c14e'); kc.box(xx, top, zr, 0.0018, 0.0015, 0.011, '#2b2b2b'); }
      for (const dz of [-0.004, 0.004]) kc.box((xa + xb) / 2, top + 0.019, zr + dz, xb - xa + 0.002, 0.0018, 0.0016, '#f2c14e');
      kc.box(xa + 0.003, top + 0.0205, zr, 0.004, 0.002, 0.009, '#ececec');
      cranes.rtg.push({ x: X0 + (xa + xb) / 2, y: top, z: Z + zr, yaw: 0, ph: Math.abs(Math.sin(xa * 91.7 + zr * 47.3)) * 6.28 });
    }
  }
  if (big) {
    // conteneurs vides empilés haut près de l'entrée
    for (let x = -0.55; x < -0.42; x += 0.0125) for (let z = 0.3; z < 1.55; z += 0.0026 * 1.04) if (rnd() < 0.7) { const h = 3 + Math.floor(rnd() * 3); for (let j = 0; j < h; j++) put(x, j, z, 0); }
  }

  // ---- arrière-port : voies ferrées, portail, entrepôts, bureaux ----
  if (big) {
    for (let t = 0; t < 4; t++) k.rect(-0.36 + t * 0.006, top + 0.0004, (zC0 + zC1) / 2, 0.0014, zC1 - zC0 - 0.05, '#4a3f35');
    for (let t = 0; t < 2; t++) for (let z = zC0 + 0.1; z < zC1 - 0.25; z += 0.0135) { k.box(-0.36 + t * 0.006, top + 0.0012, z, 0.0026, 0.0003, 0.0128, '#343a40'); if (rnd() < 0.75) put(-0.36 + t * 0.006 - 0.0, 0.5, z, Math.PI / 2); }
    // entrepôts et bureaux
    for (let q = 0; q < 6; q++) {
      const z = zC0 + 0.12 + q * 0.23;
      k.box(-0.2, top, z, 0.12, 0.014, 0.16, q % 2 ? '#c9d1d9' : '#aebdcc', { mat: M.steel });
      k.box(-0.2, top + 0.014, z, 0.122, 0.001, 0.162, '#d7dade', { mat: M.metal });
    }
    k.box(0.0, top, zC0 + 0.1, 0.05, 0.03, 0.04, '#ffffff', { mat: M.office });
    k.box(0.0, top, zC0 + 0.32, 0.03, 0.06, 0.03, '#ffffff', { mat: M.glass }); // capitainerie
    k.box(0.0, top + 0.06, zC0 + 0.32, 0.034, 0.003, 0.034, '#203040', { glow: 1 });
    // portail camions et parking poids lourds
    for (let q = 0; q < 10; q++) k.box(0.12, top, zC0 + 0.6 + q * 0.012, 0.03, 0.0005, 0.002, '#f1faee');
    k.box(0.12, top + 0.007, zC0 + 0.66, 0.04, 0.0012, 0.13, '#e63946');
    k.rect(0.25, top + 0.0003, zC0 + 0.9, 0.12, 0.5, '#55575a', M.asphalt);
    for (let z = zC0 + 0.68; z < zC0 + 1.12; z += 0.006) if (rnd() < 0.7) { k.box(0.22, top, z, 0.016, 0.0035, 0.0025, CONTAINER_COLS[Math.floor(rnd() * 16)], { mat: M.steel }); k.box(0.212, top, z, 0.004, 0.003, 0.0024, '#e9ecef'); }

    // ---- portiques de la darse (côté nord, face au sud) ----
    for (const x of [-1.1, -0.82]) sts(x, zC0, 0, -1, false);
    // quai sud de la darse : déchargeurs de vrac et convoyeurs
    for (const x of [-0.75, -0.45]) {
      for (const dx of [-0.01, 0.01]) for (const dz of [0.006, 0.03]) k.box(x + dx, top, -0.3 + dz, 0.002, 0.04, 0.002, '#4f772d');
      k.beam(new Vector3(x, top + 0.042, -0.3 + 0.045), new Vector3(x, top + 0.045, -0.3 - 0.035), 0.004, 0.004, '#4f772d');
      k.box(x, top + 0.035, -0.3 + 0.018, 0.024, 0.008, 0.012, '#e9ecef');
    }
    k.beam(new Vector3(-0.6, top + 0.012, -0.32), new Vector3(-0.6, top + 0.012, -0.85), 0.003, 0.004, '#8d99ae');
    // tas de charbon, de minerai et de granulats + gerbeuses-reprises
    const pileCols = ['#2b2b2b', '#7a3b22', '#2b2b2b', '#9c8b72'];
    for (let q = 0; q < 4; q++) {
      const z = -0.42 - q * 0.11;
      k.gable(-0.55, top, z, 0.62, 0.016, 0.06, pileCols[q]);
      k.rect(-0.55, top + 0.0004, z - 0.055, 0.66, 0.002, '#555');
      const xs = -0.85 + rnd() * 0.6;
      k.box(xs, top, z - 0.055, 0.008, 0.012, 0.006, '#e9c46a');
      k.beam(new Vector3(xs, top + 0.012, z - 0.055), new Vector3(xs + 0.045, top + 0.004, z - 0.02), 0.002, 0.0025, '#e9c46a');
    }
    // silos à grains
    for (let q = 0; q < 8; q++) k.cyl(0.02 + (q % 4) * 0.018, top, -0.2 + Math.floor(q / 4) * 0.018, 0.0085, 0.0085, 0.04, '#d9d4c7', { tess: 12, mat: M.concrete });
    k.box(0.05, top, -0.17, 0.08, 0.05, 0.012, '#c8c2b4', { mat: M.concrete });
    // dépôt pétrolier : réservoirs dans leurs cuvettes de rétention
    for (let i = 0; i < 22; i++) for (let j = 0; j < 6; j++) {
      const x = -0.85 + i * 0.1, z = -1.62 + j * 0.105;
      if (x > east(z) - 0.15) continue;
      const r = 0.026 + rnd() * 0.012;
      k.cyl(x, top, z, r, r, 0.016 + rnd() * 0.006, rnd() < 0.15 ? '#c9c4b8' : '#eeebe4', { tess: 20 });
      k.cyl(x, top + 0.0225, z, r * 0.92, r * 0.92, 0.0004, '#9a9a94', { tess: 20 });
      for (const [dx, dz, w, d] of [[0, -0.047, 0.095, 0.002], [0, 0.047, 0.095, 0.002], [-0.047, 0, 0.002, 0.095], [0.047, 0, 0.002, 0.095]]) k.box(x + dx, top, z + dz, w, 0.002, d, '#b8b4aa', { mat: M.concrete });
    }
    // appontement pétrolier (estacade + tête en T + bras de chargement)
    k.box(-1.43, top - 0.002, -1.25, 0.86, 0.004, 0.012, '#b5b2aa', { mat: M.concrete });
    for (let x = -1.85; x < -1.0; x += 0.04) k.box(x, SEA_Y - 0.01, -1.25, 0.002, top - SEA_Y + 0.008, 0.01, '#6c757d');
    k.beam(new Vector3(-1.0, top + 0.004, -1.246), new Vector3(-1.85, top + 0.004, -1.246), 0.0015, 0.0015, '#adb5bd');
    k.beam(new Vector3(-1.0, top + 0.004, -1.254), new Vector3(-1.85, top + 0.004, -1.254), 0.0015, 0.0015, '#e9c46a');
    k.box(-1.86, top - 0.002, -1.25, 0.03, 0.005, 0.12, '#b5b2aa', { mat: M.concrete });
    for (const dz of [-0.03, 0, 0.03]) { k.box(-1.865, top + 0.003, -1.25 + dz, 0.002, 0.014, 0.002, '#adb5bd'); k.beam(new Vector3(-1.865, top + 0.016, -1.25 + dz), new Vector3(-1.877, top + 0.009, -1.25 + dz), 0.001, 0.001, '#adb5bd'); }
    for (const dz of [-0.09, 0.09]) k.cyl(-1.865, SEA_Y - 0.005, -1.25 + dz, 0.006, 0.006, top - SEA_Y + 0.01, '#8d99ae', { tess: 10 });
    for (let x = -1.8; x < -1.0; x += 0.06) lightAt(x, top + 0.008, -1.25, '#ffc77a', 1.6);
    // zone logistique : entrepôts, dépôts de conteneurs vides, parkings poids lourds
    const logi = ['#c9d1d9', '#aebdcc', '#d6d0c4', '#b9c6b0', '#e2e2dc'];
    for (let x = 0.42; x < 2.2; x += 0.2) for (let z = zC0 + 0.05; z < zC1 - 0.12; z += 0.16) {
      if (x + 0.09 > Math.min(east(z), east(z + 0.12)) - 0.08) continue;
      const r = rnd();
      if (r < 0.55) {
        k.box(x, top, z + 0.06, 0.16, 0.012 + rnd() * 0.006, 0.11, logi[Math.floor(rnd() * logi.length)], { mat: M.steel });
        k.box(x, top + 0.0195, z + 0.06, 0.162, 0.0008, 0.112, '#c3c7cb', { mat: M.metal });
        for (let d = -0.07; d <= 0.07; d += 0.012) k.box(x + d, top, z + 0.003, 0.009, 0.006, 0.002, '#3d4a57');
      } else if (r < 0.8) {
        k.rect(x, top + 0.0003, z + 0.06, 0.17, 0.12, '#6b6d70', M.asphalt);
        for (let a = 0; a < 12; a++) for (let b = 0; b < 30; b++) if (rnd() < 0.75) { const h = 1 + Math.floor(rnd() * 5); for (let j = 0; j < h; j++) put(x - 0.07 + a * 0.0128, j, z + 0.008 + b * 0.0034, 0); }
      } else {
        k.rect(x, top + 0.0003, z + 0.06, 0.17, 0.12, '#55575a', M.asphalt);
        for (let a = 0; a < 8; a++) for (let b = 0; b < 30; b++) if (rnd() < 0.6) { k.box(x - 0.07 + a * 0.02, top, z + 0.01 + b * 0.0034, 0.016, 0.0036, 0.0025, CONTAINER_COLS[Math.floor(rnd() * 16)], { mat: M.steel }); }
      }
    }
    // terminal roulier : voitures neuves alignées
    for (let x = 0.15; x < 2.2; x += 0.13) for (let z = -0.85; z < -0.36; z += 0.12) {
      if (x + 0.06 > Math.min(east(z), east(z + 0.1)) - 0.08) continue;
      k.rect(x, top + 0.0003, z + 0.05, 0.12, 0.1, '#505255', M.asphalt);
      const cc = ['#f1f1ef', '#1d1d1f', '#a8adb3', '#2f4f6f', '#8c1c13'][Math.floor(rnd() * 5)];
      for (let a = 0; a < 24; a++) for (let b = 0; b < 18; b++) if (rnd() < 0.85) addInst(cars, X0 + x - 0.055 + a * 0.0046, top + 0.0003, Z + z + 0.006 + b * 0.0052, 0, 0.0019, 0.0014, 0.0043, rnd() < 0.7 ? cc : '#d9d9d9');
    }
    // remorqueurs à quai (fond de darse)
    for (let q = 0; q < 3; q++) {
      const x = 0.15 - q * 0.04, z = -0.07;
      k.box(x, SEA_Y - 0.002, z, 0.03, 0.0048, 0.01, '#c1121f');
      k.box(x + 0.002, SEA_Y + 0.0028, z, 0.012, 0.004, 0.007, '#f2f2ee');
    }
  }

  // ---- digues : enrochements, mur de couronnement, accropodes ----
  const acc = newInst();
  const mound = (x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
    const nx = -dz / l, nz = dx / l;
    const yb = SEA_Y - 0.02, yc = top + 0.003;
    const wb = 0.03, wc = 0.008;
    const p = (x: number, z: number, o: number, y: number) => [x + nx * o, y, z + nz * o];
    for (const s of [-1, 1]) k.quad(p(x0, z0, s * wb, yb), p(x1, z1, s * wb, yb), p(x1, z1, s * wc, yc), p(x0, z0, s * wc, yc), '#8f8a82', M.concrete);
    k.quad(p(x0, z0, -wc, yc), p(x1, z1, -wc, yc), p(x1, z1, wc, yc), p(x0, z0, wc, yc), '#b7b2a8', M.concrete);
    k.strip(x0 + nx * 0.006, z0 + nz * 0.006, x1 + nx * 0.006, z1 + nz * 0.006, 0.003, yc + 0.006, '#c9c4b8');
    k.beam(new Vector3(x0 + nx * 0.006, yc + 0.003, z0 + nz * 0.006), new Vector3(x1 + nx * 0.006, yc + 0.003, z1 + nz * 0.006), 0.003, 0.006, '#c9c4b8', M.concrete);
    const n = Math.floor(l / 0.0035);
    for (let q = 0; q < n; q++) for (const s of [-1, 1]) {
      const t = (q + rnd()) / n;
      const o = s * (0.012 + rnd() * 0.016);
      const y = yc - ((Math.abs(o) - wc) / (wb - wc)) * (yc - yb);
      addInst(acc, X0 + x0 + dx * t + nx * o, y, Z + z0 + dz * t + nz * o, rnd() * 6.28, 0.003, 0.0026, 0.003, rnd() < 0.5 ? '#c9c5bd' : '#b0aca4');
    }
  };
  const xb = -2.5 * S;
  const zN = big ? 2.6 : 1.3, zTip = -1.4 * S, zMole = -2.4 * S;
  mound(east(zN) - 1.25, zN, xb, zN);
  mound(xb, zN, xb, zTip);
  mound(east(zMole) - 1.25, zMole, -1.9 * S, zMole);
  // phares de musoir (vert à tribord en entrant, rouge à bâbord)
  for (const [x, z, c] of [[xb, zTip, '#2fbf4f'], [-1.9 * S, zMole, '#d62828']] as const) {
    k.cyl(x, top + 0.003, z, 0.003, 0.0024, 0.016, c, { tess: 10 });
    k.cyl(x, top + 0.019, z, 0.0018, 0.0018, 0.003, '#fff', { tess: 8, glow: 3 });
  }

  // ---- mâts d'éclairage (lumière chaude) ----
  const mast = (x: number, z: number, h = 0.035) => {
    k.cyl(x, top, z, 0.0007, 0.0005, h, '#9aa0a6', { tess: 5 });
    k.box(x, top + h, z, 0.005, 0.0015, 0.005, '#ffd9a0', { glow: 1 });
    lightAt(x, top + h + 0.001, z, '#ffc77a', 3.2);
    addLight(pools, X0 + x, top + 0.0012, Z + z, '#ffb15c', 0.11);
  };
  for (let z = zC0 + 0.05; z < zC1; z += 0.11) { mast(xQ + 0.05, z); for (let x = yardX0 + 0.1; x < yardX1; x += 0.15) mast(x, z + 0.05); }
  for (let z = zC0 + 0.02; z < zC1; z += 0.03) lightAt(xQ + 0.002, top + 0.002, z, '#ffd08a', 1.2);
  // reflets chauds des quais sur l'eau
  for (let z = zC0 + 0.04; z < zC1; z += 0.07) addLight(pools, X0 + xQ - 0.03, SEA_Y + 0.0008, Z + z, '#ff9a3c', 0.07);
  if (big) {
    for (let x = -0.95; x < 0.2; x += 0.13) { mast(x, -0.35); mast(x, -0.95); mast(x, -1.68); }
    for (let x = -1.35; x < 0.2; x += 0.1) { lightAt(x, top + 0.002, 0.148, '#ffd08a', 1.2); lightAt(x + 0.3 > 0.25 ? x : x + 0.4, top + 0.002, -0.298, '#ffd08a', 1.2); }
    for (let z = 0.3; z < 1.6; z += 0.12) mast(0.18, z);
  }

  const mesh = k.build('port', scene);
  mesh.receiveShadows = true;
  mesh.freezeWorldMatrix();
  const extra: Mesh[] = [];
  const cm = applyInst(unitBox(scene, 'port-conteneurs', M.steel), box);
  if (cm) { cm.receiveShadows = true; extra.push(cm); }
  const carm = applyInst(unitBox(scene, 'port-voitures'), cars);
  if (carm) extra.push(carm);
  const am = (() => {
    const kk = new Kit();
    // accropode simplifié : deux pavés croisés
    kk.box(0, -0.5, 0, 1, 1, 0.45, '#ffffff', { mat: M.concrete });
    kk.box(0, -0.5, 0, 0.45, 1, 1, '#ffffff', { mat: M.concrete, ry: 0.3, rx: 0.4 });
    return applyInst(kk.build('port-accropodes', scene), acc);
  })();
  if (am) extra.push(am);
  const cm2 = kc.build('port-portiques', scene);
  cm2.receiveShadows = true;
  cm2.freezeWorldMatrix();
  extra.push(cm2);
  cranes.mesh = cm2;
  if (!inf.status || inf.status === 'active') { PORT_CRANES.set(inf.id, cranes); PORT_CRANES_VERSION.v++; }
  void grid;
  return { mesh, extra };
}

export type { Inst };

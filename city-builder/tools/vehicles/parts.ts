/**
 * Pièces de détail des véhicules : roues (pneu à bande de roulement et flancs lettrés, jante alliage
 * à rayons, disque et étrier de frein ; jante acier de poids lourd ; roues jumelées), optiques,
 * rétroviseurs, poignées, joints d'ouvrants, plaques, essuie-glaces, barres de toit, rampes lumineuses.
 * Le niveau de détail (mb.lod) simplifie ou supprime les pièces.
 */
import type { CarBody } from './body';
import { VMesh, type Mat, type V3 } from './mesh';
import type { RegionName } from './textures';

export type RimStyle = 'alliage' | 'alliage_sport' | 'acier' | 'pl';

/** Roue centrée en (cx, cy, cz) ; side = +1 (droite, +X) ou −1 (gauche). */
export function wheel(mb: VMesh, cx: number, cy: number, cz: number, R: number, W: number, side: 1 | -1, style: RimStyle, dual = false): void {
  const lod = mb.lod;
  const seg = lod === 0 ? (R > 0.45 ? 16 : 14) : lod === 1 ? 8 : 6;
  mb.push().translate(cx, cy, cz).scale(side, 1, 1);
  const heavy = style === 'pl';
  const rimR = R * (heavy ? 0.56 : style === 'alliage_sport' ? 0.7 : 0.64);
  const hw = W / 2;
  const tread: RegionName = heavy ? 'bande_roulement_pl' : 'bande_roulement';
  const tires = dual ? [-hw * 1.05, hw * 1.05] : [0];
  for (const off of tires) {
    const outer = off >= 0; // pneu extérieur (flanc lettré visible)
    mb.push().translate(off, 0, 0);
    if (lod < 2) {
      mb.latheX('atlas', lod === 0 ? [[R * 0.93, -hw], [R * 0.985, -hw * 0.78], [R, -hw * 0.4], [R, hw * 0.4], [R * 0.985, hw * 0.78], [R * 0.93, hw]] : [[R * 0.93, -hw], [R, -hw * 0.6], [R, hw * 0.6], [R * 0.93, hw]], seg, tread, 'band', 50);
      mb.latheX('atlas', lod === 0 ? [[R * 0.93, hw], [R * 0.86, hw * 1.04], [rimR * 1.08, hw * 0.98], [rimR, hw * 0.9]] : [[R * 0.93, hw], [rimR, hw * 0.92]], seg, outer ? 'flanc' : 'caoutchouc', 'radial', 60, R);
      mb.latheX('atlas', [[rimR, -hw * 0.9], [R * 0.93, -hw]], seg, 'caoutchouc', 'radial', 60, R);
    } else {
      mb.latheX('atlas', [[R * 0.95, -hw], [R, -hw * 0.5], [R, hw * 0.5], [R * 0.95, hw]], seg, tread, 'band', 50);
    }
    mb.pop();
  }
  const xo = dual ? hw * 2.05 : hw; // face extérieure
  if (lod === 2) {
    // disque plat : flanc + jante en une texture
    mb.latheX('atlas', [[R * 0.95, xo], [rimR, xo + 0.002], [0.001, xo + 0.004]], seg, heavy ? 'jante_pl' : 'jante_disque', 'radial', 80, R * 0.95);
  } else if (lod === 1 || style === 'acier' || heavy) {
    const region: RegionName = heavy ? 'jante_pl' : style === 'acier' ? 'jante_pl' : 'jante_disque';
    mb.latheX('atlas', lod === 0 ? [[rimR, xo * 0.9], [rimR * 0.97, xo * 0.88 - 0.01], [rimR * 0.6, xo * 0.78 - 0.02], [rimR * 0.2, xo * 0.8 - 0.01], [0.001, xo * 0.82]] : [[rimR, xo * 0.9], [rimR * 0.6, xo * 0.8 - 0.02], [0.001, xo * 0.82]], seg, region, 'radial', 30, rimR);
    if (lod === 0) {
      // écrous / moyeu en relief
      const nuts = heavy ? 10 : 5;
      for (let k = 0; k < nuts; k++) {
        const a = (k / nuts) * Math.PI * 2;
        const r = rimR * (heavy ? 0.42 : 0.3);
        mb.push().translate(xo * 0.82, Math.sin(a) * r, Math.cos(a) * r);
        mb.latheX('atlas', [[0.016, 0], [0.016, 0.02], [0.001, 0.024]], 5, 'chrome', 'radial', 40);
        mb.pop();
      }
      mb.latheX('atlas', [[rimR * 0.18, xo * 0.82], [rimR * 0.14, xo * 0.82 + 0.03], [0.001, xo * 0.82 + 0.035]], 10, heavy ? 'noir_mat' : 'chrome', 'radial', 40);
    }
    // fond du passage (intérieur sombre)
    mb.latheX('atlas', [[0.001, -hw * 0.6], [rimR * 0.98, -hw * 0.6]], seg, 'noir_mat', 'radial', 80);
  } else {
    // LOD0 alliage : lèvre, rayons, cache-moyeu, disque et étrier de frein
    const xf = hw * 0.9;
    mb.latheX('atlas', [[rimR, xf], [rimR * 0.98, xf + 0.01], [rimR * 0.9, xf + 0.008], [rimR * 0.86, xf - 0.015]], seg, 'alu', 'radial', 40, rimR);
    mb.latheX('atlas', [[rimR * 0.86, xf - 0.015], [0.001, -hw * 0.5]], seg, 'noir_mat', 'radial', 60);
    const spokes = style === 'alliage_sport' ? 10 : 5;
    const sw = style === 'alliage_sport' ? 0.022 : 0.045;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      mb.push().rotX(a);
      // rayon effilé : boîte inclinée (bombé de jante)
      const r0 = rimR * 0.22, r1 = rimR * 0.88;
      const p = (r: number, w: number, x: number): V3[] => [[x, r, -w], [x, r, w]];
      const [a0, a1] = p(r0, sw * 1.2, xf - 0.005), [b0, b1] = p(r1, sw * 0.8, xf - 0.025);
      const back = 0.025;
      mb.quad('atlas', a0!, b0!, b1!, a1!, 'alu');
      mb.quad('atlas', [a0![0] - back, a0![1], a0![2]], [a0![0], a0![1], a0![2]], [b0![0], b0![1], b0![2]], [b0![0] - back, b0![1], b0![2]], 'alu');
      mb.quad('atlas', [a1![0], a1![1], a1![2]], [a1![0] - back, a1![1], a1![2]], [b1![0] - back, b1![1], b1![2]], [b1![0], b1![1], b1![2]], 'alu');
      mb.pop();
    }
    mb.latheX('atlas', [[rimR * 0.24, xf - 0.01], [rimR * 0.2, xf + 0.012], [0.001, xf + 0.021]], 8, 'chrome', 'radial', 35);
    // disque de frein et étrier
    mb.latheX('atlas', [[rimR * 0.82, 0.01], [rimR * 0.3, 0.012]], 12, 'alu', 'radial', 40);
    mb.push().translate(0.0, rimR * 0.62, -rimR * 0.35).rotX(-0.5);
    mb.box('atlas', -0.03, -rimR * 0.17, -0.045, 0.03, rimR * 0.17, 0.045, 'bande_rouge', 'nx');
    mb.pop();
  }
  mb.pop();
}

/** Optique (lentille) : pavé arrondi mince orienté vers `yaw` (0 = vers +Z). */
export function lamp(mb: VMesh, region: RegionName, x: number, y: number, z: number, w: number, h: number, yaw: number, depth = 0.05): void {
  mb.push().translate(x, y, z).rotY(yaw);
  if (mb.lod === 2) mb.quad('atlas', [-w / 2, -h / 2, depth / 2], [w / 2, -h / 2, depth / 2], [w / 2, h / 2, depth / 2], [-w / 2, h / 2, depth / 2], region);
  else mb.roundedBox(() => ({ mat: 'atlas', region }), 0, 0, 0, w, h, depth, Math.min(w, h) * 0.25, mb.lod === 0 ? 2 : 1, region);
  mb.pop();
}

/** Plaque d'immatriculation (0,52 × 0,11 m) face à `sign` (+1 avant, −1 arrière). */
export function plate(mb: VMesh, y: number, z: number, sign: 1 | -1, scale = 1): void {
  const w = 0.52 * scale / 2, h = 0.11 * scale / 2;
  if (sign > 0) mb.quad('atlas', [-w, y - h, z], [w, y - h, z], [w, y + h, z], [-w, y + h, z], 'plaque');
  else mb.quad('atlas', [w, y - h, z], [-w, y - h, z], [-w, y + h, z], [w, y + h, z], 'plaque');
}

/** Quad d'atlas plaqué sur un flanc latéral (x = ±sx), entre z0..z1 et y0..y1. */
export function sideDecal(mb: VMesh, region: RegionName, side: 1 | -1, x: number, z0: number, z1: number, y0: number, y1: number, uvRect?: [number, number, number, number]): void {
  const X = side * x;
  // vu de l'extérieur, le texte se lit de gauche à droite : vers −Z sur le flanc +X, vers +Z sur le flanc −X
  if (side > 0) mb.quad('atlas', [X, y0, z1], [X, y0, z0], [X, y1, z0], [X, y1, z1], region, uvRect);
  else mb.quad('atlas', [X, y0, z0], [X, y0, z1], [X, y1, z1], [X, y1, z0], region, uvRect);
}

/** Quad sur un flanc de caisse galbée : suit sideX(z, y) du corps (décalé de `off`). */
export function bodySideStrip(mb: VMesh, body: CarBody, region: RegionName, side: 1 | -1, z0: number, z1: number, y0: number, y1: number, off = 0.004, n = 6): void {
  const rows: V3[][] = [];
  const ny = 2;
  for (let a = 0; a <= ny; a++) {
    const y = y0 + ((y1 - y0) * a) / ny;
    const row: V3[] = [];
    for (let k = 0; k <= n; k++) {
      // sens de lecture (vu de l'extérieur) : vers −Z sur le flanc +X, vers +Z sur le flanc −X
      const z = side > 0 ? z1 - ((z1 - z0) * k) / n : z0 + ((z1 - z0) * k) / n;
      const x = body.sideX(z, y);
      row.push([side * (x + off), y, z]);
    }
    rows.push(row);
  }
  // rows[a][k] : i = hauteur (bas -> haut), j = longueur (sens lecture)
  mb.surface(rows, { mat: () => ({ mat: 'atlas', region }), smoothAngle: 70, flip: true, uv: (_p, _n, i, j) => [j / n, 1 - i / ny] });
}

/** Élargisseur d'aile (protection plastique) suivant le passage de roue, sur le flanc galbé. */
export function archTrim(mb: VMesh, body: CarBody, side: 1 | -1, az: number, r: number, cy: number, w: number): void {
  if (mb.lod === 2) return;
  const n = mb.lod === 0 ? 12 : 6;
  const rows: V3[][] = [];
  for (const [rr, off] of [[r, 0.012], [r + w, 0.004]] as const) {
    const row: V3[] = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI;
      const z = az + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const x = Math.max(body.sideX(z, y), body.sideX(z, Math.max(y, body.bottomAt(z) + 0.01)));
      row.push([side * (x + off), y, z]);
    }
    rows.push(row);
  }
  mb.surface(rows, { mat: () => ({ mat: 'atlas', region: 'plastique' }), smoothAngle: 70, flip: side > 0, uv: (_p, _n, i, j) => [j / n, i] });
}

/** Joint d'ouvrant vertical (trait sombre fin) sur le flanc galbé. */
export function doorSeam(mb: VMesh, body: CarBody, side: 1 | -1, z: number, y0: number, y1: number): void {
  if (mb.lod > 0) return;
  bodySideStrip(mb, body, 'noir_mat', side, z - 0.006, z + 0.006, y0, y1, 0.0025, 1);
}

/** Poignée de porte. */
export function handle(mb: VMesh, body: CarBody, side: 1 | -1, z: number, y: number, mat: 'chrome' | 'peinture' = 'chrome'): void {
  if (mb.lod > 0) return;
  const x = body.sideX(z, y);
  if (x <= 0) return;
  mb.push().translate(side * (x + 0.012), y, z);
  if (mat === 'chrome') mb.roundedBox(() => ({ mat: 'atlas', region: 'chrome' }), 0, 0, 0, 0.025, 0.03, 0.16, 0.01, 1, 'chrome');
  else mb.roundedBox('peinture', 0, 0, 0, 0.025, 0.03, 0.16, 0.01, 1);
  mb.pop();
}

/** Rétroviseur extérieur : bras, coque peinte, miroir. */
export function mirror(mb: VMesh, side: 1 | -1, x: number, y: number, z: number, big = false): void {
  if (mb.lod === 2) return;
  const s = big ? 1.6 : 1;
  mb.push().translate(side * x, y, z);
  mb.box('atlas', side > 0 ? 0 : -0.1 * s, -0.02, -0.03, side > 0 ? 0.1 * s : 0, 0.02, 0.03, 'plastique');
  const cx = side * 0.16 * s;
  if (big) {
    mb.roundedBox(() => ({ mat: 'atlas', region: 'plastique' }), cx, 0.12, 0, 0.1, 0.36, 0.08, 0.03, mb.lod === 0 ? 2 : 1, 'plastique');
    mb.quad('atlas', [cx + 0.04, 0.0, -0.041], [cx - 0.04, 0.0, -0.041], [cx - 0.04, 0.26, -0.041], [cx + 0.04, 0.26, -0.041], 'chrome');
  } else {
    mb.roundedBox('peinture', cx, 0.04, 0, 0.17, 0.11, 0.09, 0.035, mb.lod === 0 ? 2 : 1);
    mb.quad('atlas', [cx + 0.07, 0.0, -0.046], [cx - 0.07, 0.0, -0.046], [cx - 0.07, 0.085, -0.046], [cx + 0.07, 0.085, -0.046], 'chrome');
  }
  mb.pop();
}

/** Essuie-glace (bras + balai) à la base du pare-brise. */
export function wiper(mb: VMesh, x: number, y: number, z: number, len: number, slope: number): void {
  if (mb.lod > 0) return;
  mb.push().translate(x, y, z).rotZ(0.12).rotX(-slope);
  mb.box('atlas', -len / 2, 0, -0.012, len / 2, 0.018, 0.012, 'noir_mat', 'ny');
  mb.pop();
}

/** Rampe lumineuse de toit (gyrophares) : socle + deux blocs bleus (ou orange). */
export function lightbar(mb: VMesh, y: number, z: number, w: number, color: 'bleu' | 'orange'): void {
  const reg: RegionName = color === 'bleu' ? 'gyro_bleu' : 'gyro_orange';
  mb.box('atlas', -w / 2, y, z - 0.14, w / 2, y + 0.04, z + 0.14, 'noir_mat', 'ny');
  if (mb.lod === 2) { mb.box('atlas', -w / 2 + 0.03, y + 0.04, z - 0.11, w / 2 - 0.03, y + 0.14, z + 0.11, reg, 'ny'); return; }
  const seg = mb.lod === 0 ? 2 : 1;
  mb.roundedBox(() => ({ mat: 'atlas', region: reg }), -w / 4 - 0.01, y + 0.09, z, w / 2 - 0.05, 0.1, 0.22, 0.04, seg, reg);
  mb.roundedBox(() => ({ mat: 'atlas', region: reg }), w / 4 + 0.01, y + 0.09, z, w / 2 - 0.05, 0.1, 0.22, 0.04, seg, reg);
  mb.roundedBox(() => ({ mat: 'atlas', region: 'chrome' }), 0, y + 0.08, z, 0.08, 0.07, 0.2, 0.02, 1, 'chrome');
}

/** Barres de toit longitudinales. */
export function roofRails(mb: VMesh, body: CarBody, z0: number, z1: number, x: number): void {
  if (mb.lod === 2) return;
  for (const s of [1, -1] as const) {
    const n = mb.lod === 0 ? 6 : 3;
    const rows: V3[][] = [];
    const prof: [number, number][] = [[0, 0], [0.02, 0.02], [0.02, 0.045], [-0.02, 0.045], [-0.02, 0.02], [-0.0, 0]];
    for (let k = 0; k <= n; k++) {
      const z = z0 + ((z1 - z0) * k) / n;
      const y = body.roofAt(z) - 0.005;
      const lift = Math.sin((k / n) * Math.PI) > 0.2 ? 0.03 : 0;
      rows.push(prof.map(([dx, dy]) => [s * x + dx, y + dy + lift, z] as V3));
    }
    mb.surface(rows, { mat: () => ({ mat: 'atlas', region: 'alu' }), smoothAngle: 40, closedJ: false, autoOrient: false, flip: s < 0 });
  }
}

/** Pot d'échappement. */
export function exhaust(mb: VMesh, x: number, y: number, z: number, r = 0.035): void {
  if (mb.lod === 2) return;
  mb.push().translate(x, y, z).rotY(-Math.PI / 2);
  mb.latheX('atlas', [[r * 0.7, -0.02], [r, 0], [r, 0.12], [r * 0.75, 0.12], [r * 0.75, 0.02]], mb.lod === 0 ? 12 : 6, 'chrome', 'band', 50);
  mb.pop();
}

/** Boîte simple d'un matériau donné (raccourci lisible). */
export function slab(mb: VMesh, mat: Mat, region: RegionName | undefined, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = ''): void {
  mb.box(mat, Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), region, skip);
}

export { VMesh };

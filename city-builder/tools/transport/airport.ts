/**
 * Modèles de l'AÉROPORT, originaux, style européen moderne : avions de ligne (moyen-courrier, gros porteur,
 * cargo) aux livrées FICTIVES (AUBE AIR / AUBE CARGO), aérogare (hall + jetée), tour de contrôle, hangar,
 * modules au sol (piste, seuil, zone de toucher, voie de circulation droite / virage, aire de stationnement),
 * passerelle d'embarquement (rotation, télescope, cabine animables), véhicules de piste.
 * Repère : mètres, Y vers le haut, nez / façade vers +Z ; pistes orientées le long de X (09-27).
 */
import type { TransportDef } from './defs';
import type { MatKey } from './materials';
import { lerp3, type TMesh, type TModel, type V3 } from './mesh';
import { beacon, disc, lightMast, railing, wheelX } from './parts';
import { band, bandsBox } from './ship';
import type { RegionName } from './textures';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Avions                                                               */
/* ------------------------------------------------------------------ */
interface PlaneSpec {
  L: number; R: number; belly: number; livery: RegionName; fin: RegionName;
  span: number; rootChord: number; tipChord: number; sweep: number; dihedral: number; wingLE: number;
  engR: number; engL: number; engF: number[]; finH: number; finRoot: number; finTip: number; stabSpan: number;
  mainWheels: 2 | 6; wheelR: number;
}

/** Profil d'aile (corde 1, bord d'attaque en 0, bord de fuite en −1) : points (z, y) fermés. */
function airfoil(n: number, t: number): [number, number][] {
  const pts: [number, number][] = [];
  const yt = (x: number): number => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  for (let k = n; k >= 0; k--) { const x = (1 - Math.cos((k / n) * Math.PI)) / 2; pts.push([-x, yt(x) + 0.02 * Math.sin(Math.PI * x)]); }
  for (let k = 1; k < n; k++) { const x = (1 - Math.cos((k / n) * Math.PI)) / 2; pts.push([-x, -yt(x) * 0.8 + 0.02 * Math.sin(Math.PI * x)]); }
  return pts;
}

/** Surface portante : sections (origine bord d'attaque, corde, épaisseur) le long de l'envergure ; fermée au saumon. */
function lift(mb: TMesh, mat: MatKey, secs: { le: V3; c: number; t: number }[], vertical = false, region?: RegionName, uvf?: (p: V3) => [number, number]): void {
  const n = mb.lod === 0 ? 9 : mb.lod === 1 ? 6 : 3;
  const grid: V3[][] = secs.map(({ le, c, t }) => airfoil(n, t).map(([z, y]) => vertical ? [le[0] + y * c, le[1], le[2] + z * c] as V3 : [le[0], le[1] + y * c, le[2] + z * c] as V3));
  const last = secs[secs.length - 1]!;
  grid.push(airfoil(n, 0.001).map(([z]) => [last.le[0], last.le[1], last.le[2] + z * last.c * 0.98 - 0.02] as V3));
  mb.surface(grid, { mat, closedJ: true, smoothAngle: 50, ...(region && uvf ? { region, uv: (i, j) => uvf(grid[i]![j % grid[i]!.length]!) } : {}) });
}

function airplane(m: TModel, p: PlaneSpec): void {
  const mb = m.mb, lod = mb.lod;
  const yc = p.belly + p.R;
  // --- fuselage (u = 0 nez en +L/2 … 1 queue), UV livrée (u, angle/2π)
  const nu = lod === 0 ? 64 : lod === 1 ? 30 : 14, nt = lod === 0 ? 24 : lod === 1 ? 14 : 8;
  const us: number[] = [];
  for (let k = 0; k <= nu; k++) { const t = k / nu; us.push(t < 0.5 ? 0.5 * Math.pow(2 * t, 1.6) : t); }
  const prof = (u: number): [number, number] => {
    if (u < 0.11) { const t = 1 - u / 0.11; return [p.R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.3))), -p.R * 0.22 * t * t]; }
    if (u > 0.66) { const t = (u - 0.66) / 0.34; return [p.R * (1 - 0.86 * Math.pow(t, 1.25)), p.R * 0.62 * Math.pow(t, 1.5)]; }
    return [p.R, 0];
  };
  const grid: V3[][] = us.map((u) => {
    const [r, yo] = prof(u);
    const z = p.L / 2 - u * p.L;
    return Array.from({ length: nt }, (_, j) => { const a = (j / nt) * Math.PI * 2; return [Math.sin(a) * r, yc + yo + Math.cos(a) * r * 1.03, z] as V3; });
  });
  grid.push(grid[grid.length - 1]!.map((q) => [q[0] * 0.01, q[1], q[2] - 0.15] as V3));
  mb.surface(grid, { mat: 'atlas', closedJ: true, region: p.livery, smoothAngle: 60, uv: (i, j) => [Math.min(1, us[Math.min(i, us.length - 1)]!), j / nt] });
  // --- ailes
  const half = p.span / 2;
  const yW = yc - p.R * 0.5;
  const wsec = (s: number, f: number): { le: V3; c: number; t: number } => {
    const d = p.R * 0.85 + f * (half - p.R * 0.85);
    return { le: [s * d, yW + (d - p.R * 0.85) * Math.tan(p.dihedral * DEG), p.wingLE - (d - p.R * 0.85) * Math.tan(p.sweep * DEG)], c: p.rootChord + (p.tipChord - p.rootChord) * Math.pow(f, 0.8), t: 0.14 - 0.05 * f };
  };
  const fs = lod === 0 ? [0, 0.12, 0.3, 0.55, 0.8, 1] : lod === 1 ? [0, 0.3, 0.7, 1] : [0, 1];
  for (const s of [-1, 1]) {
    lift(mb, 'gris_clair', [{ ...wsec(s, 0), le: [0, yW, p.wingLE + 1.2], c: p.rootChord + 1.6 }, ...fs.map((f) => wsec(s, f))]);
    const tip = wsec(s, 1);
    // ailette verticale
    if (lod < 2) lift(mb, 'livree', [{ le: tip.le, c: tip.c, t: 0.08 }, { le: [tip.le[0] + s * 0.25, tip.le[1] + p.R * 0.9, tip.le[2] - tip.c * 0.6], c: tip.c * 0.45, t: 0.08 }], true);
    beacon(mb, [tip.le[0] + s * 0.1, tip.le[1], tip.le[2] - 0.3], s > 0 ? 'feu_rouge' : 'feu_vert', 0.12, 0.2);
    // carénages de rails de volets
    if (lod === 0) for (const f of [0.28, 0.48, 0.68]) { const w = wsec(s, f); mb.tube('gris_clair', [w.le[0], w.le[1] - 0.15, w.le[2] - w.c * 0.5], [w.le[0], w.le[1] - 0.3, w.le[2] - w.c * 1.15], [0.22, 0.08], 6, true); }
    // réacteurs
    for (const f of p.engF) {
      const w = wsec(s, f);
      const c: V3 = [w.le[0], w.le[1] - p.engR * 1.15, w.le[2] + p.engL * 0.35];
      engine(mb, c, p.engR, p.engL);
      mb.beam('gris_clair', [c[0], c[1] + p.engR * 0.8, c[2] - p.engL * 0.1], [w.le[0], w.le[1] - 0.05, w.le[2] - w.c * 0.55], 0.35, 0.7);
      mb.beam('gris_clair', [c[0], c[1] + p.engR * 0.8, c[2] + p.engL * 0.25], [c[0], c[1] + p.engR * 0.9, c[2] - p.engL * 0.1], 0.35, 0.5);
    }
  }
  // carénage ventral voilure
  mb.push().translate(0, yc - p.R * 0.78, p.wingLE - p.rootChord * 0.45).scale(p.R * 0.9, p.R * 0.35, p.rootChord * 0.75);
  mb.lathe('gris_clair', [[0.001, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0.001, 1]].map(([r, y]) => [r, y] as [number, number]), lod === 0 ? 12 : 6, 60);
  mb.pop();
  // --- empennage horizontal
  const zt = -p.L / 2 + p.finRoot * 0.9, yt = yc + p.R * 0.45;
  for (const s of [-1, 1]) {
    const hs = p.stabSpan / 2;
    lift(mb, 'gris_clair', [{ le: [s * p.R * 0.3, yt, zt + 0.5], c: p.finRoot * 0.7, t: 0.11 }, { le: [s * hs, yt + hs * 0.1, zt - hs * 0.55], c: p.finRoot * 0.28, t: 0.09 }]);
  }
  // --- dérive (livrée de dérive projetée)
  const fy0 = yc + p.R * 0.6, fz0 = -p.L / 2 + p.finRoot * 1.15;
  const ztop = fz0 - p.finH * Math.tan(38 * DEG);
  lift(mb, 'atlas', [{ le: [0, fy0 - 0.3, fz0 + 0.8], c: p.finRoot + 0.8, t: 0.1 }, { le: [0, fy0 + p.finH * 0.5, fz0 - p.finH * 0.5 * Math.tan(38 * DEG)], c: (p.finRoot + p.finTip) / 2, t: 0.1 }, { le: [0, fy0 + p.finH, ztop], c: p.finTip, t: 0.1 }], true, p.fin,
    (q) => [Math.max(0, Math.min(1, (fz0 + 0.8 - q[2]) / (fz0 + 0.8 - (ztop - p.finTip)))), Math.max(0, Math.min(1, 1 - (q[1] - fy0) / p.finH))]);
  // --- feux anticollision, antennes, APU
  beacon(mb, [0, yc + p.R * 1.03, p.wingLE - 2], 'feu_rouge', 0.15, 0.25);
  beacon(mb, [0, fy0 + p.finH, ztop - p.finTip * 0.6], 'feu_blanc', 0.12, 0.2);
  if (lod === 0) {
    mb.push().translate(0, yc - p.R * 1.03, p.wingLE + 4).rotX(Math.PI); beacon(mb, [0, 0, 0], 'feu_rouge', 0.15, 0.25); mb.pop();
    for (const z of [p.L * 0.25, -p.L * 0.05]) mb.beam('gris_fonce', [0, yc + p.R * 1.02, z], [0, yc + p.R * 1.02 + 0.5, z - 0.3], 0.05, 0.25);
  }
  // --- trains d'atterrissage
  const zn = p.L / 2 - p.L * 0.12;
  mb.tube('gris_clair', [0, yc - p.R * 0.8, zn], [0, p.wheelR * 0.9, zn], 0.12, 6, false);
  for (const s of [-1, 1]) { mb.push().translate(s * 0.25, p.wheelR * 0.85, zn); wheelX(mb, [0, 0, 0], p.wheelR * 0.85, 0.3); mb.pop(); }
  const zm = p.wingLE - p.rootChord * 0.75;
  for (const s of [-1, 1]) {
    const x = s * p.R * (p.mainWheels === 6 ? 1.3 : 1.5);
    mb.tube('gris_clair', [x, yW - 0.2, zm], [x, p.wheelR, zm], 0.2, 8, false);
    const axles = p.mainWheels === 6 ? [-1.5, 0, 1.5] : [0];
    if (p.mainWheels === 6) mb.box('gris_fonce', x - 0.15, p.wheelR - 0.12, zm - 1.7, x + 0.15, p.wheelR + 0.12, zm + 1.7);
    for (const dz of axles) for (const dx of [-0.55, 0.55]) { mb.push().translate(x + dx, p.wheelR, zm + dz); wheelX(mb, [0, 0, 0], p.wheelR, 0.38); mb.pop(); }
    if (lod < 2) mb.box('gris_clair', x + s * 0.3 - 0.04, p.wheelR + 0.4, zm - 0.9, x + s * 0.3 + 0.04, yW - 0.3, zm + 0.9);
  }
}

function engine(mb: TMesh, c: V3, r: number, l: number): void {
  const seg = mb.lod === 0 ? 20 : mb.lod === 1 ? 12 : 8;
  mb.push().translate(c[0], c[1], c[2]).rotX(Math.PI / 2);
  // nacelle : y local = axe (vers l'avant +Z monde)
  mb.lathe('blanc', [[r * 0.72, -l / 2], [r * 0.92, -l * 0.3], [r, 0], [r * 1.02, l * 0.3], [r * 0.95, l / 2], [r * 0.86, l / 2 - 0.05]], seg, 45);
  mb.lathe('gris', [[r * 0.72, -l / 2], [r * 0.45, -l / 2 - r * 0.5], [r * 0.05, -l / 2 - r * 0.9]], seg, 45);
  mb.pop();
  disc(mb, 'atlas', [c[0], c[1], c[2] + l / 2 - 0.12], [0, 0, 1], r * 0.86, seg, 'moteur');
  if (mb.lod < 2) disc(mb, 'atlas', [c[0], c[1], c[2] - l / 2 + 0.01], [0, 0, -1], r * 0.72, seg, 'tuyere');
}

const MC: PlaneSpec = { L: 37.6, R: 1.98, belly: 1.75, livery: 'livree_mc', fin: 'derive_mc', span: 35.8, rootChord: 6.4, tipChord: 1.6, sweep: 25, dihedral: 5, wingLE: 3.6, engR: 1.05, engL: 4.6, engF: [0.34], finH: 6.2, finRoot: 6.2, finTip: 2.2, stabSpan: 12.4, mainWheels: 2, wheelR: 0.58 };
const GP: PlaneSpec = { L: 63.7, R: 2.95, belly: 2.4, livery: 'livree_gp', fin: 'derive_gp', span: 60.1, rootChord: 11, tipChord: 2.4, sweep: 31, dihedral: 6, wingLE: 7.5, engR: 1.75, engL: 7.2, engF: [0.32], finH: 9.6, finRoot: 9.5, finTip: 3.4, stabSpan: 21.5, mainWheels: 6, wheelR: 0.66 };
const CG: PlaneSpec = { ...GP, livery: 'livree_cargo', fin: 'derive_cargo' };

/* ------------------------------------------------------------------ */
/* Bâtiments                                                            */
/* ------------------------------------------------------------------ */

/** Façade vitrée (grille de modules `vitrage` m×m) sur une face verticale de a à b (a à gauche vu de l'extérieur). */
function curtain(mb: TMesh, a: [number, number], b: [number, number], y0: number, y1: number, mod = 3.5): void {
  const rowsN = Math.max(1, Math.round((y1 - y0) / mod));
  for (let k = 0; k < rowsN; k++) band(mb, a, b, y0 + ((y1 - y0) * k) / rowsN, y0 + ((y1 - y0) * (k + 1)) / rowsN, 'vitrage', mod * 2);
}

/** Toiture ondulée (le long de X), débords. Dessus bac acier clair, sous-face blanche, rives. */
function waveRoof(mb: TMesh, x0: number, x1: number, z0: number, z1: number, y: number, amp: number, waves: number): void {
  const n = mb.lod === 0 ? 24 : mb.lod === 1 ? 12 : 6;
  const yf = (x: number, z: number): number => y + amp * Math.sin(((x - x0) / (x1 - x0)) * Math.PI * 2 * waves) * 0.5 + amp * 0.5 + (z - z0) / (z1 - z0) * 1.2;
  const top: V3[][] = [], bot: V3[][] = [];
  for (const z of [z0, z1]) {
    const rt: V3[] = [], rb: V3[] = [];
    for (let k = 0; k <= n; k++) { const x = x0 + ((x1 - x0) * k) / n; rt.push([x, yf(x, z) + 0.8, z]); rb.push([x, yf(x, z), z]); }
    top.push(rt); bot.push(rb);
  }
  mb.surface(top, { mat: 'bardage_blanc', smoothAngle: 40, flip: true });
  mb.surface(bot, { mat: 'blanc', smoothAngle: 40 });
  for (let k = 0; k < n; k++) {
    mb.quad('gris_clair', bot[1]![k]!, bot[1]![k + 1]!, top[1]![k + 1]!, top[1]![k]!);
    mb.quad('gris_clair', bot[0]![k + 1]!, bot[0]![k]!, top[0]![k]!, top[0]![k + 1]!);
  }
  for (const [i, s] of [[0, -1], [n, 1]] as [number, number][]) {
    const a = bot[0]![i]!, b = bot[1]![i]!, c = top[1]![i]!, d = top[0]![i]!;
    if (s > 0) mb.quad('gris_clair', a, b, c, d); else mb.quad('gris_clair', b, a, d, c);
  }
}

function aerogare(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const X = 30, Z0 = -14, Z1 = 12, H = 14;
  mb.box('beton_clair', -X, 0, Z0, X, 0.8, Z1, 'ny');
  mb.box('gris_fonce', -X + 0.3, 0.8, Z0 + 0.3, X - 0.3, H, Z1 - 0.3, 'py ny');
  curtain(mb, [-X + 0.3, Z1 - 0.25], [X - 0.3, Z1 - 0.25], 0.8, H, 3.5);
  curtain(mb, [X - 0.3, Z0 + 0.25], [-X + 0.3, Z0 + 0.25], 6, H, 4);
  mb.box('beton_clair', -X + 0.3, 0.8, Z0 - 0.05, X - 0.3, 6, Z0 + 0.4);
  if (lod < 2) for (let x = -X + 6; x < X - 4; x += 12) mb.quad('atlas', [x + 2.4, 0.8, Z0 - 0.08], [x - 2.4, 0.8, Z0 - 0.08], [x - 2.4, 5.2, Z0 - 0.08], [x + 2.4, 5.2, Z0 - 0.08], { region: 'porte_quai' });
  for (const s of [-1, 1]) {
    const x = s * X;
    mb.box('beton_clair', x - (s > 0 ? 1.2 : 0), 0.8, Z0, x + (s < 0 ? 1.2 : 0), H, Z1, 'ny');
    if (lod < 2) for (const y of [2, 7.5]) band(mb, s > 0 ? [x + 0.03, Z1 - 2] : [x - 0.03, Z0 + 2], s > 0 ? [x + 0.03, Z0 + 2] : [x - 0.03, Z1 - 2], y, y + 3, 'bureaux', 4);
  }
  // entrées (sas vitrés en saillie)
  for (const x of [-15, 0, 15]) {
    mb.box('gris_clair', x - 3.2, 0.8, Z1 - 0.3, x + 3.2, 4.4, Z1 + 3);
    if (lod < 2) { band(mb, [x - 3.2, Z1 + 3.03], [x + 3.2, Z1 + 3.03], 0.8, 4.0, 'porte_bus', 1.6); band(mb, [x + 3.23, Z1 + 3], [x + 3.23, Z1 - 0.3], 0.8, 4.0, 'vitrage', 3.3); band(mb, [x - 3.23, Z1 - 0.3], [x - 3.23, Z1 + 3], 0.8, 4.0, 'vitrage', 3.3); }
  }
  // toiture ondulée et auvent côté ville (+Z) sur poteaux arborescents
  waveRoof(mb, -X - 2, X + 2, Z0 - 2, Z1 + 9, H, 2.2, 1.5);
  for (let x = -X + 4; x <= X - 4; x += 13) {
    const base: V3 = [x, 0, Z1 + 6.5];
    mb.tube('blanc', base, [x, H - 3, Z1 + 6.5], [0.45, 0.35], lod === 0 ? 10 : 6, false);
    if (lod < 2) for (const [dx, dz] of [[-2.5, -1.5], [2.5, -1.5], [-2.5, 1.5], [2.5, 1.5]]) mb.tube('blanc', [x, H - 3, Z1 + 6.5], [x + dx!, H + 0.8, Z1 + 6.5 + dz!], 0.18, 6, false);
  }
  mb.quad('decal', [-11, H - 2.3, Z1 + 0.05], [11, H - 2.3, Z1 + 0.05], [11, H + 0.45, Z1 + 0.05], [-11, H + 0.45, Z1 + 0.05], { region: 'ens_aeroport' });
  // bordure de dépose et équipements de toiture
  mb.box('beton_clair', -X, 0, Z1 + 8.5, X, 0.18, Z1 + 9.5);
  if (lod < 2) for (const x of [-18, -6, 6, 18]) { mb.box('gris_clair', x - 2, H + 2.4, -8, x + 2, H + 4, -4); mb.box('atlas', x - 2.01, H + 2.6, -8.01, x + 2.01, H + 3.8, -3.99, 'ny py', { region: 'aeration' }); }
}

function jetee(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const X = 23.8, Z = 8.5, H1 = 4.5, H2 = 10;
  mb.box('bardage', -X, 0, -Z, X, H1, Z, 'ny');
  mb.box('gris_fonce', -X, H1, -Z + 0.3, X, H2, Z - 0.3, 'py');
  curtain(mb, [-X, Z - 0.25], [X, Z - 0.25], H1, H2, 2.75);
  curtain(mb, [X, -Z + 0.25], [-X, -Z + 0.25], H1, H2, 2.75);
  mb.box('beton_clair', -X, H1 - 0.3, -Z - 0.3, X, H1 + 0.2, Z + 0.3);
  for (let x = -X + 4; x < X; x += 8) { mb.quad('atlas', [x - 1.8, 0, Z + 0.03], [x + 1.8, 0, Z + 0.03], [x + 1.8, 3.6, Z + 0.03], [x - 1.8, 3.6, Z + 0.03], { region: 'porte_quai' }); }
  // toiture cintrée
  const n = lod === 0 ? 10 : lod === 1 ? 6 : 3;
  const rows: V3[][] = [];
  for (const x of [-X - 0.6, X + 0.6]) { const r: V3[] = []; for (let k = 0; k <= n; k++) { const t = k / n; r.push([x, H2 + Math.sin(t * Math.PI) * 1.6, -Z - 0.8 + t * (2 * Z + 1.6)]); } rows.push(r); }
  mb.surface(rows, { mat: 'bardage_blanc', smoothAngle: 40, flip: true });
  for (const [x, s] of [[-X - 0.6, -1], [X + 0.6, 1]] as [number, number][]) { const r = rows[s < 0 ? 0 : 1]!; for (let k = 1; k < n; k++) if (s > 0) mb.quad('gris_clair', [x, H2, r[k]![2]], [x, H2, r[k + 1]![2]], r[k + 1]!, r[k]!); else mb.quad('gris_clair', [x, H2, r[k + 1]![2]], [x, H2, r[k]![2]], r[k]!, r[k + 1]!); }
  // pignons et portes de passerelle (côté piste −Z)
  for (const s of [-1, 1]) mb.box('beton_clair', s * X - 0.4, H1, -Z, s * X + 0.4, H2, Z);
  for (const x of [-12, 12]) {
    mb.box('gris_clair', x - 1.8, H1, -Z - 1.6, x + 1.8, H1 + 3.4, -Z);
    if (lod < 2) { mb.quad('atlas', [x + 1.5, H1 + 0.2, -Z - 1.62], [x - 1.5, H1 + 0.2, -Z - 1.62], [x - 1.5, H1 + 3.2, -Z - 1.62], [x + 1.5, H1 + 3.2, -Z - 1.62], { region: 'soufflet' }); beacon(mb, [x, H1 + 3.4, -Z - 1], 'feu_jaune'); }
    mb.box('gris_fonce', x - 0.2, 0, -Z - 3, x + 0.2, 3.5, -Z - 2.6);
    mb.box('atlas', x - 1.4, 3.5, -Z - 3.05, x + 1.4, 4.2, -Z - 2.95, '', { nz: { region: 'panneau_taxi' }, pz: { region: 'panneau_taxi' } });
  }
  if (lod === 0) for (let x = -X + 4; x < X; x += 8) mb.tube('gris', [x, 0, -Z - 0.15], [x, H1, -Z - 0.15], 0.08, 6, false);
}

function tour(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  // bâtiment de base
  mb.box('beton_clair', -9, 0, -7, 9, 8, 7, 'ny');
  mb.box('gris_fonce', -9.2, 8, -7.2, 9.2, 8.6, 7.2);
  if (lod < 2) for (const y of [1, 4.6]) bandsBox(mb, -9, -7, 9, 7, y, y + 2.5, 'bureaux', 4.5);
  mb.box('verre', -2, 0, 7, 2, 3, 7.06);
  // fût
  const seg = lod === 0 ? 16 : lod === 1 ? 10 : 8;
  mb.lathe('beton_clair', [[3.6, 8.6], [3.0, 20], [3.0, 44]], seg, 30);
  if (lod < 2) for (let y = 12; y < 42; y += 6) for (const a of [0, Math.PI]) mb.box('verre', Math.cos(a) * 3.02 - 0.3, y, -Math.sin(a) * 3.02 - 0.4, Math.cos(a) * 3.02 + 0.3, y + 3.5, -Math.sin(a) * 3.02 + 0.4);
  // vigie : étage technique, vitrage incliné, toiture
  mb.lathe('blanc', [[3.0, 44], [6.2, 46.2], [6.2, 48]], seg, 20);
  const rows: V3[][] = [];
  for (const [r, y] of [[6.0, 48], [7.0, 52.2]] as [number, number][]) { const row: V3[] = []; for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI * 2; row.push([Math.cos(a) * r, y, -Math.sin(a) * r]); } rows.push(row); }
  mb.surface(rows, { mat: 'atlas', region: 'vitrage_tour', uv: (i, j) => [j % 2, 1 - i], smoothAngle: 5, autoOrient: true });
  mb.lathe('gris_fonce', [[7.0, 52.2], [7.6, 52.4], [7.6, 53.1], [2.5, 53.6], [0.001, 53.6]], 12, 15);
  if (lod < 2) {
    mb.lathe('gris', [[6.2, 47.6], [7.3, 47.6], [7.3, 47.9], [6.2, 47.9]], 12, 5);
    for (let k = 0; k < 12; k++) { const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2; railing(mb, [Math.cos(a0) * 7.3, 47.9, -Math.sin(a0) * 7.3], [Math.cos(a1) * 7.3, 47.9, -Math.sin(a1) * 7.3]); }
  }
  // radôme, antennes
  mb.push().translate(-2.5, 53.6, 0);
  mb.lathe('blanc', [[0.6, 0], [0.6, 0.8], [1.1, 1.2], [1.2, 1.9], [0.8, 2.6], [0.001, 2.8]], lod === 0 ? 12 : 8, 50);
  mb.pop();
  mb.tube('gris_clair', [2, 53.6, 0], [2, 59, 0], [0.12, 0.05], 6, true);
  beacon(mb, [2, 59, 0], 'feu_rouge');
  if (lod < 2) { mb.beam('gris_clair', [1, 57, 0], [3, 57, 0], 0.08); mb.tube('gris_clair', [0, 53.6, 2.5], [0, 56, 2.5], 0.06, 4, true); }
}

function hangar(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const X = 38, Z0 = -26, Z1 = 28, He = 16, Hr = 24;
  // murs latéraux et arrière
  mb.box('beton_clair', -X, 0, Z0, X, 1, Z1, 'ny');
  for (const s of [-1, 1]) mb.box('bardage', s > 0 ? X - 0.4 : -X, 1, Z0, s > 0 ? X : -X + 0.4, He, Z1);
  mb.box('bardage', -X, 1, Z0, X, He, Z0 + 0.4);
  // toiture en arc (génératrice le long de Z)
  const n = lod === 0 ? 20 : lod === 1 ? 10 : 5;
  const arc = (k: number): [number, number] => { const t = k / n; return [-X - 0.8 + t * (2 * X + 1.6), He + Math.sin(t * Math.PI) * (Hr - He)]; };
  const rowsT: V3[][] = [Z0 - 0.8, Z1 + 0.8].map((z) => Array.from({ length: n + 1 }, (_, k) => { const [x, y] = arc(k); return [x, y, z] as V3; }));
  mb.surface(rowsT, { mat: 'bardage_gris', smoothAngle: 35 });
  // pignon arrière et tympan avant
  for (const [z, s] of [[Z0, -1], [Z1, 1]] as [number, number][]) for (let k = 0; k < n; k++) {
    const [xa, ya] = arc(k), [xb, yb] = arc(k + 1);
    if (s > 0) mb.quad(z > 0 ? 'bardage_bleu' : 'bardage', [xa, He, z], [xb, He, z], [xb, yb, z], [xa, ya, z]); else mb.quad('bardage', [xb, He, z], [xa, He, z], [xa, ya, z], [xb, yb, z]);
  }
  // linteau et portes coulissantes (8 vantaux)
  mb.box('bardage_bleu', -X, He - 1.6, Z1 - 0.6, X, He, Z1);
  for (let k = 0; k < 8; k++) {
    const x0 = -X + 0.4 + k * ((2 * X - 0.8) / 8), x1 = x0 + (2 * X - 0.8) / 8;
    const dz = k % 2 ? 0.25 : 0.5;
    mb.box('gris', x0, 0, Z1 - 0.6 + dz - 0.2, x1, He - 1.6, Z1 - 0.6 + dz, 'ny');
    mb.quad('atlas', [x0, 0, Z1 - 0.6 + dz + 0.01], [x1, 0, Z1 - 0.6 + dz + 0.01], [x1, He - 1.6, Z1 - 0.6 + dz + 0.01], [x0, He - 1.6, Z1 - 0.6 + dz + 0.01], { region: 'hangar_porte' });
  }
  mb.box('gris_fonce', -X, 0, Z1, X, 0.05, Z1 + 0.6, 'ny');
  mb.quad('decal', [-14, He + 1.2, Z1 + 0.04], [14, He + 1.2, Z1 + 0.04], [14, He + 4.7, Z1 + 0.04], [-14, He + 4.7, Z1 + 0.04], { region: 'ens_maintenance' });
  // lanterneau de faîtage, annexe d'ateliers à l'arrière
  if (lod < 2) for (let z = Z0 + 4; z < Z1 - 4; z += 10) mb.box('verre', -3, Hr + 0.02, z, 3, Hr + 0.5, z + 6);
  mb.box('beton_clair', -X + 4, 0, Z0 - 7, X - 4, 7.5, Z0, 'ny');
  mb.box('gris_fonce', -X + 3.8, 7.5, Z0 - 7.2, X - 3.8, 8, Z0 + 0.1);
  if (lod < 2) for (const y of [1, 4.4]) band(mb, [X - 4, Z0 - 7.03], [-X + 4, Z0 - 7.03], y, y + 2.4, 'bureaux', 4.5);
  if (lod === 0) for (let z = Z0 + 6; z < Z1; z += 12) for (const s of [-1, 1]) mb.tube('gris', [s * (X + 0.2), 0.2, z], [s * (X + 0.2), He, z], 0.12, 6, false);
  lightMast(mb, X - 2, Z1 + 2.5, 18, 3);
}

/* ------------------------------------------------------------------ */
/* Modules au sol                                                       */
/* ------------------------------------------------------------------ */
function flat(mb: TMesh, mat: MatKey, x0: number, z0: number, x1: number, z1: number, y = 0): void { mb.box(mat, x0, y - 0.4, z0, x1, y, z1, 'ny'); }
/** Marque peinte au sol (decal) : rectangle [x0,x1]×[z0,z1]. */
function paint(mb: TMesh, x0: number, z0: number, x1: number, z1: number, region: RegionName, y = 0.015): void {
  mb.quad('decal', [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], { region });
}
function runwayBase(mb: TMesh): void {
  flat(mb, 'asphalte', -30, -22.5, 30, 22.5);
  flat(mb, 'beton', -30, -30, 30, -22.5, -0.03); flat(mb, 'beton', -30, 22.5, 30, 30, -0.03);
  for (const s of [-1, 1]) paint(mb, -30, s * 21.6 - 0.45, 30, s * 21.6 + 0.45, 'marque_blanche');
  for (const x of [-15, 15]) for (const s of [-1, 1]) beacon(mb, [x, 0, s * 23.6], 'feu_blanc', 0.18, 0.4);
}
function pisteSection(m: TModel): void {
  const mb = m.mb;
  runwayBase(mb);
  paint(mb, -15, -0.45, 15, 0.45, 'marque_blanche');
  if (mb.lod === 0) for (const x of [-22.5, -7.5, 7.5, 22.5]) mb.box('atlas', x - 0.2, 0, -0.2, x + 0.2, 0.05, 0.2, 'ny', { py: { region: 'feu_blanc' } });
}
function pisteSeuil(m: TModel): void {
  const mb = m.mb;
  runwayBase(mb);
  // barres de seuil (« touches de piano »)
  for (let k = 0; k < 8; k++) for (const s of [-1, 1]) { const z0 = s * (1.8 + k * 2.45); paint(mb, -26, Math.min(z0, z0 + s * 1.8), 4, Math.max(z0, z0 + s * 1.8), 'marque_blanche'); }
  // indicatif de piste « 09 » (lisible en approche depuis −X)
  mb.quad('decal', [8, 0.016, -6], [8, 0.016, 6], [26, 0.016, 6], [26, 0.016, -6], { region: 'num_09' });
  paint(mb, -29, -22.5, -27.5, 22.5, 'marque_blanche');
  for (let z = -21; z <= 21; z += 3) beacon(mb, [-29.6, 0, z], 'feu_vert', 0.15, 0.3);
  if (mb.lod < 2) for (const s of [-1, 1]) { mb.box('gris_fonce', -28, 0, s * 33 - 0.6, -20, 0.9, s * 33 + 0.6); for (let k = 0; k < 4; k++) mb.box('atlas', -27.5 + k * 2, 0.9, s * 33 - 0.35, -26.5 + k * 2, 1.4, s * 33 + 0.35, 'ny', { region: 'feu_blanc' }); }
}
function pisteToucher(m: TModel): void {
  const mb = m.mb;
  runwayBase(mb);
  paint(mb, -15, -0.45, 15, 0.45, 'marque_blanche');
  for (const s of [-1, 1]) {
    paint(mb, -22.5, s * 6 - (s > 0 ? 0 : 9), 22.5, s * 6 + (s > 0 ? 9 : 0), 'marque_blanche');
    for (const z of [16, 18.7]) paint(mb, -28, s * z - 0.9, -6, s * z + 0.9, 'marque_blanche');
  }
}
function taxiDroit(m: TModel): void {
  const mb = m.mb;
  flat(mb, 'asphalte', -15, -11.5, 15, 11.5);
  flat(mb, 'beton', -15, -15, 15, -11.5, -0.03); flat(mb, 'beton', -15, 11.5, 15, 15, -0.03);
  paint(mb, -15, -0.08, 15, 0.08, 'marque_jaune');
  for (const s of [-1, 1]) for (const d of [10.7, 11.1]) paint(mb, -15, s * d - 0.08, 15, s * d + 0.08, 'marque_jaune');
  for (const x of [-7.5, 7.5]) for (const s of [-1, 1]) beacon(mb, [x, 0, s * 12.3], 'feu_bleu', 0.15, 0.35);
  if (mb.lod === 0) for (const x of [-11, 0, 11]) mb.box('atlas', x - 0.15, 0, -0.15, x + 0.15, 0.04, 0.15, 'ny', { py: { region: 'feu_vert' } });
  if (mb.lod < 2) { mb.box('gris_fonce', 9, 0, 13.2, 9.2, 0.6, 13.4); mb.box('gris_fonce', 12, 0, 13.2, 12.2, 0.6, 13.4); mb.box('atlas', 8.7, 0.6, 13, 12.5, 1.6, 13.6, '', { nz: { region: 'panneau_taxi' }, pz: { region: 'panneau_taxi' } }); }
}
function taxiVirage(m: TModel): void {
  const mb = m.mb;
  flat(mb, 'asphalte', -15, -15, 15, 15);
  // axe en arc (centre (−15, −15), rayon 15) de l'entrée ouest à la sortie sud
  const n = mb.lod === 0 ? 12 : 6;
  const pt = (a: number, r: number): [number, number] => [-15 + Math.cos(a) * r, -15 + Math.sin(a) * r];
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * (Math.PI / 2), a1 = ((k + 1) / n) * (Math.PI / 2);
    for (const [r, w] of [[15, 0.08], [26.1, 0.08], [26.5, 0.08], [4.3, 0.08], [3.9, 0.08]] as [number, number][]) {
      const [x0, z0] = pt(a0, r - w), [x1, z1] = pt(a1, r - w), [x2, z2] = pt(a1, r + w), [x3, z3] = pt(a0, r + w);
      const clip = (v: number): number => Math.max(-15, Math.min(15, v));
      mb.quad('decal', [clip(x0), 0.015, clip(z0)], [clip(x3), 0.015, clip(z3)], [clip(x2), 0.015, clip(z2)], [clip(x1), 0.015, clip(z1)], { region: 'marque_jaune' });
    }
  }
  for (let k = 1; k < 6; k++) { const [x, z] = pt((k / 6) * (Math.PI / 2), 27.5); if (Math.abs(x) < 14.8 && Math.abs(z) < 14.8) beacon(mb, [x, 0, z], 'feu_bleu', 0.15, 0.35); }
  for (let k = 0; k <= 4; k++) { const [x, z] = pt((k / 4) * (Math.PI / 2), 3); if (x > -14.8 && z > -14.8) beacon(mb, [x, 0, z], 'feu_bleu', 0.15, 0.35); }
}
function aireStationnement(m: TModel): void {
  const mb = m.mb;
  flat(mb, 'beton', -30, -30, 30, 30);
  if (mb.lod < 2) for (let k = -25; k <= 25; k += 5) { mb.quad('atlas', [k - 0.03, 0.005, 30], [k + 0.03, 0.005, 30], [k + 0.03, 0.005, -30], [k - 0.03, 0.005, -30], { region: 'noir' }); mb.quad('atlas', [-30, 0.005, k + 0.03], [30, 0.005, k + 0.03], [30, 0.005, k - 0.03], [-30, 0.005, k - 0.03], { region: 'noir' }); }
  paint(mb, -0.1, -18, 0.1, 30, 'marque_jaune');
  paint(mb, -3, -18.2, 3, -17.8, 'marque_jaune');
  for (const s of [-1, 1]) { paint(mb, s * 28 - 0.12, -28, s * 28 + 0.12, 28, 'marque_rouge'); paint(mb, -28, s * 28 - 0.12, 28, s * 28 + 0.12, 'marque_rouge'); }
  for (let k = 0; k < 6; k++) paint(mb, 18 + k * 1.6, -27, 18.8 + k * 1.6, -21, 'marque_blanche');
  if (mb.lod < 2) { mb.box('gris_fonce', -0.15, 0, -24, 0.15, 3, -23.7); mb.box('atlas', -1.5, 3, -24.05, 1.5, 4.2, -23.65, '', { pz: { region: 'panneau_taxi' }, nz: { region: 'panneau_taxi' } }); }
  lightMast(mb, -27, -27, 22, 4);
}

/* ------------------------------------------------------------------ */
/* Passerelle d'embarquement                                            */
/* ------------------------------------------------------------------ */
function passerelle(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const seg = lod === 0 ? 16 : 8;
  mb.tube('gris_clair', [0, 0, 0], [0, 4.2, 0], 0.9, seg, true);
  mb.lathe('blanc', [[2.4, 4.2], [2.4, 7.6], [2.2, 7.9], [0.001, 7.9]], seg, 30);
  if (lod < 2) for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; mb.box('verre', Math.cos(a) * 2.42 - 0.5, 5.2, -Math.sin(a) * 2.42 - 0.5, Math.cos(a) * 2.42 + 0.5, 6.8, -Math.sin(a) * 2.42 + 0.5); }
  const tu = m.node('tunnel', m.root, [0, 4.6, 0], { kind: 'rotate', axis: 'y', min: -50, max: 50, note: 'orientation du tunnel autour de la rotonde (degrés)' });
  const t = tu.mesh;
  t.box('gris_clair', -1.4, 0, 2.2, 1.4, 2.8, 15);
  if (t.lod < 2) { band(t, [1.43, 15], [1.43, 2.2], 0.9, 2.2, 'passerelle_vitre', 3.2); band(t, [-1.43, 2.2], [-1.43, 15], 0.9, 2.2, 'passerelle_vitre', 3.2); }
  const ex = m.node('tunnel_ext', tu, [0, 0, 0], { kind: 'translate', axis: 'z', min: 0, max: 9, note: 'extension télescopique (m)' });
  const e = ex.mesh;
  e.box('blanc', -1.6, -0.15, 13.5, 1.6, 3.0, 25);
  if (e.lod < 2) { band(e, [1.63, 25], [1.63, 13.5], 0.9, 2.3, 'passerelle_vitre', 3.6); band(e, [-1.63, 13.5], [-1.63, 25], 0.9, 2.3, 'passerelle_vitre', 3.6); }
  // colonne motrice (vérins, bogie)
  for (const s of [-1, 1]) e.tube('gris', [s * 1.1, -0.15, 21], [s * 1.1, -3.6, 21], 0.22, lod === 0 ? 8 : 5, false);
  e.box('gris_fonce', -1.7, -4.0, 20.2, 1.7, -3.4, 21.8);
  if (e.lod < 2) for (const s of [-1, 1]) { e.push().translate(s * 1.25, -4.05, 21).rotY(Math.PI / 2); wheelX(e, [0, 0, 0], 0.55, 0.4); e.pop(); }
  else e.box('noir', -1.5, -4.6, 20.5, 1.5, -4.0, 21.5);
  e.box('atlas', -0.3, -3.4, 20.6, 0.3, -2.9, 21.4, 'ny', { region: 'gyro' });
  const cb = m.node('cabine', ex, [0, 0, 25], { kind: 'rotate', axis: 'y', min: -90, max: 90, note: 'orientation de la cabine vers la porte de l’avion (degrés)' });
  const c = cb.mesh;
  c.box('blanc', -2.0, -0.3, 0, 2.0, 3.2, 3.2);
  c.box('atlas', -1.9, -0.2, 3.2, 1.9, 3.1, 4.0, 'ny', { pz: { region: 'soufflet' }, px: { region: 'soufflet' }, nx: { region: 'soufflet' }, py: { region: 'soufflet' } });
  c.box('gris_clair', -2.2, 3.2, -0.2, 2.2, 3.45, 4.2);
  if (c.lod < 2) { band(c, [2.03, 3], [2.03, 0.4], 1, 2.4, 'passerelle_vitre', 2.6); band(c, [-2.03, 0.4], [-2.03, 3], 1, 2.4, 'passerelle_vitre', 2.6); railing(c, [2.1, -0.3, 0.2], [3.2, -2.4, 0.2]); }
  beacon(c, [1.7, 3.45, 1], 'feu_jaune');
}

/* ------------------------------------------------------------------ */
/* Véhicules de piste                                                   */
/* ------------------------------------------------------------------ */
function axles(mb: TMesh, zs: number[], halfW: number, r: number, w = 0.32): void {
  for (const z of zs) for (const s of [-1, 1]) { mb.push().translate(s * halfW, r, z); wheelX(mb, [0, 0, 0], r, w); mb.pop(); }
}
function lightsFront(mb: TMesh, z: number, y: number, halfW: number): void {
  if (mb.lod >= 2) return;
  for (const s of [-1, 1]) mb.quad('atlas', [s * halfW - (s > 0 ? 0.35 : 0) , y, z], [s * halfW + (s > 0 ? 0 : 0.35), y, z], [s * halfW + (s > 0 ? 0 : 0.35), y + 0.22, z], [s * halfW - (s > 0 ? 0.35 : 0), y + 0.22, z], { region: 'phare' });
}
function lightsRear(mb: TMesh, z: number, y: number, halfW: number): void {
  if (mb.lod >= 2) return;
  for (const s of [-1, 1]) mb.quad('atlas', [s * halfW + (s > 0 ? 0 : 0.3), y, z], [s * halfW - (s > 0 ? 0.3 : 0), y, z], [s * halfW - (s > 0 ? 0.3 : 0), y + 0.2, z], [s * halfW + (s > 0 ? 0 : 0.3), y + 0.2, z], { region: 'feu_arriere' });
}

function pushback(m: TModel): void {
  const mb = m.mb;
  axles(mb, [-1.8, 1.8], 1.15, 0.55, 0.42);
  mb.box('jaune', -1.45, 0.45, -3.0, 1.45, 1.3, 3.0);
  mb.box('gris_fonce', -1.5, 0.35, -3.1, 1.5, 0.5, 3.1);
  mb.box('atlas', -1.46, 0.5, 2.98, 1.46, 0.95, 3.02, 'ny py', { pz: { region: 'hachures' }, nz: { region: 'hachures' } });
  // cabine basse décalée
  mb.box('jaune', 0.1, 1.3, -1.6, 1.4, 2.25, 0.4);
  bandsBox(mb, 0.1, -1.6, 1.4, 0.4, 1.4, 2.15, 'fenetres_bus', 1.4, 'pz px nz nx');
  mb.box('gris_fonce', 0.05, 2.25, -1.65, 1.45, 2.32, 0.45);
  beacon(mb, [0.75, 2.32, -0.6], 'gyro', 0.12, 0.18);
  mb.box('gris_fonce', -0.3, 0.6, 3.0, 0.3, 0.9, 3.7);
  lightsFront(mb, 3.03, 0.95, 1.4); lightsRear(mb, -3.03, 0.95, 1.4);
  if (mb.lod === 0) for (const s of [-1, 1]) mb.box('noir', s * 1.45 - 0.05, 0.35, -2.6, s * 1.45 + 0.05, 1.2, -0.9);
}

function avitailleur(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  axles(mb, [3.1, -1.8, -3.2], 1.0, 0.5, 0.35);
  mb.box('gris_fonce', -0.9, 0.5, -4.7, 0.9, 0.95, 4.2);
  // cabine avancée
  mb.box('blanc', -1.25, 0.85, 3.0, 1.25, 2.95, 4.9);
  bandsBox(mb, -1.25, 3.4, 1.25, 4.9, 1.9, 2.75, 'fenetres_bus', 2.5, 'pz px nx');
  mb.quad('atlas', [-0.7, 1.0, 4.92], [0.7, 1.0, 4.92], [0.7, 1.6, 4.92], [-0.7, 1.6, 4.92], { region: 'calandre' });
  lightsFront(mb, 4.93, 1.05, 1.2);
  beacon(mb, [0, 2.95, 4], 'gyro', 0.14, 0.2);
  // citerne (section elliptique)
  mb.push().translate(0, 2.05, -0.8).scale(1.2, 1.05, 1).rotX(Math.PI / 2);
  mb.lathe('blanc', [[0.001, -3.9], [0.7, -3.85], [1, -3.6], [1, 3.4], [0.7, 3.65], [0.001, 3.7]], lod === 0 ? 18 : 10, 40);
  mb.pop();
  for (const s of [1, -1]) {
    const x = s * 1.22;
    if (s > 0) mb.quad('decal', [x, 1.75, 1.8], [x, 1.75, -3.6], [x, 2.35, -3.6], [x, 2.35, 1.8], { region: 'texte_jet' });
    else mb.quad('decal', [x, 1.75, -3.6], [x, 1.75, 1.8], [x, 2.35, 1.8], [x, 2.35, -3.6], { region: 'texte_jet' });
  }
  if (lod < 2) { railing(mb, [-0.6, 3.05, 2.6], [-0.6, 3.05, -4.2], 0.55); railing(mb, [0.6, 3.05, -4.2], [0.6, 3.05, 2.6], 0.55); }
  // armoire de distribution arrière + enrouleurs
  mb.box('gris_clair', -1.2, 0.95, -5.0, 1.2, 2.4, -4.5);
  if (lod < 2) for (const s of [-1, 1]) { mb.push().translate(s * 0.55, 1.7, -5.05); mb.tube('noir', [0, 0, 0], [0, 0, -0.35], 0.45, 10, true); mb.pop(); }
  lightsRear(mb, -5.03, 1.0, 1.15);
  if (lod < 2) mb.box('atlas', -1.21, 0.6, -4.7, 1.21, 0.9, 4.2, 'py ny pz nz', { region: 'bande_rr' });
}

function busPiste(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  const L = 13.6, W = 3.0, H = 3.05;
  axles(mb, [L / 2 - 2.4, -L / 2 + 3.0], W / 2 - 0.25, 0.45, 0.3);
  mb.box('blanc', -W / 2, 0.35, -L / 2, W / 2, H, L / 2);
  mb.box('gris_clair', -W / 2 + 0.2, H, -L / 2 + 1, W / 2 - 0.2, H + 0.25, -L / 2 + 3.5);
  // vitrages : bandeau continu, portes côté droit (−X), pare-brise
  band(mb, [W / 2 + 0.02, L / 2 - 0.4], [W / 2 + 0.02, -L / 2 + 0.4], 1.0, 2.75, 'fenetres_bus', 2.6);
  band(mb, [-W / 2 - 0.03, -L / 2 + 0.4], [-W / 2 - 0.03, L / 2 - 0.4], 1.0, 2.75, 'fenetres_bus', 2.6);
  for (const z of [-4.2, 0, 4.2]) mb.quad('atlas', [-W / 2 - 0.04, 0.35, z - 0.9], [-W / 2 - 0.04, 0.35, z + 0.9], [-W / 2 - 0.04, 2.8, z + 0.9], [-W / 2 - 0.04, 2.8, z - 0.9], { region: 'porte_bus' });
  mb.quad('atlas', [-W / 2 + 0.15, 1.0, L / 2 + 0.02], [W / 2 - 0.15, 1.0, L / 2 + 0.02], [W / 2 - 0.15, 2.8, L / 2 + 0.02], [-W / 2 + 0.15, 2.8, L / 2 + 0.02], { region: 'fenetres_bus', rect: [0.02, 0, 0.3, 1] });
  mb.quad('decal', [W / 2 + 0.04, 0.55, 3.5], [W / 2 + 0.04, 0.55, -3.5], [W / 2 + 0.04, 0.98, -3.5], [W / 2 + 0.04, 0.98, 3.5], { region: 'texte_bus' });
  lightsFront(mb, L / 2 + 0.03, 0.55, W / 2 - 0.1); lightsRear(mb, -L / 2 - 0.03, 0.6, W / 2 - 0.1);
  beacon(mb, [0, H + 0.25, -L / 2 + 2], 'gyro', 0.14, 0.2);
  if (lod < 2) mb.box('atlas', -W / 2 - 0.01, 0.35, -L / 2, W / 2 + 0.01, 0.5, L / 2, 'py ny', { region: 'bande_rr' });
}

function trainBagages(m: TModel): void {
  const mb = m.mb, lod = mb.lod;
  // tracteur
  axles(mb, [5.6, 4.0], 0.65, 0.35, 0.25);
  mb.box('blanc', -0.8, 0.35, 3.4, 0.8, 1.1, 6.3);
  mb.box('gris_fonce', -0.75, 1.1, 3.6, 0.75, 2.1, 4.8);
  if (lod < 2) bandsBox(mb, -0.75, 3.6, 0.75, 4.8, 1.2, 2.0, 'fenetres_bus', 1.5, 'pz px nx');
  mb.box('blanc', -0.8, 2.1, 3.5, 0.8, 2.18, 4.9);
  beacon(mb, [0, 2.18, 4.2], 'gyro', 0.1, 0.15);
  lightsFront(mb, 6.32, 0.75, 0.75);
  // 3 chariots avec bagages
  for (let k = 0; k < 3; k++) {
    const z = 1.6 - k * 3.4;
    axles(mb, [z + 0.9, z - 0.9], 0.62, 0.22, 0.16);
    mb.box('gris', -0.8, 0.42, z - 1.3, 0.8, 0.55, z + 1.3);
    mb.beam('gris_fonce', [0, 0.45, z + 1.3], [0, 0.45, z + 1.9], 0.08);
    // conteneur bagages (bâché) ou bagages en vrac
    if (k < 2) {
      mb.box('gris_clair', -0.75, 0.55, z - 1.2, 0.75, 2.1, z + 1.2);
      if (lod < 2) { mb.quad('atlas', [0.76, 0.6, z + 1.0], [0.76, 0.6, z - 1.0], [0.76, 2.0, z - 1.0], [0.76, 2.0, z + 1.0], { region: 'porte_quai' }); mb.box('gris', -0.78, 2.1, z - 1.22, 0.78, 2.15, z + 1.22); }
    } else {
      const cols: MatKey[] = ['bleu', 'noir', 'rouge', 'gris_fonce', 'vert_pont', 'orange'];
      for (let b = 0; b < 6; b++) mb.box(cols[b]!, -0.65 + (b % 2) * 0.68, 0.55 + Math.floor(b / 4) * 0.45, z - 1.1 + (b % 3) * 0.75, -0.05 + (b % 2) * 0.68, 0.95 + Math.floor(b / 4) * 0.45, z - 0.5 + (b % 3) * 0.75);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Registre                                                             */
/* ------------------------------------------------------------------ */
const v = (o: Partial<Record<MatKey, string>>, id: string, nameFr: string): NonNullable<TransportDef['variants']>[number] => ({ id, nameFr, overrides: o });
const ground = (id: string, nameFr: string, build: (m: TModel) => void, kind: string, tags: string[] = []): TransportDef => ({ id, nameFr, group: 'aeroport', category: 'prop', kind, lodDistances: [300, 1000], build, origin: 'niveau', tags: ['module', 'niveau:sol_y0', 'axe:x', ...tags] });

export const AIRPORT_DEFS: TransportDef[] = [
  { id: 'aero_avion_moyen_courrier', nameFr: 'Avion de ligne moyen-courrier (AUBE AIR)', group: 'aeroport', category: 'prop', kind: 'avion', lodDistances: [250, 900], build: (m) => airplane(m, MC), tags: ['passagers', 'places:180'],
    variants: [v({ livree: '#7a1f3d' }, 'bordeaux', 'Ailettes bordeaux')] },
  { id: 'aero_avion_gros_porteur', nameFr: 'Avion gros porteur long-courrier (AUBE AIR)', group: 'aeroport', category: 'prop', kind: 'avion', lodDistances: [350, 1200], build: (m) => airplane(m, GP), tags: ['passagers', 'places:330'] },
  { id: 'aero_avion_cargo', nameFr: 'Avion cargo (AUBE CARGO)', group: 'aeroport', category: 'prop', kind: 'avion', lodDistances: [350, 1200], build: (m) => airplane(m, CG), tags: ['fret', 'charge_t:100'] },
  { id: 'aero_aerogare_hall', nameFr: 'Aérogare — hall principal (module)', group: 'aeroport', category: 'public', kind: 'terminal', lodDistances: [300, 1000], build: aerogare,
    footprint: { tilesX: 8, tilesZ: 5 }, cost: 2400000, upkeepPerMonth: 14000, capacity: { residents: 0, jobs: 260 },
    frontage: [{ x: 0, z: 20, nx: 0, nz: 1, kind: 'pedestrian' }, { x: -20, z: 20, nx: 0, nz: 1, kind: 'vehicle' }], tags: ['module'] },
  { id: 'aero_aerogare_jetee', nameFr: 'Aérogare — jetée d’embarquement (module)', group: 'aeroport', category: 'public', kind: 'terminal', lodDistances: [300, 1000], build: jetee,
    footprint: { tilesX: 6, tilesZ: 3 }, cost: 900000, upkeepPerMonth: 5200, capacity: { residents: 0, jobs: 60 }, frontage: [{ x: 0, z: 9, nx: 0, nz: 1, kind: 'delivery' }], tags: ['module', 'portes:2'] },
  { id: 'aero_tour_controle', nameFr: 'Tour de contrôle', group: 'aeroport', category: 'public', kind: 'tour_controle', lodDistances: [400, 1400], build: tour,
    footprint: { tilesX: 3, tilesZ: 2 }, cost: 1200000, upkeepPerMonth: 6000, capacity: { residents: 0, jobs: 40 }, frontage: [{ x: 0, z: 8, nx: 0, nz: 1, kind: 'pedestrian' }] },
  { id: 'aero_hangar', nameFr: 'Hangar de maintenance', group: 'aeroport', category: 'industrial', kind: 'hangar', lodDistances: [300, 1000], build: hangar,
    footprint: { tilesX: 10, tilesZ: 8 }, cost: 1600000, upkeepPerMonth: 7000, capacity: { residents: 0, jobs: 120 }, frontage: [{ x: 0, z: 32, nx: 0, nz: 1, kind: 'delivery' }],
    variants: [v({ bardage_bleu: '#a33a2c' }, 'rouge', 'Linteau rouge'), v({ bardage: '#e6e5df', bardage_gris: '#9aa0a6' }, 'clair', 'Bardage clair')] },
  ground('aero_piste_section', 'Piste — section courante (60 m)', pisteSection, 'piste'),
  ground('aero_piste_seuil', 'Piste — seuil 09 (60 m)', pisteSeuil, 'piste', ['seuil']),
  ground('aero_piste_toucher', 'Piste — zone de toucher (60 m)', pisteToucher, 'piste'),
  ground('aero_taxiway_droit', 'Voie de circulation — droite (30 m)', taxiDroit, 'taxiway'),
  ground('aero_taxiway_virage', 'Voie de circulation — virage 90°', taxiVirage, 'taxiway'),
  ground('aero_aire_stationnement', 'Aire de stationnement avion (60 m)', aireStationnement, 'aire'),
  { id: 'aero_passerelle', nameFr: 'Passerelle d’embarquement', group: 'aeroport', category: 'prop', kind: 'passerelle', lodDistances: [200, 700], build: passerelle },
  { id: 'aero_tracteur_pushback', nameFr: 'Tracteur de repoussage', group: 'aeroport', category: 'vehicle', kind: 'vehicule_piste', lodDistances: [90, 320], build: pushback, vehicle: { kind: 'service', maxSpeedKmh: 25 } },
  { id: 'aero_avitailleur', nameFr: 'Camion avitailleur', group: 'aeroport', category: 'vehicle', kind: 'vehicule_piste', lodDistances: [90, 320], build: avitailleur, vehicle: { kind: 'truck', maxSpeedKmh: 40 } },
  { id: 'aero_bus_piste', nameFr: 'Bus de piste', group: 'aeroport', category: 'vehicle', kind: 'vehicule_piste', lodDistances: [90, 320], build: busPiste, vehicle: { kind: 'bus', maxSpeedKmh: 40 },
    variants: [v({ blanc: '#e0a321' }, 'jaune', 'Carrosserie jaune')] },
  { id: 'aero_train_bagages', nameFr: 'Train de bagages', group: 'aeroport', category: 'vehicle', kind: 'vehicule_piste', lodDistances: [90, 320], build: trainBagages, vehicle: { kind: 'service', maxSpeedKmh: 25 } },
];
void lerp3;

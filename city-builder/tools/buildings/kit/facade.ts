/**
 * Kit bâtiments — FAÇADES : murs percés, fenêtres (tableaux, dormants, petits bois, appuis, encadrements,
 * volets battants / roulants, balconnets), portes (panneaux, imposte, emmarchement, marquise), portes de garage,
 * vitrines de commerce (enseigne, store banne), loggias, balcons et garde-corps, bandeaux, corniches,
 * soubassements, chaînages d'angle, descentes d'eaux pluviales.
 *
 * Repère de façade (Frame) : origine `o` en bas à gauche VU DE L'EXTÉRIEUR, `u` horizontal vers la droite,
 * v vers le haut (+Y), d = profondeur le long de la normale sortante `n` (d > 0 : en saillie, d < 0 : en retrait).
 * (u, v, d) est un repère direct : les ordres de sommets anti-horaires y restent anti-horaires dans le modèle.
 *
 * Niveaux de détail : toutes les fonctions lisent `ctx.lod`
 *   LOD0 : modélisation complète ; LOD1 : sans petits bois, encadrements, ferronneries fines ;
 *   LOD2 : mur plein, baies en aplats légèrement saillants (verre, volets, portes) — pour la vue lointaine.
 */
import { madd, type MeshBuilder, type V3 } from './mesh';

export interface Ctx {
  mb: MeshBuilder;
  lod: 0 | 1 | 2;
  /** Aléatoire déterministe (même suite pour les trois LOD d'un bâtiment). */
  r: () => number;
}

export interface Frame { o: V3; u: V3; n: V3; w: number; h: number }
export interface Rect { u0: number; u1: number; v0: number; v1: number }

export type Side = 'S' | 'E' | 'N' | 'W';

/** Point du repère de façade -> point local du maillage. */
export function P(f: Frame, u: number, v: number, d: number): V3 {
  return [f.o[0] + f.u[0] * u + f.n[0] * d, f.o[1] + v, f.o[2] + f.u[2] * u + f.n[2] * d];
}

/**
 * Façade d'un pavé [x0,x1]×[y0,y1]×[z0,z1] : S = +Z (façade principale, côté rue), E = +X, N = -Z, W = -X.
 */
export function sideFrame(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, side: Side): Frame {
  switch (side) {
    case 'S': return { o: [x0, y0, z1], u: [1, 0, 0], n: [0, 0, 1], w: x1 - x0, h: y1 - y0 };
    case 'E': return { o: [x1, y0, z1], u: [0, 0, -1], n: [1, 0, 0], w: z1 - z0, h: y1 - y0 };
    case 'N': return { o: [x1, y0, z0], u: [-1, 0, 0], n: [0, 0, -1], w: x1 - x0, h: y1 - y0 };
    case 'W': return { o: [x0, y0, z0], u: [0, 0, 1], n: [-1, 0, 0], w: z1 - z0, h: y1 - y0 };
  }
}

/** Repère translaté / restreint : sous-façade commençant en (u, v, d) de `f`, de taille w × h. */
export function subFrame(f: Frame, u: number, v: number, d: number, w: number, h: number): Frame {
  return { o: P(f, u, v, d), u: f.u, n: f.n, w, h };
}

/** Quadrilatère en coordonnées de façade (u, v, d), ordre anti-horaire vu depuis sa face. */
export function fq(ctx: Ctx, mat: string, f: Frame, a: V3, b: V3, c: V3, d: V3, uvs?: [number, number][]): void {
  ctx.mb.quad(mat, P(f, a[0], a[1], a[2]), P(f, b[0], b[1], b[2]), P(f, c[0], c[1], c[2]), P(f, d[0], d[1], d[2]), uvs);
}
export function ft(ctx: Ctx, mat: string, f: Frame, a: V3, b: V3, c: V3): void {
  ctx.mb.tri(mat, P(f, a[0], a[1], a[2]), P(f, b[0], b[1], b[2]), P(f, c[0], c[1], c[2]));
}

/**
 * Boîte en coordonnées de façade. `skip` parmi : 'front' (d+), 'back' (d−), 'left' (u−), 'right' (u+), 'top', 'bottom'.
 */
export function fbox(ctx: Ctx, mat: string, f: Frame, u0: number, u1: number, v0: number, v1: number, d0: number, d1: number, skip = ''): void {
  if (u1 < u0) [u0, u1] = [u1, u0];
  if (v1 < v0) [v0, v1] = [v1, v0];
  if (d1 < d0) [d0, d1] = [d1, d0];
  if (u1 - u0 < 1e-5 || v1 - v0 < 1e-5 || d1 - d0 < 1e-5) return;
  if (!skip.includes('front')) fq(ctx, mat, f, [u0, v0, d1], [u1, v0, d1], [u1, v1, d1], [u0, v1, d1]);
  if (!skip.includes('back')) fq(ctx, mat, f, [u1, v0, d0], [u0, v0, d0], [u0, v1, d0], [u1, v1, d0]);
  if (!skip.includes('right')) fq(ctx, mat, f, [u1, v0, d1], [u1, v0, d0], [u1, v1, d0], [u1, v1, d1]);
  if (!skip.includes('left')) fq(ctx, mat, f, [u0, v0, d0], [u0, v0, d1], [u0, v1, d1], [u0, v1, d0]);
  if (!skip.includes('top')) fq(ctx, mat, f, [u0, v1, d1], [u1, v1, d1], [u1, v1, d0], [u0, v1, d0]);
  if (!skip.includes('bottom')) fq(ctx, mat, f, [u0, v0, d0], [u1, v0, d0], [u1, v0, d1], [u0, v0, d1]);
}

/** Mur plan percé de trous rectangulaires (découpage en grille, cellules fusionnées par rangée). */
export function wall(ctx: Ctx, mat: string, f: Frame, holes: Rect[], u0 = 0, u1 = f.w, v0 = 0, v1 = f.h, d = 0): void {
  const hs = holes.filter((h) => h.u1 > u0 && h.u0 < u1 && h.v1 > v0 && h.v0 < v1);
  const us = uniq([u0, u1, ...hs.flatMap((h) => [clamp(h.u0, u0, u1), clamp(h.u1, u0, u1)])]);
  const vs = uniq([v0, v1, ...hs.flatMap((h) => [clamp(h.v0, v0, v1), clamp(h.v1, v0, v1)])]);
  for (let j = 0; j < vs.length - 1; j++) {
    const va = vs[j]!;
    const vb = vs[j + 1]!;
    const vm = (va + vb) / 2;
    let start = -1;
    for (let i = 0; i <= us.length - 1; i++) {
      let solid = false;
      if (i < us.length - 1) {
        const um = (us[i]! + us[i + 1]!) / 2;
        solid = !hs.some((h) => um > h.u0 && um < h.u1 && vm > h.v0 && vm < h.v1);
      }
      if (solid && start < 0) start = i;
      if (!solid && start >= 0) {
        fq(ctx, mat, f, [us[start]!, va, d], [us[i]!, va, d], [us[i]!, vb, d], [us[start]!, vb, d]);
        start = -1;
      }
    }
  }
}

function uniq(a: number[]): number[] {
  const s = [...a].sort((x, y) => x - y);
  const out: number[] = [];
  for (const v of s) if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > 1e-6) out.push(v);
  return out;
}
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** Tableaux (faces intérieures) d'une baie de profondeur `R`, et fond optionnel. */
export function reveals(ctx: Ctx, mat: string, f: Frame, r: Rect, R: number, opts: { bottomMat?: string; noBottom?: boolean; topMat?: string } = {}): void {
  const { u0, u1, v0, v1 } = r;
  fq(ctx, mat, f, [u0, v0, 0], [u0, v0, -R], [u0, v1, -R], [u0, v1, 0]);
  fq(ctx, mat, f, [u1, v0, -R], [u1, v0, 0], [u1, v1, 0], [u1, v1, -R]);
  fq(ctx, opts.topMat ?? mat, f, [u0, v1, -R], [u1, v1, -R], [u1, v1, 0], [u0, v1, 0]);
  if (!opts.noBottom) fq(ctx, opts.bottomMat ?? mat, f, [u0, v0, 0], [u1, v0, 0], [u1, v0, -R], [u0, v0, -R]);
}

/** Vitrage plan (attribut _LIT = graine). */
export function glass(ctx: Ctx, f: Frame, u0: number, u1: number, v0: number, v1: number, d: number, lit?: number, mat = 'verre'): void {
  const prev = ctx.mb.lit;
  ctx.mb.lit = lit ?? ctx.r();
  fq(ctx, mat, f, [u0, v0, d], [u1, v0, d], [u1, v1, d], [u0, v1, d]);
  ctx.mb.lit = prev;
}

/* ------------------------------------------------------------------ */
/* Fenêtres                                                             */
/* ------------------------------------------------------------------ */

export type ShutterKind = 'battants' | 'roulant' | 'none';

export interface WindowOpts {
  /** Profondeur du tableau (m), défaut 0.18. */
  reveal?: number;
  /** Nombre de vantaux (montants verticaux + 1) ; défaut : 2 si largeur > 0.9 m. */
  leaves?: number;
  /** Rangées de petits bois (0 = aucune). */
  bars?: number;
  /** Imposte fixe en partie haute (hauteur m). */
  transom?: number;
  /** Appui saillant (défaut vrai sauf porte-fenêtre). */
  sill?: boolean;
  /** Encadrement saillant (largeur m, 0 = aucun) et son matériau. */
  surround?: number;
  surroundMat?: string;
  /** Clé de linteau (pierre). */
  keystone?: boolean;
  /** Linteau en saillie (béton/pierre) au-dessus de la baie. */
  lintel?: boolean;
  shutters?: ShutterKind;
  /** Garde-corps de porte-fenêtre (balconnet). */
  railing?: 'barreaux' | 'fer' | 'verre' | null;
  /** Matériau des tableaux (défaut : celui du mur). */
  revealMat?: string;
  frameMat?: string;
  /** Épaisseur des dormants (m). */
  frameW?: number;
  /** Forcer la graine d'allumage. */
  lit?: number;
  /** Proportion de volets fermés (0..1, défaut 0.12). */
  closedRatio?: number;
}

/** Fenêtre complète dans un trou `r` déjà réservé dans le mur `wallMat`. */
export function window(ctx: Ctx, f: Frame, r: Rect, wallMat: string, o: WindowOpts = {}): void {
  const R = o.reveal ?? 0.18;
  const w = r.u1 - r.u0;
  const h = r.v1 - r.v0;
  const fm = o.frameMat ?? 'menuiserie';
  const leaves = o.leaves ?? (w > 0.95 ? 2 : 1);
  const lit = o.lit ?? ctx.r();
  const sill = o.sill ?? true;
  const french = !sill;
  // tirages aléatoires toujours consommés dans le même ordre (LOD identiques)
  const rShut = ctx.r();
  const rRoll = ctx.r();
  const closed = rShut < (o.closedRatio ?? 0.12);
  const rollF = [0, 0, 0, 0.12, 0.3, 0.55, 0.85, 1][Math.floor(rRoll * 8)]!;

  if (ctx.lod === 2) {
    // Aplats saillants : verre (ou volet fermé), volets ouverts, appui.
    const d = 0.03;
    if (o.shutters === 'battants' && closed) fq(ctx, 'volet', f, [r.u0, r.v0, d], [r.u1, r.v0, d], [r.u1, r.v1, d], [r.u0, r.v1, d]);
    else {
      const top = o.shutters === 'roulant' && rollF > 0 ? r.v1 - h * rollF : r.v1;
      if (top > r.v0 + 0.05) glass(ctx, f, r.u0, r.u1, r.v0, top, d, lit);
      if (top < r.v1) fq(ctx, 'store', f, [r.u0, top, d], [r.u1, top, d], [r.u1, r.v1, d], [r.u0, r.v1, d]);
    }
    if (o.shutters === 'battants' && !closed) {
      const sw = w / 2;
      fq(ctx, 'volet', f, [r.u0 - sw, r.v0, d], [r.u0, r.v0, d], [r.u0, r.v1, d], [r.u0 - sw, r.v1, d]);
      fq(ctx, 'volet', f, [r.u1, r.v0, d], [r.u1 + sw, r.v0, d], [r.u1 + sw, r.v1, d], [r.u1, r.v1, d]);
    }
    if (sill) fbox(ctx, o.surroundMat ?? 'encadrement', f, r.u0 - 0.05, r.u1 + 0.05, r.v0 - 0.06, r.v0, 0, 0.05, 'back bottom left right');
    return;
  }

  reveals(ctx, o.revealMat ?? wallMat, f, r, R, { noBottom: sill });
  const dg = -R + 0.04; // plan du vitrage
  const fw = o.frameW ?? 0.065;
  // dormant (cadre) : anneau (face avant + retours intérieurs) — LOD0 seulement
  if (ctx.lod === 0) frameRing(ctx, fm, f, r, fw, dg - 0.01, dg + 0.04);
  const iu0 = r.u0 + fw;
  const iu1 = r.u1 - fw;
  let iv0 = r.v0 + fw;
  const iv1 = r.v1 - fw;
  if (french) iv0 = r.v0 + 0.14; // soubassement de porte-fenêtre
  if (iv0 > r.v0 + fw + 0.01 && ctx.lod === 0) fbox(ctx, fm, f, iu0, iu1, r.v0 + fw, iv0, dg - 0.02, dg + 0.02, 'back');
  glass(ctx, f, iu0, iu1, iv0, iv1, dg, lit);
  // imposte
  let leafTop = iv1;
  if (o.transom && o.transom < h * 0.5 && ctx.lod === 0) {
    leafTop = iv1 - o.transom;
    fbox(ctx, fm, f, iu0, iu1, leafTop - fw * 0.5, leafTop + fw * 0.5, dg - 0.01, dg + 0.04, 'back');
  }
  // vantaux : montants (LOD0)
  for (let k = 1; k < leaves && ctx.lod === 0; k++) {
    const uc = iu0 + ((iu1 - iu0) * k) / leaves;
    fbox(ctx, fm, f, uc - fw * 0.6, uc + fw * 0.6, iv0, leafTop, dg - 0.01, dg + 0.045, 'back top bottom');
  }
  // petits bois (LOD0)
  if (ctx.lod === 0 && (o.bars ?? 0) > 0) {
    const n = o.bars!;
    const bw = 0.022;
    for (let k = 1; k <= n; k++) {
      const vc = iv0 + ((leafTop - iv0) * k) / (n + 1);
      fbox(ctx, fm, f, iu0, iu1, vc - bw, vc + bw, dg, dg + 0.025, 'back left right');
    }
  }
  // appui
  if (sill) {
    const sm = o.surroundMat ?? 'encadrement';
    fbox(ctx, sm, f, r.u0 - 0.06, r.u1 + 0.06, r.v0 - 0.07, r.v0, -R, 0.055, ctx.lod === 0 ? 'back' : 'back bottom left right');
  }
  // encadrement saillant
  if (ctx.lod === 0 && (o.surround ?? 0) > 0) {
    const s = o.surround!;
    const sm = o.surroundMat ?? 'encadrement';
    const vb = sill ? r.v0 : r.v0 - 0.0;
    fbox(ctx, sm, f, r.u0 - s, r.u0, vb, r.v1, 0, 0.025, 'back');
    fbox(ctx, sm, f, r.u1, r.u1 + s, vb, r.v1, 0, 0.025, 'back');
    fbox(ctx, sm, f, r.u0 - s, r.u1 + s, r.v1, r.v1 + s, 0, 0.025, 'back');
    if (o.keystone) fbox(ctx, sm, f, (r.u0 + r.u1) / 2 - 0.12, (r.u0 + r.u1) / 2 + 0.12, r.v1 - 0.06, r.v1 + s + 0.08, 0, 0.05, 'back');
  }
  if (o.lintel) fbox(ctx, o.surroundMat ?? 'encadrement', f, r.u0 - 0.12, r.u1 + 0.12, r.v1, r.v1 + 0.2, 0, 0.03, 'back');
  // volets
  if (o.shutters === 'battants') shutters(ctx, f, r, closed, R);
  else if (o.shutters === 'roulant' && rollF > 0) {
    const top = r.v1 - h * rollF;
    fbox(ctx, 'store', f, r.u0 + 0.01, r.u1 - 0.01, top, r.v1, -R + 0.075, -R + 0.1, 'back left right top');
    if (ctx.lod === 0) fbox(ctx, 'menuiserie', f, r.u0 + 0.01, r.u1 - 0.01, top - 0.04, top, -R + 0.07, -R + 0.105, 'back');
  }
  // balconnet
  if (o.railing) {
    const rv0 = r.v0;
    railing(ctx, P(f, r.u0 - 0.04, rv0, 0.07), P(f, r.u1 + 0.04, rv0, 0.07), 1.0, o.railing, true);
  }
}

/**
 * Cadre rectangulaire (dormant) : 4 quads de face (à dFront) + 4 retours intérieurs (de dFront à dBack).
 * Les faces extérieures, plaquées contre les tableaux, ne sont pas dessinées.
 */
export function frameRing(ctx: Ctx, mat: string, f: Frame, r: Rect, fw: number, dBack: number, dFront: number): void {
  const { u0, u1, v0, v1 } = r;
  const a0 = u0 + fw, a1 = u1 - fw, b0 = v0 + fw, b1 = v1 - fw;
  const d = dFront;
  fq(ctx, mat, f, [u0, v0, d], [u1, v0, d], [a1, b0, d], [a0, b0, d]);
  fq(ctx, mat, f, [a1, b0, d], [u1, v0, d], [u1, v1, d], [a1, b1, d]);
  fq(ctx, mat, f, [a0, b1, d], [a1, b1, d], [u1, v1, d], [u0, v1, d]);
  fq(ctx, mat, f, [u0, v0, d], [a0, b0, d], [a0, b1, d], [u0, v1, d]);
  // retours (faces tournées vers le centre de la baie)
  fq(ctx, mat, f, [a0, b0, d], [a1, b0, d], [a1, b0, dBack], [a0, b0, dBack]);
  fq(ctx, mat, f, [a1, b1, d], [a0, b1, d], [a0, b1, dBack], [a1, b1, dBack]);
  fq(ctx, mat, f, [a0, b1, d], [a0, b0, d], [a0, b0, dBack], [a0, b1, dBack]);
  fq(ctx, mat, f, [a1, b0, d], [a1, b1, d], [a1, b1, dBack], [a1, b0, dBack]);
}

/** Volets battants (ouverts plaqués contre le mur, ou fermés dans le tableau). */
export function shutters(ctx: Ctx, f: Frame, r: Rect, closed: boolean, R: number): void {
  const w = r.u1 - r.u0;
  const sw = w / 2;
  const t = 0.035;
  const vm = 'volet';
  if (closed) {
    fbox(ctx, vm, f, r.u0 + 0.01, r.u0 + sw - 0.005, r.v0 + 0.01, r.v1 - 0.01, -0.09, -0.09 + t, 'back');
    fbox(ctx, vm, f, r.u0 + sw + 0.005, r.u1 - 0.01, r.v0 + 0.01, r.v1 - 0.01, -0.09, -0.09 + t, 'back');
    void R;
    return;
  }
  const skip = ctx.lod === 0 ? 'back' : 'back top bottom left right';
  fbox(ctx, vm, f, r.u0 - sw - 0.02, r.u0 - 0.02, r.v0 + 0.01, r.v1 - 0.01, 0.01, 0.01 + t, skip);
  fbox(ctx, vm, f, r.u1 + 0.02, r.u1 + sw + 0.02, r.v0 + 0.01, r.v1 - 0.01, 0.01, 0.01 + t, skip);
  if (ctx.lod === 0) {
    // pentures (ferrures) : deux barres sombres par vantail
    for (const [a, b] of [[r.u0 - sw - 0.01, r.u0 - 0.04], [r.u1 + 0.04, r.u1 + sw + 0.01]] as const) {
      for (const vv of [r.v0 + 0.18, r.v1 - 0.22]) fbox(ctx, 'garde_corps', f, a, b, vv, vv + 0.04, 0.01 + t, 0.01 + t + 0.008, 'back');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Portes                                                               */
/* ------------------------------------------------------------------ */

export interface DoorOpts {
  reveal?: number;
  style?: 'panneaux' | 'vitree' | 'double' | 'moderne';
  /** Imposte vitrée (hauteur m). */
  transom?: number;
  /** Hauteur d'emmarchement à franchir (m) : marches devant la porte. */
  steps?: number;
  canopy?: 'verre' | 'dalle' | 'tuiles' | null;
  surround?: number;
  surroundMat?: string;
  frameMat?: string;
  doorMat?: string;
}

export function door(ctx: Ctx, f: Frame, r: Rect, wallMat: string, o: DoorOpts = {}): void {
  const R = o.reveal ?? 0.22;
  const w = r.u1 - r.u0;
  const fm = o.frameMat ?? 'menuiserie';
  const dm = o.doorMat ?? 'porte';
  const style = o.style ?? 'panneaux';
  const lit = ctx.r();
  const steps = o.steps ?? 0;
  if (ctx.lod === 2) {
    const d = 0.03;
    const tv = o.transom ? r.v1 - o.transom : r.v1;
    fq(ctx, dm, f, [r.u0, r.v0, d], [r.u1, r.v0, d], [r.u1, tv, d], [r.u0, tv, d]);
    if (o.transom) glass(ctx, f, r.u0, r.u1, tv, r.v1, d, lit);
  } else {
    reveals(ctx, wallMat, f, r, R, { bottomMat: 'soubassement' });
    const dz = -R + 0.05;
    const fw = 0.08;
    if (ctx.lod === 0) frameRing(ctx, fm, f, { u0: r.u0, u1: r.u1, v0: r.v0 - fw, v1: r.v1 }, fw, dz - 0.02, dz + 0.05);
    let top = r.v1 - fw;
    if (o.transom) {
      const tv = r.v1 - fw - o.transom;
      glass(ctx, f, r.u0 + fw, r.u1 - fw, tv, top, dz, lit);
      if (ctx.lod === 0) fbox(ctx, fm, f, r.u0 + fw, r.u1 - fw, tv - 0.06, tv, dz - 0.02, dz + 0.05, 'back');
      top = tv - 0.06;
    }
    const a = r.u0 + fw;
    const b = r.u1 - fw;
    // vantail(s)
    const leafs = style === 'double' || w > 1.5 ? 2 : 1;
    for (let k = 0; k < leafs; k++) {
      const la = a + ((b - a) * k) / leafs;
      const lb = a + ((b - a) * (k + 1)) / leafs;
      const lw = lb - la;
      fq(ctx, dm, f, [la, r.v0, dz], [lb, r.v0, dz], [lb, top, dz], [la, top, dz]);
      const hh = top - r.v0;
      if (style === 'vitree' || style === 'moderne') {
        const gm = style === 'moderne' ? 0.12 : 0.14;
        const gv0 = style === 'moderne' ? r.v0 + 0.15 : r.v0 + hh * 0.45;
        const gu0 = style === 'moderne' ? lb - 0.1 - Math.min(0.2, lw * 0.25) : la + gm;
        glass(ctx, f, gu0, lb - gm, gv0, top - 0.15, dz + 0.012, lit);
        if (ctx.lod === 0 && style === 'vitree') {
          fbox(ctx, dm, f, la + 0.1, lb - 0.1, r.v0 + 0.15, gv0 - 0.12, dz, dz + 0.025, 'back');
          // grille de protection
          const n = Math.max(2, Math.round((lb - la - 0.28) / 0.12));
          for (let i = 1; i < n; i++) {
            const uu = la + gm + ((lb - gm - la - gm) * i) / n;
            fbox(ctx, 'garde_corps', f, uu - 0.008, uu + 0.008, gv0, top - 0.15, dz + 0.015, dz + 0.03, 'back');
          }
        }
      } else if (ctx.lod === 0) {
        // panneaux moulurés : 2 hauts + 1 bas
        const pm = 0.1;
        const mid = r.v0 + hh * 0.42;
        fbox(ctx, dm, f, la + pm, lb - pm, r.v0 + 0.14, mid - 0.06, dz, dz + 0.025, 'back');
        fbox(ctx, dm, f, la + pm, (la + lb) / 2 - 0.04, mid + 0.06, top - 0.12, dz, dz + 0.025, 'back');
        fbox(ctx, dm, f, (la + lb) / 2 + 0.04, lb - pm, mid + 0.06, top - 0.12, dz, dz + 0.025, 'back');
      }
      if (ctx.lod === 0) {
        const hu = leafs === 2 ? (k === 0 ? lb - 0.09 : la + 0.05) : lb - 0.12;
        const hv = r.v0 + hh * 0.48;
        fbox(ctx, 'garde_corps', f, hu, hu + 0.04, hv, hv + (style === 'moderne' ? 0.6 : 0.12), dz + 0.02, dz + 0.07);
      }
    }
    if (leafs === 2 && ctx.lod === 0) fbox(ctx, fm, f, (a + b) / 2 - 0.02, (a + b) / 2 + 0.02, r.v0, top, dz - 0.01, dz + 0.04, 'back');
    if (ctx.lod === 0 && (o.surround ?? 0) > 0) {
      const s = o.surround!;
      const sm = o.surroundMat ?? 'encadrement';
      fbox(ctx, sm, f, r.u0 - s, r.u0, r.v0, r.v1, 0, 0.03, 'back');
      fbox(ctx, sm, f, r.u1, r.u1 + s, r.v0, r.v1, 0, 0.03, 'back');
      fbox(ctx, sm, f, r.u0 - s, r.u1 + s, r.v1, r.v1 + s * 1.2, 0, 0.04, 'back');
    }
  }
  // seuil et marches
  if (steps > 0.05) {
    const n = Math.max(1, Math.round(steps / 0.17));
    const sh = steps / n;
    for (let i = 0; i < n; i++) {
      const depth = 0.32 * (n - i);
      fbox(ctx, 'soubassement', f, r.u0 - 0.25, r.u1 + 0.25, r.v0 - steps + i * sh, r.v0 - steps + (i + 1) * sh, 0, depth, 'back');
    }
  } else {
    fbox(ctx, 'soubassement', f, r.u0 - 0.08, r.u1 + 0.08, r.v0 - 0.02, r.v0 + 0.03, 0, 0.12, 'back');
  }
  // marquise
  if (o.canopy) {
    const cv = r.v1 + 0.3;
    const cd = o.canopy === 'tuiles' ? 0.85 : 1.0;
    const cu0 = r.u0 - 0.45;
    const cu1 = r.u1 + 0.45;
    if (o.canopy === 'dalle') {
      fbox(ctx, 'dalle', f, cu0, cu1, cv, cv + 0.14, 0, cd, 'back');
    } else if (o.canopy === 'verre') {
      fbox(ctx, 'garde_corps', f, cu0, cu1, cv, cv + 0.06, cd - 0.05, cd, 'back');
      fbox(ctx, 'garde_corps', f, cu0, cu0 + 0.05, cv, cv + 0.06, 0, cd - 0.05, 'back');
      fbox(ctx, 'garde_corps', f, cu1 - 0.05, cu1, cv, cv + 0.06, 0, cd - 0.05, 'back');
      const prev = ctx.mb.lit;
      ctx.mb.lit = -1;
      fq(ctx, 'verre_gc', f, [cu0, cv + 0.05, cd], [cu1, cv + 0.05, cd], [cu1, cv + 0.12, 0], [cu0, cv + 0.12, 0]);
      fq(ctx, 'verre_gc', f, [cu0, cv + 0.12, 0], [cu1, cv + 0.12, 0], [cu1, cv + 0.05, cd], [cu0, cv + 0.05, cd]);
      ctx.mb.lit = prev;
      if (ctx.lod === 0) {
        for (const uu of [cu0 + 0.1, cu1 - 0.1]) ctx.mb.tube('garde_corps', P(f, uu, cv + 0.05, cd - 0.03), P(f, uu, cv + 0.75, 0), 0.015, 5);
      }
    } else {
      // auvent à deux pans en tuiles sur consoles bois
      const ridge = cv + 0.55;
      const um = (cu0 + cu1) / 2;
      fq(ctx, 'toiture', f, [cu0, cv, 0], [cu0, cv, cd], [um, ridge, cd], [um, ridge, 0]);
      fq(ctx, 'toiture', f, [um, ridge, 0], [um, ridge, cd], [cu1, cv, cd], [cu1, cv, 0]);
      fq(ctx, 'rive', f, [cu0, cv, cd], [um, ridge, cd], [um, ridge, 0], [cu0, cv, 0]);
      fq(ctx, 'rive', f, [um, ridge, 0], [um, ridge, cd], [cu1, cv, cd], [cu1, cv, 0]);
      ft(ctx, 'rive', f, [cu0 + 0.05, cv, cd - 0.02], [cu1 - 0.05, cv, cd - 0.02], [um, ridge - 0.08, cd - 0.02]);
      if (ctx.lod < 2) for (const uu of [cu0 + 0.15, cu1 - 0.15]) fbox(ctx, 'bois', f, uu - 0.05, uu + 0.05, cv - 0.45, cv, 0, 0.12 + 0.5 * (ctx.lod === 0 ? 1 : 0), 'back');
    }
  }
}

/** Porte de garage sectionnelle (texture 0..1 sur le panneau). */
export function garage(ctx: Ctx, f: Frame, r: Rect, wallMat: string): void {
  const uvs: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  if (ctx.lod === 2) {
    fq(ctx, 'porte_garage', f, [r.u0, r.v0, 0.03], [r.u1, r.v0, 0.03], [r.u1, r.v1, 0.03], [r.u0, r.v1, 0.03], uvs);
    return;
  }
  const R = 0.25;
  reveals(ctx, wallMat, f, r, R, { noBottom: true });
  fq(ctx, 'porte_garage', f, [r.u0, r.v0, -R + 0.05], [r.u1, r.v0, -R + 0.05], [r.u1, r.v1, -R + 0.05], [r.u0, r.v1, -R + 0.05], uvs);
  fbox(ctx, 'encadrement', f, r.u0 - 0.1, r.u1 + 0.1, r.v1, r.v1 + 0.22, 0, 0.03, 'back');
  fbox(ctx, 'soubassement', f, r.u0, r.u1, r.v0 - 0.02, r.v0 + 0.02, -R, 0.4, 'back');
}

/* ------------------------------------------------------------------ */
/* Commerces                                                            */
/* ------------------------------------------------------------------ */

export interface ShopOpts { awning?: boolean; sign?: boolean; doorAt?: 'left' | 'right' | 'center'; reveal?: number; shutterDown?: number; /** Matériau d'enseigne / store (défaut 'enseigne'). */ signMat?: string }

/** Devanture vitrée (allumée la nuit), porte vitrée, enseigne et store banne. */
export function shopfront(ctx: Ctx, f: Frame, r: Rect, wallMat: string, o: ShopOpts = {}): void {
  const R = o.reveal ?? 0.25;
  const w = r.u1 - r.u0;
  const lit = 2;
  const sgn = o.signMat ?? 'enseigne';
  if (ctx.lod === 2) {
    glass(ctx, f, r.u0, r.u1, r.v0 + 0.4, r.v1 - 0.1, 0.03, lit);
    fq(ctx, 'menuiserie', f, [r.u0, r.v0, 0.03], [r.u1, r.v0, 0.03], [r.u1, r.v0 + 0.4, 0.03], [r.u0, r.v0 + 0.4, 0.03]);
  } else {
    reveals(ctx, wallMat, f, r, R, { bottomMat: 'soubassement' });
    const dz = -R + 0.06;
    // soubassement de vitrine
    fbox(ctx, 'menuiserie', f, r.u0, r.u1, r.v0, r.v0 + 0.45, dz - 0.04, dz + 0.04, 'back left right');
    glass(ctx, f, r.u0, r.u1, r.v0 + 0.45, r.v1 - 0.06, dz, lit);
    fbox(ctx, 'menuiserie', f, r.u0, r.u1, r.v1 - 0.08, r.v1, dz - 0.03, dz + 0.04, 'back');
    const n = Math.max(1, Math.round(w / 1.6));
    for (let k = 1; k < n && ctx.lod === 0; k++) {
      const uc = r.u0 + (w * k) / n;
      fbox(ctx, 'menuiserie', f, uc - 0.04, uc + 0.04, r.v0 + 0.45, r.v1 - 0.08, dz - 0.02, dz + 0.05, 'back top bottom');
    }
    // porte vitrée
    const dw = Math.min(1.1, w * 0.35);
    const du0 = o.doorAt === 'left' ? r.u0 + 0.15 : o.doorAt === 'center' ? (r.u0 + r.u1 - dw) / 2 : r.u1 - 0.15 - dw;
    fbox(ctx, 'menuiserie', f, du0 - 0.05, du0 + dw + 0.05, r.v0, r.v0 + 2.3, dz + 0.01, dz + 0.07, 'back');
    glass(ctx, f, du0 + 0.06, du0 + dw - 0.06, r.v0 + 0.1, r.v0 + 2.2, dz + 0.075, lit);
    if (ctx.lod === 0) fbox(ctx, 'garde_corps', f, du0 + dw - 0.14, du0 + dw - 0.1, r.v0 + 0.8, r.v0 + 1.5, dz + 0.08, dz + 0.12);
    // rideau métallique partiellement baissé
    if (o.shutterDown) fbox(ctx, 'store', f, r.u0, r.u1, r.v1 - (r.v1 - r.v0) * o.shutterDown, r.v1, -0.06, -0.03, 'back left right');
  }
  if (o.sign !== false) {
    fbox(ctx, sgn, f, r.u0 - 0.05, r.u1 + 0.05, r.v1 + 0.08, r.v1 + 0.62, 0, 0.09, 'back');
    if (ctx.lod === 0) {
      // lettrage en relief (lames claires)
      const n = Math.max(3, Math.round(w / 0.55));
      const span = Math.min(w * 0.6, n * 0.3);
      const s0 = (r.u0 + r.u1) / 2 - span / 2;
      for (let i = 0; i < n; i++) {
        const lu = s0 + (span * i) / n;
        fbox(ctx, 'menuiserie', f, lu, lu + span / n - 0.06, r.v1 + 0.2, r.v1 + 0.48, 0.09, 0.11, 'back');
      }
    }
  }
  if (o.awning && ctx.lod < 2) {
    const a0 = r.v1 + 0.02;
    const ad = 1.25;
    const drop = 0.55;
    fq(ctx, sgn, f, [r.u0, a0, 0.05], [r.u1, a0, 0.05], [r.u1, a0 - drop, ad], [r.u0, a0 - drop, ad]);
    fq(ctx, sgn, f, [r.u0, a0 - drop, ad], [r.u1, a0 - drop, ad], [r.u1, a0 - drop - 0.25, ad], [r.u0, a0 - drop - 0.25, ad]);
    ft(ctx, sgn, f, [r.u0, a0, 0.05], [r.u0, a0 - drop, ad], [r.u0, a0 - drop - 0.25, ad]);
    ft(ctx, sgn, f, [r.u1, a0 - drop - 0.25, ad], [r.u1, a0 - drop, ad], [r.u1, a0, 0.05]);
    // dessous
    fq(ctx, sgn, f, [r.u0, a0 - 0.02, 0.05], [r.u0, a0 - drop - 0.02, ad], [r.u1, a0 - drop - 0.02, ad], [r.u1, a0 - 0.02, 0.05]);
  }
}

/* ------------------------------------------------------------------ */
/* Balcons, garde-corps, loggias                                        */
/* ------------------------------------------------------------------ */

export type RailStyle = 'barreaux' | 'fer' | 'verre' | 'plein' | 'bois';

/**
 * Garde-corps rectiligne de A à B (points du pied, coordonnées locales), hauteur h.
 * `endPosts` : poteaux aux extrémités.
 */
export function railing(ctx: Ctx, A: V3, B: V3, h: number, style: RailStyle, endPosts = true, plainMat = 'dalle'): void {
  const { mb } = ctx;
  const dx = B[0] - A[0];
  const dz = B[2] - A[2];
  const L = Math.hypot(dx, dz);
  if (L < 0.05) return;
  const ang = Math.atan2(-dz, dx);
  mb.push(A[0], A[1], A[2], ang);
  const gm = style === 'bois' ? 'bois' : 'garde_corps';
  if (style === 'plein') {
    mb.box(plainMat, 0, 0, -0.06, L, h, 0.06, 'ny');
    mb.pop();
    return;
  }
  if (ctx.lod === 2) {
    // main courante (+ vitrage ou lisse basse)
    mb.box(gm, 0, h - 0.05, -0.025, L, h, 0.025, 'ny nx px');
    if (style === 'verre') {
      const prev = mb.lit; mb.lit = -1;
      mb.quad('verre_gc', [0, 0.05, 0], [L, 0.05, 0], [L, h - 0.05, 0], [0, h - 0.05, 0]);
      mb.lit = prev;
    } else mb.box(gm, 0, 0.05, -0.02, L, 0.1, 0.02, 'ny py nx px');
    mb.pop();
    return;
  }
  const rail = style === 'bois' ? 0.045 : 0.025;
  mb.box(gm, 0, h - rail * 2, -rail, L, h, rail, style === 'verre' ? 'nx px' : '');
  if (style === 'fer') mb.box(gm, 0, h - 0.16, -0.012, L, h - 0.13, 0.012, 'ny');
  if (style !== 'verre') mb.box(gm, 0, 0.04, -0.015, L, 0.08, 0.015, ctx.lod === 0 ? '' : 'nx px');
  if (endPosts && ctx.lod === 0) {
    const sk = style === 'verre' ? 'ny py' : 'ny';
    mb.box(gm, 0, 0, -rail, rail * 2, h, rail, sk);
    mb.box(gm, L - rail * 2, 0, -rail, L, h, rail, sk);
  }
  if (style === 'verre') {
    const prev = mb.lit; mb.lit = -1;
    mb.quad('verre_gc', [0.03, 0.08, 0], [L - 0.03, 0.08, 0], [L - 0.03, h - 0.05, 0], [0.03, h - 0.05, 0]);
    mb.quad('verre_gc', [L - 0.03, 0.08, 0], [0.03, 0.08, 0], [0.03, h - 0.05, 0], [L - 0.03, h - 0.05, 0]);
    mb.lit = prev;
  } else {
    const sp = style === 'bois' ? 0.16 : style === 'fer' ? 0.11 : 0.13;
    const step = ctx.lod === 0 ? sp : sp * 4;
    const n = Math.max(1, Math.floor(L / step));
    const bw = style === 'bois' ? 0.035 : 0.009;
    for (let i = 1; i < n; i++) {
      const x = (L * i) / n;
      mb.box(gm, x - bw, 0.08, -bw, x + bw, h - rail * 2, bw, 'ny py');
    }
    if (style === 'fer' && ctx.lod === 0) {
      // frise : petits cercles stylisés (barrettes croisées) dans la bande haute
      const m = Math.max(1, Math.floor(L / 0.3));
      for (let i = 0; i < m; i++) {
        const x = (L * (i + 0.5)) / m;
        mb.box(gm, x - 0.06, h - 0.13 - 0.004, -0.008, x + 0.06, h - 0.13 + 0.004, 0.008, 'ny py');
      }
    }
  }
  mb.pop();
}

export interface BalconyOpts {
  depth?: number;
  slab?: number;
  rail?: RailStyle;
  railH?: number;
  /** Consoles sous la dalle (pierre / métal). */
  consoles?: boolean;
  slabMat?: string;
  /** Côtés fermés : 'both' (défaut), 'none' (balcon filant entre deux murs). */
  sides?: 'both' | 'none' | 'left' | 'right';
  /** Sol bois. */
  deck?: boolean;
}

/** Balcon en saillie de u0 à u1, sol au niveau v (dessus de dalle). */
export function balcony(ctx: Ctx, f: Frame, u0: number, u1: number, v: number, o: BalconyOpts = {}): void {
  const D = o.depth ?? 1.2;
  const T = o.slab ?? 0.16;
  const sm = o.slabMat ?? 'dalle';
  fbox(ctx, sm, f, u0, u1, v - T, v, 0, D, 'back');
  if (o.deck && ctx.lod === 0) fbox(ctx, 'bois', f, u0 + 0.02, u1 - 0.02, v, v + 0.03, 0, D - 0.02, 'back bottom');
  const rs = o.rail ?? 'barreaux';
  const h = o.railH ?? 1.0;
  const inset = rs === 'plein' ? 0.06 : 0.04;
  railing(ctx, P(f, u0 + inset, v, D - inset), P(f, u1 - inset, v, D - inset), h, rs, true, sm);
  const sides = o.sides ?? 'both';
  if (sides === 'both' || sides === 'left') railing(ctx, P(f, u0 + inset, v, 0.02), P(f, u0 + inset, v, D - inset), h, rs, false, sm);
  if (sides === 'both' || sides === 'right') railing(ctx, P(f, u1 - inset, v, D - inset), P(f, u1 - inset, v, 0.02), h, rs, false, sm);
  if (o.consoles && ctx.lod === 0) {
    const n = Math.max(2, Math.round((u1 - u0) / 1.6) + 1);
    for (let i = 0; i < n; i++) {
      const uc = u0 + 0.15 + ((u1 - u0 - 0.3) * i) / (n - 1);
      // console en équerre (deux boîtes)
      fbox(ctx, 'encadrement', f, uc - 0.08, uc + 0.08, v - T - 0.35, v - T, 0, 0.18, 'back top');
      fbox(ctx, 'encadrement', f, uc - 0.07, uc + 0.07, v - T - 0.12, v - T, 0.18, D * 0.6, 'back top');
    }
  }
}

/** Loggia : baie profonde (D) avec porte-fenêtre au fond, sol, plafond et garde-corps en façade. */
export function loggia(ctx: Ctx, f: Frame, r: Rect, wallMat: string, o: { depth?: number; rail?: RailStyle; backMat?: string; win?: WindowOpts } = {}): void {
  const D = o.depth ?? 1.4;
  const w = r.u1 - r.u0;
  if (ctx.lod === 2) {
    fq(ctx, 'dalle', f, [r.u0, r.v0, 0.02], [r.u1, r.v0, 0.02], [r.u1, r.v0 + 1.0, 0.02], [r.u0, r.v0 + 1.0, 0.02]);
    glass(ctx, f, r.u0, r.u1, r.v0 + 1.0, r.v1 - 0.1, 0.02);
    return;
  }
  reveals(ctx, wallMat, f, r, D, { bottomMat: 'dalle', topMat: 'dalle' });
  const back = subFrame(f, r.u0, r.v0, -D, w, r.v1 - r.v0);
  const bm = o.backMat ?? wallMat;
  const ww = Math.min(w - 0.8, 2.4);
  const hole: Rect = { u0: (w - ww) / 2, u1: (w + ww) / 2, v0: 0.02, v1: Math.min(2.3, back.h - 0.25) };
  wall(ctx, bm, back, [hole]);
  window(ctx, back, hole, bm, { sill: false, leaves: 2, shutters: 'none', ...o.win });
  railing(ctx, P(f, r.u0 + 0.05, r.v0, -0.08), P(f, r.u1 - 0.05, r.v0, -0.08), 1.0, o.rail ?? 'verre', true, wallMat);
}

/* ------------------------------------------------------------------ */
/* Modénature : bandeaux, corniches, soubassements, chaînages            */
/* ------------------------------------------------------------------ */

/** Bandeau horizontal (boîte en saillie) de u0 à u1. */
export function band(ctx: Ctx, mat: string, f: Frame, v: number, h: number, d: number, u0 = 0, u1 = f.w): void {
  if (ctx.lod === 2 && d < 0.08) return;
  fbox(ctx, mat, f, u0, u1, v, v + h, 0, d, 'back');
}

/**
 * Corniche à profil étagé : `profile` = liste [hauteur, saillie] de bas en haut.
 * Les extrémités sont prolongées de la saillie (`wrap`) pour fermer les angles d'un volume.
 */
export function cornice(ctx: Ctx, mat: string, f: Frame, v: number, profile: [number, number][], wrap = true): void {
  let y = v;
  const prof = ctx.lod === 2 ? [[profile.reduce((s, p) => s + p[0], 0), Math.max(...profile.map((p) => p[1]))] as [number, number]] : profile;
  for (const [h, d] of prof) {
    const e = wrap ? d : 0;
    fbox(ctx, mat, f, -e, f.w + e, y, y + h, 0, d, 'back');
    y += h;
  }
}

/** Soubassement en saillie, interrompu au droit des baies qui descendent jusqu'au sol. */
export function plinth(ctx: Ctx, mat: string, f: Frame, h: number, d: number, holes: Rect[], wrap = true): void {
  const cuts = holes.filter((r) => r.v0 < h).map((r) => [r.u0, r.u1] as [number, number]).sort((a, b) => a[0] - b[0]);
  let u = wrap ? -d : 0;
  const end = wrap ? f.w + d : f.w;
  for (const [a, b] of cuts) {
    if (a > u) fbox(ctx, mat, f, u, a, 0, h, 0, d, 'back');
    u = Math.max(u, b);
  }
  if (end > u) fbox(ctx, mat, f, u, end, 0, h, 0, d, 'back');
}

/** Chaînages d'angle harpés (pierres alternées) aux deux extrémités de la façade. */
export function quoins(ctx: Ctx, mat: string, f: Frame, v0: number, v1: number, blockH = 0.32, d = 0.025): void {
  if (ctx.lod === 2) return;
  const n = Math.floor((v1 - v0) / blockH);
  for (let i = 0; i < n; i++) {
    const long = i % 2 === 0 ? 0.5 : 0.3;
    const va = v0 + i * blockH + 0.01;
    const vb = v0 + (i + 1) * blockH - 0.01;
    fbox(ctx, mat, f, 0, long, va, vb, 0, d, 'back left');
    fbox(ctx, mat, f, f.w - long, f.w, va, vb, 0, d, 'back right');
  }
}

/** Pilastre vertical en saillie. */
export function pilaster(ctx: Ctx, mat: string, f: Frame, u: number, w: number, v0: number, v1: number, d: number): void {
  fbox(ctx, mat, f, u - w / 2, u + w / 2, v0, v1, 0, d, 'back');
}

/** Descente d'eaux pluviales (zinc) le long de la façade, du haut `vTop` au sol. */
export function downpipe(ctx: Ctx, f: Frame, u: number, vTop: number, d = 0.1): void {
  if (ctx.lod === 2) return;
  const seg = ctx.lod === 0 ? 8 : 4;
  ctx.mb.tube('zinc', P(f, u, 0.05, d), P(f, u, vTop - 0.25, d), 0.045, seg);
  ctx.mb.tube('zinc', P(f, u, vTop - 0.25, d), P(f, u, vTop, d + 0.18), 0.045, seg);
  if (ctx.lod === 0) for (let v = 1.5; v < vTop - 0.5; v += 2.2) fbox(ctx, 'zinc', f, u - 0.06, u + 0.06, v, v + 0.05, 0, d, 'back');
}

/* ------------------------------------------------------------------ */
/* Composition d'une façade                                             */
/* ------------------------------------------------------------------ */

export type OpeningSpec =
  | { kind: 'window'; r: Rect; o?: WindowOpts }
  | { kind: 'door'; r: Rect; o?: DoorOpts }
  | { kind: 'garage'; r: Rect }
  | { kind: 'shop'; r: Rect; o?: ShopOpts }
  | { kind: 'loggia'; r: Rect; o?: { depth?: number; rail?: RailStyle; backMat?: string; win?: WindowOpts } }
  | { kind: 'blind'; r: Rect };

/**
 * Façade complète : mur percé + chaque ouverture. `blind` = trou sans rien (rempli par l'appelant).
 * Au LOD2 le mur est plein et les ouvertures sont des aplats.
 */
export function facade(ctx: Ctx, f: Frame, wallMat: string, openings: OpeningSpec[], opts: { u0?: number; u1?: number; v0?: number; v1?: number } = {}): void {
  const holes = ctx.lod === 2 ? openings.filter((o) => o.kind === 'blind').map((o) => o.r) : openings.map((o) => o.r);
  wall(ctx, wallMat, f, holes, opts.u0 ?? 0, opts.u1 ?? f.w, opts.v0 ?? 0, opts.v1 ?? f.h);
  for (const op of openings) {
    switch (op.kind) {
      case 'window': window(ctx, f, op.r, wallMat, op.o); break;
      case 'door': door(ctx, f, op.r, wallMat, op.o); break;
      case 'garage': garage(ctx, f, op.r, wallMat); break;
      case 'shop': shopfront(ctx, f, op.r, wallMat, op.o); break;
      case 'loggia': loggia(ctx, f, op.r, wallMat, op.o); break;
      case 'blind': break;
    }
  }
}

/** Centres de `n` travées régulièrement réparties sur une largeur w (marges égales à une demi-travée). */
export function bays(w: number, n: number, margin = 0): number[] {
  const out: number[] = [];
  const inner = w - 2 * margin;
  for (let i = 0; i < n; i++) out.push(margin + (inner * (i + 0.5)) / n);
  return out;
}

/** Rectangle centré en u. */
export function rectAt(uc: number, w: number, v0: number, h: number): Rect {
  return { u0: uc - w / 2, u1: uc + w / 2, v0, v1: v0 + h };
}

/** Mélange déterministe utilitaire. */
export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length]!;
}

export { madd };

/* ------------------------------------------------------------------ */
/* Volumes                                                              */
/* ------------------------------------------------------------------ */

export interface VolumeSpec {
  x0: number; x1: number; z0: number; z1: number;
  /** Base (défaut 0) et hauteur des murs. */
  y0?: number;
  h: number;
  wallMat: string;
  /** Ouvertures par côté (S = +Z, façade sur rue). Un côté absent = mur plein. */
  sides?: Partial<Record<Side, OpeningSpec[]>>;
  /** Côtés non dessinés (accolés à un autre volume). */
  hidden?: Side[];
  /** Matériau de mur par côté (surcharge). */
  sideMat?: Partial<Record<Side, string>>;
  plinth?: { h: number; d?: number; mat?: string };
  quoins?: { mat?: string; v0?: number; v1?: number };
  /** Bandeaux horizontaux (hauteurs relatives à y0). */
  bands?: { v: number; h?: number; d?: number; mat?: string }[];
  /** Corniche en tête de mur. */
  cornice?: { profile: [number, number][]; mat?: string; v?: number };
}

/** Pavé de murs percés + modénature. Renvoie les repères des quatre façades. */
export function volume(ctx: Ctx, s: VolumeSpec): Record<Side, Frame> {
  const y0 = s.y0 ?? 0;
  const frames = {} as Record<Side, Frame>;
  for (const side of ['S', 'E', 'N', 'W'] as Side[]) {
    const f = sideFrame(s.x0, s.z0, s.x1, s.z1, y0, y0 + s.h, side);
    frames[side] = f;
    if (s.hidden?.includes(side)) continue;
    const ops = s.sides?.[side] ?? [];
    const wm = s.sideMat?.[side] ?? s.wallMat;
    facade(ctx, f, wm, ops);
    if (s.plinth) plinth(ctx, s.plinth.mat ?? 'soubassement', f, s.plinth.h, s.plinth.d ?? 0.04, ops.map((o) => o.r));
    if (s.quoins) quoins(ctx, s.quoins.mat ?? 'encadrement', f, s.quoins.v0 ?? (s.plinth?.h ?? 0), s.quoins.v1 ?? s.h);
    for (const b of s.bands ?? []) {
      const cuts = ops.filter((o) => o.r.v0 < b.v + (b.h ?? 0.18) && o.r.v1 > b.v).map((o) => o.r);
      if (cuts.length === 0) band(ctx, b.mat ?? 'encadrement', f, b.v, b.h ?? 0.18, b.d ?? 0.05, -(b.d ?? 0.05), f.w + (b.d ?? 0.05));
      else {
        let u = -(b.d ?? 0.05);
        for (const c of [...cuts].sort((a, z) => a.u0 - z.u0)) {
          if (c.u0 > u) band(ctx, b.mat ?? 'encadrement', f, b.v, b.h ?? 0.18, b.d ?? 0.05, u, c.u0);
          u = Math.max(u, c.u1);
        }
        band(ctx, b.mat ?? 'encadrement', f, b.v, b.h ?? 0.18, b.d ?? 0.05, u, f.w + (b.d ?? 0.05));
      }
    }
    if (s.cornice) cornice(ctx, s.cornice.mat ?? 'encadrement', f, s.cornice.v ?? s.h, s.cornice.profile);
  }
  return frames;
}

/** Ouvertures identiques sur une rangée de travées (centres `us`) pour un étage. */
export function row(us: number[], w: number, v0: number, h: number, mk: (i: number) => Omit<OpeningSpec, 'r'> = () => ({ kind: 'window' })): OpeningSpec[] {
  return us.map((u, i) => ({ ...mk(i), r: rectAt(u, w, v0, h) }) as OpeningSpec);
}

/**
 * Fenêtre « en applique » sur un mur plein sans trou (pignons triangulaires, lucarnes rondes) :
 * encadrement saillant, vitrage, croisillon, appui.
 */
export function flushWindow(ctx: Ctx, f: Frame, r: Rect, o: { surroundMat?: string; frameMat?: string; bars?: boolean; s?: number } = {}): void {
  const s = o.s ?? 0.12;
  const sm = o.surroundMat ?? 'encadrement';
  const fm = o.frameMat ?? 'menuiserie';
  glass(ctx, f, r.u0, r.u1, r.v0, r.v1, 0.02);
  if (ctx.lod === 2) return;
  fbox(ctx, sm, f, r.u0 - s, r.u0, r.v0 - s, r.v1 + s, 0, 0.06, 'back');
  fbox(ctx, sm, f, r.u1, r.u1 + s, r.v0 - s, r.v1 + s, 0, 0.06, 'back');
  fbox(ctx, sm, f, r.u0, r.u1, r.v1, r.v1 + s, 0, 0.06, 'back');
  fbox(ctx, sm, f, r.u0 - 0.04, r.u1 + 0.04, r.v0 - s, r.v0, 0, 0.09, 'back');
  if (o.bars !== false) {
    const um = (r.u0 + r.u1) / 2;
    const vm = (r.v0 + r.v1) / 2;
    fbox(ctx, fm, f, um - 0.03, um + 0.03, r.v0, r.v1, 0.02, 0.05, 'back top bottom');
    fbox(ctx, fm, f, r.u0, r.u1, vm - 0.03, vm + 0.03, 0.02, 0.05, 'back left right');
  }
}

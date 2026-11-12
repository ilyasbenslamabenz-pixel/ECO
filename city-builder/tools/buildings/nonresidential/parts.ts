/**
 * Briques complémentaires du kit (tools/buildings/kit) propres aux bâtiments NON résidentiels :
 * lettrages en relief, murs-rideaux, baies cintrées, oculus, horloges, colonnes et frontons, stores rayés,
 * escaliers de secours, drapeaux, parkings marqués, lampadaires, quais de chargement, sheds, cheminées
 * industrielles, cuves, dômes, flèches, kiosque, mobilier de terrasse…
 *
 * Toutes respectent la convention du kit : `ctx.lod` (0 complet, 1 allégé, 2 aplats / silhouettes),
 * matériaux par rôle de la palette, aucun tirage `ctx.r()` dépendant du LOD (graines d'allumage calculées
 * par hachage), Y vers le haut, façade principale vers +Z.
 */
import {
  basePalette, fbox, fq, ft, glass, P, wall, type Ctx, type Frame, type KitMaterial, type Palette, type Rect, type V3,
} from '../kit/index';
import { glyphRuns } from './font';

/* ------------------------------------------------------------------ */
/* Palette commune                                                      */
/* ------------------------------------------------------------------ */

/** Palette de base + rôles des équipements urbains (sols, marquages, végétal, lettrages…). */
export function npPalette(over: Partial<Palette> = {}): Palette {
  const extra: Palette = {
    sol: { set: 'route_asphalte', color: '#8c8c8c' },
    marquage_b: { set: 'enduit_peint', color: '#2f62b0', roughness: 0.8 },
    marquage: { set: 'enduit_blanc', color: '#f7f7f2', roughness: 0.8 },
    marquage_j: { set: 'enduit_blanc', color: '#e8c33a', roughness: 0.8 },
    beton: { set: 'sol_beton_brut' },
    dallage: { set: 'trottoir_dalles' },
    paves: { set: 'paves_granit' },
    bordure: { set: 'bordure_granit' },
    gazon: { set: 'terrain_herbe', color: '#a9c77c' },
    vegetal: { set: 'terrain_herbe', color: '#5d7f3a' },
    gravier: { set: 'terrain_gravier' },
    lettres: { set: 'enduit_blanc', color: '#fbfaf5', roughness: 0.5 },
    logo: { set: 'enduit_peint', color: '#d0482c', roughness: 0.5 },
    logo_b: { set: 'enduit_peint', color: '#f2c230', roughness: 0.5 },
    store_a: { set: 'enduit_peint', color: '#b8322a', doubleSided: true },
    store_b: { set: 'enduit_blanc', color: '#f3efe6', doubleSided: true },
    meneau: { set: 'metal_rideau', color: '#4a5056', metalness: 1, roughness: 0.45 },
    acier: { set: 'metal_rideau', color: '#b9bec2', metalness: 1, roughness: 0.5 },
    cadran: { set: 'enduit_blanc', color: '#f6f3ea' },
    tissu: { set: 'enduit_blanc', color: '#f0ebe0', doubleSided: true },
    verre_mr: { kind: 'glass', color: '#4c6a7c' },
  };
  return basePalette({ ...extra, ...over });
}

/** Graine d'allumage déterministe (ne consomme pas ctx.r : identique sur les trois LOD). */
export function litSeed(a: number, b: number, c = 0): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
}

/* ------------------------------------------------------------------ */
/* Repères                                                              */
/* ------------------------------------------------------------------ */

/** Repère de façade le long d'un segment AB (vu de dessus) : u = A→B, normale sortante à droite de AB (convention S→E→N→W). */
export function edgeFrame(ax: number, az: number, bx: number, bz: number, y0: number, h: number): Frame {
  const L = Math.hypot(bx - ax, bz - az);
  const u: V3 = [(bx - ax) / L, 0, (bz - az) / L];
  return { o: [ax, y0, az], u, n: [-u[2], 0, u[0]], w: L, h };
}

/** Polygone régulier XZ (n sommets, rayon R) dans l'ordre S→E→N→W du kit ; `rot0` décale l'angle (rad). */
export function regularPoly(n: number, R: number, rot0 = 0, cx = 0, cz = 0): [number, number][] {
  const out: [number, number][] = [];
  const start = Math.PI / 2 + Math.PI / n + rot0; // côté plat face au sud
  for (let k = 0; k < n; k++) {
    const t = start - (k * 2 * Math.PI) / n;
    out.push([cx + R * Math.cos(t), cz + R * Math.sin(t)]);
  }
  return out;
}

/** Repères de façade de chaque côté d'un polygone XZ. */
export function polyFrames(poly: [number, number][], y0: number, h: number): Frame[] {
  return poly.map((a, i) => { const b = poly[(i + 1) % poly.length]!; return edgeFrame(a[0], a[1], b[0], b[1], y0, h); });
}

/** Polygone en coordonnées de façade (u, v, d), orienté vers la direction (du, dv, dd) du repère. */
export function fpf(ctx: Ctx, mat: string, f: Frame, pts: V3[], dir: V3): void {
  const w = pts.map((p) => P(f, p[0], p[1], p[2]));
  const D: V3 = [f.u[0] * dir[0] + f.n[0] * dir[2], dir[1], f.u[2] * dir[0] + f.n[2] * dir[2]];
  ctx.mb.polyFacing(mat, w, D);
}

/* ------------------------------------------------------------------ */
/* Lettrages en relief                                                  */
/* ------------------------------------------------------------------ */

/**
 * Texte en lettres capitales en relief (police matricielle originale), centré en `uc`, ligne de base `v0`,
 * hauteur de capitale `capH`, saillie `d0`→`d0+depth`. LOD0 : lettres en volume ; LOD1 : faces avant ; LOD2 : rien.
 * Renvoie la largeur du texte.
 */
export function lettering(ctx: Ctx, mat: string, f: Frame, text: string, uc: number, v0: number, capH: number, d0 = 0.02, depth = 0.06): number {
  const px = capH / 7;
  const adv = px * 6;
  const chars = [...text];
  const width = chars.length * adv - px;
  if (ctx.lod === 2) return width;
  let u = uc - width / 2;
  const skip = ctx.lod === 0 ? 'back' : 'back left right top bottom';
  for (const ch of chars) {
    for (const [c, l, r] of glyphRuns(ch)) {
      fbox(ctx, mat, f, u + c * px, u + (c + l) * px, v0 + r * px, v0 + (r + 1) * px, d0, d0 + depth, skip);
    }
    u += adv;
  }
  return width;
}

/** Panneau d'enseigne (plaque + lettrage). */
export function signPanel(ctx: Ctx, f: Frame, text: string, uc: number, v0: number, h: number, o: { plate?: string; letters?: string; pad?: number; d?: number; w?: number } = {}): void {
  const capH = h * 0.62;
  const tw = [...text].length * (capH / 7) * 6 - capH / 7;
  const pad = o.pad ?? h * 0.35;
  const w = o.w ?? tw + 2 * pad;
  const d = o.d ?? 0.12;
  fbox(ctx, o.plate ?? 'enseigne', f, uc - w / 2, uc + w / 2, v0, v0 + h, 0, d, 'back');
  lettering(ctx, o.letters ?? 'lettres', f, text, uc, v0 + (h - capH) / 2, capH, d, 0.05);
}

/* ------------------------------------------------------------------ */
/* Disques, horloges, oculus                                            */
/* ------------------------------------------------------------------ */

/** Disque (polygone) dans le plan de la façade, à la saillie d. */
export function disc(ctx: Ctx, mat: string, f: Frame, uc: number, vc: number, r: number, d: number, seg = 20): void {
  const pts: V3[] = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pts.push(P(f, uc + Math.cos(t) * r, vc + Math.sin(t) * r, d));
  }
  ctx.mb.poly(mat, pts);
}

/** Anneau (couronne) dans le plan de la façade, extrudé de d0 à d1. */
export function ring(ctx: Ctx, mat: string, f: Frame, uc: number, vc: number, r0: number, r1: number, d0: number, d1: number, seg = 20): void {
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const b = ((i + 1) / seg) * Math.PI * 2;
    const p = (r: number, t: number, d: number): V3 => [uc + Math.cos(t) * r, vc + Math.sin(t) * r, d];
    fq(ctx, mat, f, p(r0, a, d1), p(r1, a, d1), p(r1, b, d1), p(r0, b, d1));
    if (ctx.lod === 0) {
      fq(ctx, mat, f, p(r1, a, d1), p(r1, a, d0), p(r1, b, d0), p(r1, b, d1));
    }
  }
}

/** Horloge : cadran, couronne, index des heures, aiguilles. */
export function clockFace(ctx: Ctx, f: Frame, uc: number, vc: number, r: number, d = 0.05, hour = 10.2): void {
  const seg = ctx.lod === 0 ? 28 : ctx.lod === 1 ? 16 : 10;
  disc(ctx, 'cadran', f, uc, vc, r, d, seg);
  if (ctx.lod === 2) return;
  ring(ctx, 'garde_corps', f, uc, vc, r, r + r * 0.1, 0, d + 0.04, seg);
  if (ctx.lod === 0) {
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const cu = uc + Math.cos(t) * r * 0.82;
      const cv = vc + Math.sin(t) * r * 0.82;
      const s = k % 3 === 0 ? r * 0.07 : r * 0.04;
      fbox(ctx, 'garde_corps', f, cu - s, cu + s, cv - s, cv + s, d, d + 0.02, 'back');
    }
  }
  // aiguilles (heure, minute) : quads inclinés
  const hand = (ang: number, L: number, w: number, dd: number): void => {
    const cx = Math.cos(ang), cy = Math.sin(ang);
    const nx = -cy * w, ny = cx * w;
    fpf(ctx, 'garde_corps', f, [[uc - nx - cx * 0.1 * L, vc - ny - cy * 0.1 * L, dd], [uc + cx * L - nx * 0.3, vc + cy * L - ny * 0.3, dd],
      [uc + cx * L + nx * 0.3, vc + cy * L + ny * 0.3, dd], [uc + nx - cx * 0.1 * L, vc + ny - cy * 0.1 * L, dd]], [0, 0, 1]);
  };
  const hAng = Math.PI / 2 - ((hour % 12) / 12) * Math.PI * 2;
  const mAng = Math.PI / 2 - ((hour % 1) * Math.PI * 2);
  hand(hAng, r * 0.5, r * 0.06, d + 0.03);
  hand(mAng, r * 0.78, r * 0.04, d + 0.04);
}

/** Remplit de mur les écoinçons entre un rectangle `r` (trou réservé) et un arc en plein cintre posé sur `vSpring`. */
function archSpandrels(ctx: Ctx, mat: string, f: Frame, u0: number, u1: number, vSpring: number, vTop: number, seg: number, d = 0): void {
  const uc = (u0 + u1) / 2;
  const rr = (u1 - u0) / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = Math.PI - (i / seg) * Math.PI;
    pts.push([uc + Math.cos(t) * rr, vSpring + Math.sin(t) * rr]);
  }
  // moitié gauche : coin (u0, vTop) ; moitié droite : coin (u1, vTop)
  const half = Math.floor(seg / 2);
  for (let i = 0; i < seg; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const corner: [number, number] = i < half ? [u0, vTop] : [u1, vTop];
    fpf(ctx, mat, f, [[a[0], a[1], d], [corner[0], corner[1], d], [b[0], b[1], d]], [0, 0, 1]);
  }
}

/**
 * Baie en plein cintre dans un trou rectangulaire réservé (`blind`) [u0,u1]×[v0, vSpring + w/2].
 * Tableaux, vitrage cintré, meneaux, archivolte en saillie et clé (LOD0).
 */
export function archWindow(ctx: Ctx, f: Frame, r: Rect, wallMat: string, o: { R?: number; surroundMat?: string; mullions?: number; transoms?: number; lit?: number; sill?: boolean; frameMat?: string } = {}): void {
  const R = o.R ?? 0.25;
  const w = r.u1 - r.u0;
  const rr = w / 2;
  const vSpring = r.v1 - rr;
  const uc = (r.u0 + r.u1) / 2;
  const seg = ctx.lod === 0 ? 12 : ctx.lod === 1 ? 8 : 6;
  const lit = o.lit ?? litSeed(Math.round(r.u0 * 10), Math.round(r.v0 * 10), Math.round(f.o[0] + f.o[2]));
  const fm = o.frameMat ?? 'menuiserie';
  const sm = o.surroundMat ?? 'encadrement';
  const dg = ctx.lod === 2 ? 0 : -R + 0.05;
  archSpandrels(ctx, wallMat, f, r.u0, r.u1, vSpring, r.v1, seg, 0);
  // vitrage cintré
  const pts: V3[] = [];
  pts.push(P(f, r.u0, r.v0, dg), P(f, r.u1, r.v0, dg));
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI;
    pts.push(P(f, uc + Math.cos(t) * rr, vSpring + Math.sin(t) * rr, dg));
  }
  const prev = ctx.mb.lit; ctx.mb.lit = lit; ctx.mb.poly('verre', pts); ctx.mb.lit = prev;
  if (ctx.lod === 2) { if (o.sill !== false) fbox(ctx, sm, f, r.u0 - 0.05, r.u1 + 0.05, r.v0 - 0.08, r.v0, 0, 0.06, 'back'); return; }
  // tableaux droits + intrados
  fq(ctx, wallMat, f, [r.u0, r.v0, 0], [r.u0, r.v0, -R], [r.u0, vSpring, -R], [r.u0, vSpring, 0]);
  fq(ctx, wallMat, f, [r.u1, r.v0, -R], [r.u1, r.v0, 0], [r.u1, vSpring, 0], [r.u1, vSpring, -R]);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI, b = ((i + 1) / seg) * Math.PI;
    const A = [uc + Math.cos(a) * rr, vSpring + Math.sin(a) * rr] as const;
    const B = [uc + Math.cos(b) * rr, vSpring + Math.sin(b) * rr] as const;
    fpf(ctx, wallMat, f, [[A[0], A[1], 0], [A[0], A[1], -R], [B[0], B[1], -R], [B[0], B[1], 0]], [-(A[0] + B[0] - 2 * uc), -(A[1] + B[1] - 2 * vSpring), 0]);
  }
  if (o.sill !== false) fbox(ctx, sm, f, r.u0 - 0.08, r.u1 + 0.08, r.v0 - 0.1, r.v0, -R, 0.07, 'back');
  else fq(ctx, sm, f, [r.u0, r.v0, 0], [r.u1, r.v0, 0], [r.u1, r.v0, -R], [r.u0, r.v0, -R]);
  // meneaux / traverses
  const nm = o.mullions ?? (w > 1.4 ? 2 : 1);
  for (let k = 1; k < nm; k++) {
    const u = r.u0 + (w * k) / nm;
    const vt = vSpring + Math.sqrt(Math.max(0, rr * rr - (u - uc) * (u - uc)));
    fbox(ctx, fm, f, u - 0.04, u + 0.04, r.v0, vt, dg, dg + 0.05, 'back');
  }
  const nt = ctx.lod === 0 ? (o.transoms ?? 1) : 0;
  for (let k = 1; k <= nt; k++) {
    const v = r.v0 + ((vSpring - r.v0) * k) / (nt + 1);
    fbox(ctx, fm, f, r.u0, r.u1, v - 0.03, v + 0.03, dg, dg + 0.05, 'back');
  }
  fbox(ctx, fm, f, r.u0, r.u1, vSpring - 0.035, vSpring + 0.035, dg, dg + 0.05, 'back');
  // archivolte
  if (ctx.lod === 0) {
    const s = 0.16;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI, b = ((i + 1) / seg) * Math.PI;
      const p = (rad: number, t: number, d: number): V3 => [uc + Math.cos(t) * rad, vSpring + Math.sin(t) * rad, d];
      fq(ctx, sm, f, p(rr, a, 0.05), p(rr + s, a, 0.05), p(rr + s, b, 0.05), p(rr, b, 0.05));
      fq(ctx, sm, f, p(rr + s, a, 0.05), p(rr + s, a, 0), p(rr + s, b, 0), p(rr + s, b, 0.05));
    }
    fbox(ctx, sm, f, uc - 0.13, uc + 0.13, r.v1 - 0.05, r.v1 + s + 0.1, 0, 0.09, 'back');
  }
}

/** Oculus / rosace dans un trou carré réservé (côté 2r). */
export function oculus(ctx: Ctx, f: Frame, uc: number, vc: number, rad: number, wallMat: string, o: { spokes?: number; surroundMat?: string } = {}): void {
  const seg = ctx.lod === 0 ? 20 : ctx.lod === 1 ? 12 : 8;
  // écoinçons : 4 quarts
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
    const mid = (a + b) / 2;
    const cu = uc + Math.sign(Math.cos(mid)) * rad;
    const cv = vc + Math.sign(Math.sin(mid)) * rad;
    fpf(ctx, wallMat, f, [[uc + Math.cos(a) * rad, vc + Math.sin(a) * rad, 0], [cu, cv, 0], [uc + Math.cos(b) * rad, vc + Math.sin(b) * rad, 0]], [0, 0, 1]);
  }
  const dg = ctx.lod === 2 ? 0 : -0.2;
  const prev = ctx.mb.lit; ctx.mb.lit = 0.97;
  disc(ctx, 'verre', f, uc, vc, rad, dg, seg);
  ctx.mb.lit = prev;
  if (ctx.lod === 2) return;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
    const m = (a + b) / 2;
    fpf(ctx, wallMat, f, [[uc + Math.cos(a) * rad, vc + Math.sin(a) * rad, 0], [uc + Math.cos(a) * rad, vc + Math.sin(a) * rad, -0.2],
      [uc + Math.cos(b) * rad, vc + Math.sin(b) * rad, -0.2], [uc + Math.cos(b) * rad, vc + Math.sin(b) * rad, 0]], [-Math.cos(m), -Math.sin(m), 0]);
  }
  ring(ctx, o.surroundMat ?? 'encadrement', f, uc, vc, rad, rad + 0.22, 0, 0.08, seg);
  const sp = o.spokes ?? 8;
  if (ctx.lod === 0) {
    ring(ctx, 'encadrement', f, uc, vc, rad * 0.28, rad * 0.36, -0.2, -0.12, 12);
    for (let k = 0; k < sp; k++) {
      const t = (k / sp) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t), w = 0.035;
      fq(ctx, 'encadrement', f, [uc + c * rad * 0.3 - s * w, vc + s * rad * 0.3 + c * w, -0.13], [uc + c * rad * 0.3 + s * w, vc + s * rad * 0.3 - c * w, -0.13],
        [uc + c * rad + s * w, vc + s * rad - c * w, -0.13], [uc + c * rad - s * w, vc + s * rad + c * w, -0.13]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Murs-rideaux et bandeaux vitrés                                      */
/* ------------------------------------------------------------------ */

export interface CurtainOpts {
  u0?: number; u1?: number; v0?: number; v1?: number;
  /** Nombre de trames verticales. */
  cols: number;
  /** Hauteur d'étage (traverses). */
  floorH: number;
  /** Allège opaque en bas de chaque étage (m) et son matériau. */
  spandrel?: number;
  spandrelMat?: string;
  mullionMat?: string;
  /** Saillie des montants (m). */
  fin?: number;
  /** Montants plus épais toutes les k trames (lames verticales). */
  finEvery?: number;
  finDepth?: number;
  glassMat?: string;
  /** Décalage de graine (allumage). */
  seed?: number;
}

/** Mur-rideau : vitrages par cellule (allumage nocturne individuel), allèges, montants et traverses. */
export function curtainWall(ctx: Ctx, f: Frame, o: CurtainOpts): void {
  const u0 = o.u0 ?? 0, u1 = o.u1 ?? f.w, v0 = o.v0 ?? 0, v1 = o.v1 ?? f.h;
  const gm = o.glassMat ?? 'verre_mr';
  const mm = o.mullionMat ?? 'meneau';
  const sp = o.spandrel ?? 0;
  const spm = o.spandrelMat ?? 'meneau';
  const nF = Math.max(1, Math.round((v1 - v0) / o.floorH));
  const fh = (v1 - v0) / nF;
  const cw = (u1 - u0) / o.cols;
  const seed = o.seed ?? Math.round((f.o[0] * 7 + f.o[2] * 13 + f.o[1]) * 10);
  const group = ctx.lod === 0 ? 1 : ctx.lod === 1 ? 2 : o.cols;
  for (let k = 0; k < nF; k++) {
    const va = v0 + k * fh;
    const vb = va + fh;
    if (sp > 0) fq(ctx, spm, f, [u0, va, 0], [u1, va, 0], [u1, va + sp, 0], [u0, va + sp, 0]);
    for (let c = 0; c < o.cols; c += group) {
      const ua = u0 + c * cw;
      const ub = u0 + Math.min(o.cols, c + group) * cw;
      glass(ctx, f, ua, ub, va + sp, vb, 0, litSeed(seed, k, c), gm);
    }
  }
  if (ctx.lod === 2) return;
  const fin = o.fin ?? 0.08;
  const fw = 0.05;
  // traverses (une par étage) et montants (toute hauteur)
  for (let k = 0; k <= nF; k++) {
    const v = v0 + k * fh;
    fbox(ctx, mm, f, u0, u1, v - fw, v + fw, 0, fin * 0.7, ctx.lod === 0 ? 'back' : 'back left right');
    if (sp > 0 && k < nF && ctx.lod === 0) fbox(ctx, mm, f, u0, u1, v + sp - 0.025, v + sp + 0.025, 0, fin * 0.5, 'back left right');
  }
  const step = ctx.lod === 0 ? 1 : 2;
  for (let c = 0; c <= o.cols; c += step) {
    const u = u0 + c * cw;
    const big = o.finEvery && c % o.finEvery === 0;
    const d = big ? (o.finDepth ?? 0.35) : fin;
    const hw = big ? 0.09 : fw;
    fbox(ctx, mm, f, Math.max(u0 - 0.0, u - hw), Math.min(u1, u + hw), v0, v1, 0, d, ctx.lod === 0 ? 'back' : 'back top bottom');
  }
}

/** Bande de mur plein (face avant seule) de v0 à v1 et de u0 à u1. */
export function wallStrip(ctx: Ctx, mat: string, f: Frame, v0: number, v1: number, u0 = 0, u1 = f.w): void {
  fpf(ctx, mat, f, [[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]], [0, 0, 1]);
}

/** Bandeaux de fenêtres filantes (bureaux) : trous filants + vitrage + meneaux + allèges. */
export function ribbonFloors(ctx: Ctx, f: Frame, wallMat: string, o: { v0: number; floors: number; floorH: number; sill: number; winH: number; cols: number; margin?: number; mullionMat?: string; seed?: number }): void {
  const m = o.margin ?? 0.6;
  const holes: Rect[] = [];
  for (let k = 0; k < o.floors; k++) holes.push({ u0: m, u1: f.w - m, v0: o.v0 + k * o.floorH + o.sill, v1: o.v0 + k * o.floorH + o.sill + o.winH });
  wall(ctx, wallMat, f, ctx.lod === 2 ? [] : holes, 0, f.w, o.v0, o.v0 + o.floors * o.floorH);
  const R = 0.22;
  const cw = (f.w - 2 * m) / o.cols;
  const seed = o.seed ?? Math.round(f.o[0] * 11 + f.o[2] * 5);
  holes.forEach((h, k) => {
    const d = ctx.lod === 2 ? 0.03 : -R + 0.04;
    for (let c = 0; c < o.cols; c += ctx.lod === 0 ? 1 : 3) glass(ctx, f, h.u0 + c * cw, h.u0 + Math.min(o.cols, c + (ctx.lod === 0 ? 1 : 3)) * cw, h.v0, h.v1, d, litSeed(seed, k, c));
    if (ctx.lod === 2) return;
    fq(ctx, wallMat, f, [h.u0, h.v0, 0], [h.u0, h.v0, -R], [h.u0, h.v1, -R], [h.u0, h.v1, 0]);
    fq(ctx, wallMat, f, [h.u1, h.v0, -R], [h.u1, h.v0, 0], [h.u1, h.v1, 0], [h.u1, h.v1, -R]);
    fq(ctx, wallMat, f, [h.u0, h.v1, -R], [h.u1, h.v1, -R], [h.u1, h.v1, 0], [h.u0, h.v1, 0]);
    fbox(ctx, 'encadrement', f, h.u0, h.u1, h.v0 - 0.06, h.v0, -R, 0.05, 'back');
    const mm = o.mullionMat ?? 'meneau';
    for (let c = 1; c < o.cols; c += ctx.lod === 0 ? 1 : 3) {
      const u = h.u0 + c * cw;
      fbox(ctx, mm, f, u - 0.035, u + 0.035, h.v0, h.v1, d, d + 0.06, 'back top bottom');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Ordres classiques                                                    */
/* ------------------------------------------------------------------ */

/** Colonne : base, fût cylindrique (léger galbe), chapiteau. */
export function column(ctx: Ctx, mat: string, x: number, y0: number, z: number, r: number, h: number): void {
  const seg = ctx.lod === 0 ? 14 : ctx.lod === 1 ? 8 : 6;
  const bh = r * 0.7;
  if (ctx.lod < 2) {
    ctx.mb.box(mat, x - r * 1.35, y0, z - r * 1.35, x + r * 1.35, y0 + bh * 0.5, z + r * 1.35, 'ny');
    ctx.mb.cylinder(mat, x, y0 + bh * 0.5, z, r * 1.15, bh * 0.5, seg, false, r);
  }
  ctx.mb.cylinder(mat, x, y0 + bh, z, r, h - 2 * bh, seg, false, r * 0.86);
  if (ctx.lod < 2) {
    ctx.mb.cylinder(mat, x, y0 + h - bh, z, r * 0.86, bh * 0.5, seg, false, r * 1.2);
    ctx.mb.box(mat, x - r * 1.35, y0 + h - bh * 0.5, z - r * 1.35, x + r * 1.35, y0 + h, z + r * 1.35, '');
  } else ctx.mb.box(mat, x - r * 1.3, y0 + h - bh, z - r * 1.3, x + r * 1.3, y0 + h, z + r * 1.3, 'ny');
}

/** Fronton triangulaire (tympan + corniches rampantes couvertes) posé sur un entablement en `v`. */
export function pediment(ctx: Ctx, mat: string, f: Frame, u0: number, u1: number, v: number, h: number, depth: number, d0 = 0): void {
  const uc = (u0 + u1) / 2;
  const df = d0 + depth;
  const db = d0 - 0.5;
  // tympan
  fpf(ctx, mat, f, [[u0, v, df], [u1, v, df], [uc, v + h, df]], [0, 0, 1]);
  const e = 0.22;
  const L = Math.hypot(uc - u0, h);
  const t = 0.28;
  const nu = (h / L) * t, nv = ((uc - u0) / L) * t; // normale (vers l'extérieur) du rampant gauche : (-nu, nv)
  const lo0: V3 = [u0 - e, v - 0.02, df + e], hi0: V3 = [uc, v + h + 0.02, df + e];
  const lo0o: V3 = [u0 - e - nu, v - 0.02 + nv, df + e], hi0o: V3 = [uc, v + h + 0.02 + t * 1.15, df + e];
  const lo1: V3 = [u1 + e, v - 0.02, df + e], lo1o: V3 = [u1 + e + nu, v - 0.02 + nv, df + e];
  // corniches rampantes (faces avant)
  fpf(ctx, mat, f, [lo0, hi0, hi0o, lo0o], [0, 0, 1]);
  fpf(ctx, mat, f, [lo1, lo1o, hi0o, hi0], [0, 0, 1]);
  // couverture des rampants
  fpf(ctx, 'toiture', f, [lo0o, hi0o, [hi0o[0], hi0o[1], db], [lo0o[0], lo0o[1], db]], [-nu, nv, 0]);
  fpf(ctx, 'toiture', f, [hi0o, lo1o, [lo1o[0], lo1o[1], db], [hi0o[0], hi0o[1], db]], [nu, nv, 0]);
  // sous-faces des rampants
  if (ctx.lod < 2) {
    fpf(ctx, mat, f, [lo0, [lo0[0], lo0[1], df], [hi0[0], hi0[1], df], hi0], [nu, -nv, 0]);
    fpf(ctx, mat, f, [lo1, [lo1[0], lo1[1], df], [hi0[0], hi0[1], df], hi0], [-nu, -nv, 0]);
  }
  // corniche horizontale (entablement)
  fbox(ctx, mat, f, u0 - e, u1 + e, v - 0.35, v, db, df + e, '');
}

/** Emmarchement (marches) devant une façade : n marches de hauteur totale H et de giron g. */
export function steps(ctx: Ctx, mat: string, f: Frame, u0: number, u1: number, H: number, n: number, g = 0.32): void {
  const rh = H / n;
  for (let i = 0; i < n; i++) {
    const d1 = (n - i) * g;
    fbox(ctx, mat, f, u0 - (ctx.lod === 0 ? 0 : 0), u1, i * rh, (i + 1) * rh, 0, d1, 'back bottom');
  }
}

/* ------------------------------------------------------------------ */
/* Stores, auvents, mobilier                                            */
/* ------------------------------------------------------------------ */

/** Store banne rayé (lambrequin festonné au LOD0). */
export function stripedAwning(ctx: Ctx, f: Frame, u0: number, u1: number, v: number, depth = 1.4, drop = 0.6, o: { a?: string; b?: string; stripe?: number; valance?: number } = {}): void {
  const A = o.a ?? 'store_a', B = o.b ?? 'store_b';
  const st = o.stripe ?? 0.32;
  const val = o.valance ?? 0.25;
  if (ctx.lod === 2) {
    fpf(ctx, A, f, [[u0, v, 0.05], [u1, v, 0.05], [u1, v - drop, depth], [u0, v - drop, depth]], [0, depth, drop]);
    return;
  }
  const n = Math.max(1, Math.round((u1 - u0) / st));
  const sw = (u1 - u0) / n;
  for (let i = 0; i < n; i++) {
    const a = u0 + i * sw, b = a + sw;
    const m = i % 2 === 0 ? A : B;
    fpf(ctx, m, f, [[a, v, 0.05], [b, v, 0.05], [b, v - drop, depth], [a, v - drop, depth]], [0, depth, drop]);
    // lambrequin
    if (ctx.lod === 0) fpf(ctx, m, f, [[a, v - drop, depth], [b, v - drop, depth], [b, v - drop - val * 0.6, depth], [(a + b) / 2, v - drop - val, depth], [a, v - drop - val * 0.6, depth]], [0, 0, 1]);
    else fpf(ctx, m, f, [[a, v - drop - val, depth], [b, v - drop - val, depth], [b, v - drop, depth], [a, v - drop, depth]], [0, 0, 1]);
  }
  fpf(ctx, A, f, [[u0, v, 0.05], [u0, v - drop, depth], [u0, v - drop - val * 0.6, depth]], [-1, 0, 0]);
  fpf(ctx, A, f, [[u1, v - drop - val * 0.6, depth], [u1, v - drop, depth], [u1, v, 0.05]], [1, 0, 0]);
  // bras articulés
  if (ctx.lod === 0) for (const u of [u0 + 0.15, u1 - 0.15]) ctx.mb.tube('garde_corps', P(f, u, v - drop - 0.4, 0.05), P(f, u, v - drop + 0.02, depth - 0.05), 0.025, 5);
}

/** Lampadaire urbain (mât, crosse, lanterne). */
export function lampPost(ctx: Ctx, x: number, y: number, z: number, h = 6, dir: V3 = [0, 0, 1]): void {
  if (ctx.lod === 2) { ctx.mb.box('garde_corps', x - 0.07, y, z - 0.07, x + 0.07, y + h, z + 0.07, 'ny'); return; }
  const seg = ctx.lod === 0 ? 8 : 5;
  ctx.mb.cylinder('garde_corps', x, y, z, 0.11, 0.6, seg, false, 0.08);
  ctx.mb.cylinder('garde_corps', x, y + 0.6, z, 0.07, h - 0.6, seg, true, 0.05);
  const ax = x + dir[0] * 1.1, az = z + dir[2] * 1.1;
  ctx.mb.tube('garde_corps', [x, y + h - 0.1, z], [ax, y + h + 0.05, az], 0.04, seg);
  ctx.mb.box('garde_corps', ax - 0.28, y + h - 0.05, az - 0.18, ax + 0.28, y + h + 0.12, az + 0.18, '');
  const prev = ctx.mb.lit; ctx.mb.lit = 2;
  ctx.mb.quad('verre', [ax - 0.24, y + h - 0.06, az + 0.15], [ax - 0.24, y + h - 0.06, az - 0.15], [ax + 0.24, y + h - 0.06, az - 0.15], [ax + 0.24, y + h - 0.06, az + 0.15]);
  ctx.mb.lit = prev;
}

/** Drapeau sur mât (couleurs en bandes verticales : rôles de la palette). */
export function flagPole(ctx: Ctx, x: number, y: number, z: number, h: number, stripes: string[], dir: V3 = [1, 0, 0]): void {
  const seg = ctx.lod === 0 ? 8 : 4;
  ctx.mb.cylinder('acier', x, y, z, 0.05, h, seg, true, 0.035);
  if (ctx.lod < 2) ctx.mb.cylinder('logo_b', x, y + h, z, 0.07, 0.1, seg, true, 0.02);
  const fw = 1.6, fh = 1.05;
  const n = stripes.length;
  for (let i = 0; i < n; i++) {
    const a = 0.06 + (fw * i) / n, b = 0.06 + (fw * (i + 1)) / n;
    const wave = (t: number): number => (ctx.lod === 0 ? Math.sin(t * 3.2) * 0.12 : 0);
    const p = (t: number, yy: number): V3 => [x + dir[0] * t - dir[2] * wave(t), yy, z + dir[2] * t + dir[0] * wave(t)];
    ctx.mb.quad(stripes[i]!, p(a, y + h - 0.15 - fh), p(b, y + h - 0.15 - fh), p(b, y + h - 0.15), p(a, y + h - 0.15));
    ctx.mb.quad(stripes[i]!, p(b, y + h - 0.15 - fh), p(a, y + h - 0.15 - fh), p(a, y + h - 0.15), p(b, y + h - 0.15));
  }
}

/** Banc public (pieds métal, lames bois). */
export function bench(ctx: Ctx, x: number, y: number, z: number, rot = 0, L = 1.8): void {
  const { mb } = ctx;
  mb.push(x, y, z, rot);
  if (ctx.lod === 2) { mb.box('bois', -L / 2, 0.4, -0.25, L / 2, 0.48, 0.25, 'ny'); mb.pop(); return; }
  for (const sx of [-L / 2 + 0.15, L / 2 - 0.15]) {
    mb.box('garde_corps', sx - 0.03, 0, -0.25, sx + 0.03, 0.42, 0.22, '');
    mb.box('garde_corps', sx - 0.03, 0.42, -0.28, sx + 0.03, 0.85, -0.22, '');
  }
  const ns = ctx.lod === 0 ? 3 : 1;
  for (let i = 0; i < ns; i++) {
    const z0 = -0.22 + (0.46 * i) / ns;
    mb.box('bois', -L / 2, 0.42, z0 + 0.01, L / 2, 0.46, z0 + 0.46 / ns - 0.01, '');
  }
  mb.box('bois', -L / 2, 0.58, -0.3, L / 2, 0.8, -0.26, '');
  mb.pop();
}

/** Parasol (mât + toile octogonale) et table ronde avec chaises. */
export function terraceSet(ctx: Ctx, x: number, y: number, z: number, umbrella: string | null = 'store_a'): void {
  const { mb } = ctx;
  const seg = ctx.lod === 0 ? 10 : 6;
  if (ctx.lod < 2) {
    mb.cylinder('garde_corps', x, y, z, 0.25, 0.03, seg, true);
    mb.cylinder('garde_corps', x, y + 0.03, z, 0.03, 0.7, 5, false);
    mb.cylinder('bois', x, y + 0.72, z, 0.38, 0.03, seg, true);
    for (let k = 0; k < (ctx.lod === 0 ? 2 : 0); k++) {
      const a = k * Math.PI + 0.4;
      const cx = x + Math.cos(a) * 0.65, cz = z + Math.sin(a) * 0.65;
      mb.push(cx, y, cz, -a);
      mb.box('garde_corps', -0.2, 0, -0.2, -0.17, 0.45, -0.17); mb.box('garde_corps', 0.17, 0, -0.2, 0.2, 0.45, -0.17);
      mb.box('garde_corps', -0.2, 0, 0.17, -0.17, 0.85, 0.2); mb.box('garde_corps', 0.17, 0, 0.17, 0.2, 0.85, 0.2);
      mb.box('bois', -0.21, 0.45, -0.21, 0.21, 0.48, 0.21);
      mb.box('bois', -0.21, 0.6, 0.17, 0.21, 0.85, 0.2);
      mb.pop();
    }
  }
  if (umbrella) {
    mb.cylinder('garde_corps', x, y + 0.75, z, 0.025, 1.6, 4, false);
    const n = ctx.lod === 0 ? 8 : 6;
    const R = 1.25, top = y + 2.55, rim = y + 2.15;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      const m = i % 2 === 0 || ctx.lod === 2 ? umbrella : 'store_b';
      const mc = (a + b) / 2;
      mb.polyFacing(m, [[x, top, z], [x + Math.cos(b) * R, rim, z + Math.sin(b) * R], [x + Math.cos(a) * R, rim, z + Math.sin(a) * R]], [Math.cos(mc), 2, Math.sin(mc)]);
      if (ctx.lod === 0) mb.polyFacing(m, [[x + Math.cos(a) * R, rim, z + Math.sin(a) * R], [x + Math.cos(b) * R, rim, z + Math.sin(b) * R], [x + Math.cos(b) * R, rim - 0.18, z + Math.sin(b) * R], [x + Math.cos(a) * R, rim - 0.18, z + Math.sin(a) * R]], [Math.cos(mc), 0, Math.sin(mc)]);
    }
  }
}

/** Jardinière rectangulaire plantée. */
export function planter(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, h = 0.5, mat = 'dalle'): void {
  ctx.mb.box(mat, x0, y, z0, x1, y + h, z1, 'ny py');
  ctx.mb.box('vegetal', x0 + 0.06, y + h - 0.02, z0 + 0.06, x1 - 0.06, y + h + (ctx.lod === 0 ? 0.35 : 0.2), z1 - 0.06, 'ny');
  if (ctx.lod < 2) {
    ctx.mb.quad(mat, [x0, y + h, z1], [x1, y + h, z1], [x1 - 0.06, y + h, z1 - 0.06], [x0 + 0.06, y + h, z1 - 0.06]);
    ctx.mb.quad(mat, [x1, y + h, z0], [x0, y + h, z0], [x0 + 0.06, y + h, z0 + 0.06], [x1 - 0.06, y + h, z0 + 0.06]);
  }
}

/** Arbuste en touffe : grappe de boules irrégulières (déterministe), en matériau végétal. */
export function shrub(ctx: Ctx, x: number, y: number, z: number, r: number, mat = 'vegetal'): void {
  const seg = ctx.lod === 0 ? 9 : 6;
  const sv = ctx.lod === 0 ? 4 : 3;
  if (ctx.lod === 2) { dome(ctx, mat, x, y, z, r, 6, 2, 0.85, false); return; }
  const k = litSeed(Math.round(x * 10), Math.round(z * 10), 3);
  const blobs: [number, number, number, number][] = [
    [0, r * 0.55, 0, r * 0.62], [r * 0.42, r * 0.4, r * 0.18, r * 0.5], [-r * 0.38, r * 0.38, r * 0.25, r * 0.48],
    [r * 0.1, r * 0.42, -r * 0.42, r * 0.5], [-r * 0.15, r * 0.82, -r * 0.05, r * 0.42],
  ];
  blobs.forEach(([dx, dy, dz, rr], i) => {
    const a = k * 6.28 + i * 0.9;
    const c = Math.cos(a), s = Math.sin(a);
    dome(ctx, mat, x + dx * c - dz * s, y + dy, z + dx * s + dz * c, rr, seg, sv, 0.9, true);
  });
}

/** Calotte / sphère (dôme si `full` faux) à facettes lisses. hScale écrase verticalement. */
export function dome(ctx: Ctx, mat: string, x: number, y: number, z: number, r: number, segU: number, segV: number, hScale = 1, full = false): void {
  const pts: V3[] = [];
  const nors: V3[] = [];
  const tris: number[] = [];
  const vMin = full ? -Math.PI / 2 : 0;
  for (let j = 0; j <= segV; j++) {
    const phi = vMin + ((Math.PI / 2 - vMin) * j) / segV;
    for (let i = 0; i <= segU; i++) {
      const th = (i / segU) * Math.PI * 2;
      const nx = Math.cos(phi) * Math.cos(th), ny = Math.sin(phi), nz = Math.cos(phi) * Math.sin(th);
      pts.push([x + nx * r, y + ny * r * hScale, z + nz * r]);
      const n: V3 = [nx, ny / hScale, nz];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      nors.push([n[0] / l, n[1] / l, n[2] / l]);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    tris.push(a, c, b, b, c, d);
  }
  ctx.mb.smooth(mat, pts, nors, tris);
}

/** Cône / pyramide à n pans (flèche, toit de kiosque). */
export function spire(ctx: Ctx, mat: string, x: number, y: number, z: number, r: number, h: number, n: number, rot0 = Math.PI / 4): void {
  for (let i = 0; i < n; i++) {
    const a = rot0 - (i / n) * Math.PI * 2, b = rot0 - ((i + 1) / n) * Math.PI * 2;
    ctx.mb.polyFacing(mat, [[x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(b) * r, y, z + Math.sin(b) * r], [x, y + h, z]],
      [Math.cos((a + b) / 2), 0.3, Math.sin((a + b) / 2)]);
  }
}

/** Cylindre horizontal entre A et B (cuves, galeries, conduites) avec fonds plats. */
export function hCylinder(ctx: Ctx, mat: string, A: V3, B: V3, r: number, seg: number, caps = true): void {
  ctx.mb.tube(mat, A, B, r, seg, false);
  if (!caps) return;
  const d: V3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const ax: V3 = [d[0] / L, d[1] / L, d[2] / L];
  const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1: V3 = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
  const l1 = Math.hypot(...e1); e1[0] /= l1; e1[1] /= l1; e1[2] /= l1;
  const e2: V3 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
  for (const [C, s] of [[A, -1], [B, 1]] as const) {
    const pts: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pts.push([C[0] + (e1[0] * Math.cos(t) + e2[0] * Math.sin(t)) * r, C[1] + (e1[1] * Math.cos(t) + e2[1] * Math.sin(t)) * r, C[2] + (e1[2] * Math.cos(t) + e2[2] * Math.sin(t)) * r]);
    }
    ctx.mb.polyFacing(mat, pts, [ax[0] * s, ax[1] * s, ax[2] * s]);
  }
}

/* ------------------------------------------------------------------ */
/* Sols extérieurs : parkings, cours                                    */
/* ------------------------------------------------------------------ */

/** Dalle de sol (dessus seulement + chant) de x0..x1 × z0..z1, épaisseur h. */
export function slab(ctx: Ctx, mat: string, x0: number, z0: number, x1: number, z1: number, y: number, h = 0.12): void {
  ctx.mb.box(mat, x0, y, z0, x1, y + h, z1, 'ny');
}

/** Ligne de marquage au sol (quad légèrement surélevé). */
export function mark(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, mat = 'marquage'): void {
  ctx.mb.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}

/**
 * Parking en enrobé : places en épi droit des deux côtés d'allées parallèles à X, bordures, îlots plantés,
 * lampadaires. y = niveau du sol fini.
 */
export function parkingLot(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, o: { stallW?: number; stallD?: number; aisle?: number; lamps?: boolean; islands?: boolean; disabled?: number } = {}): void {
  const sw = o.stallW ?? 2.5, sd = o.stallD ?? 5, ai = o.aisle ?? 6;
  slab(ctx, 'sol', x0, z0, x1, z1, y - 0.1, 0.1);
  // bordures périphériques
  if (ctx.lod < 2) {
    const b = 0.15, bh = 0.14;
    ctx.mb.box('bordure', x0, y, z0, x1, y + bh, z0 + b, 'ny');
    ctx.mb.box('bordure', x0, y, z1 - b, x0 + (x1 - x0) * 0.35, y + bh, z1, 'ny');
    ctx.mb.box('bordure', x1 - (x1 - x0) * 0.35, y, z1 - b, x1, y + bh, z1, 'ny');
    ctx.mb.box('bordure', x0, y, z0 + b, x0 + b, y + bh, z1 - b, 'ny');
    ctx.mb.box('bordure', x1 - b, y, z0 + b, x1, y + bh, z1 - b, 'ny');
  }
  if (ctx.lod === 2) return;
  const yy = y + 0.012;
  const lw = 0.12;
  // rangées : double rangée (dos à dos) + allée, répétées
  let z = z0 + 0.4;
  const rowsZ: [number, number, number][] = []; // [zStart, zEnd, dir]
  while (z + sd <= z1 - 0.4) {
    rowsZ.push([z, z + sd, 1]);
    z += sd;
    if (z + ai + sd <= z1 - 0.4) { z += ai; rowsZ.push([z, z + sd, -1]); z += sd; }
    else break;
    if (z + sd * 2 <= z1 - 0.4) { /* îlot entre rangées dos à dos */ z += 0; }
  }
  const nx = Math.floor((x1 - x0 - 1.2) / sw);
  const sx0 = (x0 + x1) / 2 - (nx * sw) / 2;
  let rowIdx = 0;
  for (const [za, zb] of rowsZ) {
    for (let i = 0; i <= nx; i++) {
      const x = sx0 + i * sw;
      mark(ctx, x - lw / 2, za, x + lw / 2, zb, yy);
    }
    // ligne de fond de place
    mark(ctx, sx0, (rowIdx % 2 === 0 ? za : zb) - lw / 2, sx0 + nx * sw, (rowIdx % 2 === 0 ? za : zb) + lw / 2, yy);
    if (ctx.lod === 0 && (o.disabled ?? 0) > 0 && rowIdx === rowsZ.length - 1) {
      for (let k = 0; k < (o.disabled ?? 0); k++) {
        const x = sx0 + (nx - 1 - k) * sw;
        ctx.mb.quad('marquage_b', [x + 0.15, yy - 0.004, zb], [x + sw - 0.15, yy - 0.004, zb], [x + sw - 0.15, yy - 0.004, za], [x + 0.15, yy - 0.004, za]);
      }
    }
    rowIdx++;
  }
  // flèches de circulation dans les allées
  if (ctx.lod === 0) {
    for (let k = 1; k < rowsZ.length; k += 2) {
      const zc = (rowsZ[k - 1]![1] + rowsZ[k]![0]) / 2;
      for (const xc of [x0 + (x1 - x0) * 0.3, x0 + (x1 - x0) * 0.7]) {
        mark(ctx, xc - 1.2, zc - 0.08, xc + 0.4, zc + 0.08, yy);
        ctx.mb.polyFacing('marquage', [[xc + 0.4, yy, zc + 0.45], [xc + 1.2, yy, zc], [xc + 0.4, yy, zc - 0.45]], [0, 1, 0]);
      }
    }
  }
  if (o.lamps !== false) {
    for (const lx of [x0 + 0.6, x1 - 0.6]) lampPost(ctx, lx, y, (z0 + z1) / 2, 7, [lx < (x0 + x1) / 2 ? 1 : -1, 0, 0]);
  }
}

/* ------------------------------------------------------------------ */
/* Industrie                                                            */
/* ------------------------------------------------------------------ */

/** Escalier de secours métallique en façade : paliers à chaque étage, volées en zigzag. */
export function fireEscape(ctx: Ctx, f: Frame, u0: number, u1: number, levels: number[], depth = 1.2): void {
  if (ctx.lod === 2) return;
  const t = 0.06;
  for (const v of levels) {
    fbox(ctx, 'garde_corps', f, u0, u1, v - t, v, 0, depth, 'back');
    if (ctx.lod === 0) {
      const a = P(f, u0, v, depth - 0.03), b = P(f, u1, v, depth - 0.03);
      railingSimple(ctx, a, b, 1.0);
      railingSimple(ctx, P(f, u0 + 0.03, v, 0.05), P(f, u0 + 0.03, v, depth - 0.03), 1.0);
      railingSimple(ctx, P(f, u1 - 0.03, v, depth - 0.03), P(f, u1 - 0.03, v, 0.05), 1.0);
      // consoles
      for (const u of [u0 + 0.1, u1 - 0.1]) ft(ctx, 'garde_corps', f, [u, v - t, 0], [u, v - t, depth * 0.9], [u, v - 0.8, 0]);
    }
  }
  // volées entre paliers
  for (let i = 0; i < levels.length - 1; i++) {
    const va = levels[i]!, vb = levels[i + 1]!;
    const left = i % 2 === 0;
    const ua = left ? u0 + 0.2 : u1 - 0.2;
    const ub = left ? u1 - 0.6 : u0 + 0.6;
    const da = depth * 0.25, db = depth * 0.85;
    // limon (planche inclinée)
    fpf(ctx, 'garde_corps', f, [[ua, va, da], [ub, vb - t, da], [ub, vb - t, db], [ua, va, db]], [0, 1, 0]);
    fpf(ctx, 'garde_corps', f, [[ua, va - 0.08, da], [ub, vb - t - 0.08, da], [ub, vb - t - 0.08, db], [ua, va - 0.08, db]], [0, -1, 0]);
    if (ctx.lod === 0) ctx.mb.tube('garde_corps', P(f, ua, va + 0.95, db), P(f, ub, vb + 0.95 - t, db), 0.025, 4);
  }
}

/** Garde-corps simple : main courante + lisse + barreaux espacés. */
export function railingSimple(ctx: Ctx, A: V3, B: V3, h: number): void {
  const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
  ctx.mb.tube('garde_corps', [A[0], A[1] + h, A[2]], [B[0], B[1] + h, B[2]], 0.025, 4);
  ctx.mb.tube('garde_corps', [A[0], A[1] + h * 0.5, A[2]], [B[0], B[1] + h * 0.5, B[2]], 0.015, 4);
  const n = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, z = A[2] + (B[2] - A[2]) * t;
    ctx.mb.box('garde_corps', x - 0.02, y, z - 0.02, x + 0.02, y + h, z + 0.02, 'ny py');
  }
}

/**
 * Toiture en sheds : n dents parallèles à X ; pans opaques inclinés vers +Z (sud) et verrières verticales au nord.
 * Ferme les pignons (triangles) aux extrémités x0/x1 avec `wallMat`.
 */
export function sawtoothRoof(ctx: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, n: number, h: number, o: { roofMat?: string; wallMat?: string } = {}): void {
  const rm = o.roofMat ?? 'toiture';
  const wm = o.wallMat ?? 'facade';
  const dz = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const za = z1 - i * dz;      // égout bas (sud)
    const zb = za - dz;          // faîtage (nord), verrière verticale
    ctx.mb.polyFacing(rm, [[x0 - 0.2, y, za + 0.15], [x1 + 0.2, y, za + 0.15], [x1 + 0.2, y + h, zb], [x0 - 0.2, y + h, zb]], [0, 1, 0.3]);
    // verrière (face nord)
    const cols = ctx.lod === 2 ? 1 : Math.max(1, Math.round((x1 - x0) / 2.2));
    const cw = (x1 - x0) / cols;
    for (let c = 0; c < cols; c++) {
      const prev = ctx.mb.lit; ctx.mb.lit = litSeed(i, c, 7);
      ctx.mb.polyFacing('verre', [[x0 + c * cw, y + 0.25, zb], [x0 + (c + 1) * cw, y + 0.25, zb], [x0 + (c + 1) * cw, y + h - 0.12, zb], [x0 + c * cw, y + h - 0.12, zb]], [0, 0, -1]);
      ctx.mb.lit = prev;
      if (ctx.lod === 0 && c > 0) ctx.mb.box('meneau', x0 + c * cw - 0.04, y + 0.25, zb - 0.06, x0 + c * cw + 0.04, y + h - 0.12, zb + 0.02);
    }
    ctx.mb.polyFacing(rm, [[x0, y, zb], [x1, y, zb], [x1, y + 0.25, zb], [x0, y + 0.25, zb]], [0, 0, -1]);
    if (ctx.lod < 2) {
      ctx.mb.box('zinc', x0 - 0.2, y + h - 0.12, zb - 0.08, x1 + 0.2, y + h + 0.05, zb + 0.1);
      ctx.mb.tube('zinc', [x0 - 0.2, y + 0.05, za + 0.2], [x1 + 0.2, y + 0.05, za + 0.2], 0.08, ctx.lod === 0 ? 6 : 4, true);
    }
    // pignons
    for (const [x, s] of [[x0, -1], [x1, 1]] as const) ctx.mb.polyFacing(wm, [[x, y, za], [x, y, zb], [x, y + h, zb]], [s, 0, 0]);
  }
}

/** Grande cheminée d'usine en brique : fût tronconique, bagues, couronnement. */
export function factoryChimney(ctx: Ctx, x: number, z: number, y0: number, h: number, r0: number, r1: number, mat = 'cheminee'): void {
  const seg = ctx.lod === 0 ? 16 : ctx.lod === 1 ? 10 : 6;
  // socle carré
  ctx.mb.box(mat, x - r0 * 1.25, y0, z - r0 * 1.25, x + r0 * 1.25, y0 + 3, z + r0 * 1.25, 'ny');
  if (ctx.lod < 2) ctx.mb.box('encadrement', x - r0 * 1.32, y0 + 3, z - r0 * 1.32, x + r0 * 1.32, y0 + 3.3, z + r0 * 1.32, 'ny');
  ctx.mb.cylinder(mat, x, y0 + 3, z, r0, h - 3, seg, false, r1);
  const top = y0 + h;
  // bagues métalliques
  if (ctx.lod < 2) {
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const yy = y0 + 3 + (h - 3) * t;
      const rr = r0 + (r1 - r0) * t + 0.03;
      ctx.mb.cylinder('garde_corps', x, yy, z, rr, 0.12, seg, false);
    }
  }
  // couronnement évasé
  ctx.mb.cylinder(mat, x, top, z, r1, 0.6, seg, false, r1 * 1.18);
  ctx.mb.cylinder(mat, x, top + 0.6, z, r1 * 1.18, 0.5, seg, false, r1 * 1.18);
  // intérieur sombre (conduit)
  const pts: V3[] = [];
  for (let i = seg - 1; i >= 0; i--) { const t = (i / seg) * Math.PI * 2; pts.push([x + Math.cos(t) * r1 * 1.18, top + 1.1, z + Math.sin(t) * r1 * 1.18]); }
  ctx.mb.poly('garde_corps', pts);
  // échelle à crinoline
  if (ctx.lod === 0) {
    const zr = z + r0 + 0.12;
    ctx.mb.box('garde_corps', x - 0.22, y0 + 3.3, zr, x - 0.19, top, zr + 0.04);
    ctx.mb.box('garde_corps', x + 0.19, y0 + 3.3, zr, x + 0.22, top, zr + 0.04);
  }
}

/** Quai de chargement (dans un trou `r` réservé) : porte sectionnelle, sas d'étanchéité, butoirs, niveleur, auvent, feu. */
export function loadingDock(ctx: Ctx, f: Frame, r: Rect, dockH: number): void {
  const w = r.u1 - r.u0;
  const uvs: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
  fq(ctx, 'store', f, [r.u0, r.v0, ctx.lod === 2 ? 0.03 : -0.1], [r.u1, r.v0, ctx.lod === 2 ? 0.03 : -0.1], [r.u1, r.v1, ctx.lod === 2 ? 0.03 : -0.1], [r.u0, r.v1, ctx.lod === 2 ? 0.03 : -0.1], uvs);
  // massif du quai (béton) sous la porte
  fbox(ctx, 'beton', f, r.u0 - 0.6, r.u1 + 0.6, 0, dockH, 0, 0.5, 'back bottom');
  if (ctx.lod === 2) return;
  // tableaux
  fq(ctx, 'acier', f, [r.u0, r.v0, 0], [r.u0, r.v0, -0.1], [r.u0, r.v1, -0.1], [r.u0, r.v1, 0]);
  fq(ctx, 'acier', f, [r.u1, r.v0, -0.1], [r.u1, r.v0, 0], [r.u1, r.v1, 0], [r.u1, r.v1, -0.1]);
  fq(ctx, 'acier', f, [r.u0, r.v1, -0.1], [r.u1, r.v1, -0.1], [r.u1, r.v1, 0], [r.u0, r.v1, 0]);
  // sas d'étanchéité (bourrelets sombres)
  fbox(ctx, 'garde_corps', f, r.u0 - 0.35, r.u0, r.v0, r.v1 + 0.3, 0, 0.6, 'back');
  fbox(ctx, 'garde_corps', f, r.u1, r.u1 + 0.35, r.v0, r.v1 + 0.3, 0, 0.6, 'back');
  fbox(ctx, 'garde_corps', f, r.u0 - 0.35, r.u1 + 0.35, r.v1, r.v1 + 0.5, 0, 0.6, 'back');
  // niveleur + butoirs
  fbox(ctx, 'acier', f, r.u0 + 0.1, r.u1 - 0.1, dockH - 0.02, dockH + 0.02, 0, 0.55, 'back');
  if (ctx.lod === 0) {
    for (const u of [r.u0 + 0.15, r.u1 - 0.45]) fbox(ctx, 'garde_corps', f, u, u + 0.3, dockH - 0.5, dockH - 0.1, 0.5, 0.65, 'back');
    // bandes de sécurité jaunes
    fbox(ctx, 'marquage_j', f, r.u0 - 0.6, r.u1 + 0.6, dockH - 0.12, dockH - 0.02, 0.5, 0.51, 'back');
    // feu de quai
    fbox(ctx, 'acier', f, r.u1 + 0.5, r.u1 + 0.75, r.v0 + 1.2, r.v0 + 1.8, 0, 0.12, 'back');
    disc(ctx, 'logo', f, r.u1 + 0.625, r.v0 + 1.62, 0.07, 0.125, 8);
    disc(ctx, 'vegetal', f, r.u1 + 0.625, r.v0 + 1.38, 0.07, 0.125, 8);
  }
  void w;
}

/* ------------------------------------------------------------------ */
/* Divers                                                               */
/* ------------------------------------------------------------------ */

/** Clôture (poteaux + panneaux grillagés en rôle garde_corps) le long de A→B. */
export function fence(ctx: Ctx, A: V3, B: V3, h = 1.8): void {
  if (ctx.lod === 2) return;
  const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
  const n = Math.max(1, Math.round(L / 2.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = A[0] + (B[0] - A[0]) * t, z = A[2] + (B[2] - A[2]) * t;
    ctx.mb.box('garde_corps', x - 0.04, A[1], z - 0.04, x + 0.04, A[1] + h, z + 0.04, 'ny');
  }
  const ang = Math.atan2(-(B[2] - A[2]), B[0] - A[0]);
  ctx.mb.push(A[0], A[1], A[2], ang);
  const bars = ctx.lod === 0 ? Math.round(L / 0.2) : 0;
  ctx.mb.box('garde_corps', 0, h - 0.06, -0.02, L, h, 0.02);
  ctx.mb.box('garde_corps', 0, 0.1, -0.02, L, 0.16, 0.02);
  for (let i = 1; i < bars; i++) { const x = (L * i) / bars; ctx.mb.box('garde_corps', x - 0.012, 0.16, -0.012, x + 0.012, h - 0.06, 0.012, 'ny py'); }
  ctx.mb.pop();
}

/** Bloc de climatiseurs muraux (façades arrière). */
export function wallAC(ctx: Ctx, f: Frame, u: number, v: number): void {
  if (ctx.lod === 2) return;
  fbox(ctx, 'equipement', f, u - 0.42, u + 0.42, v, v + 0.6, 0, 0.32, 'back');
  if (ctx.lod === 0) {
    disc(ctx, 'garde_corps', f, u - 0.08, v + 0.3, 0.2, 0.325, 10);
    fbox(ctx, 'garde_corps', f, u - 0.36, u - 0.33, v - 0.25, v, 0.05, 0.3, 'back');
    fbox(ctx, 'garde_corps', f, u + 0.33, u + 0.36, v - 0.25, v, 0.05, 0.3, 'back');
  }
}

/** Palette de bois chargée (caisses filmées). */
export function pallet(ctx: Ctx, x: number, y: number, z: number, load = true, rot = 0): void {
  const { mb } = ctx;
  mb.push(x, y, z, rot);
  mb.box('bois', -0.6, 0, -0.4, 0.6, 0.15, 0.4, 'ny');
  if (load) mb.box(ctx.lod === 0 ? 'tissu' : 'tissu', -0.55, 0.15, -0.35, 0.55, 1.05, 0.35, 'ny');
  mb.pop();
}

/** Raccourci : matériau texturé. */
export const M = (set: string, color?: string, extra: Partial<KitMaterial> = {}): KitMaterial => ({ set, ...(color ? { color } : {}), ...extra });

export { fbox, fq, ft, glass, P };

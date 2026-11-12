/**
 * Kit bâtiments — TOITURES : deux pans (pignons, débords, rives, chevrons/pannes apparents), quatre pans (croupes,
 * sous-faces caissonnées, arêtiers), mono-pente, terrasse (acrotère, couvertine, équipements, édicule),
 * mansarde (brisis + terrasson, lucarnes), lucarnes, souches de cheminée, gouttières, génoise.
 *
 * Coordonnées locales du maillage (Y vers le haut). Pente en degrés.
 */
import type { V3 } from './mesh';
import { fbox, P, type Ctx, type Frame, window as windowFn, wall, type WindowOpts } from './facade';

const rad = (deg: number): number => (deg * Math.PI) / 180;

export interface GableOpts {
  x0: number; x1: number; z0: number; z1: number;
  /** Hauteur de l'égout (dessus des murs). */
  y: number;
  pitch: number;
  /** Direction du faîtage. */
  axis: 'x' | 'z';
  overhang?: number;
  /** Débord en rive (pignons). */
  verge?: number;
  thickness?: number;
  roofMat?: string;
  /** Matériau des pignons (triangles de mur) ; null = pas de pignon (mitoyen / autre volume). */
  gableMat?: string | null;
  /** Pignons à dessiner : [extrémité basse, extrémité haute] le long du faîtage. */
  gables?: [boolean, boolean];
  gutters?: boolean;
  /** Pannes et chevrons apparents (chalet). */
  timber?: boolean;
  ridgeMat?: string;
}

export interface RoofResult { ridgeY: number; eaveY: number }

/** Toit à deux pans. Renvoie la hauteur du faîtage (dessus) et de l'égout (dessous du débord). */
export function gableRoof(ctx: Ctx, o: GableOpts): RoofResult {
  const { mb } = ctx;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  const alongX = o.axis === 'x';
  const Lh = (alongX ? o.x1 - o.x0 : o.z1 - o.z0) / 2;
  const Wh = (alongX ? o.z1 - o.z0 : o.x1 - o.x0) / 2;
  const tn = Math.tan(rad(o.pitch));
  const oh = o.overhang ?? 0.45;
  const vg = o.verge ?? 0.3;
  const t = o.thickness ?? 0.2;
  const tv = t / Math.cos(rad(o.pitch));
  const rm = o.roofMat ?? 'toiture';
  const y = o.y;
  mb.push(cx, 0, cz, alongX ? 0 : Math.PI / 2);
  const X = Lh + vg;
  const yEu = y - oh * tn; // dessous à l'égout
  const yRu = y + Wh * tn; // dessous au faîtage
  for (const s of [1, -1]) {
    const ze = s * (Wh + oh);
    const dir: V3 = [0, 1, s];
    mb.polyFacing(rm, [[-X, yEu + tv, ze], [X, yEu + tv, ze], [X, yRu + tv, 0], [-X, yRu + tv, 0]], dir);
    mb.polyFacing('rive', [[-X, yEu, ze], [X, yEu, ze], [X, yRu, 0], [-X, yRu, 0]], [0, -1, -s * 0.01]);
    mb.polyFacing('rive', [[-X, yEu, ze], [X, yEu, ze], [X, yEu + tv, ze], [-X, yEu + tv, ze]], [0, 0, s]);
    for (const sx of [1, -1]) {
      mb.polyFacing('rive', [[sx * X, yEu, ze], [sx * X, yRu, 0], [sx * X, yRu + tv, 0], [sx * X, yEu + tv, ze]], [sx, 0, 0]);
    }
    if (o.gutters !== false && ctx.lod < 2) {
      const gz = ze + s * 0.07;
      mb.tube('zinc', [-X, yEu + 0.02, gz], [X, yEu + 0.02, gz], 0.075, ctx.lod === 0 ? 8 : 4, true);
    }
  }
  // pignons
  const gm = o.gableMat === undefined ? 'facade' : o.gableMat;
  if (gm) {
    const [g0, g1] = o.gables ?? [true, true];
    if (g1) mb.polyFacing(gm, [[Lh, y, Wh], [Lh, y, -Wh], [Lh, yRu, 0]], [1, 0, 0]);
    if (g0) mb.polyFacing(gm, [[-Lh, y, -Wh], [-Lh, y, Wh], [-Lh, yRu, 0]], [-1, 0, 0]);
  }
  // faîtage
  const yt = yRu + tv;
  if (ctx.lod < 2) {
    const rmat = o.ridgeMat ?? rm;
    mb.polyFacing(rmat, [[-X - 0.02, yt + 0.09, 0], [X + 0.02, yt + 0.09, 0], [X + 0.02, yt - 0.03, 0.17], [-X - 0.02, yt - 0.03, 0.17]], [0, 1, 1]);
    mb.polyFacing(rmat, [[-X - 0.02, yt + 0.09, 0], [X + 0.02, yt + 0.09, 0], [X + 0.02, yt - 0.03, -0.17], [-X - 0.02, yt - 0.03, -0.17]], [0, 1, -1]);
    if (ctx.lod === 0) {
      for (const sx of [1, -1]) mb.polyFacing(rmat, [[sx * (X + 0.02), yt + 0.09, 0], [sx * (X + 0.02), yt - 0.03, 0.17], [sx * (X + 0.02), yt - 0.03, -0.17]], [sx, 0, 0]);
    }
  }
  // charpente apparente (pannes en about de pignon)
  if (o.timber && ctx.lod < 2) {
    const purlins = [0, 0.5, 0.92];
    for (const f of purlins) {
      for (const s of f === 0 ? [0] : [1, -1]) {
        const z = s * Wh * f;
        const yb = (f === 0 ? yRu : y + Wh * (1 - f) * tn) - 0.02;
        for (const sx of [1, -1]) mb.box('bois', sx > 0 ? Lh - 0.3 : -X + 0.02, yb - 0.26, z - 0.1, sx > 0 ? X - 0.02 : -Lh + 0.3, yb, z + 0.1, 'py');
      }
    }
    if (ctx.lod === 0) {
      // chevrons sous le débord d'égout
      const n = Math.max(3, Math.round((2 * X) / 0.9));
      for (let i = 0; i <= n; i++) {
        const x = -X + 0.08 + ((2 * X - 0.16) * i) / n;
        for (const s of [1, -1]) {
          const zA = s * (Wh - 0.1);
          const zB = s * (Wh + oh - 0.05);
          const yA = y + 0.1 * tn - 0.0;
          const yB = yEu + 0.05 * tn;
          mb.polyFacing('bois', [[x - 0.05, yA - 0.14, zA], [x - 0.05, yB - 0.14, zB], [x - 0.05, yB, zB], [x - 0.05, yA, zA]], [-1, 0, 0]);
          mb.polyFacing('bois', [[x + 0.05, yA - 0.14, zA], [x + 0.05, yB - 0.14, zB], [x + 0.05, yB, zB], [x + 0.05, yA, zA]], [1, 0, 0]);
          mb.polyFacing('bois', [[x - 0.05, yA - 0.14, zA], [x + 0.05, yA - 0.14, zA], [x + 0.05, yB - 0.14, zB], [x - 0.05, yB - 0.14, zB]], [0, -1, 0]);
          mb.polyFacing('bois', [[x - 0.05, yB - 0.14, zB], [x + 0.05, yB - 0.14, zB], [x + 0.05, yB, zB], [x - 0.05, yB, zB]], [0, 0, s]);
        }
      }
    }
  }
  mb.pop();
  return { ridgeY: yt, eaveY: yEu };
}

export interface HipOpts {
  x0: number; x1: number; z0: number; z1: number;
  y: number;
  pitch: number;
  overhang?: number;
  thickness?: number;
  roofMat?: string;
  gutters?: boolean;
  /** Arêtiers et faîtage en tuiles rondes. */
  hipMat?: string | null;
  /** Coyau (léger relevé à l'égout) non géré ; sous-face caissonnée horizontale. */
}

/** Toit à quatre pans (croupes) ; pavillon si le plan est carré. */
export function hipRoof(ctx: Ctx, o: HipOpts): RoofResult {
  const { mb } = ctx;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  const lx = o.x1 - o.x0;
  const lz = o.z1 - o.z0;
  const alongX = lx >= lz;
  const Lh0 = (alongX ? lx : lz) / 2;
  const Wh0 = (alongX ? lz : lx) / 2;
  const oh = o.overhang ?? 0.5;
  const tn = Math.tan(rad(o.pitch));
  const t = o.thickness ?? 0.2;
  const tv = t / Math.cos(rad(o.pitch));
  const rm = o.roofMat ?? 'toiture';
  mb.push(cx, 0, cz, alongX ? 0 : Math.PI / 2);
  const L = Lh0 + oh;
  const W = Wh0 + oh;
  const yb = o.y - oh * tn;
  const r = Math.max(0, L - W);
  const yr = yb + W * tn;
  const T = yb + tv;
  const TR = yr + tv;
  // pans (dessus)
  mb.polyFacing(rm, [[-L, T, W], [L, T, W], [r, TR, 0], [-r, TR, 0]], [0, 1, 1]);
  mb.polyFacing(rm, [[L, T, -W], [-L, T, -W], [-r, TR, 0], [r, TR, 0]], [0, 1, -1]);
  mb.polyFacing(rm, [[L, T, W], [L, T, -W], [r, TR, 0]], [1, 1, 0]);
  mb.polyFacing(rm, [[-L, T, -W], [-L, T, W], [-r, TR, 0]], [-1, 1, 0]);
  // sous-face caissonnée horizontale et bandeau de rive
  const lh = Lh0;
  const wh = Wh0;
  mb.polyFacing('rive', [[-L, yb, W], [L, yb, W], [lh, yb, wh], [-lh, yb, wh]], [0, -1, 0]);
  mb.polyFacing('rive', [[L, yb, -W], [-L, yb, -W], [-lh, yb, -wh], [lh, yb, -wh]], [0, -1, 0]);
  mb.polyFacing('rive', [[L, yb, W], [L, yb, -W], [lh, yb, -wh], [lh, yb, wh]], [0, -1, 0]);
  mb.polyFacing('rive', [[-L, yb, -W], [-L, yb, W], [-lh, yb, wh], [-lh, yb, -wh]], [0, -1, 0]);
  mb.polyFacing('rive', [[-L, yb, W], [L, yb, W], [L, T, W], [-L, T, W]], [0, 0, 1]);
  mb.polyFacing('rive', [[-L, yb, -W], [L, yb, -W], [L, T, -W], [-L, T, -W]], [0, 0, -1]);
  mb.polyFacing('rive', [[L, yb, -W], [L, yb, W], [L, T, W], [L, T, -W]], [1, 0, 0]);
  mb.polyFacing('rive', [[-L, yb, -W], [-L, yb, W], [-L, T, W], [-L, T, -W]], [-1, 0, 0]);
  if (o.gutters !== false && ctx.lod < 2) {
    const seg = ctx.lod === 0 ? 8 : 4;
    const g = 0.07;
    mb.tube('zinc', [-L - g, yb + 0.02, W + g], [L + g, yb + 0.02, W + g], 0.075, seg, true);
    mb.tube('zinc', [L + g, yb + 0.02, -W - g], [-L - g, yb + 0.02, -W - g], 0.075, seg, true);
    mb.tube('zinc', [L + g, yb + 0.02, W + g], [L + g, yb + 0.02, -W - g], 0.075, seg, true);
    mb.tube('zinc', [-L - g, yb + 0.02, -W - g], [-L - g, yb + 0.02, W + g], 0.075, seg, true);
  }
  const hm = o.hipMat === undefined ? 'poterie' : o.hipMat;
  if (hm && ctx.lod < 2) {
    const seg = ctx.lod === 0 ? 6 : 4;
    const rr = 0.09;
    const lift = 0.04;
    if (r > 0) mb.tube(hm, [-r - 0.05, TR + lift, 0], [r + 0.05, TR + lift, 0], rr, seg);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) mb.tube(hm, [sx * L, T + lift, sz * W], [sx * r, TR + lift, 0], rr, seg);
  }
  mb.pop();
  return { ridgeY: TR, eaveY: yb };
}

export interface ShedOpts {
  x0: number; x1: number; z0: number; z1: number;
  /** Hauteur des murs côté bas et côté haut. */
  yLow: number; yHigh: number;
  /** Côté de l'égout bas. */
  low: 'S' | 'N' | 'E' | 'W';
  overhang?: number;
  thickness?: number;
  roofMat?: string;
  /** Matériau des murs latéraux (triangles + trapèzes). */
  wallMat?: string;
  gutters?: boolean;
}

/** Toit mono-pente ; ferme aussi les murs latéraux en trapèze au-dessus de yLow. */
export function shedRoof(ctx: Ctx, o: ShedOpts): RoofResult {
  const { mb } = ctx;
  const cx = (o.x0 + o.x1) / 2;
  const cz = (o.z0 + o.z1) / 2;
  // repère canonique : égout bas vers +z
  const rot = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 }[o.low];
  const alongX = o.low === 'S' || o.low === 'N';
  const Lh = (alongX ? o.x1 - o.x0 : o.z1 - o.z0) / 2;
  const Wh = (alongX ? o.z1 - o.z0 : o.x1 - o.x0) / 2;
  const oh = o.overhang ?? 0.4;
  const t = o.thickness ?? 0.22;
  const rm = o.roofMat ?? 'toiture';
  const wm = o.wallMat ?? 'facade';
  const tn = (o.yHigh - o.yLow) / (2 * Wh);
  const tv = t * Math.sqrt(1 + tn * tn);
  mb.push(cx, 0, cz, rot);
  const X = Lh + oh * 0.6;
  const yF = o.yLow - oh * tn;
  const yB = o.yHigh + oh * tn;
  const zF = Wh + oh;
  const zB = -Wh - oh;
  mb.polyFacing(rm, [[-X, yF + tv, zF], [X, yF + tv, zF], [X, yB + tv, zB], [-X, yB + tv, zB]], [0, 1, 0]);
  mb.polyFacing('rive', [[-X, yF, zF], [X, yF, zF], [X, yB, zB], [-X, yB, zB]], [0, -1, 0]);
  mb.polyFacing('rive', [[-X, yF, zF], [X, yF, zF], [X, yF + tv, zF], [-X, yF + tv, zF]], [0, 0, 1]);
  mb.polyFacing('rive', [[-X, yB, zB], [X, yB, zB], [X, yB + tv, zB], [-X, yB + tv, zB]], [0, 0, -1]);
  for (const sx of [1, -1]) {
    mb.polyFacing('rive', [[sx * X, yF, zF], [sx * X, yB, zB], [sx * X, yB + tv, zB], [sx * X, yF + tv, zF]], [sx, 0, 0]);
    mb.polyFacing(wm, [[sx * Lh, o.yLow, Wh], [sx * Lh, o.yLow, -Wh], [sx * Lh, o.yHigh, -Wh]], [sx, 0, 0]);
  }
  // mur arrière haut (entre yLow et yHigh) : à la charge de l'appelant si le volume s'arrête à yLow
  mb.polyFacing(wm, [[-Lh, o.yLow, -Wh], [Lh, o.yLow, -Wh], [Lh, o.yHigh, -Wh], [-Lh, o.yHigh, -Wh]], [0, 0, -1]);
  if (o.gutters !== false && ctx.lod < 2) mb.tube('zinc', [-X, yF + 0.02, zF + 0.07], [X, yF + 0.02, zF + 0.07], 0.075, ctx.lod === 0 ? 8 : 4, true);
  mb.pop();
  return { ridgeY: yB + tv, eaveY: yF };
}

export interface FlatOpts {
  x0: number; x1: number; z0: number; z1: number;
  /** Niveau de l'étanchéité (sol de la terrasse). */
  y: number;
  /** Dessus de l'acrotère (les murs extérieurs doivent monter jusque-là). */
  parapet: number;
  /** Épaisseur de l'acrotère. */
  t?: number;
  deckMat?: string;
  wallMat?: string;
  copingMat?: string;
}

/** Toiture-terrasse avec acrotère et couvertine. */
export function flatRoof(ctx: Ctx, o: FlatOpts): void {
  const { mb } = ctx;
  const t = o.t ?? 0.25;
  const dm = o.deckMat ?? 'terrasse';
  const wm = o.wallMat ?? 'facade';
  const cm = o.copingMat ?? 'zinc';
  const ix0 = o.x0 + t, ix1 = o.x1 - t, iz0 = o.z0 + t, iz1 = o.z1 - t;
  if (o.parapet - o.y < 0.05) {
    mb.box(dm, o.x0, o.y - 0.01, o.z0, o.x1, o.y, o.z1, 'ny px nx pz nz');
    return;
  }
  mb.quad(dm, [ix0, o.y, iz1], [ix1, o.y, iz1], [ix1, o.y, iz0], [ix0, o.y, iz0]);
  // faces intérieures de l'acrotère
  mb.polyFacing(wm, [[ix0, o.y, iz1], [ix1, o.y, iz1], [ix1, o.parapet, iz1], [ix0, o.parapet, iz1]], [0, 0, -1]);
  mb.polyFacing(wm, [[ix0, o.y, iz0], [ix1, o.y, iz0], [ix1, o.parapet, iz0], [ix0, o.parapet, iz0]], [0, 0, 1]);
  mb.polyFacing(wm, [[ix0, o.y, iz0], [ix0, o.y, iz1], [ix0, o.parapet, iz1], [ix0, o.parapet, iz0]], [1, 0, 0]);
  mb.polyFacing(wm, [[ix1, o.y, iz0], [ix1, o.y, iz1], [ix1, o.parapet, iz1], [ix1, o.parapet, iz0]], [-1, 0, 0]);
  // couvertine (débord 3 cm)
  const e = 0.03;
  const h = ctx.lod === 2 ? 0.01 : 0.06;
  const top = o.parapet;
  mb.box(cm, o.x0 - e, top, o.z0 - e, o.x1 + e, top + h, o.z0 + t + 0.01, '');
  mb.box(cm, o.x0 - e, top, o.z1 - t - 0.01, o.x1 + e, top + h, o.z1 + e, '');
  mb.box(cm, o.x0 - e, top, o.z0 + t, o.x0 + t + 0.01, top + h, o.z1 - t, 'pz nz');
  mb.box(cm, o.x1 - t - 0.01, top, o.z0 + t, o.x1 + e, top + h, o.z1 - t, 'pz nz');
}

/** Groupe de climatisation / centrale de traitement d'air. */
export function rooftopUnit(ctx: Ctx, x: number, y: number, z: number, w: number, d: number, h: number): void {
  const { mb } = ctx;
  mb.box('equipement', x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, 'ny');
  if (ctx.lod === 0) {
    // socle, ventilateurs
    mb.box('dalle', x - w / 2 - 0.1, y - 0.01, z - d / 2 - 0.1, x + w / 2 + 0.1, y + 0.12, z + d / 2 + 0.1, 'ny');
    const n = Math.max(1, Math.floor(w / 1.1));
    for (let i = 0; i < n; i++) {
      const fx = x - w / 2 + (w * (i + 0.5)) / n;
      mb.cylinder('garde_corps', fx, y + h, z, Math.min(0.42, d * 0.35), 0.12, 12, true);
    }
    // grille latérale
    mb.box('garde_corps', x - w / 2 + 0.1, y + 0.2, z + d / 2, x + w / 2 - 0.1, y + h - 0.2, z + d / 2 + 0.02, 'nz');
  }
}

/** Édicule d'accès (cage d'escalier / machinerie d'ascenseur) avec porte métallique. */
export function stairHouse(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, h: number, wallMat: string): void {
  const { mb } = ctx;
  mb.box(wallMat, x0, y, z0, x1, y + h, z1, 'ny py');
  mb.box('zinc', x0 - 0.05, y + h, z0 - 0.05, x1 + 0.05, y + h + 0.08, z1 + 0.05, '');
  if (ctx.lod < 2) {
    const f: Frame = { o: [x0, y, z1], u: [1, 0, 0], n: [0, 0, 1], w: x1 - x0, h };
    const c = (x1 - x0) / 2;
    fbox(ctx, 'store', f, c - 0.45, c + 0.45, 0.05, 2.1, 0, 0.04, 'back');
    fbox(ctx, 'dalle', f, c - 0.6, c + 0.6, 2.2, 2.32, 0, 0.5, 'back');
  }
}

/** Antenne / mât. */
export function mast(ctx: Ctx, x: number, y: number, z: number, h: number): void {
  if (ctx.lod === 2) return;
  ctx.mb.cylinder('garde_corps', x, y, z, 0.04, h, 6, true);
  if (ctx.lod === 0) for (const k of [0.6, 0.8]) ctx.mb.box('garde_corps', x - 0.5, y + h * k, z - 0.015, x + 0.5, y + h * k + 0.03, z + 0.015);
}

export interface ChimneyOpts { mat?: string; pots?: number; capMat?: string }

/** Souche de cheminée avec chapeau et mitrons. */
export function chimney(ctx: Ctx, x: number, z: number, w: number, d: number, y0: number, y1: number, o: ChimneyOpts = {}): void {
  const { mb } = ctx;
  const m = o.mat ?? 'cheminee';
  mb.box(m, x - w / 2, y0, z - d / 2, x + w / 2, y1, z + d / 2, 'ny');
  if (ctx.lod === 2) return;
  mb.box(o.capMat ?? 'encadrement', x - w / 2 - 0.05, y1, z - d / 2 - 0.05, x + w / 2 + 0.05, y1 + 0.08, z + d / 2 + 0.05, '');
  if (ctx.lod === 0) mb.box(m, x - w / 2 - 0.03, y1 - 0.35, z - d / 2 - 0.03, x + w / 2 + 0.03, y1 - 0.27, z + d / 2 + 0.03, 'ny py');
  const pots = o.pots ?? 2;
  for (let i = 0; i < pots; i++) {
    const px = x - w / 2 + (w * (i + 0.5)) / pots;
    mb.cylinder('poterie', px, y1 + 0.08, z, 0.09, 0.32, ctx.lod === 0 ? 10 : 6, true, 0.075);
  }
}

export interface DormerOpts {
  /** Toit de la lucarne. */
  roof?: 'gable' | 'shed' | 'hip';
  roofMat?: string;
  cheekMat?: string;
  wallMat?: string;
  win?: WindowOpts;
  pitch?: number;
}

/**
 * Lucarne. `f` = plan de la façade de la lucarne (repère dont d=0 est la face avant de la lucarne),
 * baie centrée en `uc`, base à `v0`, largeur extérieure `w`, hauteur de jouée `h`, profondeur `depth`
 * (vers l'arrière, jusqu'à disparaître sous la couverture principale).
 */
export function dormer(ctx: Ctx, f: Frame, uc: number, v0: number, w: number, h: number, depth: number, o: DormerOpts = {}): void {
  const wm = o.wallMat ?? 'facade';
  const cm = o.cheekMat ?? wm;
  const rm = o.roofMat ?? 'toiture';
  const u0 = uc - w / 2;
  const u1 = uc + w / 2;
  const ww = Math.max(0.5, w - 0.4);
  const win = { u0: uc - ww / 2, u1: uc + ww / 2, v0: v0 + 0.15, v1: v0 + h - 0.12 };
  const front: Frame = { o: P(f, 0, 0, 0), u: f.u, n: f.n, w: f.w, h: f.h };
  wall(ctx, wm, front, ctx.lod === 2 ? [] : [win], u0, u1, v0, v0 + h);
  windowFn(ctx, front, win, wm, { shutters: 'none', sill: true, reveal: 0.12, ...o.win });
  // jouées
  fbox(ctx, cm, f, u0, u1, v0, v0 + h, -depth, 0, 'front back top bottom');
  const pitch = o.pitch ?? 45;
  const tn = Math.tan(rad(pitch));
  const oh = 0.18;
  const t = 0.12;
  if ((o.roof ?? 'gable') === 'shed') {
    fbox(ctx, rm, f, u0 - oh, u1 + oh, v0 + h, v0 + h + t, -depth, oh, 'back');
    return;
  }
  const half = w / 2 + oh;
  const rise = half * tn;
  const yb = v0 + h - oh * tn * 0.5;
  // deux pans perpendiculaires à la façade
  for (const s of [-1, 1]) {
    const ue = uc + s * half;
    ctx.mb.polyFacing(rm, [P(f, ue, yb + t, oh), P(f, uc, yb + rise + t, oh), P(f, uc, yb + rise + t, -depth), P(f, ue, yb + t, -depth)], [f.u[0] * s, 1, f.u[2] * s]);
    ctx.mb.polyFacing('rive', [P(f, ue, yb, oh), P(f, uc, yb + rise, oh), P(f, uc, yb + rise, -depth), P(f, ue, yb, -depth)], [-f.u[0] * s, -1, -f.u[2] * s]);
    ctx.mb.polyFacing('rive', [P(f, ue, yb, oh), P(f, uc, yb + rise, oh), P(f, uc, yb + rise + t, oh), P(f, ue, yb + t, oh)], f.n);
  }
  // fronton
  ctx.mb.polyFacing(wm, [P(f, u0, v0 + h, 0), P(f, u1, v0 + h, 0), P(f, uc, yb + rise - 0.02, 0)], f.n);
}

/** Génoise provençale : rangs de tuiles en saillie sous l'égout (sur la façade f, au niveau v). */
export function genoise(ctx: Ctx, f: Frame, v: number, rows = 2): void {
  if (ctx.lod === 2) return;
  for (let i = 0; i < rows; i++) {
    const y = v - (rows - i) * 0.11;
    fbox(ctx, 'poterie', f, -0.08 * (i + 1), f.w + 0.08 * (i + 1), y, y + 0.07, 0, 0.08 * (i + 1), 'back');
    fbox(ctx, 'encadrement', f, -0.08 * (i + 1), f.w + 0.08 * (i + 1), y + 0.07, y + 0.11, 0, 0.08 * (i + 1) - 0.03, 'back');
    if (ctx.lod === 0) {
      // canaux visibles : demi-cylindres en about
      const n = Math.floor(f.w / 0.22);
      for (let k = 0; k < n; k++) {
        const u = 0.11 + k * 0.22;
        ctx.mb.tube('poterie', P(f, u, y + 0.035, 0.08 * (i + 1)), P(f, u, y + 0.035, 0.08 * (i + 1) + 0.03), 0.06, 5);
      }
    }
  }
}

/**
 * Mansarde : brisis (pans raides) de la façade jusqu'au retrait `inset`, puis terrasson à faible pente.
 * Renvoie les repères des quatre brisis (pour y poser des lucarnes) et le haut du terrasson.
 */
export function mansardRoof(ctx: Ctx, o: { x0: number; x1: number; z0: number; z1: number; y: number; lowerH: number; inset: number; upperPitch?: number; lowerMat?: string; upperMat?: string }): { top: number; yBreak: number } {
  const { mb } = ctx;
  const lm = o.lowerMat ?? 'toiture';
  const um = o.upperMat ?? 'zinc';
  const e = 0.12; // léger débord au pied du brisis (sur la corniche)
  const a0 = [o.x0 - e, o.z0 - e, o.x1 + e, o.z1 + e] as const;
  const a1 = [o.x0 + o.inset, o.z0 + o.inset, o.x1 - o.inset, o.z1 - o.inset] as const;
  const y0 = o.y;
  const y1 = o.y + o.lowerH;
  // brisis
  mb.polyFacing(lm, [[a0[0], y0, a0[3]], [a0[2], y0, a0[3]], [a1[2], y1, a1[3]], [a1[0], y1, a1[3]]], [0, 0.3, 1]);
  mb.polyFacing(lm, [[a0[0], y0, a0[1]], [a0[2], y0, a0[1]], [a1[2], y1, a1[1]], [a1[0], y1, a1[1]]], [0, 0.3, -1]);
  mb.polyFacing(lm, [[a0[2], y0, a0[1]], [a0[2], y0, a0[3]], [a1[2], y1, a1[3]], [a1[2], y1, a1[1]]], [1, 0.3, 0]);
  mb.polyFacing(lm, [[a0[0], y0, a0[1]], [a0[0], y0, a0[3]], [a1[0], y1, a1[3]], [a1[0], y1, a1[1]]], [-1, 0.3, 0]);
  // ligne de bris (bavette zinc)
  if (ctx.lod < 2) {
    mb.box('zinc', a1[0] - 0.06, y1 - 0.02, a1[3] - 0.02, a1[2] + 0.06, y1 + 0.06, a1[3] + 0.06, 'ny');
    mb.box('zinc', a1[0] - 0.06, y1 - 0.02, a1[1] - 0.06, a1[2] + 0.06, y1 + 0.06, a1[1] + 0.02, 'ny');
    mb.box('zinc', a1[0] - 0.06, y1 - 0.02, a1[1], a1[0] + 0.02, y1 + 0.06, a1[3], 'ny pz nz');
    mb.box('zinc', a1[2] - 0.02, y1 - 0.02, a1[1], a1[2] + 0.06, y1 + 0.06, a1[3], 'ny pz nz');
  }
  const r = hipRoof(ctx, { x0: a1[0], x1: a1[2], z0: a1[1], z1: a1[3], y: y1 + 0.02, pitch: o.upperPitch ?? 14, overhang: 0.02, thickness: 0.06, roofMat: um, gutters: false, hipMat: null });
  return { top: r.ridgeY, yBreak: y1 };
}

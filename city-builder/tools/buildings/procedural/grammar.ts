/**
 * GÉNÉRATEUR ARCHITECTURAL PROCÉDURAL — grammaire de façade (phase 2A, module « Bâtiments & quartiers »).
 *
 * Une façade est une GRILLE : des TRAVÉES (rythme décrit par un motif, ex. « abba » ou « apcpa ») croisées avec
 * des NIVEAUX (soubassement / rez-de-chaussée, étage noble, étages courants, attique). Une RÈGLE associe à chaque
 * cellule (travée × niveau) un élément : baie (fenêtre droite ou cintrée, porte, vitrine, loggia), et un décor
 * (fronton, balcon, allège, ancre…). Les éléments sont rendus par le kit (tools/buildings/kit) ; ce fichier ajoute
 * les composants qui manquaient au kit : baies cintrées, frontons, refends, modillons, pans de bois, pignons à
 * gradins / en cloche / à cou, oriels en encorbellement, murs-rideaux, panneaux d'allège.
 *
 * Règle d'or des LOD : toute fonction consomme `ctx.r()` dans le même ordre aux trois niveaux de détail
 * (les graines d'allumage des fenêtres doivent rester identiques d'un LOD à l'autre).
 */
import {
  facade, fbox, fq, ft, glass, P, rectAt,
  type Ctx, type DoorOpts, type Frame, type OpeningSpec, type RailStyle, type Rect, type ShopOpts, type V3, type WindowOpts,
} from '../kit/index';
import { balcon, railLine, type BalconOpts } from './rail';

/* ------------------------------------------------------------------ */
/* Grille                                                               */
/* ------------------------------------------------------------------ */

export interface LevelSpec {
  /** Rôle du niveau : 'rdc', 'noble', 'etage', 'attique'… (libre : la règle l'interprète). */
  id: string;
  /** Hauteur d'étage (plancher à plancher), m. */
  h: number;
}
export interface Level extends LevelSpec { v0: number; index: number; last: boolean }

export interface Grid {
  w: number;
  h: number;
  /** Centres et largeurs des travées, de gauche à droite vu de l'extérieur. */
  us: number[];
  bw: number[];
  kinds: string[];
  levels: Level[];
}

/**
 * Découpe une façade de largeur `w` : une travée par caractère de `pattern` (largeurs proportionnelles à
 * `weights[caractère]`, défaut 1), marges latérales `margin`, niveaux empilés à partir de `v0`.
 */
export function grid(w: number, pattern: string, levels: LevelSpec[], o: { margin?: number; weights?: Record<string, number>; v0?: number } = {}): Grid {
  const margin = o.margin ?? 0;
  const kinds = [...pattern];
  const ws = kinds.map((k) => o.weights?.[k] ?? 1);
  const tot = ws.reduce((s, x) => s + x, 0);
  const inner = w - 2 * margin;
  const us: number[] = [];
  const bw: number[] = [];
  let u = margin;
  for (const x of ws) {
    const b = (inner * x) / tot;
    us.push(u + b / 2);
    bw.push(b);
    u += b;
  }
  let v = o.v0 ?? 0;
  const lv: Level[] = levels.map((l, index) => {
    const out = { ...l, v0: v, index, last: index === levels.length - 1 };
    v += l.h;
    return out;
  });
  return { w, h: v, us, bw, kinds, levels: lv };
}

export interface Cell {
  /** Index de travée et de niveau. */
  i: number;
  kind: string;
  uc: number;
  bw: number;
  level: Level;
  nBays: number;
  first: boolean;
  lastBay: boolean;
}

export type Deco = (ctx: Ctx, f: Frame) => void;
export interface Elem { op?: OpeningSpec; deco?: Deco }
export type Rule = (c: Cell) => Elem | Elem[] | null | undefined;

export interface Composition { ops: OpeningSpec[]; decos: Deco[] }

/** Applique la règle à chaque cellule (niveau par niveau, de bas en haut, travées de gauche à droite). */
export function compose(g: Grid, rule: Rule): Composition {
  const ops: OpeningSpec[] = [];
  const decos: Deco[] = [];
  for (const level of g.levels) {
    for (let i = 0; i < g.us.length; i++) {
      const e = rule({ i, kind: g.kinds[i]!, uc: g.us[i]!, bw: g.bw[i]!, level, nBays: g.us.length, first: i === 0, lastBay: i === g.us.length - 1 });
      if (!e) continue;
      for (const x of Array.isArray(e) ? e : [e]) {
        if (x.op) ops.push(x.op);
        if (x.deco) decos.push(x.deco);
      }
    }
  }
  return { ops, decos };
}

export function decorate(ctx: Ctx, f: Frame, c: Composition): void {
  for (const d of c.decos) d(ctx, f);
}

/* ------------------------------------------------------------------ */
/* Éléments de cellule                                                  */
/* ------------------------------------------------------------------ */

export type PedimentKind = 'tri' | 'seg' | 'plat';

export interface WinSpec {
  w: number;
  h: number;
  /** Hauteur d'allège (appui au-dessus du plancher) ; 0 = porte-fenêtre. */
  sill: number;
  o?: WindowOpts;
  /** Fronton au-dessus de la baie. */
  ped?: PedimentKind | null;
  /** Balcon : 'net' = balconnet (garde-corps dans le tableau), 'saillie' = dalle individuelle. */
  balc?: 'net' | 'saillie' | null;
  balcOpts?: BalconOpts;
  rail?: RailStyle;
  /** Baie cintrée (plein cintre). */
  arch?: boolean;
  /** Panneau d'allège (matériau) sous la baie, jusqu'au plancher. */
  apron?: string | null;
  /** Décalage horizontal par rapport au centre de la travée. */
  du?: number;
}

/** Fenêtre d'une cellule (décor compris). */
export function win(c: Cell, s: WinSpec, wallMat = 'facade'): Elem[] {
  const uc = c.uc + (s.du ?? 0);
  const v0 = c.level.v0 + s.sill;
  const r = rectAt(uc, s.w, v0, s.h);
  const french = s.sill < 0.05;
  const o: WindowOpts = { ...(s.o ?? {}) };
  if (french) o.sill = false;
  if (s.balc === 'net' && !o.railing) o.railing = s.rail === 'verre' ? 'verre' : s.rail === 'barreaux' ? 'barreaux' : 'fer';
  const out: Elem[] = [];
  if (s.arch) out.push(archedWindow(r, wallMat, o));
  else out.push({ op: { kind: 'window', r, o } });
  const decos: Deco[] = [];
  if (s.ped) { const k = s.ped; decos.push((ctx, f) => pediment(ctx, f, uc, s.w + 0.36, r.v1 + ((o.surround ?? 0) > 0 ? o.surround! : 0.04), k)); }
  if (s.balc === 'saillie') {
    const bo: BalconOpts = { depth: 0.9, rail: s.rail ?? 'fer', consoles: true, ...(s.balcOpts ?? {}) };
    decos.push((ctx, f) => balcon(ctx, f, r.u0 - 0.35, r.u1 + 0.35, c.level.v0 + 0.02, bo));
  }
  if (s.apron && s.sill > 0.3) {
    const m = s.apron;
    decos.push((ctx, f) => { if (ctx.lod < 2) fbox(ctx, m, f, r.u0, r.u1, c.level.v0 + 0.12, v0 - 0.09, 0, 0.02, 'back'); else fq(ctx, m, f, [r.u0, c.level.v0 + 0.12, 0.02], [r.u1, c.level.v0 + 0.12, 0.02], [r.u1, v0 - 0.09, 0.02], [r.u0, v0 - 0.09, 0.02]); });
  }
  for (const d of decos) out.push({ deco: d });
  return out;
}

export function doorAt(c: Cell, w: number, h: number, o: DoorOpts = {}, du = 0): Elem {
  return { op: { kind: 'door', r: rectAt(c.uc + du, w, c.level.v0, h), o } };
}

export function shopAt(c: Cell, margin: number, h: number, o: ShopOpts = {}, base = 0.02): Elem {
  return { op: { kind: 'shop', r: { u0: c.uc - c.bw / 2 + margin, u1: c.uc + c.bw / 2 - margin, v0: c.level.v0 + base, v1: c.level.v0 + h }, o } };
}

/* ------------------------------------------------------------------ */
/* Baies cintrées                                                       */
/* ------------------------------------------------------------------ */

function arcPts(uc: number, vs: number, rad: number, seg: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k <= seg; k++) {
    const a = (Math.PI * k) / seg;
    pts.push([uc + Math.cos(a) * rad, vs + Math.sin(a) * rad]);
  }
  return pts;
}

/**
 * Remplissage d'une baie rectangulaire `r` pour lui donner un couvrement en plein cintre : écoinçons au nu du mur
 * et intrados (profondeur R). La naissance de l'arc est à r.v1 − largeur/2.
 */
export function archFill(ctx: Ctx, f: Frame, r: Rect, wallMat: string, R: number, seg: number): { vs: number; rad: number; uc: number } {
  const rad = (r.u1 - r.u0) / 2;
  const uc = (r.u0 + r.u1) / 2;
  const vs = r.v1 - rad;
  const pts = arcPts(uc, vs, rad, seg); // de u1 (angle 0) à u0 (angle π)
  const half = seg / 2;
  for (let k = 0; k < seg; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    // écoinçons : éventail depuis le coin haut droit (k < half) ou haut gauche
    const corner: [number, number] = k < half ? [r.u1, r.v1] : [r.u0, r.v1];
    ft(ctx, wallMat, f, [corner[0], corner[1], 0], [b[0], b[1], 0], [a[0], a[1], 0]);
    // intrados (face tournée vers le centre de l'arc)
    const A0 = P(f, a[0], a[1], 0), B0 = P(f, b[0], b[1], 0), A1 = P(f, a[0], a[1], -R), B1 = P(f, b[0], b[1], -R);
    const mid = P(f, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -R / 2);
    const cen = P(f, uc, vs, -R / 2);
    ctx.mb.polyFacing(wallMat, [A0, B0, B1, A1], [cen[0] - mid[0], cen[1] - mid[1], cen[2] - mid[2]]);
  }
  return { vs, rad, uc };
}

/** Demi-disque vitré (éventail) dans le plan d. */
function glassFan(ctx: Ctx, f: Frame, uc: number, vs: number, rad: number, d: number, seg: number, lit: number, mat = 'verre'): void {
  const prev = ctx.mb.lit;
  ctx.mb.lit = lit;
  ctx.mb.poly(mat, arcPts(uc, vs, rad, seg).map(([u, v]) => P(f, u, v, d)));
  ctx.mb.lit = prev;
}

/**
 * Fenêtre cintrée complète dans le rectangle englobant `r` (arc compris) : tableaux, intrados, vitrage droit +
 * imposte en éventail, dormant, montant central, traverse d'imposte, rayons, appui, archivolte.
 */
export function archedWindow(r: Rect, wallMat: string, o: WindowOpts = {}): Elem {
  return {
    op: { kind: 'blind', r },
    deco: (ctx, f) => {
      const R = o.reveal ?? 0.18;
      const lit = o.lit ?? ctx.r();
      const uc = (r.u0 + r.u1) / 2;
      const rad = (r.u1 - r.u0) / 2;
      const vs = r.v1 - rad;
      const sill = o.sill ?? true;
      const sm = o.surroundMat ?? 'encadrement';
      const upper: Rect = { u0: r.u0, u1: r.u1, v0: vs, v1: r.v1 };
      if (ctx.lod === 2) {
        archFill(ctx, f, upper, wallMat, 0.001, 4);
        glass(ctx, f, r.u0, r.u1, r.v0, vs, 0, lit);
        glassFan(ctx, f, uc, vs, rad, 0, 4, lit);
        return;
      }
      const seg = ctx.lod === 0 ? 8 : 4;
      archFill(ctx, f, upper, wallMat, R, seg);
      // tableaux latéraux (+ seuil si porte-fenêtre)
      fq(ctx, wallMat, f, [r.u0, r.v0, 0], [r.u0, r.v0, -R], [r.u0, vs, -R], [r.u0, vs, 0]);
      fq(ctx, wallMat, f, [r.u1, r.v0, -R], [r.u1, r.v0, 0], [r.u1, vs, 0], [r.u1, vs, -R]);
      if (!sill) fq(ctx, wallMat, f, [r.u0, r.v0, 0], [r.u1, r.v0, 0], [r.u1, r.v0, -R], [r.u0, r.v0, -R]);
      const dg = -R + 0.04;
      const fw = 0.065;
      const fm = o.frameMat ?? 'menuiserie';
      glass(ctx, f, r.u0, r.u1, r.v0, vs, dg, lit);
      glassFan(ctx, f, uc, vs, rad, dg, seg, lit);
      if (sill && ctx.lod === 0) fbox(ctx, sm, f, r.u0 - 0.06, r.u1 + 0.06, r.v0 - 0.07, r.v0, -R, 0.055, 'back bottom');
      if (ctx.lod === 0) {
        fbox(ctx, fm, f, r.u0, r.u0 + fw, r.v0, vs, dg, dg + 0.04, 'back left top bottom');
        fbox(ctx, fm, f, r.u1 - fw, r.u1, r.v0, vs, dg, dg + 0.04, 'back right top bottom');
        fbox(ctx, fm, f, r.u0 + fw, r.u1 - fw, r.v0, r.v0 + (sill ? fw : 0.14), dg, dg + 0.04, 'back left right bottom');
        fbox(ctx, fm, f, uc - 0.035, uc + 0.035, r.v0 + fw, vs, dg, dg + 0.045, 'back top bottom');
        fbox(ctx, fm, f, r.u0, r.u1, vs - 0.035, vs + 0.035, dg, dg + 0.045, 'back left right');
        for (const a of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
          const c = Math.cos(a), s = Math.sin(a);
          const e = 0.022;
          fq(ctx, fm, f, [uc + s * e, vs - c * e, dg + 0.02], [uc + c * rad + s * e, vs + s * rad - c * e, dg + 0.02], [uc + c * rad - s * e, vs + s * rad + c * e, dg + 0.02], [uc - s * e, vs + c * e, dg + 0.02]);
        }
        const sw = o.surround ?? 0;
        if (sw > 0) {
          fbox(ctx, sm, f, r.u0 - sw, r.u0, r.v0, vs, 0, 0.03, 'back top');
          fbox(ctx, sm, f, r.u1, r.u1 + sw, r.v0, vs, 0, 0.03, 'back top');
          archivolt(ctx, f, uc, vs, rad, sw, sm, seg, o.keystone ?? false);
        }
      }
      if (o.railing) railLine(ctx, P(f, r.u0 - 0.04, r.v0, 0.07), P(f, r.u1 + 0.04, r.v0, 0.07), 1.0, o.railing, { outward: true });
    },
  };
}

/** Archivolte : bandeau saillant suivant l'arc (+ clé). */
export function archivolt(ctx: Ctx, f: Frame, uc: number, vs: number, rad: number, w: number, mat: string, seg: number, keystone = false): void {
  const inner = arcPts(uc, vs, rad, seg);
  const outer = arcPts(uc, vs, rad + w, seg);
  const d = 0.03;
  for (let k = 0; k < seg; k++) {
    const a = inner[k]!, b = inner[k + 1]!, c = outer[k + 1]!, e = outer[k]!;
    fq(ctx, mat, f, [a[0], a[1], d], [e[0], e[1], d], [c[0], c[1], d], [b[0], b[1], d]);
    // chant extérieur
    const E0 = P(f, e[0], e[1], 0), C0 = P(f, c[0], c[1], 0), E1 = P(f, e[0], e[1], d), C1 = P(f, c[0], c[1], d);
    const mid = P(f, (e[0] + c[0]) / 2, (e[1] + c[1]) / 2, d / 2);
    const cen = P(f, uc, vs, d / 2);
    ctx.mb.polyFacing(mat, [E0, C0, C1, E1], [mid[0] - cen[0], mid[1] - cen[1], mid[2] - cen[2]]);
  }
  if (keystone) fbox(ctx, mat, f, uc - 0.11, uc + 0.11, vs + rad - 0.05, vs + rad + w + 0.1, 0, 0.06, 'back');
}

/* ------------------------------------------------------------------ */
/* Modénature                                                           */
/* ------------------------------------------------------------------ */

/** Fronton posé au-dessus d'une baie (centre uc, largeur w, base v). LOD0 : modelé ; LOD1 : tablette ; LOD2 : rien. */
export function pediment(ctx: Ctx, f: Frame, uc: number, w: number, v: number, kind: PedimentKind, mat = 'encadrement'): void {
  if (ctx.lod === 2) return;
  const u0 = uc - w / 2, u1 = uc + w / 2;
  if (ctx.lod === 1 || kind === 'plat') {
    fbox(ctx, mat, f, u0, u1, v + 0.06, v + 0.16, 0, 0.1, 'back');
    if (ctx.lod === 0) for (const u of [u0 + 0.08, u1 - 0.08]) fbox(ctx, mat, f, u - 0.05, u + 0.05, v - 0.14, v + 0.06, 0, 0.07, 'back top');
    return;
  }
  const d = 0.11;
  fbox(ctx, mat, f, u0, u1, v + 0.04, v + 0.12, 0, d, 'back');
  const b = v + 0.12;
  if (kind === 'tri') {
    const h = w * 0.2;
    ft(ctx, mat, f, [u0, b, d], [u1, b, d], [uc, b + h, d]);
    ctx.mb.polyFacing(mat, [P(f, u0, b, 0), P(f, u0, b, d), P(f, uc, b + h, d), P(f, uc, b + h, 0)], P({ ...f, o: [0, 0, 0] }, -0.3, 1, 0));
    ctx.mb.polyFacing(mat, [P(f, u1, b, 0), P(f, u1, b, d), P(f, uc, b + h, d), P(f, uc, b + h, 0)], P({ ...f, o: [0, 0, 0] }, 0.3, 1, 0));
  } else {
    const h = w * 0.14;
    const n = 4;
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) { const t = k / n; pts.push([u0 + (u1 - u0) * t, b + h * Math.sin(Math.PI * t)]); }
    ctx.mb.poly(mat, [...pts.map(([u, vv]) => P(f, u, vv, d))].reverse().reverse());
    for (let k = 0; k < n; k++) {
      const a = pts[k]!, c = pts[k + 1]!;
      ctx.mb.polyFacing(mat, [P(f, a[0], a[1], 0), P(f, a[0], a[1], d), P(f, c[0], c[1], d), P(f, c[0], c[1], 0)], [0, 1, 0]);
    }
  }
}

/** Refends (bossages continus en table) entre v0 et v1, interrompus par les baies. LOD1 : nu ; LOD2 : rien. */
export function refends(ctx: Ctx, f: Frame, mat: string, v0: number, v1: number, holes: Rect[], course = 0.42, d = 0.03, u0 = 0, u1 = f.w): void {
  if (ctx.lod === 2) return;
  const spans = (va: number, vb: number): [number, number][] => {
    const cuts = holes.filter((h) => h.v0 < vb && h.v1 > va && h.u1 > u0 && h.u0 < u1).map((h) => [h.u0, h.u1] as [number, number]).sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let u = u0;
    for (const [a, b] of cuts) { if (a > u + 0.05) out.push([u, a]); u = Math.max(u, b); }
    if (u1 > u + 0.05) out.push([u, u1]);
    return out;
  };
  if (ctx.lod === 1) {
    for (const [a, b] of spans(v0, v1)) fq(ctx, mat, f, [a, v0, d], [b, v0, d], [b, v1, d], [a, v1, d]);
    // bandes pleines entre baies seulement : au-dessus / au-dessous des baies le mur reste visible (acceptable à distance)
    return;
  }
  const n = Math.max(1, Math.round((v1 - v0) / course));
  const ch = (v1 - v0) / n;
  for (let k = 0; k < n; k++) {
    const va = v0 + k * ch + 0.025;
    const vb = v0 + (k + 1) * ch - 0.025;
    for (const [a, b] of spans(va, vb)) fbox(ctx, mat, f, a, b, va, vb, 0, d, 'back left right');
  }
}

/** Rangée de modillons (petites consoles) sous une corniche. LOD0 seulement. */
export function modillons(ctx: Ctx, f: Frame, mat: string, v: number, spacing = 0.6, h = 0.16, d = 0.18, w = 0.12): void {
  if (ctx.lod !== 0) return;
  const n = Math.max(2, Math.round(f.w / spacing));
  for (let i = 0; i < n; i++) {
    const u = (f.w * (i + 0.5)) / n;
    fbox(ctx, mat, f, u - w / 2, u + w / 2, v - h, v, 0, d, 'back top');
  }
}

/** Ancres de façade en fer forgé (croix), typiques des maisons de brique. LOD0 seulement. */
export function ancres(ctx: Ctx, f: Frame, us: number[], v: number, size = 0.32): void {
  if (ctx.lod !== 0) return;
  const e = 0.025;
  for (const u of us) {
    fq(ctx, 'garde_corps', f, [u - size / 2, v - size / 2 + e, 0.02], [u - size / 2 + e, v - size / 2, 0.02], [u + size / 2, v + size / 2 - e, 0.02], [u + size / 2 - e, v + size / 2, 0.02]);
    fq(ctx, 'garde_corps', f, [u + size / 2 - e, v - size / 2, 0.02], [u + size / 2, v - size / 2 + e, 0.02], [u - size / 2 + e, v + size / 2, 0.02], [u - size / 2, v + size / 2 - e, 0.02]);
  }
}

/* ------------------------------------------------------------------ */
/* Pans de bois                                                         */
/* ------------------------------------------------------------------ */

export interface TimberSpec {
  u0: number; u1: number; v0: number; v1: number;
  /** Poteaux (u) et sablières / entretoises (v). */
  posts: number[];
  rails: number[];
  /** Décharges obliques : segments [u0, v0, u1, v1]. */
  braces?: [number, number, number, number][];
  mat?: string;
  /** Largeur des bois (m). */
  t?: number;
  /** Trous (baies) : les entretoises y sont interrompues. */
  holes?: Rect[];
}

/**
 * Pans de bois apparents : poteaux, sablières, décharges. LOD0 : pièces en relief (3 cm) ; LOD1/2 : aplats —
 * conservés au LOD2 (la trame sombre reste lisible de loin).
 */
export function timber(ctx: Ctx, f: Frame, s: TimberSpec): void {
  const m = s.mat ?? 'colombage';
  const t = s.t ?? 0.17;
  const d = ctx.lod === 0 ? 0.035 : 0.02;
  const holes = s.holes ?? [];
  const flat = (a: number, b: number, va: number, vb: number): void => {
    if (ctx.lod === 0) fbox(ctx, m, f, a, b, va, vb, 0, d, 'back');
    else fq(ctx, m, f, [a, va, d], [b, va, d], [b, vb, d], [a, vb, d]);
  };
  const cutSpans = (lo: number, hi: number, isU: boolean, at: number): [number, number][] => {
    // intervalle [lo, hi] privé des baies traversées par la pièce située en `at` (sur l'autre axe)
    const cuts = holes
      .filter((h) => (isU ? h.v0 < at + t / 2 && h.v1 > at - t / 2 : h.u0 < at + t / 2 && h.u1 > at - t / 2))
      .map((h) => (isU ? [h.u0, h.u1] : [h.v0, h.v1]) as [number, number]).sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let x = lo;
    for (const [a, b] of cuts) { if (a > x + 0.04) out.push([x, Math.min(a, hi)]); x = Math.max(x, b); }
    if (hi > x + 0.04) out.push([x, hi]);
    return out;
  };
  for (const v of s.rails) for (const [a, b] of cutSpans(s.u0, s.u1, true, v)) flat(a, b, v - t / 2, v + t / 2);
  for (const u of s.posts) for (const [a, b] of cutSpans(s.v0, s.v1, false, u)) flat(u - t / 2, u + t / 2, a, b);
  if (ctx.lod === 2) return;
  for (const [a, va, b, vb] of s.braces ?? []) {
    const L = Math.hypot(b - a, vb - va) || 1;
    const nu = (-(vb - va) / L) * (t * 0.42), nv = ((b - a) / L) * (t * 0.42);
    const pts: V3[] = [[a - nu, va - nv, d * 0.8], [b - nu, vb - nv, d * 0.8], [b + nu, vb + nv, d * 0.8], [a + nu, va + nv, d * 0.8]];
    const q = pts.map((p) => P(f, p[0], p[1], p[2]));
    ctx.mb.polyFacing(m, q, f.n);
  }
}

/** Décharges en croix de Saint-André dans un panneau rectangulaire. */
export function croix(u0: number, v0: number, u1: number, v1: number): [number, number, number, number][] {
  return [[u0, v0, u1, v1], [u0, v1, u1, v0]];
}

/* ------------------------------------------------------------------ */
/* Pignons de façade (au-dessus d'un toit à deux pans perpendiculaire à la rue) */
/* ------------------------------------------------------------------ */

export interface GableSpec {
  /** Façade sur rue (repère dont v = 0 est le sol) ; le pignon occupe toute sa largeur. */
  f: Frame;
  /** Hauteur de l'égout et hauteur du triangle de toiture (faîtage − égout). */
  eave: number;
  rise: number;
  mat?: string;
  capMat?: string;
  /** Épaisseur du mur pignon. */
  t?: number;
}

/**
 * Pignon à gradins (redents) : `steps` gradins de chaque côté, dépassant la toiture de `lift`.
 * Le premier gradin (toute la largeur) est laissé à l'appelant s'il veut y percer des baies : passer `skipFirst`.
 */
export function steppedGable(ctx: Ctx, g: GableSpec & { steps: number; lift?: number; skipFirst?: boolean }): { top: number; tierH: number } {
  const { f } = g;
  const m = g.mat ?? 'facade';
  const cap = g.capMat ?? 'encadrement';
  const t = g.t ?? 0.3;
  const lift = g.lift ?? 0.45;
  const n = g.steps;
  const sh = g.rise / n;
  const Wh = f.w / 2;
  for (let j = g.skipFirst ? 1 : 0; j < n; j++) {
    const hw = Wh * (1 - j / n);
    const va = g.eave + (j === 0 ? 0 : j * sh + lift);
    const vb = g.eave + (j + 1) * sh + lift;
    fbox(ctx, m, f, Wh - hw, Wh + hw, va, vb, -t, 0, 'bottom');
    if (ctx.lod < 2) {
      // couvertines de chaque redent (seulement la partie découverte)
      const hwN = j + 1 < n ? Wh * (1 - (j + 1) / n) : 0;
      if (hwN > 0) {
        fbox(ctx, cap, f, Wh - hw - 0.04, Wh - hwN, vb, vb + 0.07, -t - 0.04, 0.04, 'bottom');
        fbox(ctx, cap, f, Wh + hwN, Wh + hw + 0.04, vb, vb + 0.07, -t - 0.04, 0.04, 'bottom');
      } else fbox(ctx, cap, f, Wh - hw - 0.04, Wh + hw + 0.04, vb, vb + 0.07, -t - 0.04, 0.04, 'bottom');
    }
  }
  return { top: g.eave + n * sh + lift + 0.07, tierH: sh + lift };
}

/**
 * Pignon profilé par tranches : `profile(s)` donne la demi-largeur relative (0..1) à la hauteur relative s (0..1)
 * entre l'égout et `eave + height`. Sert aux pignons en cloche et chantournés.
 */
export function profiledGable(ctx: Ctx, g: GableSpec & { height: number; profile: (s: number) => number; slices?: number; from?: number }): number {
  const { f } = g;
  const m = g.mat ?? 'facade';
  const cap = g.capMat ?? 'encadrement';
  const t = g.t ?? 0.3;
  const n = ctx.lod === 0 ? (g.slices ?? 9) : ctx.lod === 1 ? 6 : 4;
  const Wh = f.w / 2;
  const s0 = g.from ?? 0;
  for (let j = 0; j < n; j++) {
    const sa = s0 + ((1 - s0) * j) / n;
    const sb = s0 + ((1 - s0) * (j + 1)) / n;
    const hw = Wh * Math.max(0.04, g.profile(sa));
    fbox(ctx, m, f, Wh - hw, Wh + hw, g.eave + g.height * sa, g.eave + g.height * sb, -t, 0, 'bottom');
    if (ctx.lod === 0) {
      const hwN = j + 1 < n ? Wh * Math.max(0.04, g.profile(sb)) : 0;
      const vb = g.eave + g.height * sb;
      if (hw - hwN > 0.05) {
        fbox(ctx, cap, f, Wh - hw - 0.03, Wh - hwN + 0.02, vb, vb + 0.05, -t - 0.03, 0.04, 'bottom');
        fbox(ctx, cap, f, Wh + hwN - 0.02, Wh + hw + 0.03, vb, vb + 0.05, -t - 0.03, 0.04, 'bottom');
      }
    }
  }
  return g.eave + g.height;
}

/** Poutre de levage (treuil) et crochet au sommet d'un pignon d'entrepôt. */
export function hoist(ctx: Ctx, f: Frame, uc: number, v: number): void {
  if (ctx.lod === 2) return;
  fbox(ctx, 'colombage', f, uc - 0.09, uc + 0.09, v, v + 0.2, 0, 1.0, 'back');
  if (ctx.lod === 0) {
    ctx.mb.tube('garde_corps', P(f, uc, v, 0.85), P(f, uc, v - 0.55, 0.85), 0.012, 4);
    fbox(ctx, 'garde_corps', f, uc - 0.05, uc + 0.05, v - 0.68, v - 0.55, 0.8, 0.9);
  }
}

/* ------------------------------------------------------------------ */
/* Oriel (bow-window en encorbellement)                                 */
/* ------------------------------------------------------------------ */

export interface OrielSpec {
  uc: number; v0: number; w: number; h: number; depth: number;
  wallMat: string;
  /** Baies de la face avant par niveau : [allège, hauteur] ; hauteur d'étage. */
  floorH: number;
  floors: number;
  win?: WindowOpts;
  winW?: number;
  winH?: number;
  sill?: number;
  /** Toit : 'zinc' (dalle inclinée) ou 'balcon' (terrasse avec garde-corps). */
  top?: 'zinc' | 'balcon';
  roofMat?: string;
  timbered?: boolean;
}

/** Oriel rectangulaire sur consoles, percé sur trois faces. */
export function oriel(ctx: Ctx, f: Frame, s: OrielSpec): void {
  const u0 = s.uc - s.w / 2, u1 = s.uc + s.w / 2;
  const front: Frame = { o: P(f, u0, s.v0, s.depth), u: f.u, n: f.n, w: s.w, h: s.h };
  const left: Frame = { o: P(f, u0, s.v0, 0), u: f.n, n: [-f.u[0], 0, -f.u[2]], w: s.depth, h: s.h };
  const right: Frame = { o: P(f, u1, s.v0, s.depth), u: [-f.n[0], 0, -f.n[2]], n: f.u, w: s.depth, h: s.h };
  const ww = s.winW ?? Math.min(s.w - 0.5, 1.7);
  const wh = s.winH ?? 1.45;
  const sill = s.sill ?? 0.85;
  const fo: OpeningSpec[] = [];
  const so: OpeningSpec[] = [];
  for (let k = 0; k < s.floors; k++) {
    fo.push({ kind: 'window', r: rectAt(s.w / 2, ww, k * s.floorH + sill, wh), o: { leaves: ww > 1.3 ? 3 : 2, shutters: 'none', ...(s.win ?? {}) } });
    if (s.depth >= 0.7) so.push({ kind: 'window', r: rectAt(s.depth / 2, Math.max(0.3, s.depth - 0.36), k * s.floorH + sill, wh), o: { leaves: 1, shutters: 'none', ...(s.win ?? {}), surround: 0 } });
  }
  facade(ctx, front, s.wallMat, fo);
  facade(ctx, left, s.wallMat, so);
  facade(ctx, right, s.wallMat, so);
  if (s.timbered) {
    const rails = [0.09]; for (let k = 1; k <= s.floors; k++) rails.push(k * s.floorH - 0.09);
    timber(ctx, front, { u0: 0, u1: s.w, v0: 0, v1: s.h, posts: [0.09, s.w - 0.09], rails, holes: fo.map((o) => o.r) });
  }
  // sous-face et consoles
  fq(ctx, 'dalle', f, [u0, s.v0, 0], [u1, s.v0, 0], [u1, s.v0, s.depth], [u0, s.v0, s.depth]);
  if (ctx.lod === 0) {
    for (const u of [u0 + 0.12, u1 - 0.12]) {
      fbox(ctx, 'encadrement', f, u - 0.08, u + 0.08, s.v0 - 0.5, s.v0, 0, 0.16, 'back top');
      fbox(ctx, 'encadrement', f, u - 0.07, u + 0.07, s.v0 - 0.16, s.v0, 0.16, s.depth * 0.8, 'back top');
    }
  }
  const vt = s.v0 + s.h;
  if ((s.top ?? 'zinc') === 'zinc') {
    const rm = s.roofMat ?? 'zinc';
    const e = 0.08;
    ctx.mb.polyFacing(rm, [P(f, u0 - e, vt, s.depth + e), P(f, u1 + e, vt, s.depth + e), P(f, u1 + e, vt + 0.45, 0), P(f, u0 - e, vt + 0.45, 0)], [f.n[0], 1, f.n[2]]);
    ctx.mb.polyFacing(rm, [P(f, u0 - e, vt, s.depth + e), P(f, u0 - e, vt + 0.45, 0), P(f, u0 - e, vt, 0)], [-f.u[0], 0, -f.u[2]]);
    ctx.mb.polyFacing(rm, [P(f, u1 + e, vt, s.depth + e), P(f, u1 + e, vt + 0.45, 0), P(f, u1 + e, vt, 0)], [f.u[0], 0, f.u[2]]);
  } else {
    fbox(ctx, 'dalle', f, u0 - 0.05, u1 + 0.05, vt, vt + 0.12, 0, s.depth + 0.05, 'back');
    balcon(ctx, f, u0 - 0.05, u1 + 0.05, vt + 0.12, { depth: s.depth + 0.05, slab: 0.02, rail: 'fer' });
  }
}

/* ------------------------------------------------------------------ */
/* Mur-rideau et trames tertiaires                                      */
/* ------------------------------------------------------------------ */

export interface CurtainSpec {
  u0: number; u1: number; v0: number; v1: number;
  /** Largeur de trame (m) et hauteur d'étage. */
  module: number;
  floorH: number;
  /** Hauteur de l'allège opaque en pied d'étage (0 = tout verre). */
  spandrel: number;
  spandrelMat?: string;
  /** Épines verticales : profondeur (0 = aucune) et pas (en trames). */
  fin?: number;
  finEvery?: number;
  finMat?: string;
  /** Nez de dalle saillant (bandeau horizontal) : profondeur. */
  slabEdge?: number;
  glassMat?: string;
}

/**
 * Mur-rideau : vitrages par trame et par étage (graine d'allumage propre : bureaux éclairés par plateaux),
 * allèges opaques, épines verticales et nez de dalle. Surface autoportante (aucun mur derrière).
 */
export function curtainWall(ctx: Ctx, f: Frame, s: CurtainSpec): void {
  const w = s.u1 - s.u0;
  const nM = Math.max(1, Math.round(w / s.module));
  const mW = w / nM;
  const nF = Math.max(1, Math.round((s.v1 - s.v0) / s.floorH));
  const fh = (s.v1 - s.v0) / nF;
  const sp = s.spandrelMat ?? 'allege';
  const gm = s.glassMat ?? 'verre';
  const group = ctx.lod === 0 ? 2 : ctx.lod === 1 ? 4 : nM; // trames par vitrage
  for (let k = 0; k < nF; k++) {
    const va = s.v0 + k * fh;
    const floorSeed = ctx.r();
    if (s.spandrel > 0) fq(ctx, sp, f, [s.u0, va, 0], [s.u1, va, 0], [s.u1, va + s.spandrel, 0], [s.u0, va + s.spandrel, 0]);
    for (let i = 0; i < nM; i += group) {
      const a = s.u0 + i * mW;
      const b = s.u0 + Math.min(nM, i + group) * mW;
      // plateaux éclairés d'un bloc : la graine varie peu le long d'un étage
      const lit = Math.min(0.999, Math.max(0, floorSeed + ((((i / group) * 7919) % 5) - 2) * 0.06));
      glass(ctx, f, a, b, va + s.spandrel, va + fh, 0, lit, gm);
    }
    if ((s.slabEdge ?? 0) > 0 && ctx.lod < 2) fbox(ctx, s.finMat ?? 'menuiserie', f, s.u0, s.u1, va - 0.07, va + 0.07, 0, s.slabEdge!, 'back left right');
  }
  const fm = s.finMat ?? 'menuiserie';
  if (ctx.lod === 0) {
    for (let i = 0; i <= nM; i++) {
      const u = s.u0 + i * mW;
      const deep = (s.fin ?? 0) > 0 && i % (s.finEvery ?? 1) === 0;
      fbox(ctx, fm, f, u - 0.03, u + 0.03, s.v0, s.v1, 0, deep ? s.fin! : 0.05, 'back top bottom');
    }
  } else if (ctx.lod === 1 && (s.fin ?? 0) > 0.15) {
    const every = (s.finEvery ?? 1) * 2;
    for (let i = 0; i <= nM; i += every) {
      const u = s.u0 + i * mW;
      fbox(ctx, fm, f, u - 0.03, u + 0.03, s.v0, s.v1, 0, s.fin!, 'back top bottom');
    }
  }
}

/** Brise-soleil horizontaux (lames) devant une bande vitrée. LOD0 : lames ; LOD1 : 1 lame sur 3 ; LOD2 : rien. */
export function louvers(ctx: Ctx, f: Frame, u0: number, u1: number, v0: number, v1: number, step = 0.35, depth = 0.35, mat = 'menuiserie'): void {
  if (ctx.lod === 2) return;
  const st = ctx.lod === 0 ? step : step * 3;
  for (let v = v0 + st / 2; v < v1; v += st) fbox(ctx, mat, f, u0, u1, v - 0.02, v + 0.02, 0.1, 0.1 + depth, 'back');
  if (ctx.lod === 0) for (const u of [u0 + 0.05, u1 - 0.05]) fbox(ctx, mat, f, u - 0.03, u + 0.03, v0, v1, 0, 0.12, 'back');
}

/* ------------------------------------------------------------------ */
/* Règles prêtes à l'emploi                                             */
/* ------------------------------------------------------------------ */

/** Façade arrière sobre : une fenêtre simple par travée et par étage, porte de service au rez-de-chaussée. */
export function rearRule(o: { w?: number; h?: number; sill?: number; win?: WindowOpts; door?: boolean; rdcH?: number } = {}): Rule {
  return (c) => {
    if (c.level.id === 'socle') return null;
    if (c.level.index === 0 && o.door !== false && c.i === Math.floor(c.nBays / 2)) return doorAt(c, 0.95, 2.1, { style: 'vitree' });
    const h = Math.min(o.h ?? 1.35, c.level.h - (o.sill ?? 0.95) - 0.25);
    if (h < 0.5) return null;
    return win(c, { w: Math.min(o.w ?? 1.0, c.bw - 0.5), h, sill: o.sill ?? 0.95, o: { shutters: 'none', ...(o.win ?? {}) } });
  };
}

/** Niveaux courants : rdc + n étages (+ attique). */
export function levels(rdcH: number, n: number, floorH: number, o: { noble?: number; attic?: number } = {}): LevelSpec[] {
  const out: LevelSpec[] = [{ id: 'rdc', h: rdcH }];
  for (let k = 0; k < n; k++) out.push({ id: k === 0 && o.noble ? 'noble' : 'etage', h: k === 0 && o.noble ? o.noble : floorH });
  if (o.attic) out.push({ id: 'attique', h: o.attic });
  return out;
}


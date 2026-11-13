/**
 * GÉNÉRATEUR PROCÉDURAL — composants de haut niveau : corps de bâtiment (volume + grammaire de façade + modénature),
 * toitures par style (lucarnes, souches, équipements, édicules), rez-de-chaussée commercial, cours et clôtures.
 *
 * Toutes les fonctions sont déterministes et respectent les trois LOD (voir tools/buildings/kit).
 */
import {
  bays, chimney, dormer, downpipe, fbox, flatRoof, gableRoof, hipRoof, loggia, mansardRoof, mast, P,
  rectAt, rooftopUnit, shedRoof, stairHouse, subFrame, volume,
  type Ctx, type Frame, type OpeningSpec, type Rect, type Side, type VolumeSpec,
} from '../kit/index';
import { balcon, railLine, type BalconOpts } from './rail';
import { compose, decorate, grid, levels, modillons, refends, timber, win, type Elem, type Grid, type Rule } from './grammar';
import type { RoofKind, StyleSpec } from './styles';
import type { WindowOpts } from '../kit/index';

export const SIDES: Side[] = ['S', 'E', 'N', 'W'];

/** Côtés opposé / latéraux d'une façade principale. */
export function opposite(s: Side): Side { return s === 'S' ? 'N' : s === 'N' ? 'S' : s === 'E' ? 'W' : 'E'; }
export function laterals(s: Side): [Side, Side] { return s === 'S' || s === 'N' ? ['E', 'W'] : ['S', 'N']; }

export interface BodySpec {
  x0: number; x1: number; z0: number; z1: number;
  y0?: number;
  /** Nombre d'étages au-dessus du rez-de-chaussée. */
  floors: number;
  groundH?: number;
  floorH?: number;
  /** Côté rue (défaut S). */
  front?: Side;
  /** Motif de travées de la façade principale (ex. 'aba', 'apa'). 'p' = travée de porte. */
  pattern?: string;
  weights?: Record<string, number>;
  margin?: number;
  /** Rez-de-chaussée commercial (vitrines). */
  shop?: { bays?: number; awning?: boolean; sign?: boolean } | false;
  /** Porte d'entrée : travée visée (index), ou 'milieu'. */
  door?: number | 'milieu' | false;
  doorW?: number;
  /** Balcons des étages. */
  balcony?: 'non' | 'filant' | 'saillie' | 'alterne' | 'loggia';
  /** Étage(s) sans balcon (index d'étage, 0 = premier au-dessus du rdc). */
  balconyFrom?: number;
  /** Côtés non dessinés (mitoyenneté). */
  hidden?: Side[];
  /** Percer l'arrière et les côtés. */
  rear?: boolean;
  lateral?: boolean;
  /** Matériau de mur (défaut : style.wall) et de côtés. */
  wallMat?: string;
  sideMat?: Partial<Record<Side, string>>;
  /** Soubassement. */
  plinth?: { h: number; d?: number; mat?: string } | false;
  /** Corniche en tête (défaut : celle du style). */
  cornice?: boolean;
  /** Attique en retrait (hauteur) après la corniche. */
  attic?: number;
  /** Règle personnalisée (remplace la règle du style). */
  rule?: (g: Grid, side: Side, s: StyleSpec) => Rule;
  /** Pans de bois sur la façade principale (style colombage). */
  timbered?: boolean;
  /** Décalage de la trame (jamais de porte / vitrine). */
  blindGround?: boolean;
}

export interface BodyResult {
  frames: Record<Side, Frame>;
  /** Hauteur du dessus des murs (égout) et du haut de la corniche. */
  eave: number;
  top: number;
  grid: Grid;
  ops: Record<Side, OpeningSpec[]>;
}

/** Travées d'une largeur donnée : motif régulier avec une travée de porte au milieu si demandé. */
export function pattern(w: number, bayW: number, door: boolean): string {
  const n = Math.max(2, Math.round(w / bayW));
  if (!door) return 'a'.repeat(n);
  const k = Math.floor(n / 2);
  return `${'a'.repeat(k)}p${'a'.repeat(n - k - 1)}`;
}

/** Règle de façade principale du style (baies, frontons, balcons, vitrines, porte). */
/** Options de fenêtre allégées au LOD1 (modénature invisible au-delà de 150 m, coûteuse en sommets). */
export function winOpts(ctx: Ctx, w: WindowOpts): WindowOpts {
  if (ctx.lod === 0) return w;
  const out: WindowOpts = { ...w, bars: 0, surround: 0, keystone: false, lintel: false };
  if (w.shutters === 'battants') out.shutters = 'battants';
  return out;
}

export function styleRule(s: StyleSpec, g: Grid, o: {
  shop?: { awning?: boolean; sign?: boolean } | false; door?: number | false; doorW?: number;
  balcony?: BodySpec['balcony']; balconyFrom?: number; rail?: BalconOpts['rail']; blindGround?: boolean;
  /** Contexte : permet d'alléger la modénature hors LOD0. */
  ctx?: Ctx;
} = {}): Rule {
  const bal = o.balcony ?? 'non';
  const from = o.balconyFrom ?? 0;
  return (c) => {
    const isGround = c.level.index === 0;
    const out: Elem[] = [];
    if (isGround && o.shop && c.kind !== 'p') {
      return [{ op: { kind: 'shop', r: { u0: c.uc - c.bw / 2 + 0.22, u1: c.uc + c.bw / 2 - 0.22, v0: c.level.v0 + 0.05, v1: c.level.v0 + Math.min(c.level.h - 0.9, 3.0) }, o: { awning: o.shop.awning ?? false, sign: o.shop.sign ?? true, doorAt: c.i % 2 ? 'left' : 'right' } } }];
    }
    if (isGround && o.door !== false && c.i === o.door) {
      const dw = o.doorW ?? Math.min(1.35, c.bw - 0.7);
      return [{ op: { kind: 'door', r: rectAt(c.uc, dw, c.level.v0 + 0.02, 2.5), o: { style: s.id === 'verre_contemporain' || s.id === 'beton_moderne' ? 'moderne' : s.id === 'reconstruction' ? 'vitree' : 'panneaux', transom: 0.5, surround: s.win.surround ?? 0.12, canopy: s.id === 'pierre_claire' ? 'verre' : null } } }];
    }
    if (isGround && o.blindGround) return null;
    const floorIdx = c.level.index - 1;
    const wide = s.bay.w + (c.level.id === 'noble' ? 0.1 : 0);
    const h = Math.min(s.bay.h + (c.level.id === 'noble' ? 0.25 : 0) - (c.level.id === 'attique' ? 0.45 : 0), c.level.h - 0.75);
    const arch = s.arches === 'tout' || (s.arches === 'rdc' && isGround);
    // Avec un balcon filant, le garde-corps continu suffit : pas de balconnet par fenêtre (triangles inutiles).
    const balc = bal === 'non' || bal === 'filant' || floorIdx < from ? null
      : bal === 'saillie' ? 'saillie'
        : bal === 'alterne' ? (floorIdx % 2 === 0 && c.i % 2 === 1 ? 'saillie' : 'net') : null;
    const frenchDoor = balc === 'saillie' || (bal === 'filant' && floorIdx < 2 && s.id !== 'colombage');
    const wo: WindowOpts = { ...s.win, surround: isGround && s.refends === 'rdc' ? 0 : s.win.surround };
    out.push(...win(c, {
      w: Math.min(wide, c.bw - 0.45), h: frenchDoor ? Math.min(h + s.bay.sill, c.level.h - 0.5) : h,
      sill: frenchDoor ? 0 : s.bay.sill, arch,
      o: o.ctx ? winOpts(o.ctx, wo) : wo,
      ped: c.level.id === 'noble' ? s.pediment : null,
      balc, rail: s.rail,
      apron: s.id === 'reconstruction' || s.id === 'beton_moderne' ? 'allege' : null,
    }));
    return out;
  };
}

/** Règle d'une façade secondaire (arrière / pignon) : baies simples, moins nombreuses. */
export function plainRule(s: StyleSpec, o: { shutters?: boolean; sill?: number; ctx?: Ctx } = {}): Rule {
  return (c) => {
    const h = Math.min(s.bay.h * 0.85, c.level.h - 0.8);
    if (h < 0.5 || c.bw < 0.9) return null;
    const wo: WindowOpts = { ...s.win, surround: 0, bars: 0, leaves: 2, shutters: o.shutters === false ? 'none' : s.win.shutters };
    return win(c, {
      w: Math.min(s.bay.w * 0.85, c.bw - 0.5), h, sill: o.sill ?? s.bay.sill,
      o: o.ctx ? winOpts(o.ctx, wo) : wo,
    });
  };
}

/**
 * Corps de bâtiment : volume percé selon la grammaire du style, modénature (soubassement, bandeaux, corniche,
 * refends, chaînages, modillons), balcons filants, loggias, descentes d'eau.
 */
export function body(ctx: Ctx, s: StyleSpec, b: BodySpec): BodyResult {
  const front = b.front ?? 'S';
  const back = opposite(front);
  const [latA, latB] = laterals(front);
  const y0 = b.y0 ?? 0;
  const gH = b.groundH ?? s.groundH;
  const fH = b.floorH ?? s.floorH;
  const w = front === 'S' || front === 'N' ? b.x1 - b.x0 : b.z1 - b.z0;
  const d = front === 'S' || front === 'N' ? b.z1 - b.z0 : b.x1 - b.x0;
  const lv = levels(gH, b.floors, fH);
  const pat = b.pattern ?? pattern(w, s.bay.w + 1.5, b.door !== false && !b.shop);
  const g = grid(w, pat, lv, { margin: b.margin ?? 0.35, weights: b.weights, v0: 0 });
  const doorIdx = b.door === false ? false : b.door === 'milieu' || b.door === undefined ? pat.indexOf('p') : b.door;
  const rule = b.rule ? b.rule(g, front, s) : styleRule(s, g, {
    shop: b.shop === false ? false : b.shop, door: typeof doorIdx === 'number' && doorIdx >= 0 ? doorIdx : false,
    doorW: b.doorW, balcony: b.balcony, balconyFrom: b.balconyFrom, blindGround: b.blindGround, ctx,
  });
  const comp = compose(g, rule);
  const sides: Partial<Record<Side, OpeningSpec[]>> = { [front]: comp.ops };
  // façade arrière : trame plus lâche hors LOD0 (invisible de la rue, coûteuse en sommets)
  const backStep = s.bay.w + (ctx.lod === 0 ? 3.4 : 5.0);
  const gBack = grid(w, 'a'.repeat(Math.max(2, Math.round(w / backStep))), lv, { margin: 0.6, v0: 0 });
  const compBack = b.rear === false ? { ops: [], decos: [] } : compose(gBack, plainRule(s, { shutters: false, ctx }));
  if (b.rear !== false && !b.hidden?.includes(back)) sides[back] = compBack.ops;
  const gLat = grid(d, 'a'.repeat(Math.max(1, Math.round(d / (s.bay.w + (ctx.lod === 0 ? 3.6 : 5.4))))), lv, { margin: 0.8, v0: 0 });
  const compLat = b.lateral ? compose(gLat, plainRule(s, { shutters: false, ctx })) : { ops: [], decos: [] };
  for (const l of [latA, latB]) if (b.lateral && !b.hidden?.includes(l)) sides[l] = compLat.ops;

  const h = g.h;
  const spec: VolumeSpec = {
    x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y0, h, wallMat: b.wallMat ?? s.wall, sides,
  };
  if (b.hidden) spec.hidden = b.hidden;
  if (b.sideMat) spec.sideMat = b.sideMat;
  if (b.plinth !== false) spec.plinth = b.plinth ?? { h: 0.55, d: 0.05, mat: s.base };
  if (s.quoins && ctx.lod === 0) spec.quoins = { mat: 'encadrement', v0: 0.55, v1: h };
  if (s.bandCourse && ctx.lod < 2) {
    const bandsList: { v: number; h?: number; d?: number; mat?: string }[] = [];
    for (let k = 0; k <= b.floors; k++) if (k > 0 || s.id !== 'reconstruction') bandsList.push({ v: lv.slice(0, k + 1).reduce((t, l) => t + l.h, 0) - 0.12, h: 0.16, d: 0.05 });
    spec.bands = bandsList.slice(0, b.floors + 1);
  }
  if (b.cornice !== false) spec.cornice = { profile: s.cornice, mat: s.id === 'brique_pignon' ? 'encadrement' : 'encadrement', v: h };
  const frames = volume(ctx, spec);

  // décors des façades
  decorate(ctx, frames[front], comp);
  if (sides[back]) decorate(ctx, frames[back], compBack);
  if (b.lateral) for (const l of [latA, latB]) if (sides[l]) decorate(ctx, frames[l], compLat);

  // refends et modillons
  const f = frames[front];
  if (s.refends !== 'non') {
    const v1 = s.refends === 'rdc' ? gH : h;
    refends(ctx, f, 'facade', 0.55, v1 - 0.1, comp.ops.map((o) => o.r), 0.62);
  }
  if (s.id === 'pierre_claire' || s.id === 'brique_pignon') modillons(ctx, f, 'encadrement', h + 0.1, 0.95);
  if (b.timbered) {
    const rails = [0.1, ...lv.map((_, k) => lv.slice(0, k + 1).reduce((t, l) => t + l.h, 0) - 0.12)];
    timber(ctx, f, {
      u0: 0.05, u1: w - 0.05, v0: 0.1, v1: h - 0.05,
      posts: [0.14, ...g.us.map((u, i) => u + g.bw[i]! / 2).slice(0, -1), w - 0.14],
      rails, holes: comp.ops.map((o) => o.r),
      braces: g.us.flatMap((u, i) => (i % 2 === 0 ? [[u - g.bw[i]! / 2 + 0.2, lv[0]!.h - 0.3, u - 0.1, lv[0]!.h - 1.5] as [number, number, number, number]] : [])),
    });
  }

  // balcons filants
  if (b.balcony === 'filant') {
    const from = b.balconyFrom ?? 0;
    for (let k = 0; k < b.floors; k++) {
      if (k < from) continue;
      const v = gH + k * fH + 0.04;
      balcon(ctx, f, 0.3, w - 0.3, v, { depth: 0.95, slab: 0.17, rail: s.rail, consoles: s.id === 'pierre_claire', sides: 'both' });
    }
  }
  if (b.balcony === 'loggia') {
    // loggias d'angle : traitées par les familles (nécessite un retrait du volume)
  }
  if (ctx.lod === 0) downpipe(ctx, f, w - 0.25, h);

  let top = h + s.cornice.reduce((t, p) => t + p[0], 0);
  if (b.attic) {
    const inset = 1.1;
    volume(ctx, {
      x0: b.x0 + inset, x1: b.x1 - inset, z0: b.z0 + inset, z1: b.z1 - inset, y0: y0 + top, h: b.attic,
      wallMat: 'facade_b',
      sides: { [front]: compose(grid(w - 2 * inset, 'a'.repeat(Math.max(2, Math.round((w - 2 * inset) / 3.2))), [{ id: 'attique', h: b.attic }], { margin: 0.4 }), plainRule(s, { sill: 0.5 })).ops },
    });
    flatRoof(ctx, { x0: b.x0 + inset, x1: b.x1 - inset, z0: b.z0 + inset, z1: b.z1 - inset, y: y0 + top + b.attic - 0.2, parapet: y0 + top + b.attic, wallMat: 'facade_b' });
    // terrasse autour de l'attique
    fbox(ctx, 'terrasse', frames[front], 0, w, top - 0.02, top + 0.02, -d + 0.1, -0.1, 'back');
    top += b.attic;
  }
  return { frames, eave: y0 + h, top: y0 + top, grid: g, ops: { [front]: comp.ops, [back]: compBack.ops, [latA]: compLat.ops, [latB]: compLat.ops } as Record<Side, OpeningSpec[]> };
}

/* ------------------------------------------------------------------ */
/* Toitures                                                             */
/* ------------------------------------------------------------------ */

export interface RoofSpec {
  x0: number; x1: number; z0: number; z1: number;
  y: number;
  kind?: RoofKind;
  /** Axe du faîtage pour un toit à deux pans. */
  axis?: 'x' | 'z';
  /** Lucarnes sur la façade `front`. */
  front?: Side;
  dormers?: number | false;
  chimneys?: number | false;
  /** Pignons visibles (deux pans). */
  gables?: [boolean, boolean];
  gableMat?: string | null;
  /** Toiture-terrasse : hauteur d'acrotère et équipements. */
  parapet?: number;
  equipment?: boolean;
  stair?: boolean;
  /** Nombre de sheds (toiture shed). */
  sheds?: number;
}

/** Toiture complète selon le style (lucarnes, souches, équipements). */
export function roof(ctx: Ctx, s: StyleSpec, o: RoofSpec): number {
  const kind = o.kind ?? s.roof;
  // Au-delà du LOD0 : pas de lucarnes ni d'équipements de toiture (invisibles au-delà de 150 m, coûteux en sommets).
  if (ctx.lod > 0) o = { ...o, dormers: false, equipment: false, stair: ctx.lod === 1 ? o.stair : false };
  const lx = o.x1 - o.x0, lz = o.z1 - o.z0;
  const front = o.front ?? 'S';
  const axis = o.axis ?? (front === 'S' || front === 'N' ? 'x' : 'z');
  if (kind === 'terrasse') {
    const par = o.parapet ?? 0.55;
    flatRoof(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y: o.y - 0.18, parapet: o.y + par, wallMat: s.wall });
    if (o.equipment !== false && ctx.lod < 2) {
      rooftopUnit(ctx, o.x0 + lx * 0.32, o.y - 0.16, o.z0 + lz * 0.42, Math.min(3.2, lx * 0.22), Math.min(2.2, lz * 0.2), 1.1);
      if (lx > 12) rooftopUnit(ctx, o.x0 + lx * 0.7, o.y - 0.16, o.z0 + lz * 0.55, Math.min(2.4, lx * 0.16), Math.min(1.8, lz * 0.16), 0.85);
    }
    if (o.stair !== false) stairHouse(ctx, o.x0 + lx * 0.5 - 1.6, o.z0 + lz * 0.5 - 1.4, o.x0 + lx * 0.5 + 1.6, o.z0 + lz * 0.5 + 1.4, o.y - 0.18, 2.6, s.wall);
    return o.y + par;
  }
  if (kind === 'shed') {
    const n = o.sheds ?? Math.max(2, Math.round(lz / 9));
    const dz = lz / n;
    let top = o.y;
    for (let k = 0; k < n; k++) {
      const z0 = o.z0 + k * dz;
      const r = shedRoof(ctx, { x0: o.x0, x1: o.x1, z0, z1: z0 + dz, yLow: o.y, yHigh: o.y + dz * 0.42, low: 'S', overhang: 0.25, thickness: 0.18, wallMat: s.wall, gutters: k === 0 });
      top = Math.max(top, r.ridgeY);
      // verrière du shed (versant nord vitré)
      if (ctx.lod === 0) {
        const yv0 = o.y + 0.25, yv1 = o.y + dz * 0.42 - 0.1;
        const f: Frame = { o: [o.x0, yv0, z0 + 0.05], u: [1, 0, 0], n: [0, 0, 1], w: lx, h: yv1 - yv0 };
        const nGl = ctx.lod === 0 ? Math.max(2, Math.round(lx / 3)) : 1;
        for (let i = 0; i < nGl; i++) {
          const a = (lx * i) / nGl + 0.2, b2 = (lx * (i + 1)) / nGl - 0.2;
          fbox(ctx, 'verre', f, a, b2, 0.1, yv1 - yv0 - 0.1, 0, 0.02, 'back');
        }
        if (ctx.lod === 0) for (let i = 0; i <= nGl; i++) fbox(ctx, 'menuiserie', f, (lx * i) / nGl - 0.05, (lx * i) / nGl + 0.05, 0, yv1 - yv0, 0, 0.06, 'back');
      }
    }
    return top;
  }
  if (kind === 'mansarde') {
    const inset = Math.min(lx, lz) * 0.22;
    const lower = Math.min(3.1, Math.min(lx, lz) * 0.3);
    const m = mansardRoof(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y: o.y, lowerH: lower, inset, upperPitch: 12 });
    if (o.dormers !== false) {
      const n = o.dormers || Math.max(2, Math.round(lx / 4.5));
      const fr: Frame = front === 'S'
        ? { o: [o.x0, o.y, o.z1 - 0.1], u: [1, 0, 0], n: [0, 0, 1], w: lx, h: lower + 2 }
        : { o: [o.x1, o.y, o.z0 + 0.1], u: [-1, 0, 0], n: [0, 0, -1], w: lx, h: lower + 2 };
      for (const u of bays(lx, n, 1.0)) dormer(ctx, fr, u, 0.3, 1.35, lower - 0.9, inset * 0.8, { roof: 'gable', wallMat: 'zinc', cheekMat: 'zinc', roofMat: 'zinc', win: { leaves: 2, bars: 1, reveal: 0.1 }, pitch: 38 });
    }
    if (o.chimneys !== false && s.chimneys) {
      const n = o.chimneys || 2;
      for (let k = 0; k < n; k++) chimney(ctx, o.x0 + (lx * (k + 0.5)) / n, o.z0 + lz * 0.45, 0.75, 1.0, o.y + lower * 0.6, m.top + 1.1, { pots: 3 });
    }
    return m.top;
  }
  if (kind === 'quatre_pans') {
    // pente plafonnée : la pente des styles à mansarde (72°) ou à pignons (55°) donne sur une croupe une pyramide démesurée
    const r = hipRoof(ctx, { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y: o.y, pitch: Math.min(s.pitch, 42), overhang: s.id === 'enduit_volets' ? 0.65 : 0.5 });
    if (o.chimneys !== false && s.chimneys) chimney(ctx, o.x0 + lx * 0.3, o.z0 + lz * 0.45, 0.7, 0.9, o.y, r.ridgeY + 0.6, { pots: 2 });
    return r.ridgeY;
  }
  const g: Parameters<typeof gableRoof>[1] = {
    x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y: o.y, pitch: s.pitch, axis,
    overhang: s.id === 'colombage' ? 0.7 : 0.45, verge: 0.3,
  };
  if (o.gableMat !== undefined) g.gableMat = o.gableMat;
  if (o.gables) g.gables = o.gables;
  if (s.id === 'colombage') g.timber = true;
  const r = gableRoof(ctx, g);
  if (o.dormers !== false && s.dormers) {
    const n = o.dormers || Math.max(1, Math.round(lx / 5.5));
    const fr: Frame = { o: [o.x0, o.y, o.z1 - 0.45], u: [1, 0, 0], n: [0, 0, 1], w: lx, h: 4 };
    if (axis === 'x') for (const u of bays(lx, n, 1.2)) dormer(ctx, fr, u, 0.55, 1.5, 1.15, 1.8, { wallMat: s.id === 'brique_pignon' ? 'facade' : 'rive', cheekMat: 'rive', win: { leaves: 2, bars: 1, reveal: 0.1 } });
  }
  if (o.chimneys !== false && s.chimneys) {
    const n = o.chimneys || 1;
    for (let k = 0; k < n; k++) chimney(ctx, o.x0 + (lx * (k + 0.5)) / n, o.z0 + lz * (axis === 'x' ? 0.5 : 0.3), 0.7, 0.9, o.y, r.ridgeY + 0.8, { pots: 2 });
  }
  return r.ridgeY;
}

/* ------------------------------------------------------------------ */
/* Abords                                                               */
/* ------------------------------------------------------------------ */

/** Muret de clôture avec piliers et portillon (devant la façade `f`, à la distance `dz`). */
export function enclosure(ctx: Ctx, f: Frame, dz: number, gateU: number, o: { h?: number; mat?: string; capMat?: string; rail?: boolean; gateW?: number } = {}): void {
  if (ctx.lod === 2) return;
  const h = o.h ?? 0.7;
  const m = o.mat ?? 'soubassement';
  const cap = o.capMat ?? 'encadrement';
  const gw = o.gateW ?? 1.2;
  for (const [a, b] of [[0.05, gateU - gw / 2], [gateU + gw / 2, f.w - 0.05]] as [number, number][]) {
    if (b - a < 0.2) continue;
    fbox(ctx, m, f, a, b, 0, h, dz - 0.12, dz + 0.12, 'bottom');
    fbox(ctx, cap, f, a - 0.04, b + 0.04, h, h + 0.08, dz - 0.16, dz + 0.16, 'bottom');
    if (o.rail !== false) fence(ctx, f, a + 0.05, b - 0.05, dz, h + 0.75, 'fer', h + 0.08);
  }
  for (const u of [gateU - gw / 2, gateU + gw / 2]) fbox(ctx, m, f, u - 0.16, u + 0.16, 0, h + 0.5, dz - 0.18, dz + 0.18, 'bottom');
  fence(ctx, f, gateU - gw / 2 + 0.16, gateU + gw / 2 - 0.16, dz, h + 0.45, 'fer');
}

/** Grille en fer entre deux points de façade (clôture ajourée). */
export function fence(ctx: Ctx, f: Frame, u0: number, u1: number, dz: number, h = 1.3, style: 'fer' | 'barreaux' = 'fer', v0 = 0): void {
  if (ctx.lod === 2) return;
  railLine(ctx, P(f, u0, v0, dz), P(f, u1, v0, dz), h - v0, style);
}

/** Terrasse / parvis dallé devant la façade. */
export function forecourt(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, mat = 'soubassement'): void {
  ctx.mb.box(mat, x0, y - 0.12, z0, x1, y, z1, 'ny');
}

/** Loggias superposées en retrait dans un volume (façade `f`), une par étage. */
export function loggiaStack(ctx: Ctx, f: Frame, u0: number, u1: number, v0: number, floorH: number, n: number, wallMat: string, o: { depth?: number; rail?: BalconOpts['rail'] } = {}): void {
  for (let k = 0; k < n; k++) {
    const r: Rect = { u0, u1, v0: v0 + k * floorH + 0.05, v1: v0 + (k + 1) * floorH - 0.35 };
    loggia(ctx, f, r, wallMat, { depth: o.depth ?? 1.5, rail: o.rail ?? 'barreaux' });
  }
}

/** Mât / antenne et balisage en couronnement de tour. */
export function crown(ctx: Ctx, x: number, z: number, y: number, h: number): void {
  mast(ctx, x, y, z, h);
}

/** Grille de parking / cour fermée : portail coulissant et bordure. */
export function gate(ctx: Ctx, f: Frame, uc: number, w: number, dz: number, h = 2.0): void {
  if (ctx.lod === 2) return;
  for (const u of [uc - w / 2, uc + w / 2]) fbox(ctx, 'soubassement', f, u - 0.14, u + 0.14, 0, h + 0.25, dz - 0.16, dz + 0.16, 'bottom');
  fence(ctx, f, uc - w / 2 + 0.14, uc + w / 2 - 0.14, dz, h, 'barreaux');
}

export { subFrame };

/* ------------------------------------------------------------------ */
/* Volumes polygonaux (immeubles d'angle, halles, plans en L)           */
/* ------------------------------------------------------------------ */

/**
 * Repères de façade d'un contour polygonal (points XZ, dans n'importe quel sens) : un repère par segment,
 * normale tournée vers l'extérieur (déterminée par rapport au centre du polygone).
 */
export function ringFrames(pts: [number, number][], y0: number, h: number): Frame[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const out: Frame[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    const u: [number, number] = [dx / L, dz / L];
    let n: [number, number] = [-u[1], u[0]];
    const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
    if (n[0] * mx + n[1] * mz < 0) n = [-n[0], -n[1]];
    // Repère du kit (cf. sideFrame : façade sud u = +X, n = +Z) : u pointe « vers la droite vu de l'extérieur », ce qui
    // donne n.x·u.z − n.z·u.x < 0. (Le signe inverse produisait des repères en miroir : faces enroulées vers l'intérieur.)
    const start = n[0] * u[1] - n[1] * u[0] < 0 ? a : b;
    const uu: [number, number] = start === a ? u : [-u[0], -u[1]];
    out.push({ o: [start[0], y0, start[1]], u: [uu[0], 0, uu[1]], n: [n[0], 0, n[1]], w: L, h });
  }
  return out;
}

/** Plancher / dalle horizontale d'un contour polygonal (face vers le haut). */
export function slab(ctx: Ctx, pts: [number, number][], y: number, mat: string, down = false): void {
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]!; return s + (p[0] * q[1] - q[0] * p[1]); }, 0);
  const ring = area > 0 ? pts : [...pts].reverse(); // sens horaire vu de dessus (x, z) => normale +Y avec notre convention
  const v = ring.map(([x, z]) => [x, y, z] as [number, number, number]);
  ctx.mb.polyFacing(mat, v, [0, down ? -1 : 1, 0]);
}

/** Acrotère le long de chaque façade d'un contour (hauteur `p`, épaisseur `t`), avec couvertine. */
export function parapetRing(ctx: Ctx, frames: Frame[], v: number, p: number, wallMat: string, capMat = 'zinc'): void {
  for (const f of frames) {
    fbox(ctx, wallMat, f, -0.02, f.w + 0.02, v, v + p, -0.28, 0, 'bottom');
    if (ctx.lod < 2) fbox(ctx, capMat, f, -0.06, f.w + 0.06, v + p, v + p + 0.07, -0.33, 0.05, 'bottom');
  }
}

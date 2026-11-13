/**
 * BÂTIMENTS PROCÉDURAUX — habitat collectif des grands ensembles : barres, plots, tours d'habitation,
 * immeubles en redans et petits collectifs de faubourg.
 *
 * Caractéristiques : trames répétitives, loggias ou balcons filants, pignons aveugles, toitures-terrasses,
 * cages d'escalier marquées (allèges d'un autre matériau), socle technique.
 */
import { fbox, flatRoof, rectAt, volume, type BuildingDef, type Ctx, type Frame, type OpeningSpec } from '../../kit/index';
import { compose, curtainWall, grid, levels } from '../grammar';
import { body, loggiaStack, plainRule, roof as roofOf, styleRule } from '../parts';
import { balcon, railLine } from '../rail';
import { STYLES } from '../styles';
import { budget, makeDef, type Meta, type QuartierTag } from './common';

const SRC = 'tools/buildings/procedural/models/collectifs.ts';

/* ================================================================== */
/* 1. Barre de logements                                                */
/* ================================================================== */

export interface BarreOpts {
  w: number; d: number; floors: number;
  /** Nombre de cages d'escalier (travées verticales marquées). */
  cages: number;
  /** Traitement des étages : balcons filants, loggias ou simples fenêtres. */
  etages?: 'filant' | 'loggia' | 'simple';
  /** Redans : décalage en plan des sections (m). */
  redans?: number;
  /** Rez-de-chaussée sur pilotis (porches traversants). */
  pilotis?: boolean;
  /** Commerces en pied. */
  shop?: boolean;
}

export function barre(m: Meta, o: BarreOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const gH = s.groundH;
    const fH = s.floorH;
    const h = gH + o.floors * fH;
    const sect = o.cages;
    const sw = o.w / sect;
    for (let k = 0; k < sect; k++) {
      const x0 = -o.w / 2 + k * sw;
      const x1 = x0 + sw;
      const off = o.redans ? (k % 2 === 0 ? 0 : o.redans) : 0;
      const z0 = -o.d / 2 + off, z1 = o.d / 2 + off;
      const hidden: ('E' | 'W')[] = [];
      if (!o.redans) { if (k > 0) hidden.push('W'); if (k < sect - 1) hidden.push('E'); }
      const nb = Math.max(2, Math.round(sw / 4.0));
      const r = body(ctx, s, {
        x0, x1, z0, z1, floors: o.floors, front: 'S', pattern: `${'a'.repeat(nb)}c`, weights: { c: 0.62 },
        margin: 0.4, shop: o.shop && k % 2 === 0 ? { awning: false, sign: true } : false,
        door: o.shop && k % 2 === 0 ? false : nb,
        balcony: o.etages === 'filant' ? 'filant' : 'non', balconyFrom: 0,
        hidden, rear: true, lateral: !!o.redans,
        plinth: { h: 0.45, d: 0.05, mat: s.base },
        sideMat: { E: 'facade_b', W: 'facade_b' },
      });
      const f = r.frames.S;
      // cage d'escalier : bande verticale vitrée (dernière travée)
      const cu = r.grid.us[nb]!;
      const cw = r.grid.bw[nb]!;
      if (ctx.lod < 2) {
        for (let i = 0; i < o.floors + 1; i++) {
          fbox(ctx, 'allege', f, cu - cw / 2 + 0.12, cu + cw / 2 - 0.12, i * fH + 0.6, i * fH + 1.0, 0, 0.04, 'back');
        }
      }
      if (o.etages === 'loggia') {
        loggiaStack(ctx, f, cu - cw / 2 - sw * 0.34, cu - cw / 2 - 0.3, gH + 0.05, fH, o.floors, 'facade', { depth: 1.5, rail: s.rail });
      }
      if (o.pilotis && k % 2 === 1 && ctx.lod < 2) {
        // porche traversant : deux poteaux et un linteau
        for (const px of [x0 + sw * 0.35, x0 + sw * 0.65]) ctx.mb.box('soubassement', px - 0.3, 0, z1 - 0.4, px + 0.3, gH - 0.3, z1 + 0.3, 'ny');
      }
      roofOf(ctx, s, { x0, x1, z0, z1, y: h, kind: 'terrasse', parapet: 0.65, front: 'S', equipment: k === 0, stair: k % 2 === 0 });
    }
  });
}

/* ================================================================== */
/* 2. Tour d'habitation (plot)                                          */
/* ================================================================== */

export interface TourOpts {
  w: number; d: number; floors: number;
  /** Balcons d'angle (saillie) ou loggias encastrées. */
  angles?: 'balcons' | 'loggias' | 'non';
  /** Couronnement : édicule technique, terrasse-jardin, mât. */
  couronnement?: 'technique' | 'jardin';
  socle?: boolean;
}

export function tour(m: Meta, o: TourOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const gH = s.groundH;
    const fH = s.floorH;
    const h = gH + o.floors * fH;
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const lv = levels(gH, o.floors, fH);
    const sides: Partial<Record<'S' | 'E' | 'N' | 'W', OpeningSpec[]>> = {};
    const comps: { side: 'S' | 'E' | 'N' | 'W'; c: ReturnType<typeof compose>; f: Frame }[] = [];
    for (const side of ['S', 'E', 'N', 'W'] as const) {
      const w = side === 'S' || side === 'N' ? o.w : o.d;
      const g = grid(w, 'a'.repeat(Math.max(2, Math.round(w / 3.6))), lv, { margin: 0.5 });
      const c = compose(g, side === 'S'
        ? styleRule(s, g, { shop: false, door: 0, balcony: 'non' })
        : plainRule(s));
      sides[side] = c.ops;
      const f: Frame = side === 'S' ? { o: [x0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w, h }
        : side === 'N' ? { o: [x1, 0, z0], u: [-1, 0, 0], n: [0, 0, -1], w, h }
          : side === 'E' ? { o: [x1, 0, z1], u: [0, 0, -1], n: [1, 0, 0], w, h }
            : { o: [x0, 0, z0], u: [0, 0, 1], n: [-1, 0, 0], w, h };
      comps.push({ side, c, f });
    }
    volume(ctx, {
      x0, x1, z0, z1, h, wallMat: s.wall, sides,
      plinth: { h: 0.6, d: 0.06, mat: s.base },
      cornice: { profile: [[0.14, 0.14]], mat: 'encadrement', v: h },
    });
    for (const { c, f } of comps) for (const d of c.decos) d(ctx, f);
    // balcons / loggias d'angle sur toute la hauteur
    if (o.angles !== 'non') {
      // balcons / loggias sur deux faces seulement (rue et jardin) : la silhouette reste lisible et le coût
      // en triangles reste raisonnable sur une tour de 12 à 14 niveaux.
      for (const { side, f } of comps.filter((c) => c.side === 'S' || c.side === 'E')) {
        void side;
        for (let k = 0; k < o.floors; k++) {
          const v = gH + k * fH + 0.05;
          if (o.angles === 'loggias') {
            fbox(ctx, 'dalle', f, 0.3, f.w * 0.32, v, v + 0.16, 0, 1.4, 'back');
            railLine(ctx, [f.o[0] + f.u[0] * 0.35 + f.n[0] * 1.35, v + 0.16, f.o[2] + f.u[2] * 0.35 + f.n[2] * 1.35], [f.o[0] + f.u[0] * f.w * 0.31 + f.n[0] * 1.35, v + 0.16, f.o[2] + f.u[2] * f.w * 0.31 + f.n[2] * 1.35], 1.0, s.rail);
          } else {
            balcon(ctx, f, f.w * 0.55, f.w - 0.35, v, { depth: 1.2, slab: 0.16, rail: s.rail, sides: 'both' });
          }
        }
      }
    }
    if (o.socle) {
      volume(ctx, {
        x0: x0 - 2.4, x1: x1 + 2.4, z0: z0 - 1.4, z1: z1 + 2.4, h: gH - 0.6, wallMat: 'facade_b',
        sides: { S: [{ kind: 'shop', r: { u0: 2.0, u1: o.w + 2.8, v0: 0.05, v1: 2.9 }, o: { sign: true, awning: false, doorAt: 'center' } }] },
        plinth: { h: 0.3, d: 0.05, mat: s.base },
      });
      flatRoof(ctx, { x0: x0 - 2.4, x1: x1 + 2.4, z0: z0 - 1.4, z1: z1 + 2.4, y: gH - 0.75, parapet: gH - 0.5, wallMat: 'facade_b' });
    }
    const top = roofOf(ctx, s, { x0, x1, z0, z1, y: h, kind: 'terrasse', parapet: 0.8, front: 'S', equipment: o.couronnement !== 'jardin' });
    if (o.couronnement === 'jardin' && ctx.lod < 2) {
      ctx.mb.box('terrasse', x0 + 1.2, top - 0.5, z0 + 1.2, x1 - 1.2, top - 0.3, z1 - 1.2, 'ny');
      for (const [bx, bz] of [[x0 + 2.5, z0 + 2.5], [x1 - 2.5, z0 + 2.8], [x0 + 3.0, z1 - 2.6], [x1 - 2.8, z1 - 2.4]] as const) {
        ctx.mb.box('dalle', bx - 0.6, top - 0.3, bz - 0.6, bx + 0.6, top + 0.35, bz + 0.6, 'ny');
      }
    }
  });
}

/* ================================================================== */
/* 3. Petit collectif (R+2/R+3) de faubourg                             */
/* ================================================================== */

export function petitCollectif(m: Meta, o: { w: number; d: number; floors: number; comble?: boolean; entree?: 'centre' | 'laterale' }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH;
    const h = gH + o.floors * s.floorH;
    const n = Math.max(3, Math.round(o.w / 3.2));
    const dIdx = o.entree === 'laterale' ? 0 : Math.floor(n / 2);
    const pat = `${'a'.repeat(dIdx)}p${'a'.repeat(n - 1 - dIdx)}`;
    body(ctx, s, {
      x0, x1, z0, z1, floors: o.floors, front: 'S', pattern: pat, margin: 0.45, door: dIdx,
      balcony: 'alterne', balconyFrom: 0, rear: true, lateral: true,
      plinth: { h: 0.5, d: 0.05, mat: s.base },
    });
    roofOf(ctx, s, {
      x0, x1, z0, z1, y: h, front: 'S', axis: 'x',
      kind: o.comble ? 'mansarde' : s.roof, dormers: o.comble ? Math.max(2, n - 2) : (s.dormers ? 2 : false),
      chimneys: s.chimneys ? 2 : false, parapet: 0.55,
    });
  });
}

/* ================================================================== */
/* 4. Tour contemporaine à mur-rideau (logements de standing)           */
/* ================================================================== */

export function tourVitree(m: Meta, o: { w: number; d: number; floors: number; retraits?: number[]; balcons?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const gH = s.groundH;
    const fH = s.floorH;
    let x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    // socle vitré
    const base = { x0, x1, z0, z1 };
    volume(ctx, {
      x0, x1, z0, z1, h: gH, wallMat: 'soubassement',
      sides: { S: [{ kind: 'shop', r: { u0: 1.2, u1: o.w - 1.2, v0: 0.1, v1: gH - 0.9 }, o: { sign: false, awning: false, doorAt: 'center' } }] },
      plinth: { h: 0.35, d: 0.06, mat: s.base },
    });
    let y = gH;
    const stages = o.retraits ?? [o.floors];
    let inset = 0;
    for (let si = 0; si < stages.length; si++) {
      const nf = stages[si]!;
      const ax0 = x0 + inset, ax1 = x1 - inset, az0 = z0 + inset, az1 = z1 - inset;
      for (const [f, w] of [
        [{ o: [ax0, y, az1], u: [1, 0, 0], n: [0, 0, 1], w: ax1 - ax0, h: nf * fH } as Frame, ax1 - ax0],
        [{ o: [ax1, y, az0], u: [-1, 0, 0], n: [0, 0, -1], w: ax1 - ax0, h: nf * fH } as Frame, ax1 - ax0],
        [{ o: [ax1, y, az1], u: [0, 0, -1], n: [1, 0, 0], w: az1 - az0, h: nf * fH } as Frame, az1 - az0],
        [{ o: [ax0, y, az0], u: [0, 0, 1], n: [-1, 0, 0], w: az1 - az0, h: nf * fH } as Frame, az1 - az0],
      ] as [Frame, number][]) {
        curtainWall(ctx, f, { u0: 0, u1: w, v0: 0, v1: nf * fH, module: 1.55, floorH: fH, spandrel: 0.95, spandrelMat: 'allege', fin: 0.22, finEvery: 2, slabEdge: o.balcons ? 0.5 : 0.18 });
        if (o.balcons) for (let k = 1; k < nf; k += 2) balcon(ctx, f, 0.5, w - 0.5, k * fH, { depth: 1.5, slab: 0.14, rail: 'verre', sides: 'none' });
      }
      y += nf * fH;
      inset += 1.8;
      x0 = ax0; x1 = ax1; z0 = az0; z1 = az1;
      if (si < stages.length - 1) {
        ctx.mb.box('terrasse', x0 - 1.8, y - 0.05, z0 - 1.8, x1 + 1.8, y, z1 + 1.8, 'ny');
      }
    }
    roofOf(ctx, s, { x0, x1, z0, z1, y, kind: 'terrasse', parapet: 1.1, front: 'S', equipment: true });
    if (ctx.lod < 2) ctx.mb.cylinder('garde_corps', (x0 + x1) / 2, y + 1.1, (z0 + z1) / 2, 0.08, 6.5, 6, true);
    void base; void rectAt;
  });
}

/* ================================================================== */
/* Modèles livrés                                                       */
/* ================================================================== */

const Q = (...q: QuartierTag[]): QuartierTag[] => q;
const meta = (o: Omit<Meta, 'src'>): Meta => ({ ...o, src: SRC });

export const COLLECTIFS: BuildingDef[] = [
  barre(meta({
    id: 'proc_barre_loggias', nameFr: 'Barre de logements à loggias', category: 'apartment_high',
    tiles: [5, 2], ...budget(5, 2, 8, 300), residents: 190, density: 'tres_forte', style: 'beton_moderne',
    quartiers: Q('grands_ensembles'), tags: ['barre', 'loggias', 'collectif'],
  }), { w: 39.0, d: 13.5, floors: 8, cages: 3, etages: 'loggia' }),

  barre(meta({
    id: 'proc_barre_redans', nameFr: 'Barre à redans', category: 'apartment_high',
    tiles: [5, 2], ...budget(5, 2, 6, 310), residents: 160, density: 'tres_forte', style: 'reconstruction',
    quartiers: Q('grands_ensembles', 'faubourg'), tags: ['barre', 'redans', 'collectif'],
  }), { w: 38.0, d: 12.0, floors: 6, cages: 3, etages: 'filant', redans: 1.6 }),

  barre(meta({
    id: 'proc_barre_commerces', nameFr: 'Barre à commerces en pied', category: 'apartment_high',
    tiles: [5, 2], ...budget(5, 2, 7, 320), residents: 170, jobs: 24, density: 'tres_forte', style: 'beton_moderne',
    quartiers: Q('grands_ensembles'), tags: ['barre', 'commerces', 'collectif'],
  }), { w: 39.0, d: 13.0, floors: 7, cages: 3, etages: 'filant', shop: true, pilotis: true }),

  barre(meta({
    id: 'proc_barre_brique', nameFr: 'Barre de brique à cages vitrées', category: 'apartment_high',
    tiles: [4, 2], ...budget(4, 2, 6, 330), residents: 130, density: 'tres_forte', style: 'brique_pignon',
    quartiers: Q('grands_ensembles', 'faubourg'), tags: ['barre', 'brique', 'collectif'],
  }), { w: 31.0, d: 13.0, floors: 6, cages: 2, etages: 'simple' }),

  tour(meta({
    id: 'proc_tour_plot_balcons', nameFr: 'Tour d’habitation à balcons', category: 'apartment_high',
    tiles: [3, 3], ...budget(3, 3, 12, 330), residents: 240, density: 'tres_forte', style: 'beton_moderne',
    quartiers: Q('grands_ensembles'), tags: ['tour', 'plot', 'balcons'], lodDistances: [190, 760],
  }), { w: 20.0, d: 19.0, floors: 12, angles: 'balcons', couronnement: 'technique', socle: false }),

  tour(meta({
    id: 'proc_tour_plot_loggias', nameFr: 'Tour à loggias et socle commercial', category: 'apartment_high',
    tiles: [3, 3], ...budget(3, 3, 14, 350), residents: 260, jobs: 20, density: 'tres_forte', style: 'reconstruction',
    quartiers: Q('grands_ensembles', 'affaires'), tags: ['tour', 'loggias', 'commerces'], lodDistances: [200, 800],
  }), { w: 18.5, d: 17.5, floors: 14, angles: 'loggias', couronnement: 'technique', socle: true }),

  tourVitree(meta({
    id: 'proc_tour_verre_logements', nameFr: 'Tour résidentielle vitrée', category: 'apartment_high',
    tiles: [3, 3], ...budget(3, 3, 18, 520), residents: 310, jobs: 14, density: 'tres_forte', style: 'verre_contemporain',
    quartiers: Q('affaires', 'grands_ensembles'), tags: ['tour', 'verre', 'standing'], lodDistances: [220, 900],
  }), { w: 20.0, d: 19.0, floors: 18, retraits: [11, 7], balcons: true }),

  petitCollectif(meta({
    id: 'proc_collectif_faubourg', nameFr: 'Petit collectif de faubourg', category: 'apartment_low',
    tiles: [2, 2], ...budget(2, 2, 2, 420), residents: 22, density: 'moyenne', style: 'enduit_volets',
    quartiers: Q('faubourg', 'pavillonnaire'), tags: ['collectif', 'volets'],
  }), { w: 14.4, d: 12.6, floors: 2, entree: 'centre' }),

  petitCollectif(meta({
    id: 'proc_collectif_comble', nameFr: 'Petit collectif à combles', category: 'apartment_low',
    tiles: [2, 2], ...budget(2, 2, 3, 440), residents: 28, density: 'moyenne', style: 'pierre_claire',
    quartiers: Q('faubourg', 'centre_historique'), tags: ['collectif', 'pierre', 'mansarde'],
  }), { w: 14.2, d: 12.4, floors: 3, comble: true, entree: 'laterale' }),

  petitCollectif(meta({
    id: 'proc_collectif_brique', nameFr: 'Petit collectif en brique', category: 'apartment_low',
    tiles: [2, 2], ...budget(2, 2, 3, 400), residents: 26, density: 'moyenne', style: 'brique_pignon',
    quartiers: Q('faubourg', 'activites'), tags: ['collectif', 'brique'],
  }), { w: 14.0, d: 12.2, floors: 3, entree: 'centre' }),
];

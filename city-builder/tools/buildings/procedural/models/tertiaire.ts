/**
 * BÂTIMENTS PROCÉDURAUX — tertiaire : immeubles de bureaux (mur-rideau, brise-soleil, socle en pierre),
 * tours de bureaux à retraits, hôtels, sièges administratifs, immeubles mixtes bureaux-commerces.
 */
import { facade, fbox, rectAt, rooftopUnit, type BuildingDef, type Ctx, type Frame } from '../../kit/index';
import { compose, curtainWall, grid, levels, louvers } from '../grammar';
import { body, parapetRing, plainRule, ringFrames, roof as roofOf, slab, styleRule } from '../parts';
import { balcon, railLine } from '../rail';
import { STYLES } from '../styles';
import { budget, makeDef, type Meta, type QuartierTag } from './common';

const SRC = 'tools/buildings/procedural/models/tertiaire.ts';

/** Repères des quatre faces d'un pavé (façade principale au sud). */
export function boxFrames(x0: number, z0: number, x1: number, z1: number, y0: number, h: number): Record<'S' | 'E' | 'N' | 'W', Frame> {
  return {
    S: { o: [x0, y0, z1], u: [1, 0, 0], n: [0, 0, 1], w: x1 - x0, h },
    N: { o: [x1, y0, z0], u: [-1, 0, 0], n: [0, 0, -1], w: x1 - x0, h },
    E: { o: [x1, y0, z1], u: [0, 0, -1], n: [1, 0, 0], w: z1 - z0, h },
    W: { o: [x0, y0, z0], u: [0, 0, 1], n: [-1, 0, 0], w: z1 - z0, h },
  };
}

/* ================================================================== */
/* 1. Immeuble de bureaux à mur-rideau                                  */
/* ================================================================== */

export interface BureauxOpts {
  w: number; d: number; floors: number;
  /** Hauteur du socle (rez-de-chaussée en pierre / verre toute hauteur). */
  socle?: number;
  /** Trame du mur-rideau (m) et allège opaque. */
  module?: number;
  allege?: number;
  /** Épines verticales (profondeur) et nez de dalle. */
  fin?: number;
  /** Brise-soleil horizontaux devant les vitrages. */
  briseSoleil?: boolean;
  /** Retrait du dernier niveau. */
  attique?: boolean;
  /** Angle arrondi (pan vitré courbe approché par facettes). */
  anglesCoupes?: number;
}

export function bureaux(m: Meta, o: BureauxOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const socle = o.socle ?? s.groundH;
    const fH = s.floorH;
    const nf = o.floors;
    const h = socle + nf * fH;
    const cut = o.anglesCoupes ?? 0;
    const pts: [number, number][] = cut > 0
      ? [[x0 + cut, z1], [x1 - cut, z1], [x1, z1 - cut], [x1, z0 + cut], [x1 - cut, z0], [x0 + cut, z0], [x0, z0 + cut], [x0, z1 - cut]]
      : [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    // socle : pierre, grandes baies, entrée vitrée
    const socleFrames = ringFrames(pts, 0, socle);
    for (const f of socleFrames) {
      const entry = f.n[2] > 0.5 && f.w > 8;
      const g = grid(f.w, 'a'.repeat(Math.max(1, Math.round(f.w / 4.0))), [{ id: 'rdc', h: socle }], { margin: 0.5 });
      const c = compose(g, (cell) => (entry && cell.i === Math.floor(cell.nBays / 2)
        ? [{ op: { kind: 'door' as const, r: rectAt(cell.uc, Math.min(3.2, cell.bw - 0.8), 0.05, socle - 1.0), o: { style: 'moderne' as const, transom: 0.6, canopy: 'verre' as const } } }]
        : [{ op: { kind: 'shop' as const, r: { u0: cell.uc - cell.bw / 2 + 0.3, u1: cell.uc + cell.bw / 2 - 0.3, v0: 0.12, v1: socle - 0.6 }, o: { sign: false, awning: false, doorAt: 'center' as const } } }]));
      facade(ctx, f, 'soubassement', c.ops);
      for (const dd of c.decos) dd(ctx, f);
    }
    slab(ctx, pts, 0.02, 'soubassement');
    // étages : mur-rideau
    const upper = ringFrames(pts, socle, nf * fH);
    for (const f of upper) {
      curtainWall(ctx, f, {
        u0: 0, u1: f.w, v0: 0, v1: nf * fH,
        module: o.module ?? 1.5, floorH: fH, spandrel: o.allege ?? 0.9, spandrelMat: 'allege',
        fin: o.fin ?? 0.25, finEvery: 2, slabEdge: 0.22,
      });
      if (o.briseSoleil) for (let k = 0; k < nf; k++) louvers(ctx, f, 0.3, f.w - 0.3, k * fH + (o.allege ?? 0.9) + 0.1, (k + 1) * fH - 0.25, 0.42, 0.42);
    }
    // bandeau de couronnement + terrasse technique
    const y = socle + nf * fH;
    slab(ctx, pts, y - 0.15, 'terrasse');
    parapetRing(ctx, ringFrames(pts, 0, 1), y, o.attique ? 0.4 : 1.0, 'facade_b');
    if (o.attique) {
      const i = 2.2;
      const apts = pts.map(([px, pz]) => [px + (px > 0 ? -i : i), pz + (pz > 0 ? -i : i)] as [number, number]);
      for (const f of ringFrames(apts, y + 0.4, fH)) curtainWall(ctx, f, { u0: 0, u1: f.w, v0: 0, v1: fH, module: 1.8, floorH: fH, spandrel: 0.4, spandrelMat: 'allege', fin: 0.12, slabEdge: 0.15 });
      slab(ctx, apts, y + 0.4 + fH - 0.1, 'terrasse');
      parapetRing(ctx, ringFrames(apts, 0, 1), y + 0.4 + fH, 0.45, 'facade_b');
      if (ctx.lod < 2) rooftopUnit(ctx, 0, y + 0.4 + fH - 0.1, 0, Math.min(5, o.w * 0.25), Math.min(3, o.d * 0.2), 1.3);
    } else if (ctx.lod < 2) {
      rooftopUnit(ctx, -o.w * 0.2, y - 0.14, 0, Math.min(4.5, o.w * 0.25), Math.min(3, o.d * 0.22), 1.4);
      rooftopUnit(ctx, o.w * 0.22, y - 0.14, o.d * 0.1, Math.min(3, o.w * 0.18), Math.min(2.2, o.d * 0.18), 1.0);
    }
  });
}

/* ================================================================== */
/* 2. Tour de bureaux                                                   */
/* ================================================================== */

export function tourBureaux(m: Meta, o: { w: number; d: number; stages: number[]; module?: number; couronne?: 'antenne' | 'technique' | 'belvedere'; socle?: number }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const fH = s.floorH;
    const socle = o.socle ?? s.groundH + 1.2;
    let x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    // socle : hall toute hauteur
    for (const f of ringFrames([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0, socle)) {
      curtainWall(ctx, f, { u0: 0.2, u1: f.w - 0.2, v0: 0.3, v1: socle - 0.4, module: 2.6, floorH: socle - 0.7, spandrel: 0, fin: 0.3, finEvery: 1, slabEdge: 0 });
      fbox(ctx, 'soubassement', f, -0.1, f.w + 0.1, 0, 0.3, -0.2, 0.25, 'bottom');
      fbox(ctx, 'facade_b', f, -0.1, f.w + 0.1, socle - 0.4, socle + 0.1, -0.2, 0.3, 'bottom');
    }
    let y = socle;
    let inset = 0;
    for (const nf of o.stages) {
      const ax0 = x0 + inset, ax1 = x1 - inset, az0 = z0 + inset, az1 = z1 - inset;
      const pts: [number, number][] = [[ax0, az1], [ax1, az1], [ax1, az0], [ax0, az0]];
      for (const f of ringFrames(pts, y, nf * fH)) {
        curtainWall(ctx, f, { u0: 0, u1: f.w, v0: 0, v1: nf * fH, module: o.module ?? 1.45, floorH: fH, spandrel: 0.85, spandrelMat: 'allege', fin: 0.3, finEvery: 3, slabEdge: 0.2 });
      }
      y += nf * fH;
      slab(ctx, pts, y - 0.12, 'terrasse');
      parapetRing(ctx, ringFrames(pts, 0, 1), y, 0.6, 'facade_b');
      inset += 1.9;
      x0 += 0; // (les retraits sont appliqués par `inset`)
    }
    const fx = 1.9 * (o.stages.length - 1);
    const cx = 0, cz = 0;
    if (o.couronne === 'antenne' && ctx.lod < 2) {
      ctx.mb.cylinder('garde_corps', cx, y + 0.6, cz, 0.22, 14, ctx.lod === 0 ? 8 : 5, true, 0.07);
      ctx.mb.box('equipement', cx - 1.6, y + 0.4, cz - 1.6, cx + 1.6, y + 2.2, cz + 1.6, 'ny');
    } else if (o.couronne === 'belvedere') {
      const bx0 = x0 + fx - 1.2, bx1 = x1 - fx + 1.2, bz0 = z0 + fx - 1.2, bz1 = z1 - fx + 1.2;
      for (const f of ringFrames([[bx0, bz1], [bx1, bz1], [bx1, bz0], [bx0, bz0]], y + 0.2, fH * 1.4)) {
        curtainWall(ctx, f, { u0: 0, u1: f.w, v0: 0, v1: fH * 1.4, module: 2.2, floorH: fH * 1.4, spandrel: 0.3, spandrelMat: 'allege', fin: 0.18, slabEdge: 0.3 });
      }
      slab(ctx, [[bx0, bz1], [bx1, bz1], [bx1, bz0], [bx0, bz0]], y + 0.2 + fH * 1.4, 'zinc');
      if (ctx.lod < 2) ctx.mb.cylinder('garde_corps', cx, y + fH * 1.4 + 0.4, cz, 0.12, 8, 6, true, 0.05);
    } else if (ctx.lod < 2) {
      rooftopUnit(ctx, cx, y - 0.1, cz, 4.2, 3.0, 2.0);
      ctx.mb.cylinder('garde_corps', cx + 2.6, y, cz - 2.2, 0.08, 6.5, 6, true);
    }
    void balcon; void railLine; void boxFrames;
  });
}

/* ================================================================== */
/* 3. Immeuble de bureaux en pierre / brique (tertiaire de centre)      */
/* ================================================================== */

export function bureauxMaconnes(m: Meta, o: { w: number; d: number; floors: number; attique?: number; shop?: boolean; porche?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const n = Math.max(4, Math.round(o.w / 2.9));
    const half = Math.floor(n / 2);
    const spec: Parameters<typeof body>[2] = {
      x0, x1, z0, z1, floors: o.floors, front: 'S',
      pattern: o.shop ? 'a'.repeat(n) : `${'a'.repeat(half)}p${'a'.repeat(n - 1 - half)}`,
      margin: 0.5, shop: o.shop ? { awning: false, sign: true } : false,
      door: o.shop ? false : half, doorW: 2.4,
      balcony: 'non', rear: true, lateral: true,
      plinth: { h: 0.75, d: 0.07, mat: s.base },
    };
    if (o.attique) spec.attic = o.attique;
    const r = body(ctx, s, spec);
    if (o.porche && ctx.lod < 2) {
      const f = r.frames.S;
      const uc = r.grid.us[half]!;
      fbox(ctx, 'encadrement', f, uc - 2.2, uc + 2.2, s.groundH - 0.3, s.groundH + 0.25, 0, 1.3, 'back');
      if (ctx.lod === 0) for (const u of [uc - 1.9, uc + 1.9]) ctx.mb.cylinder('encadrement', f.o[0] + f.u[0] * u + f.n[0] * 1.0, 0.05, f.o[2] + f.u[2] * u + f.n[2] * 1.0, 0.18, s.groundH - 0.3, 10, false);
    }
    roofOf(ctx, s, {
      x0, x1, z0, z1, y: o.attique ? r.top : s.groundH + o.floors * s.floorH, front: 'S',
      kind: o.attique ? 'terrasse' : (s.roof === 'mansarde' ? 'mansarde' : s.roof), dormers: Math.max(3, n - 3), chimneys: false, parapet: 0.7,
    });
  });
}

/* ================================================================== */
/* 4. Hôtel                                                             */
/* ================================================================== */

export function hotel(m: Meta, o: { w: number; d: number; floors: number; marquise?: boolean; angle?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const n = Math.max(5, Math.round(o.w / 2.7));
    const half = Math.floor(n / 2);
    const r = body(ctx, s, {
      x0, x1, z0, z1, floors: o.floors, front: 'S',
      pattern: `${'a'.repeat(half)}p${'a'.repeat(n - 1 - half)}`, margin: 0.5, door: half, doorW: 2.6,
      balcony: 'alterne', balconyFrom: 0, rear: true, lateral: true,
      plinth: { h: 0.7, d: 0.07, mat: s.base },
    });
    const f = r.frames.S;
    if (o.marquise && ctx.lod < 2) {
      const uc = r.grid.us[half]!;
      // marquise de verre sur tirants
      fbox(ctx, 'garde_corps', f, uc - 2.6, uc + 2.6, 3.4, 3.52, 0, 2.2, 'back');
      ctx.mb.lit = -1;
      fbox(ctx, 'verre_gc', f, uc - 2.5, uc + 2.5, 3.52, 3.56, 0.05, 2.1, 'back');
      ctx.mb.lit = 0.5;
      if (ctx.lod === 0) for (const u of [uc - 2.3, uc + 2.3]) ctx.mb.tube('garde_corps', [f.o[0] + f.u[0] * u + f.n[0] * 2.0, 3.5, f.o[2] + f.u[2] * u + f.n[2] * 2.0], [f.o[0] + f.u[0] * u, 5.6, f.o[2] + f.u[2] * u], 0.025, 5);
      // enseigne verticale
      fbox(ctx, 'enseigne', f, uc + 3.4, uc + 4.1, 4.2, 4.2 + Math.min(6, o.floors * s.floorH * 0.6), 0.1, 0.35, 'back');
    }
    roofOf(ctx, s, {
      x0, x1, z0, z1, y: s.groundH + o.floors * s.floorH, front: 'S',
      kind: s.roof === 'terrasse' ? 'terrasse' : 'mansarde', dormers: Math.max(4, n - 2), chimneys: s.chimneys ? 2 : false, parapet: 0.6,
    });
  });
}

/* ================================================================== */
/* Modèles livrés                                                       */
/* ================================================================== */

const Q = (...q: QuartierTag[]): QuartierTag[] => q;
const meta = (o: Omit<Meta, 'src'>): Meta => ({ ...o, src: SRC });

export const TERTIAIRE: BuildingDef[] = [
  bureaux(meta({
    id: 'proc_bureaux_rideau', nameFr: 'Immeuble de bureaux à mur-rideau', category: 'commercial',
    tiles: [3, 3], ...budget(3, 3, 6, 560), jobs: 320, density: 'forte', style: 'verre_contemporain',
    quartiers: Q('affaires'), tags: ['bureaux', 'tertiaire', 'service:emplois_tertiaires'],
  }), { w: 23.0, d: 21.5, floors: 6, fin: 0.3, attique: true }),

  bureaux(meta({
    id: 'proc_bureaux_brise_soleil', nameFr: 'Bureaux à brise-soleil', category: 'commercial',
    tiles: [3, 2], ...budget(3, 2, 5, 540), jobs: 210, density: 'forte', style: 'verre_contemporain',
    quartiers: Q('affaires', 'activites'), tags: ['bureaux', 'tertiaire', 'brise_soleil', 'service:emplois_tertiaires'],
  }), { w: 22.4, d: 14.4, floors: 5, briseSoleil: true, module: 1.7, allege: 1.0 }),

  bureaux(meta({
    id: 'proc_bureaux_angles_coupes', nameFr: 'Bureaux à angles coupés', category: 'commercial',
    tiles: [3, 3], ...budget(3, 3, 7, 580), jobs: 360, density: 'forte', style: 'verre_contemporain',
    quartiers: Q('affaires'), tags: ['bureaux', 'tertiaire', 'service:emplois_tertiaires'],
  }), { w: 23.0, d: 22.0, floors: 7, anglesCoupes: 3.2, fin: 0.2 }),

  tourBureaux(meta({
    id: 'proc_tour_bureaux_retraits', nameFr: 'Tour de bureaux à retraits', category: 'skyscraper',
    tiles: [3, 3], ...budget(3, 3, 22, 620), jobs: 1500, density: 'tres_forte', style: 'verre_contemporain',
    quartiers: Q('affaires'), tags: ['gratte_ciel', 'bureaux', 'service:emplois_tertiaires'], lodDistances: [230, 950],
  }), { w: 21.0, d: 20.0, stages: [12, 8, 5], couronne: 'technique' }),

  tourBureaux(meta({
    id: 'proc_tour_bureaux_antenne', nameFr: 'Tour d’affaires à antenne', category: 'skyscraper',
    tiles: [3, 3], ...budget(3, 3, 26, 660), jobs: 1900, density: 'tres_forte', style: 'verre_contemporain',
    quartiers: Q('affaires'), tags: ['gratte_ciel', 'bureaux', 'repere_visuel', 'service:emplois_tertiaires'], lodDistances: [250, 1000],
  }), { w: 19.5, d: 18.5, stages: [16, 10], couronne: 'antenne' }),

  tourBureaux(meta({
    id: 'proc_tour_belvedere', nameFr: 'Tour panoramique', category: 'skyscraper',
    tiles: [3, 3], ...budget(3, 3, 24, 700), jobs: 1600, density: 'tres_forte', style: 'verre_contemporain',
    quartiers: Q('affaires'), tags: ['gratte_ciel', 'bureaux', 'belvedere', 'attractivite:2', 'service:emplois_tertiaires'], lodDistances: [250, 1000],
  }), { w: 20.0, d: 19.0, stages: [14, 9], couronne: 'belvedere' }),

  bureauxMaconnes(meta({
    id: 'proc_bureaux_pierre', nameFr: 'Immeuble de bureaux en pierre', category: 'commercial',
    tiles: [3, 2], ...budget(3, 2, 5, 600), jobs: 180, density: 'forte', style: 'pierre_claire',
    quartiers: Q('affaires', 'centre_historique'), mitoyen: true, tags: ['bureaux', 'pierre', 'service:emplois_tertiaires'],
  }), { w: 22.6, d: 14.6, floors: 5, porche: true, attique: 2.9 }),

  bureauxMaconnes(meta({
    id: 'proc_bureaux_brique', nameFr: 'Bureaux en brique et verre', category: 'commercial',
    tiles: [3, 2], ...budget(3, 2, 4, 520), jobs: 140, density: 'forte', style: 'brique_industrielle',
    quartiers: Q('activites', 'affaires'), mitoyen: true, tags: ['bureaux', 'brique', 'service:emplois_tertiaires'],
  }), { w: 22.4, d: 14.6, floors: 4, shop: true }),

  hotel(meta({
    id: 'proc_hotel_pierre', nameFr: 'Hôtel à marquise', category: 'commercial',
    tiles: [4, 2], ...budget(4, 2, 5, 620), jobs: 90, residents: 0, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'affaires'), tags: ['hotel', 'tourisme', 'attractivite:2', 'service:tourisme'],
  }), { w: 30.0, d: 13.2, floors: 5, marquise: true }),

  hotel(meta({
    id: 'proc_hotel_moderne', nameFr: 'Hôtel contemporain', category: 'commercial',
    tiles: [4, 2], ...budget(4, 2, 6, 560), jobs: 110, density: 'forte', style: 'beton_moderne',
    quartiers: Q('affaires', 'faubourg'), tags: ['hotel', 'tourisme', 'service:tourisme'],
  }), { w: 30.2, d: 13.6, floors: 6, marquise: true }),
];

/**
 * BÂTIMENTS PROCÉDURAUX — zones d'activités : halles industrielles à sheds, entrepôts à quais,
 * ateliers artisanaux, dépôts techniques, bâtiments mixtes bureaux-atelier.
 */
import {
  bays, facade, fbox, mast, rectAt, rooftopUnit, shedRoof, volume,
  type BuildingDef, type Ctx, type Frame, type OpeningSpec,
} from '../../kit/index';
import { archedWindow, curtainWall, hoist, timber } from '../grammar';
import { body, forecourt, gate, parapetRing, ringFrames, roof as roofOf, slab } from '../parts';
import { railLine } from '../rail';
import { STYLES } from '../styles';
import { budget, makeDef, type Meta, type QuartierTag } from './common';

const SRC = 'tools/buildings/procedural/models/activites.ts';

/** Baie d'atelier (grande verrière à petits bois métalliques) dans un mur. */
function baieAtelier(f: Frame, u0: number, u1: number, v0: number, v1: number, arc: boolean): { op: OpeningSpec; deco?: (ctx: Ctx, f: Frame) => void } {
  const r = { u0, u1, v0, v1 };
  if (!arc) return { op: { kind: 'window', r, o: { leaves: 3, bars: 4, shutters: 'none', reveal: 0.28, lintel: true, frameMat: 'menuiserie' } } };
  const e = archedWindow(r, 'facade', { leaves: 3, bars: 4, shutters: 'none', reveal: 0.28, surround: 0.16, keystone: true, frameMat: 'menuiserie' });
  void f;
  return { op: e.op!, ...(e.deco ? { deco: e.deco } : {}) };
}

/* ================================================================== */
/* 1. Halle industrielle à sheds                                        */
/* ================================================================== */

export function halleSheds(m: Meta, o: { w: number; d: number; h: number; sheds?: number; cheminee?: number; bureaux?: boolean; cour?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const pts: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    for (const f of ringFrames(pts, 0, H)) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      const decos: ((c: Ctx, fr: Frame) => void)[] = [];
      const n = Math.max(2, Math.round(f.w / 4.6));
      for (const u of bays(f.w, n, 1.2)) {
        if (front && Math.abs(u - f.w / 2) < 2.6) {
          ops.push({ kind: 'garage', r: { u0: f.w / 2 - 2.4, u1: f.w / 2 + 2.4, v0: 0.05, v1: 4.4 } });
          continue;
        }
        const b = baieAtelier(f, u - 1.6, u + 1.6, 1.5, Math.min(H - 1.2, 5.0), true);
        ops.push(b.op);
        if (b.deco) decos.push(b.deco);
      }
      facade(ctx, f, s.wall, ops);
      for (const d of decos) d(ctx, f);
      fbox(ctx, s.base, f, -0.06, f.w + 0.06, 0, 0.7, 0, 0.08, 'back bottom');
      // corniche de brique en dents d'engrenage
      if (ctx.lod < 2) {
        fbox(ctx, 'encadrement', f, -0.12, f.w + 0.12, H - 0.45, H - 0.2, 0, 0.14, 'back');
        if (ctx.lod === 0) {
          const nb = Math.round(f.w / 0.5);
          for (let i = 0; i < nb; i++) fbox(ctx, 'facade', f, (f.w * i) / nb + 0.08, (f.w * (i + 1)) / nb - 0.08, H - 0.75, H - 0.45, 0, 0.1, 'back');
        }
      }
    }
    roofOf(ctx, s, { x0, x1, z0, z1, y: H, kind: 'shed', sheds: o.sheds ?? Math.max(2, Math.round(o.d / 9)), front: 'S' });
    if (o.cheminee) {
      const cx = x0 + 2.4, cz = z0 + 2.4;
      const seg = ctx.lod === 0 ? 10 : ctx.lod === 1 ? 7 : 5;
      ctx.mb.cylinder('cheminee', cx, 0, cz, 1.5, o.cheminee, seg, false, 0.95);
      if (ctx.lod < 2) {
        ctx.mb.cylinder('encadrement', cx, o.cheminee - 0.9, cz, 1.1, 0.9, seg, false, 1.05);
        ctx.mb.cylinder('facade', cx, 0, cz, 1.85, 1.6, seg, false, 1.6);
      }
    }
    if (o.bureaux) {
      // corps de bureaux accolé en façade (deux niveaux enduits)
      const bw = Math.min(11.0, o.w * 0.38);
      body(ctx, s, {
        x0: x1 - bw, x1, z0: z1, z1: z1 + 6.4, floors: 1, front: 'S',
        pattern: 'aapa', margin: 0.4, door: 2, wallMat: 'facade_b',
        rear: false, lateral: true, hidden: ['N'], balcony: 'non',
        plinth: { h: 0.5, d: 0.05, mat: s.base }, cornice: true, groundH: 3.6, floorH: 3.3,
      });
      roofOf(ctx, s, { x0: x1 - bw, x1, z0: z1, z1: z1 + 6.4, y: 6.9, kind: 'terrasse', parapet: 0.5, equipment: false, stair: false, front: 'S' });
    }
    if (o.cour && ctx.lod < 2) {
      forecourt(ctx, x0, z1 + 0.2, x1 - 6.0, z1 + 7.0, 0.06, 'soubassement');
      const cf: Frame = { o: [x0, 0, z1 + 7.0], u: [1, 0, 0], n: [0, 0, 1], w: o.w - 6.0, h: 2.4 };
      gate(ctx, cf, (o.w - 6.0) * 0.5, 7.0, 0, 2.1);
    }
  });
}

/* ================================================================== */
/* 2. Entrepôt logistique                                               */
/* ================================================================== */

export function entrepot(m: Meta, o: { w: number; d: number; h: number; portes?: number; auvent?: boolean; bureaux?: boolean; pignonHoist?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const pts: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    const wall = 'facade_b';
    for (const f of ringFrames(pts, 0, H)) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      if (front) {
        const n = o.portes ?? Math.max(3, Math.round(f.w / 7.5));
        for (const u of bays(f.w, n, 2.2)) ops.push({ kind: 'garage', r: { u0: u - 1.8, u1: u + 1.8, v0: 1.15, v1: 5.2 } });
      } else if (f.n[0] > 0.5) {
        ops.push({ kind: 'door', r: { u0: f.w * 0.5 - 0.6, u1: f.w * 0.5 + 0.6, v0: 0.05, v1: 2.4 }, o: { style: 'moderne' } });
      }
      facade(ctx, f, wall, ops);
      fbox(ctx, s.base, f, -0.05, f.w + 0.05, 0, 1.1, 0, 0.07, 'back bottom');
      if (ctx.lod < 2) {
        // bandeau d'éclairage et nervures
        const nC = ctx.lod === 0 ? Math.max(3, Math.round(f.w / 5.0)) : 1;
        for (let i = 0; i < nC; i++) {
          const a = (f.w * (i + 0.15)) / nC, b = (f.w * (i + 0.85)) / nC;
          fbox(ctx, 'menuiserie', f, a, b, H - 2.2, H - 1.1, 0, 0.08, 'back');
          fbox(ctx, 'verre', f, a + 0.12, b - 0.12, H - 2.1, H - 1.2, 0.03, 0.06, 'back');
        }
        const nR = Math.max(3, Math.round(f.w / (ctx.lod === 0 ? 3.0 : 8)));
        for (let i = 1; i < nR; i++) fbox(ctx, 'encadrement', f, (f.w * i) / nR - 0.08, (f.w * i) / nR + 0.08, 1.1, H - 2.2, 0, 0.1, 'back');
      }
      if (front && o.pignonHoist) hoist(ctx, f, f.w * 0.5, H - 0.6);
    }
    // quai de chargement et auvent
    forecourt(ctx, x0 + 0.5, z1, x1 - 0.5, z1 + 3.4, 1.15, 'soubassement');
    if (o.auvent && ctx.lod < 2) {
      const f: Frame = { o: [x0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: H };
      fbox(ctx, 'zinc', f, 0.4, o.w - 0.4, 5.6, 5.85, 0, 3.8, 'back');
      if (ctx.lod === 0) for (const u of bays(o.w, 4, 2.0)) ctx.mb.cylinder('garde_corps', x0 + u, 1.15, z1 + 3.5, 0.1, 4.5, 6, false);
    }
    slab(ctx, pts, H - 0.25, 'terrasse');
    parapetRing(ctx, ringFrames(pts, 0, 1), H, 0.6, wall);
    if (ctx.lod < 2) {
      rooftopUnit(ctx, -o.w * 0.25, H - 0.22, 0, 3.6, 2.4, 1.2);
      mast(ctx, x1 - 2.0, H + 0.6, z0 + 2.0, 5.0);
    }
    if (o.bureaux) {
      const bw = Math.min(10.0, o.w * 0.3);
      volume(ctx, {
        x0: x0, x1: x0 + bw, z0: z1, z1: z1 + 5.6, h: 6.6, wallMat: 'facade', hidden: ['N'],
        sides: {
          S: [{ kind: 'door', r: rectAt(bw / 2, 1.5, 0.05, 2.5), o: { style: 'moderne', transom: 0.4, canopy: 'dalle' } }],
          E: [{ kind: 'window', r: rectAt(2.8, 1.6, 1.1, 1.5), o: { leaves: 2, shutters: 'none' } }],
          W: [{ kind: 'window', r: rectAt(2.8, 1.6, 1.1, 1.5), o: { leaves: 2, shutters: 'none' } }],
        },
        plinth: { h: 0.5, d: 0.05, mat: s.base },
      });
      const bf: Frame = { o: [x0, 0, z1 + 5.6], u: [1, 0, 0], n: [0, 0, 1], w: bw, h: 6.6 };
      if (ctx.lod < 2) curtainWall(ctx, bf, { u0: 0.6, u1: bw - 0.6, v0: 3.6, v1: 6.0, module: 1.6, floorH: 2.4, spandrel: 0.0, fin: 0.1, slabEdge: 0 });
      roofOf(ctx, s, { x0, x1: x0 + bw, z0: z1, z1: z1 + 5.6, y: 6.6, kind: 'terrasse', parapet: 0.5, equipment: false, stair: false, front: 'S' });
    }
  });
}

/* ================================================================== */
/* 3. Atelier artisanal / petite industrie                              */
/* ================================================================== */

export function atelier(m: Meta, o: { w: number; d: number; h: number; mezzanine?: boolean; colombage?: boolean; cour?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const pts: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    for (const f of ringFrames(pts, 0, H)) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      const decos: ((c: Ctx, fr: Frame) => void)[] = [];
      if (front) {
        ops.push({ kind: 'garage', r: { u0: f.w * 0.26 - 1.9, u1: f.w * 0.26 + 1.9, v0: 0.05, v1: 3.6 } });
        ops.push({ kind: 'door', r: { u0: f.w * 0.56 - 0.55, u1: f.w * 0.56 + 0.55, v0: 0.05, v1: 2.4 }, o: { style: 'vitree', transom: 0.35 } });
        const b = baieAtelier(f, f.w * 0.76, f.w * 0.76 + 2.6, 1.3, 3.5, s.arches !== 'non');
        ops.push(b.op);
        if (b.deco) decos.push(b.deco);
      } else {
        const n = Math.max(1, Math.round(f.w / 5.0));
        for (const u of bays(f.w, n, 1.4)) {
          const b = baieAtelier(f, u - 1.3, u + 1.3, 1.4, Math.min(H - 0.9, 4.2), s.arches !== 'non');
          ops.push(b.op);
          if (b.deco) decos.push(b.deco);
        }
      }
      facade(ctx, f, s.wall, ops);
      for (const d of decos) d(ctx, f);
      fbox(ctx, s.base, f, -0.05, f.w + 0.05, 0, 0.55, 0, 0.07, 'back bottom');
      if (o.colombage) {
        timber(ctx, f, { u0: 0.1, u1: f.w - 0.1, v0: 0.5, v1: H - 0.1, posts: bays(f.w, Math.max(3, Math.round(f.w / 2.2))), rails: [0.6, H - 0.4], holes: ops.map((x) => x.r), mat: 'colombage' });
      }
    }
    const top = roofOf(ctx, s, {
      x0, x1, z0, z1, y: H, front: 'S', axis: 'x',
      kind: s.roof === 'shed' ? 'shed' : s.roof === 'terrasse' ? 'terrasse' : 'deux_pans',
      sheds: 2, dormers: false, chimneys: s.chimneys ? 1 : false, parapet: 0.5, gableMat: 'facade',
    });
    if (o.mezzanine && ctx.lod < 2) {
      const f: Frame = { o: [x0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: H };
      fbox(ctx, 'dalle', f, o.w * 0.5, o.w - 0.6, H - 0.2, H + 0.05, 0, 1.4, 'back');
      railLine(ctx, [x0 + o.w * 0.5, H + 0.05, z1 + 1.3], [x1 - 0.6, H + 0.05, z1 + 1.3], 1.0, 'barreaux');
    }
    if (o.cour && ctx.lod < 2) {
      forecourt(ctx, x0, z1 + 0.1, x1, z1 + 5.0, 0.05, 'soubassement');
      const cf: Frame = { o: [x0, 0, z1 + 5.0], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: 2.2 };
      gate(ctx, cf, o.w * 0.3, 5.0, 0, 1.9);
    }
    void top;
  });
}

/* ================================================================== */
/* 4. Dépôt technique (hangar ouvert, cuves, silos)                     */
/* ================================================================== */

export function depot(m: Meta, o: { w: number; d: number; h: number; cuves?: number; silo?: number; hangar?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const bw = o.w * (o.hangar ? 0.55 : 1);
    // corps fermé
    const pts: [number, number][] = [[x0, z1], [x0 + bw, z1], [x0 + bw, z0], [x0, z0]];
    for (const f of ringFrames(pts, 0, H)) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      if (front) {
        ops.push({ kind: 'garage', r: { u0: f.w * 0.3 - 2.2, u1: f.w * 0.3 + 2.2, v0: 0.05, v1: 4.2 } });
        ops.push({ kind: 'door', r: { u0: f.w * 0.72 - 0.55, u1: f.w * 0.72 + 0.55, v0: 0.05, v1: 2.3 }, o: { style: 'moderne' } });
      } else {
        for (const u of bays(f.w, Math.max(1, Math.round(f.w / 6)), 1.5)) ops.push({ kind: 'window', r: { u0: u - 1.0, u1: u + 1.0, v0: 2.6, v1: 4.0 }, o: { leaves: 2, bars: 2, shutters: 'none' } });
      }
      facade(ctx, f, 'facade_b', ops);
      fbox(ctx, s.base, f, -0.05, f.w + 0.05, 0, 0.8, 0, 0.07, 'back bottom');
      if (ctx.lod < 2) {
        const nR = Math.max(2, Math.round(f.w / (ctx.lod === 0 ? 2.6 : 7)));
        for (let i = 1; i < nR; i++) fbox(ctx, 'encadrement', f, (f.w * i) / nR - 0.07, (f.w * i) / nR + 0.07, 0.8, H - 0.3, 0, 0.09, 'back');
      }
    }
    shedRoof(ctx, { x0, x1: x0 + bw, z0, z1, yLow: H, yHigh: H + 1.6, low: 'S', overhang: 0.4, thickness: 0.2, wallMat: 'facade_b' });
    // hangar ouvert : poteaux + couverture
    if (o.hangar) {
      const hx0 = x0 + bw + 0.4;
      ctx.mb.box('zinc', hx0 - 0.3, H - 0.3, z0, x1, H, z1, 'ny');
      if (ctx.lod < 2) {
        const n = ctx.lod === 0 ? 3 : 2;
        for (let i = 0; i <= n; i++) {
          const px = hx0 + ((x1 - hx0) * i) / n;
          for (const pz of [z0 + 0.6, z1 - 0.6]) ctx.mb.cylinder('garde_corps', px, 0, pz, 0.16, H - 0.3, 6, false);
        }
        forecourt(ctx, hx0 - 0.4, z0, x1, z1, 0.06, 'soubassement');
      }
    }
    // cuves cylindriques
    for (let i = 0; i < (o.cuves ?? 0); i++) {
      const cx = x0 + bw * 0.3 + i * 4.0;
      const cz = z0 - 3.2;
      if (cz < z0 - 6) break;
      const seg = ctx.lod === 0 ? 12 : ctx.lod === 1 ? 8 : 5;
      ctx.mb.cylinder('equipement', cx, 0.4, cz, 1.5, 5.5, seg, true);
      if (ctx.lod < 2) {
        ctx.mb.cylinder('equipement', cx, 5.9, cz, 1.5, 0.6, seg, true, 0.9);
        ctx.mb.box('soubassement', cx - 1.8, 0, cz - 1.8, cx + 1.8, 0.4, cz + 1.8, 'ny');
      }
    }
    if (o.silo) {
      const seg = ctx.lod === 0 ? 14 : ctx.lod === 1 ? 9 : 6;
      const sx = x1 - 3.0, sz = z0 + 3.0;
      ctx.mb.cylinder('equipement', sx, 0, sz, 2.6, o.silo, seg, false);
      ctx.mb.cylinder('equipement', sx, o.silo, sz, 2.6, 1.8, seg, true, 0.6);
      if (ctx.lod < 2) {
        for (let k = 1; k < 4; k++) ctx.mb.cylinder('garde_corps', sx, (o.silo * k) / 4, sz, 2.68, 0.1, seg, false);
        mast(ctx, sx, o.silo + 1.8, sz, 2.5);
      }
    }
  });
}

/* ================================================================== */
/* Modèles livrés                                                       */
/* ================================================================== */

const Q = (...q: QuartierTag[]): QuartierTag[] => q;
const meta = (o: Omit<Meta, 'src'>): Meta => ({ ...o, src: SRC });

export const ACTIVITES: BuildingDef[] = [
  halleSheds(meta({
    id: 'proc_usine_sheds_brique', nameFr: 'Usine à sheds en brique', category: 'industrial',
    tiles: [4, 4], ...budget(4, 3, 1, 420), jobs: 160, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('activites'), tags: ['industrie', 'usine', 'sheds', 'pollution:2', 'service:emplois_industriels'],
  }), { w: 30.0, d: 21.0, h: 7.4, sheds: 3, cheminee: 22, bureaux: true }),

  halleSheds(meta({
    id: 'proc_manufacture_cour', nameFr: 'Manufacture à cour', category: 'industrial',
    tiles: [5, 4], ...budget(5, 4, 1, 400), jobs: 190, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('activites', 'faubourg'), tags: ['industrie', 'manufacture', 'cour', 'pollution:1', 'service:emplois_industriels'],
  }), { w: 36.0, d: 21.0, h: 8.0, sheds: 3, cour: true, bureaux: true }),

  entrepot(meta({
    id: 'proc_entrepot_quais', nameFr: 'Entrepôt à quais de chargement', category: 'industrial',
    tiles: [5, 4], ...budget(5, 4, 0, 330), jobs: 70, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('activites'), tags: ['industrie', 'entrepot', 'logistique', 'trafic_poids_lourds', 'service:fret'],
  }), { w: 36.0, d: 22.0, h: 10.5, portes: 4, auvent: true, bureaux: true }),

  entrepot(meta({
    id: 'proc_entrepot_brique', nameFr: 'Entrepôt de brique à poulie', category: 'industrial',
    tiles: [4, 3], ...budget(4, 3, 0, 350), jobs: 45, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('activites', 'faubourg'), tags: ['industrie', 'entrepot', 'patrimoine', 'service:fret'],
  }), { w: 29.0, d: 20.0, h: 11.0, portes: 3, pignonHoist: true }),

  atelier(meta({
    id: 'proc_atelier_artisan', nameFr: 'Atelier d’artisan', category: 'industrial',
    tiles: [2, 2], ...budget(2, 2, 0, 320), jobs: 12, density: 'faible', style: 'brique_industrielle',
    quartiers: Q('activites', 'faubourg'), tags: ['industrie', 'artisanat', 'atelier', 'service:emplois_industriels'],
  }), { w: 14.0, d: 11.5, h: 5.6, mezzanine: true }),

  atelier(meta({
    id: 'proc_atelier_bois', nameFr: 'Atelier à charpente de bois', category: 'industrial',
    tiles: [3, 3], ...budget(3, 2, 0, 330), jobs: 18, density: 'faible', style: 'colombage',
    quartiers: Q('activites', 'faubourg'), tags: ['industrie', 'artisanat', 'bois', 'service:emplois_industriels'],
  }), { w: 20.0, d: 12.5, h: 5.4, colombage: true, cour: true }),

  atelier(meta({
    id: 'proc_atelier_moderne', nameFr: 'Atelier-bureau contemporain', category: 'industrial',
    tiles: [3, 2], ...budget(3, 2, 0, 420), jobs: 34, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('activites'), tags: ['industrie', 'atelier', 'pme', 'service:emplois_industriels'],
  }), { w: 21.0, d: 13.0, h: 6.4, mezzanine: true }),

  depot(meta({
    id: 'proc_depot_cuves', nameFr: 'Dépôt technique à cuves', category: 'industrial',
    tiles: [4, 3], ...budget(4, 3, 0, 300), jobs: 26, density: 'faible', style: 'beton_moderne',
    quartiers: Q('activites'), tags: ['industrie', 'depot', 'cuves', 'pollution:1', 'service:stockage'],
  }), { w: 28.0, d: 14.0, h: 6.8, cuves: 3, hangar: true }),

  depot(meta({
    id: 'proc_depot_silo', nameFr: 'Dépôt à silo', category: 'industrial',
    tiles: [4, 3], ...budget(4, 3, 0, 320), jobs: 20, density: 'faible', style: 'brique_industrielle',
    quartiers: Q('activites'), tags: ['industrie', 'depot', 'silo', 'repere_visuel', 'service:stockage_agricole'],
  }), { w: 28.0, d: 15.0, h: 7.2, silo: 18, hangar: true }),
];

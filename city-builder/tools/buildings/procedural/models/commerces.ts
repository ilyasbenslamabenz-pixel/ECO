/**
 * BÂTIMENTS PROCÉDURAUX — commerces : rangées de boutiques, halles de marché à verrière, grands magasins,
 * supermarchés de quartier, cafés-brasseries, galeries couvertes.
 */
import {
  bays, facade, fbox, flushWindow, rectAt, rooftopUnit, volume,
  type BuildingDef, type Ctx, type Frame, type OpeningSpec,
} from '../../kit/index';
import { archedWindow, compose, grid, levels, modillons } from '../grammar';
import { body, forecourt, parapetRing, plainRule, ringFrames, roof as roofOf, slab, styleRule } from '../parts';
import { railLine } from '../rail';
import { STYLES } from '../styles';
import { budget, makeDef, type Meta, type QuartierTag } from './common';

const SRC = 'tools/buildings/procedural/models/commerces.ts';

/* ================================================================== */
/* 1. Rangée de boutiques (mitoyenne)                                   */
/* ================================================================== */

export function boutiques(m: Meta, o: { units: number; uw: number; d: number; floors: number; stores?: boolean; terrasse?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const W = o.units * o.uw;
    const x0 = -W / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH + 0.3;
    const h = gH + o.floors * s.floorH;
    for (let i = 0; i < o.units; i++) {
      const ux0 = x0 + i * o.uw;
      const hidden: ('E' | 'W')[] = [];
      if (i > 0) hidden.push('W');
      if (i < o.units - 1) hidden.push('E');
      body(ctx, s, {
        x0: ux0, x1: ux0 + o.uw, z0, z1, floors: o.floors, front: 'S',
        pattern: 'a'.repeat(Math.max(2, Math.round(o.uw / 2.4))), margin: 0.35,
        groundH: gH,
        shop: { awning: o.stores !== false && i % 2 === 0, sign: true },
        door: false, balcony: i % 2 === 1 ? 'net' as never : 'non',
        hidden, rear: i === 0 || i === o.units - 1, lateral: false,
        plinth: { h: 0.35, d: 0.05, mat: s.base },
      });
      if (o.terrasse && i % 2 === 0 && ctx.lod < 2) {
        forecourt(ctx, ux0 + 0.4, z1, ux0 + o.uw - 0.4, z1 + 2.4, 0.04, 'soubassement');
        const f: Frame = { o: [ux0, 0.04, z1 + 2.4], u: [1, 0, 0], n: [0, 0, 1], w: o.uw, h: 1 };
        railLine(ctx, [ux0 + 0.5, 0.04, z1 + 2.4], [ux0 + o.uw - 0.5, 0.04, z1 + 2.4], 0.95, 'fer');
        void f;
      }
    }
    roofOf(ctx, s, { x0, x1: x0 + W, z0, z1, y: h, front: 'S', axis: 'x', dormers: Math.max(2, o.units), chimneys: Math.max(1, o.units - 1), parapet: 0.5 });
  });
}

/* ================================================================== */
/* 2. Halle de marché (verrière sur structure)                          */
/* ================================================================== */

export function halle(m: Meta, o: { w: number; d: number; h: number; arcades?: number; lanterneau?: boolean; pignonVitre?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const nA = o.arcades ?? Math.max(3, Math.round(o.w / 5.2));
    const lv = levels(H, 0, 0);
    const frames = ringFrames([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0, H);
    for (const f of frames) {
      const long = f.w > (o.w + o.d) / 2;
      const n = long ? nA : Math.max(2, Math.round(f.w / 5.2));
      const g = grid(f.w, 'a'.repeat(n), lv, { margin: 0.5 });
      const ops: OpeningSpec[] = [];
      const decos: ((ctx: Ctx, f: Frame) => void)[] = [];
      for (let i = 0; i < n; i++) {
        const uc = g.us[i]!;
        const bw = Math.min(g.bw[i]! - 0.9, 3.4);
        const r = { u0: uc - bw / 2, u1: uc + bw / 2, v0: 0.1, v1: H - 1.1 };
        const e = archedWindow(r, s.wall, { ...s.win, surround: 0.2, keystone: true, sill: false, leaves: 2, bars: 3 });
        if (e.op) ops.push(e.op);
        if (e.deco) decos.push(e.deco);
      }
      facade(ctx, f, s.wall, ops);
      for (const d of decos) d(ctx, f);
      // bandeau et corniche à modillons
      fbox(ctx, 'encadrement', f, -0.1, f.w + 0.1, H - 0.95, H - 0.75, 0, 0.09, 'back');
      fbox(ctx, 'encadrement', f, -0.14, f.w + 0.14, H - 0.4, H - 0.1, 0, 0.2, 'back');
      modillons(ctx, f, 'encadrement', H - 0.4, 0.75, 0.2, 0.16);
      fbox(ctx, s.base, f, -0.06, f.w + 0.06, 0, 0.45, 0, 0.07, 'back bottom');
    }
    // charpente et couverture à deux pans vitrés
    const ridge = H + Math.min(o.w, o.d) * 0.3;
    const cx = 0;
    const slope = (sgn: number): void => {
      ctx.mb.polyFacing('toiture', [[cx, ridge, z0], [cx, ridge, z1], [sgn * o.w / 2, H, z1], [sgn * o.w / 2, H, z0]], [sgn, 1, 0]);
    };
    slope(1); slope(-1);
    // pignons : triangle vitré ou maçonné
    for (const z of [z1, z0]) {
      const dir: [number, number, number] = [0, 0, z > 0 ? 1 : -1];
      ctx.mb.polyFacing(o.pignonVitre ? 'verriere' : 'facade', [[x0, H, z], [x1, H, z], [cx, ridge, z]], dir);
      if (o.pignonVitre && ctx.lod < 2) {
        const f: Frame = z > 0 ? { o: [x0, H, z], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: ridge - H } : { o: [x1, H, z], u: [-1, 0, 0], n: [0, 0, -1], w: o.w, h: ridge - H };
        const nb = ctx.lod === 0 ? 6 : 3;
        for (let i = 1; i < nb; i++) {
          const u = (o.w * i) / nb;
          const vt = (ridge - H) * (1 - Math.abs(2 * (u / o.w) - 1));
          fbox(ctx, 'menuiserie', f, u - 0.06, u + 0.06, 0, Math.max(0.2, vt - 0.1), 0, 0.1, 'back');
        }
      }
    }
    // bandes de verrière le long du faîtage
    if (ctx.lod < 2) {
      for (const sgn of [1, -1]) {
        const t = 0.22;
        ctx.mb.polyFacing('verriere', [[cx + sgn * o.w * 0.02, ridge - 0.25, z0 + 0.3], [cx + sgn * o.w * 0.02, ridge - 0.25, z1 - 0.3], [sgn * o.w * (0.5 - t), H + (ridge - H) * (2 * t), z1 - 0.3], [sgn * o.w * (0.5 - t), H + (ridge - H) * (2 * t), z0 + 0.3]], [sgn, 1, 0]);
      }
    }
    if (o.lanterneau) {
      const lh = 1.5;
      volume(ctx, { x0: x0 * 0.22, x1: x1 * 0.22, z0: z0 + 1.5, z1: z1 - 1.5, y0: ridge - 0.25, h: lh, wallMat: 'verriere' });
      ctx.mb.box('zinc', x0 * 0.26, ridge + lh - 0.25, z0 + 1.2, x1 * 0.26, ridge + lh + 0.1, z1 - 1.2, 'ny');
    }
    void rectAt; void flushWindow; void plainRule; void styleRule; void compose; void bays;
  });
}

/* ================================================================== */
/* 3. Grand magasin / galerie                                           */
/* ================================================================== */

export function grandMagasin(m: Meta, o: { w: number; d: number; floors: number; verriere?: boolean; angle?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH + 0.8;
    const h = gH + o.floors * s.floorH;
    const n = Math.max(4, Math.round(o.w / 4.2));
    const r = body(ctx, s, {
      x0, x1, z0, z1, floors: o.floors, front: 'S', pattern: 'a'.repeat(n), margin: 0.5,
      groundH: gH, shop: { awning: false, sign: true }, door: false,
      balcony: 'non', rear: true, lateral: true,
      plinth: { h: 0.5, d: 0.06, mat: s.base },
    });
    const f = r.frames.S;
    // grande enseigne horizontale + mât de drapeaux
    if (ctx.lod < 2) {
      fbox(ctx, 'enseigne', f, 1.0, f.w - 1.0, h - 1.4, h - 0.3, 0, 0.18, 'back');
      if (ctx.lod === 0) for (const u of bays(f.w, 5, 2.0)) ctx.mb.tube('garde_corps', [f.o[0] + f.u[0] * u, h - 0.2, f.o[2] + f.u[2] * u + 0.1], [f.o[0] + f.u[0] * u, h + 2.2, f.o[2] + f.u[2] * u + 1.1], 0.04, 5);
    }
    const top = roofOf(ctx, s, { x0, x1, z0, z1, y: h, front: 'S', kind: 'terrasse', parapet: 0.8, equipment: true, stair: true });
    if (o.verriere) {
      // verrière centrale (atrium) en pyramide basse
      const vx = o.w * 0.17, vz = o.d * 0.2;
      const yy = top - 0.6;
      for (const [a, b, c, d] of [
        [[-vx, yy, vz], [vx, yy, vz], [0, yy + 1.6, 0], null],
        [[vx, yy, -vz], [-vx, yy, -vz], [0, yy + 1.6, 0], null],
        [[vx, yy, vz], [vx, yy, -vz], [0, yy + 1.6, 0], null],
        [[-vx, yy, -vz], [-vx, yy, vz], [0, yy + 1.6, 0], null],
      ] as [number[], number[], number[], null][]) {
        ctx.mb.polyFacing('verriere', [a as [number, number, number], b as [number, number, number], c as [number, number, number]], [0, 1, 0]);
        void d;
      }
    }
  });
}

/* ================================================================== */
/* 4. Supermarché / moyenne surface                                     */
/* ================================================================== */

export function surface(m: Meta, o: { w: number; d: number; h: number; auvent?: boolean; quai?: boolean; bardage?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const wall = o.bardage ? 'facade_b' : 'facade';
    const frames = ringFrames([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0, H);
    for (const f of frames) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      if (front) {
        const uc = f.w * 0.5;
        ops.push({ kind: 'shop', r: { u0: uc - 5.5, u1: uc + 5.5, v0: 0.15, v1: Math.min(H - 1.2, 3.6) }, o: { sign: true, awning: false, doorAt: 'center' } });
        for (const u of [uc - 9.5, uc + 9.5]) if (u > 2 && u < f.w - 2) ops.push({ kind: 'window', r: { u0: u - 2.4, u1: u + 2.4, v0: 1.6, v1: 3.4 }, o: { leaves: 3, shutters: 'none', reveal: 0.2 } });
      } else if (f.n[0] > 0.5 && o.quai) {
        for (const u of bays(f.w, 2, 3.0)) ops.push({ kind: 'garage', r: { u0: u - 1.7, u1: u + 1.7, v0: 1.1, v1: 4.3 } });
      }
      facade(ctx, f, wall, ops);
      fbox(ctx, s.base, f, -0.05, f.w + 0.05, 0, 0.6, 0, 0.06, 'back bottom');
      fbox(ctx, 'enseigne', f, -0.02, f.w + 0.02, H - 1.1, H - 0.15, 0, 0.12, 'back');
      // nervures de bardage (raidisseurs verticaux) et bandeau d'éclairage zénithal
      if (ctx.lod < 2) {
        const nR = Math.max(3, Math.round(f.w / (ctx.lod === 0 ? 2.4 : 6)));
        for (let i = 1; i < nR; i++) fbox(ctx, 'encadrement', f, (f.w * i) / nR - 0.07, (f.w * i) / nR + 0.07, 0.6, H - 1.1, 0, 0.09, 'back');
        if (!front) {
          const nC = ctx.lod === 0 ? Math.max(2, Math.round(f.w / 4.5)) : 1;
          for (let i = 0; i < nC; i++) {
            const a = (f.w * (i + 0.2)) / nC, b = (f.w * (i + 0.8)) / nC;
            fbox(ctx, 'menuiserie', f, a, b, H - 2.5, H - 1.4, 0, 0.07, 'back');
            fbox(ctx, 'verre', f, a + 0.1, b - 0.1, H - 2.4, H - 1.5, 0.02, 0.05, 'back');
          }
        }
      }
      if (front && ctx.lod < 2) {
        // auvent d'entrée sur poteaux
        if (o.auvent) {
          const uc = f.w * 0.5;
          fbox(ctx, 'dalle', f, uc - 7.5, uc + 7.5, 4.0, 4.35, 0, 4.5, 'back');
          if (ctx.lod === 0) for (const u of [uc - 6.8, uc, uc + 6.8]) ctx.mb.cylinder('garde_corps', f.o[0] + f.u[0] * u + f.n[0] * 4.2, 0.05, f.o[2] + f.u[2] * u + f.n[2] * 4.2, 0.13, 4.0, 8, false);
        }
      }
    }
    if (o.quai && ctx.lod < 2) {
      forecourt(ctx, x1, z0 + 1.0, x1 + 3.2, z1 - 3.0, 1.15, 'soubassement');
      // butoirs de quai
      if (ctx.lod === 0) for (let i = 0; i < 3; i++) ctx.mb.box('garde_corps', x1 + 3.0, 0.75, z0 + 3.0 + i * 4.5, x1 + 3.25, 1.15, z0 + 3.6 + i * 4.5, 'nx');
    }
    // abri à chariots devant la façade
    if (ctx.lod < 2) {
      const ax = x0 + o.w * 0.14;
      ctx.mb.box('dalle', ax - 2.6, 2.5, z1 + 2.2, ax + 2.6, 2.65, z1 + 5.0, 'ny');
      if (ctx.lod === 0) for (const px of [ax - 2.3, ax + 2.3]) for (const pz of [z1 + 2.5, z1 + 4.7]) ctx.mb.cylinder('garde_corps', px, 0.05, pz, 0.07, 2.5, 6, false);
    }
    slab(ctx, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], H - 0.2, 'terrasse');
    parapetRing(ctx, ringFrames([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0, 1), H, 0.55, wall);
    if (ctx.lod < 2) {
      rooftopUnit(ctx, -o.w * 0.2, H - 0.18, 0, 4.0, 2.6, 1.3);
      rooftopUnit(ctx, o.w * 0.18, H - 0.18, -o.d * 0.12, 3.2, 2.2, 1.0);
    }
  });
}

/* ================================================================== */
/* Modèles livrés                                                       */
/* ================================================================== */

const Q = (...q: QuartierTag[]): QuartierTag[] => q;
const meta = (o: Omit<Meta, 'src'>): Meta => ({ ...o, src: SRC });

export const COMMERCES: BuildingDef[] = [
  boutiques(meta({
    id: 'proc_boutiques_pierre', nameFr: 'Rangée de boutiques en pierre', category: 'commercial',
    tiles: [3, 2], ...budget(3, 2, 2, 470), residents: 8, jobs: 26, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'faubourg'), mitoyen: true, tags: ['commerce', 'boutiques', 'service:commerces', 'rayon:500'],
  }), { units: 3, uw: 7.2, d: 12.5, floors: 2, terrasse: true }),

  boutiques(meta({
    id: 'proc_boutiques_colombage', nameFr: 'Échoppes à pans de bois', category: 'commercial',
    tiles: [3, 2], ...budget(3, 2, 2, 450), residents: 6, jobs: 20, density: 'moyenne', style: 'colombage',
    quartiers: Q('centre_historique'), mitoyen: true, tags: ['commerce', 'boutiques', 'patrimoine', 'service:commerces', 'rayon:400'],
  }), { units: 3, uw: 6.8, d: 11.8, floors: 1, terrasse: true }),

  boutiques(meta({
    id: 'proc_boutiques_faubourg', nameFr: 'Commerces de faubourg', category: 'commercial',
    tiles: [3, 2], ...budget(3, 2, 1, 400), residents: 6, jobs: 18, density: 'moyenne', style: 'enduit_volets',
    quartiers: Q('faubourg', 'pavillonnaire'), mitoyen: true, tags: ['commerce', 'boutiques', 'service:commerces', 'rayon:450'],
  }), { units: 4, uw: 5.6, d: 11.0, floors: 1 }),

  halle(meta({
    id: 'proc_halle_marche', nameFr: 'Halle de marché couverte', category: 'commercial',
    tiles: [4, 3], ...budget(4, 3, 1, 520), jobs: 60, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('centre_historique', 'faubourg'), tags: ['commerce', 'halle', 'marche', 'attractivite:2', 'service:alimentation', 'rayon:1200'],
  }), { w: 30.0, d: 21.0, h: 8.5, lanterneau: true, pignonVitre: true }),

  halle(meta({
    id: 'proc_halle_pierre', nameFr: 'Halle aux grains', category: 'commercial',
    tiles: [3, 3], ...budget(3, 3, 1, 540), jobs: 36, density: 'moyenne', style: 'pierre_claire',
    quartiers: Q('centre_historique'), tags: ['commerce', 'halle', 'patrimoine', 'attractivite:2', 'service:commerces', 'rayon:900'],
  }), { w: 22.0, d: 20.0, h: 9.0, pignonVitre: false }),

  grandMagasin(meta({
    id: 'proc_grand_magasin', nameFr: 'Grand magasin à verrière', category: 'commercial',
    tiles: [4, 3], ...budget(4, 3, 4, 620), jobs: 280, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'affaires'), tags: ['commerce', 'grand_magasin', 'attractivite:3', 'service:commerces', 'rayon:2000'],
  }), { w: 30.5, d: 21.5, floors: 4, verriere: true }),

  grandMagasin(meta({
    id: 'proc_galerie_moderne', nameFr: 'Galerie commerciale moderne', category: 'commercial',
    tiles: [4, 3], ...budget(4, 3, 3, 520), jobs: 230, density: 'forte', style: 'verre_contemporain',
    quartiers: Q('affaires', 'grands_ensembles'), tags: ['commerce', 'galerie', 'service:commerces', 'rayon:1800'],
  }), { w: 30.0, d: 21.0, floors: 3, verriere: true }),

  surface(meta({
    id: 'proc_supermarche_quartier', nameFr: 'Supermarché de quartier', category: 'commercial',
    tiles: [5, 4], ...budget(4, 3, 0, 460), jobs: 55, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('grands_ensembles', 'faubourg', 'activites'), tags: ['commerce', 'grande_surface', 'service:alimentation', 'rayon:900'],
  }), { w: 30.0, d: 21.0, h: 7.2, auvent: true, quai: true }),

  surface(meta({
    id: 'proc_magasin_bricolage', nameFr: 'Magasin de matériaux', category: 'commercial',
    tiles: [5, 4], ...budget(4, 4, 0, 420), jobs: 48, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('activites'), tags: ['commerce', 'grande_surface', 'materiaux', 'service:commerces', 'rayon:1400'],
  }), { w: 30.5, d: 25.0, h: 8.4, quai: true, bardage: true }),
];

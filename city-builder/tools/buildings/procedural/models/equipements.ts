/**
 * BÂTIMENTS PROCÉDURAUX — équipements publics : groupes scolaires, crèches, médiathèques, gymnases,
 * centres de santé, salles polyvalentes, chapelles et temples, kiosques et abris de quartier.
 */
import {
  bays, chimney, facade, fbox, flushWindow, mast, rectAt, volume,
  type BuildingDef, type Ctx, type Frame, type OpeningSpec,
} from '../../kit/index';
import { archedWindow, compose, curtainWall, grid, levels, modillons, pediment } from '../grammar';
import { body, enclosure, fence, forecourt, parapetRing, plainRule, ringFrames, roof as roofOf, slab, styleRule } from '../parts';
import { railLine } from '../rail';
import { STYLES } from '../styles';
import { budget, makeDef, type Meta, type QuartierTag } from './common';

const SRC = 'tools/buildings/procedural/models/equipements.ts';

/* ================================================================== */
/* 1. Groupe scolaire (corps principal + préau + cour)                  */
/* ================================================================== */

export function ecole(m: Meta, o: { w: number; d: number; floors: number; preau?: boolean; cour?: number; horloge?: boolean; aile?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z1 = o.d / 2;
    const z0 = -o.d / 2;
    const gH = s.groundH;
    const h = gH + o.floors * s.floorH;
    const n = Math.max(5, Math.round(o.w / 3.0));
    const half = Math.floor(n / 2);
    const r = body(ctx, s, {
      x0, x1, z0, z1, floors: o.floors, front: 'S',
      pattern: `${'a'.repeat(half)}p${'a'.repeat(n - 1 - half)}`, margin: 0.6, door: half, doorW: 2.2,
      balcony: 'non', rear: true, lateral: true,
      plinth: { h: 0.65, d: 0.07, mat: s.base },
    });
    const f = r.frames.S;
    if (o.horloge && ctx.lod < 2) {
      const uc = r.grid.us[half]!;
      pediment(ctx, f, uc, 3.6, h + 0.1, 'tri');
      const seg = ctx.lod === 0 ? 12 : 7;
      ctx.mb.cylinder('encadrement', f.o[0] + f.u[0] * uc + f.n[0] * 0.12, h + 0.55, f.o[2] + f.u[2] * uc + f.n[2] * 0.12, 0.62, 0.14, seg, true);
      fbox(ctx, 'menuiserie', f, uc - 0.5, uc + 0.5, h + 0.95, h + 1.1, 0.24, 0.3, 'back');
      fbox(ctx, 'menuiserie', f, uc - 0.06, uc + 0.06, h + 0.6, h + 1.3, 0.24, 0.3, 'back');
    }
    roofOf(ctx, s, {
      x0, x1, z0, z1, y: h, front: 'S', axis: 'x',
      kind: s.roof === 'mansarde' ? 'quatre_pans' : s.roof,
      dormers: s.dormers ? Math.max(3, n - 4) : false, chimneys: s.chimneys ? 2 : false, parapet: 0.6,
    });
    // aile en retour (classes)
    if (o.aile) {
      const aw = Math.min(10.0, o.w * 0.3);
      const az0 = z0 - Math.min(14, o.d * 0.8);
      const lv = levels(gH, o.floors, s.floorH);
      const g = grid(z0 - az0, 'a'.repeat(Math.max(2, Math.round((z0 - az0) / 3.0))), lv, { margin: 0.5 });
      const c = compose(g, plainRule(s, { sill: 1.1 }));
      volume(ctx, {
        x0: x0, x1: x0 + aw, z0: az0, z1: z0, h, wallMat: s.wall, hidden: ['N'],
        sides: { E: c.ops, W: c.ops },
        plinth: { h: 0.65, d: 0.07, mat: s.base },
        cornice: { profile: s.cornice, mat: 'encadrement', v: h },
      });
      roofOf(ctx, s, { x0, x1: x0 + aw, z0: az0, z1: z0 + 0.1, y: h, kind: s.roof === 'terrasse' ? 'terrasse' : 'quatre_pans', dormers: false, chimneys: false, parapet: 0.5, equipment: false, stair: false });
    }
    // préau (galerie couverte sur poteaux) côté cour
    if (o.preau) {
      const px0 = x0 + 1.0, px1 = x1 - 1.0;
      const pz0 = z0 - 4.6, pz1 = z0;
      ctx.mb.box('dalle', px0 - 0.25, 3.3, pz0 - 0.25, px1 + 0.25, 3.55, pz1, 'ny');
      if (ctx.lod < 2) {
        const np = ctx.lod === 0 ? Math.max(3, Math.round((px1 - px0) / 4.0)) : 2;
        for (const u of bays(px1 - px0, np, 0.6)) ctx.mb.cylinder('encadrement', px0 + u, 0.05, pz0 + 0.3, 0.16, 3.3, 8, false);
        forecourt(ctx, px0 - 0.3, pz0 - 0.3, px1 + 0.3, pz1, 0.08, 'soubassement');
      }
    }
    // cour clôturée devant / autour
    if (o.cour && ctx.lod < 2) {
      const cf: Frame = { o: [x0, 0, z1 + o.cour], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: 2.4 };
      enclosure(ctx, cf, 0, o.w * 0.5, { h: 0.55, gateW: 3.4, mat: s.base, rail: true });
      forecourt(ctx, x0, z1, x1, z1 + o.cour - 0.4, 0.05, 'soubassement');
    }
  });
}

/* ================================================================== */
/* 2. Équipement civique (médiathèque, poste, maison de quartier)       */
/* ================================================================== */

export function civique(m: Meta, o: { w: number; d: number; floors: number; porche?: 'colonnes' | 'auvent' | 'non'; fronton?: boolean; vitrine?: boolean; mat?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH + 0.6;
    const h = gH + o.floors * s.floorH;
    const n = Math.max(4, Math.round(o.w / 3.2));
    const half = Math.floor(n / 2);
    const r = body(ctx, s, {
      x0, x1, z0, z1, floors: o.floors, front: 'S', groundH: gH,
      pattern: `${'a'.repeat(half)}p${'a'.repeat(n - 1 - half)}`, margin: 0.6, door: half, doorW: 2.4,
      balcony: 'non', rear: true, lateral: true,
      plinth: { h: 0.9, d: 0.08, mat: s.base },
    });
    const f = r.frames.S;
    const uc = r.grid.us[half]!;
    if (o.vitrine && ctx.lod < 2) {
      // grande baie vitrée du hall (deux niveaux)
      curtainWall(ctx, f, { u0: uc - 3.2, u1: uc + 3.2, v0: 0.7, v1: Math.min(h - 1.2, gH + s.floorH - 0.6), module: 1.6, floorH: s.floorH, spandrel: 0.0, fin: 0.14, finMat: 'menuiserie', slabEdge: 0 });
    }
    if (o.porche === 'colonnes') {
      const w2 = Math.min(8.5, o.w * 0.4);
      fbox(ctx, 'encadrement', f, uc - w2 / 2 - 0.3, uc + w2 / 2 + 0.3, gH - 0.9, gH - 0.2, 0, 2.6, 'back');
      if (ctx.lod < 2) {
        const np = ctx.lod === 0 ? 4 : 2;
        for (const u of bays(w2, np, 0.3)) {
          const px = f.o[0] + f.u[0] * (uc - w2 / 2 + u) + f.n[0] * 2.2;
          const pz = f.o[2] + f.u[2] * (uc - w2 / 2 + u) + f.n[2] * 2.2;
          ctx.mb.cylinder('encadrement', px, 0.35, pz, 0.34, gH - 1.3, ctx.lod === 0 ? 12 : 7, false, 0.3);
          if (ctx.lod === 0) {
            ctx.mb.cylinder('encadrement', px, gH - 1.35, pz, 0.42, 0.45, 12, true, 0.32);
            ctx.mb.cylinder('encadrement', px, 0.08, pz, 0.42, 0.3, 12, true, 0.38);
          }
        }
        forecourt(ctx, x0 + 2, z1, x1 - 2, z1 + 3.0, 0.3, 'soubassement');
        // emmarchement
        if (ctx.lod === 0) for (let i = 0; i < 3; i++) fbox(ctx, 'soubassement', f, uc - w2 / 2 - 1.0, uc + w2 / 2 + 1.0, 0.09 * i, 0.09 * (i + 1), 0, 2.9 + 0.3 * (2 - i), 'back');
      }
      if (o.fronton) pediment(ctx, f, uc, Math.min(10.0, o.w * 0.46), h + 0.15, 'tri');
    } else if (o.porche === 'auvent' && ctx.lod < 2) {
      fbox(ctx, 'dalle', f, uc - 3.0, uc + 3.0, gH - 1.0, gH - 0.75, 0, 2.6, 'back');
      if (ctx.lod === 0) for (const u of [uc - 2.6, uc + 2.6]) ctx.mb.cylinder('garde_corps', f.o[0] + f.u[0] * u + f.n[0] * 2.3, 0.05, f.o[2] + f.u[2] * u + f.n[2] * 2.3, 0.1, gH - 1.0, 8, false);
    }
    if (ctx.lod === 0) modillons(ctx, f, 'encadrement', h + 0.05, 0.8, 0.18, 0.2);
    roofOf(ctx, s, {
      x0, x1, z0, z1, y: h, front: 'S', axis: 'x',
      kind: s.roof === 'mansarde' ? 'quatre_pans' : s.roof, dormers: s.dormers ? 3 : false,
      chimneys: false, parapet: 0.7,
    });
    if (o.mat && ctx.lod < 2) mast(ctx, x0 + 2.0, h + 0.7, z1 - 1.0, 7.0);
  });
}

/* ================================================================== */
/* 3. Gymnase / salle polyvalente                                       */
/* ================================================================== */

export function gymnase(m: Meta, o: { w: number; d: number; h: number; bandeau?: boolean; entree?: boolean; charpente?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    const pts: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    for (const f of ringFrames(pts, 0, H)) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      if (front && o.entree !== false) {
        ops.push({ kind: 'door', r: { u0: f.w / 2 - 1.8, u1: f.w / 2 + 1.8, v0: 0.05, v1: 2.6 }, o: { style: 'moderne', transom: 0.5, canopy: 'dalle' } });
      }
      facade(ctx, f, s.wall, ops);
      fbox(ctx, s.base, f, -0.06, f.w + 0.06, 0, 1.3, 0, 0.08, 'back bottom');
      // bandeau vitré continu en partie haute
      if (o.bandeau !== false && ctx.lod < 2) {
        const nb = ctx.lod === 0 ? Math.max(3, Math.round(f.w / 3.0)) : 1;
        fbox(ctx, 'menuiserie', f, 0.4, f.w - 0.4, H - 3.2, H - 1.0, 0, 0.1, 'back');
        for (let i = 0; i < nb; i++) {
          const a = 0.6 + ((f.w - 1.2) * i) / nb, b = 0.6 + ((f.w - 1.2) * (i + 1)) / nb - 0.12;
          fbox(ctx, 'verre', f, a, b, H - 3.0, H - 1.2, 0.04, 0.07, 'back');
        }
      }
      if (ctx.lod < 2) {
        const nR = Math.max(2, Math.round(f.w / (ctx.lod === 0 ? 2.6 : 7)));
        for (let i = 1; i < nR; i++) fbox(ctx, 'facade_b', f, (f.w * i) / nR - 0.22, (f.w * i) / nR + 0.22, 1.3, H - 3.2, 0, 0.14, 'back');
        // soubassement à joints creux et bandeau d'acrotère
        fbox(ctx, 'encadrement', f, -0.08, f.w + 0.08, H - 0.9, H - 0.6, 0, 0.16, 'back');
        if (ctx.lod === 0) for (let k = 0; k < 3; k++) fbox(ctx, s.base, f, -0.05, f.w + 0.05, 0.25 + k * 0.35, 0.33 + k * 0.35, 0, 0.1, 'back');
      }
      // édicule d'entrée (hall vitré en saillie)
      if (front && o.entree !== false) {
        const uc = f.w / 2;
        fbox(ctx, 'facade_b', f, uc - 4.2, uc + 4.2, 0, 3.9, 0, 2.4, 'back');
        if (ctx.lod < 2) {
          fbox(ctx, 'verre', f, uc - 3.6, uc - 2.1, 0.5, 3.2, 2.42, 2.45, 'back');
          fbox(ctx, 'verre', f, uc + 2.1, uc + 3.6, 0.5, 3.2, 2.42, 2.45, 'back');
          fbox(ctx, 'zinc', f, uc - 4.5, uc + 4.5, 3.9, 4.1, -0.1, 2.8, 'back');
        }
      }
    }
    // couverture : deux pans très surbaissés ou charpente apparente
    const ridge = H + Math.min(o.w, o.d) * 0.12;
    for (const sgn of [1, -1]) {
      ctx.mb.polyFacing('toiture', [[0, ridge, z0 - 0.3], [0, ridge, z1 + 0.3], [sgn * (o.w / 2 + 0.3), H, z1 + 0.3], [sgn * (o.w / 2 + 0.3), H, z0 - 0.3]], [sgn, 1, 0]);
    }
    for (const z of [z1, z0]) {
      ctx.mb.polyFacing(s.wall, [[x0, H, z], [x1, H, z], [0, ridge, z]], [0, 0, z > 0 ? 1 : -1]);
    }
    if (o.charpente && ctx.lod < 2) {
      const n = ctx.lod === 0 ? 4 : 2;
      for (let i = 1; i <= n; i++) {
        const z = z0 + ((z1 - z0) * i) / (n + 1);
        for (const sgn of [1, -1]) ctx.mb.box('bois', sgn > 0 ? 0 : -o.w / 2, H - 0.5, z - 0.12, sgn > 0 ? o.w / 2 : 0, H - 0.1, z + 0.12, '');
      }
    }
    if (ctx.lod < 2) {
      forecourt(ctx, x0 + 1.0, z1, x1 - 1.0, z1 + 2.6, 0.05, 'soubassement');
      fence(ctx, { o: [x0, 0.05, z1 + 2.6], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: 1 }, 0.5, o.w * 0.35, 0, 1.1, 'barreaux');
    }
  });
}

/* ================================================================== */
/* 4. Édifice cultuel (chapelle / temple de quartier)                   */
/* ================================================================== */

export function chapelle(m: Meta, o: { w: number; d: number; h: number; clocher: number; abside?: boolean; rose?: boolean; porche?: boolean }): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const H = o.h;
    // nef
    const pts: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    for (const f of ringFrames(pts, 0, H)) {
      const front = f.n[2] > 0.5;
      const ops: OpeningSpec[] = [];
      const decos: ((c: Ctx, fr: Frame) => void)[] = [];
      if (front) {
        ops.push({ kind: 'door', r: { u0: f.w / 2 - 1.3, u1: f.w / 2 + 1.3, v0: 0.05, v1: 3.2 }, o: { style: 'double', surround: 0.26, surroundMat: 'encadrement', doorMat: 'porte' } });
      } else {
        const n = Math.max(2, Math.round(f.w / 4.2));
        for (const u of bays(f.w, n, 1.6)) {
          const e = archedWindow({ u0: u - 0.75, u1: u + 0.75, v0: 2.2, v1: Math.min(H - 1.0, 6.4) }, s.wall, { leaves: 2, bars: 3, shutters: 'none', surround: 0.18, keystone: true, reveal: 0.35 });
          if (e.op) ops.push(e.op);
          if (e.deco) decos.push(e.deco);
        }
      }
      facade(ctx, f, s.wall, ops);
      for (const d of decos) d(ctx, f);
      fbox(ctx, s.base, f, -0.08, f.w + 0.08, 0, 0.8, 0, 0.1, 'back bottom');
      if (ctx.lod < 2) {
        fbox(ctx, 'encadrement', f, -0.14, f.w + 0.14, H - 0.5, H - 0.2, 0, 0.18, 'back');
        if (ctx.lod === 0) modillons(ctx, f, 'encadrement', H - 0.5, 0.7, 0.2, 0.2);
      }
      // contreforts
      if (!front && ctx.lod < 2) {
        const n = Math.max(2, Math.round(f.w / 4.2));
        for (const u of bays(f.w, n + 1, 0.4)) fbox(ctx, s.wall, f, u - 0.35, u + 0.35, 0, H - 1.2, 0, 0.55, 'back');
      }
    }
    const ridge = H + o.w * 0.42;
    for (const sgn of [1, -1]) ctx.mb.polyFacing('toiture', [[0, ridge, z0 - 0.35], [0, ridge, z1 + 0.35], [sgn * (o.w / 2 + 0.35), H, z1 + 0.35], [sgn * (o.w / 2 + 0.35), H, z0 - 0.35]], [sgn, 1, 0]);
    for (const z of [z1, z0]) {
      const fr: Frame = z > 0 ? { o: [x0, 0, z], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: ridge } : { o: [x1, 0, z], u: [-1, 0, 0], n: [0, 0, -1], w: o.w, h: ridge };
      ctx.mb.polyFacing(s.wall, [[x0, H, z], [x1, H, z], [0, ridge, z]], [0, 0, z > 0 ? 1 : -1]);
      if (z > 0 && o.rose) {
        // rosace : disque vitré et encadrement rayonnant
        const seg = ctx.lod === 0 ? 14 : ctx.lod === 1 ? 9 : 6;
        const cxu = o.w / 2, cv = H + (ridge - H) * 0.42;
        const R = Math.min(1.5, o.w * 0.14);
        const pfs: [number, number, number][] = [];
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          pfs.push([cxu + Math.cos(a) * R, cv + Math.sin(a) * R, 0.04]);
        }
        ctx.mb.lit = 0.8;
        ctx.mb.polyFacing('verre', pfs.map(([u, v, d]) => [fr.o[0] + fr.u[0] * u + fr.n[0] * d, v, fr.o[2] + fr.u[2] * u + fr.n[2] * d] as [number, number, number]), fr.n);
        ctx.mb.lit = 0.5;
        if (ctx.lod < 2) {
          for (let i = 0; i < seg; i++) {
            const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
            fbox(ctx, 'encadrement', fr, cxu + Math.cos(a0) * (R + 0.1) - 0.07, cxu + Math.cos(a0) * (R + 0.1) + 0.07, cv + Math.sin(a0) * (R + 0.1) - 0.07, cv + Math.sin(a0) * (R + 0.1) + 0.07, 0, 0.1, 'back');
            void a1;
          }
          if (ctx.lod === 0) for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            fbox(ctx, 'menuiserie', fr, cxu - 0.03 + Math.cos(a) * R * 0.5, cxu + 0.03 + Math.cos(a) * R * 0.5, cv - R * 0.5 + Math.sin(a) * R * 0.5, cv + R * 0.5 + Math.sin(a) * R * 0.5, 0.05, 0.08, 'back');
          }
        }
      } else if (z > 0) {
        flushWindow(ctx, fr, rectAt(o.w / 2, 0.9, H + (ridge - H) * 0.35, 1.4), { bars: true });
      }
    }
    // clocher
    const cw = Math.min(4.2, o.w * 0.34);
    const cx0 = x1 - cw - 0.4, cx1 = x1 - 0.4;
    const cz1 = z1 - 0.2, cz0 = cz1 - cw;
    const top = o.clocher;
    const cFrames = ringFrames([[cx0, cz1], [cx1, cz1], [cx1, cz0], [cx0, cz0]], 0, top);
    for (const f of cFrames) {
      const ops: OpeningSpec[] = [];
      const decos: ((c: Ctx, fr: Frame) => void)[] = [];
      const e = archedWindow({ u0: f.w / 2 - 0.6, u1: f.w / 2 + 0.6, v0: top - 3.4, v1: top - 0.9 }, s.wall, { leaves: 1, bars: 2, shutters: 'none', surround: 0.16, reveal: 0.4, keystone: true });
      if (e.op) ops.push(e.op);
      if (e.deco) decos.push(e.deco);
      facade(ctx, f, s.wall, ops);
      for (const d of decos) d(ctx, f);
      if (ctx.lod < 2) {
        fbox(ctx, 'encadrement', f, -0.12, f.w + 0.12, top - 0.55, top - 0.25, 0, 0.16, 'back');
        fbox(ctx, 'encadrement', f, -0.06, f.w + 0.06, top * 0.55, top * 0.55 + 0.2, 0, 0.1, 'back');
        // cadran d'horloge sur la face sud
        if (f.n[2] > 0.5) {
          const seg = ctx.lod === 0 ? 12 : 7;
          ctx.mb.cylinder('encadrement', f.o[0] + f.u[0] * (f.w / 2) + f.n[0] * 0.1, top - 5.6, f.o[2] + f.u[2] * (f.w / 2) + f.n[2] * 0.1, 0.7, 0.14, seg, true);
          fbox(ctx, 'menuiserie', f, f.w / 2 - 0.5, f.w / 2 + 0.06, top - 5.6 + 0.3, top - 5.6 + 0.42, 0.2, 0.26, 'back');
        }
      }
    }
    // flèche
    const scx = (cx0 + cx1) / 2, scz = (cz0 + cz1) / 2;
    const seg = ctx.lod === 0 ? 4 : 4;
    ctx.mb.cylinder('toiture', scx, top - 0.25, scz, cw * 0.72, cw * 1.9, seg, false, 0.05);
    if (ctx.lod < 2) {
      ctx.mb.cylinder('garde_corps', scx, top + cw * 1.65, scz, 0.05, 1.4, 6, true);
      ctx.mb.box('garde_corps', scx - 0.45, top + cw * 1.9 + 0.2, scz - 0.04, scx + 0.45, top + cw * 1.9 + 0.32, scz + 0.04, '');
    }
    if (o.porche && ctx.lod < 2) {
      const f: Frame = { o: [x0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: H };
      fbox(ctx, 'encadrement', f, o.w / 2 - 2.2, o.w / 2 + 2.2, 3.9, 4.3, 0, 1.8, 'back');
      if (ctx.lod === 0) for (const u of [o.w / 2 - 1.9, o.w / 2 + 1.9]) ctx.mb.cylinder('encadrement', f.o[0] + f.u[0] * u + f.n[0] * 1.5, 0.05, f.o[2] + f.u[2] * u + f.n[2] * 1.5, 0.2, 3.9, 10, false);
      forecourt(ctx, x0 + 1.5, z1, x1 - 1.5, z1 + 2.2, 0.08, 'soubassement');
    }
    if (o.abside) {
      const seg2 = ctx.lod === 0 ? 9 : ctx.lod === 1 ? 6 : 4;
      const R = o.w * 0.4;
      ctx.mb.cylinder(s.wall, 0, 0, z0, R, H - 1.2, seg2, false);
      ctx.mb.cylinder('toiture', 0, H - 1.2, z0, R + 0.3, R * 0.75, seg2, false, 0.1);
    }
    if (s.chimneys) chimney(ctx, x0 + 1.4, z0 + 1.4, 0.5, 0.6, H, H + 1.4, { pots: 1 });
    void styleRule; void railLine; void slab; void parapetRing; void volume; void levels;
  });
}

/* ================================================================== */
/* Modèles livrés                                                       */
/* ================================================================== */

const Q = (...q: QuartierTag[]): QuartierTag[] => q;
const meta = (o: Omit<Meta, 'src'>): Meta => ({ ...o, src: SRC });

export const EQUIPEMENTS: BuildingDef[] = [
  ecole(meta({
    id: 'proc_ecole_brique', nameFr: 'Groupe scolaire en brique', category: 'public',
    tiles: [4, 4], ...budget(4, 3, 2, 480), jobs: 34, density: 'moyenne', style: 'brique_pignon',
    quartiers: Q('faubourg', 'pavillonnaire'), tags: ['public', 'education', 'ecole', 'service:education', 'rayon:900', 'capacite_service:320'],
  }), { w: 29.5, d: 13.0, floors: 2, preau: true, cour: 5.0, horloge: true, aile: true }),

  ecole(meta({
    id: 'proc_ecole_moderne', nameFr: 'École contemporaine', category: 'public',
    tiles: [4, 4], ...budget(4, 3, 1, 460), jobs: 26, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('grands_ensembles', 'pavillonnaire'), tags: ['public', 'education', 'ecole', 'service:education', 'rayon:800', 'capacite_service:240'],
  }), { w: 29.0, d: 12.5, floors: 1, preau: true, cour: 5.0, aile: true }),

  ecole(meta({
    id: 'proc_creche', nameFr: 'Crèche de quartier', category: 'public',
    tiles: [3, 3], ...budget(3, 2, 1, 470), jobs: 16, density: 'faible', style: 'reconstruction',
    quartiers: Q('faubourg', 'grands_ensembles', 'pavillonnaire'), tags: ['public', 'petite_enfance', 'service:petite_enfance', 'rayon:600', 'capacite_service:60'],
  }), { w: 19.5, d: 10.5, floors: 1, cour: 4.0, preau: true }),

  civique(meta({
    id: 'proc_mediatheque', nameFr: 'Médiathèque', category: 'public',
    tiles: [4, 3], ...budget(4, 3, 2, 620), jobs: 38, density: 'moyenne', style: 'verre_contemporain',
    quartiers: Q('centre_historique', 'affaires', 'grands_ensembles'), tags: ['public', 'culture', 'mediatheque', 'attractivite:2', 'service:culture', 'rayon:2000'],
  }), { w: 29.0, d: 20.0, floors: 2, porche: 'auvent', vitrine: true, mat: true }),

  civique(meta({
    id: 'proc_mairie_annexe', nameFr: 'Mairie de quartier', category: 'public',
    tiles: [3, 3], ...budget(3, 2, 2, 650), jobs: 42, density: 'moyenne', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'faubourg'), tags: ['public', 'administration', 'service:administration', 'rayon:1800', 'attractivite:2'],
  }), { w: 22.0, d: 15.0, floors: 2, porche: 'colonnes', fronton: true, mat: true }),

  civique(meta({
    id: 'proc_poste_quartier', nameFr: 'Bureau de poste', category: 'public',
    tiles: [3, 2], ...budget(3, 2, 1, 520), jobs: 22, density: 'moyenne', style: 'reconstruction',
    quartiers: Q('faubourg', 'grands_ensembles'), tags: ['public', 'administration', 'poste', 'service:administration', 'rayon:1200'],
  }), { w: 22.0, d: 13.0, floors: 1, porche: 'auvent', vitrine: true }),

  civique(meta({
    id: 'proc_centre_sante', nameFr: 'Centre de santé', category: 'public',
    tiles: [3, 3], ...budget(3, 3, 2, 600), jobs: 56, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('faubourg', 'grands_ensembles'), tags: ['public', 'sante', 'service:sante', 'rayon:1500', 'capacite_service:90'],
  }), { w: 22.0, d: 18.0, floors: 2, porche: 'auvent', vitrine: true }),

  gymnase(meta({
    id: 'proc_gymnase', nameFr: 'Gymnase municipal', category: 'public',
    tiles: [4, 4], ...budget(4, 4, 0, 430), jobs: 14, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('grands_ensembles', 'faubourg', 'pavillonnaire'), tags: ['public', 'sport', 'service:sport', 'rayon:1500', 'capacite_service:400'],
  }), { w: 30.0, d: 26.0, h: 9.0, charpente: true }),

  gymnase(meta({
    id: 'proc_salle_polyvalente', nameFr: 'Salle polyvalente', category: 'public',
    tiles: [4, 3], ...budget(4, 3, 0, 450), jobs: 12, density: 'moyenne', style: 'brique_pignon',
    quartiers: Q('faubourg', 'pavillonnaire'), tags: ['public', 'culture', 'salle', 'service:culture', 'rayon:1200'],
  }), { w: 28.0, d: 19.0, h: 8.0, charpente: true }),

  chapelle(meta({
    id: 'proc_chapelle_pierre', nameFr: 'Chapelle de quartier', category: 'public',
    tiles: [2, 4], ...budget(2, 4, 0, 560), jobs: 3, density: 'faible', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'faubourg', 'pavillonnaire'), tags: ['public', 'culte', 'patrimoine', 'monument', 'attractivite:2', 'service:patrimoine'],
  }), { w: 12.6, d: 22.0, h: 9.5, clocher: 20, rose: true, porche: true, abside: true }),

  chapelle(meta({
    id: 'proc_temple_brique', nameFr: 'Temple en brique', category: 'public',
    tiles: [2, 4], ...budget(2, 4, 0, 520), jobs: 3, density: 'faible', style: 'brique_pignon',
    quartiers: Q('faubourg', 'centre_historique'), tags: ['public', 'culte', 'patrimoine', 'attractivite:2', 'service:patrimoine'],
  }), { w: 12.4, d: 24.0, h: 9.0, clocher: 17, porche: true }),
];

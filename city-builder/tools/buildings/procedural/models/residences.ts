/**
 * BÂTIMENTS PROCÉDURAUX — habitat : maisons en bande (mitoyennes), pavillons et villas, immeubles de rapport,
 * immeubles d'angle à pan coupé, résidences contemporaines.
 *
 * Chaque archétype est une fonction paramétrée (style, gabarit, options) : le même plan donne des bâtiments très
 * différents selon le style (percements, toiture, modénature, matériaux). La table en fin de fichier instancie
 * les modèles livrés au catalogue.
 */
import {
  bays, chimney, cornice as corniceOf, facade, fbox, flushWindow, gableRoof, plinth as plinthOf, rectAt, volume,
  type BuildingDef, type Ctx, type Frame,
} from '../../kit/index';
import { balcon } from '../rail';
import { compose, grid, levels, oriel, profiledGable, steppedGable } from '../grammar';
import { body, enclosure, fence, forecourt, loggiaStack, parapetRing, plainRule, ringFrames, roof as roofOf, slab, styleRule } from '../parts';
import { STYLES } from '../styles';
import { budget, makeDef, type Meta, type QuartierTag } from './common';

const SRC = 'tools/buildings/procedural/models/residences.ts';

/* ================================================================== */
/* 1. Maisons en bande (mitoyennes)                                     */
/* ================================================================== */

export interface RangeeOpts {
  units: number;
  /** Largeur d'une unité (m). */
  uw: number;
  depth: number;
  floors: number;
  /** Faîtage perpendiculaire à la rue : pignons en façade. */
  perp?: boolean;
  gable?: 'droit' | 'gradins' | 'cloche';
  shop?: boolean;
  oriel?: boolean;
  jardinet?: boolean;
  /** Encorbellement de l'étage (saillie en m). */
  encorbellement?: number;
}

export function rangee(m: Meta, o: RangeeOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const W = o.units * o.uw;
    const x0 = -W / 2, z0 = -o.depth / 2, z1 = o.depth / 2;
    const gH = s.groundH;
    const fH = s.floorH;
    const h = gH + o.floors * fH;
    for (let i = 0; i < o.units; i++) {
      const ux0 = x0 + i * o.uw;
      const ux1 = ux0 + o.uw;
      const hidden: ('E' | 'W')[] = [];
      if (i > 0) hidden.push('W');
      if (i < o.units - 1) hidden.push('E');
      const nBays = Math.max(2, Math.round((o.uw - 0.4) / 2.0));
      const pat = o.shop ? 'a'.repeat(nBays) : (i % 2 === 0 ? `p${'a'.repeat(nBays - 1)}` : `${'a'.repeat(nBays - 1)}p`);
      const r = body(ctx, s, {
        x0: ux0, x1: ux1, z0, z1, floors: o.floors, front: 'S', pattern: pat,
        weights: { p: 0.9 }, margin: 0.4,
        shop: o.shop ? { awning: i % 2 === 0, sign: true } : false,
        door: o.shop ? false : pat.indexOf('p'),
        balcony: s.id === 'pierre_claire' ? 'alterne' : 'non',
        balconyFrom: 1,
        hidden, rear: i === 0 || i === o.units - 1, lateral: false,
        timbered: s.id === 'colombage',
        plinth: { h: 0.5, d: 0.05, mat: s.base },
        cornice: !o.perp,
      });
      const f = r.frames.S;
      if (o.encorbellement && ctx.lod < 2) {
        fbox(ctx, 'dalle', f, 0, o.uw, gH - 0.22, gH, 0, o.encorbellement, 'back');
        if (ctx.lod === 0) for (const u of bays(o.uw, 3, 0.4)) fbox(ctx, 'colombage', f, u - 0.07, u + 0.07, gH - 0.8, gH - 0.2, 0, o.encorbellement * 0.9, 'back top');
      }
      if (o.oriel) {
        oriel(ctx, f, {
          uc: o.uw * 0.6, v0: gH + 0.2, w: Math.min(2.5, o.uw * 0.52), h: fH * Math.min(2, o.floors) - 0.55, depth: 0.8,
          wallMat: 'facade', floorH: fH, floors: Math.min(2, o.floors), timbered: s.id === 'colombage',
          top: o.floors > 2 ? 'balcon' : 'zinc', win: { ...s.win, shutters: 'none', surround: 0 },
        });
      }
      if (o.jardinet && ctx.lod < 2) {
        enclosure(ctx, f, 2.1, o.uw * (i % 2 === 0 ? 0.25 : 0.75), { h: 0.6, gateW: 1.1, mat: s.base, rail: s.id !== 'colombage' });
        forecourt(ctx, ux0 + 0.3, z1, ux1 - 0.3, z1 + 2.1, 0.05, 'soubassement');
      }
      if (o.perp) {
        const rr = gableRoof(ctx, { x0: ux0 - 0.1, x1: ux1 + 0.1, z0, z1, y: h, pitch: s.pitch, axis: 'z', overhang: 0.3, verge: 0.1, gableMat: 'facade', gutters: true });
        const gf: Frame = { o: [ux0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w: o.uw, h: h + 12 };
        const rise = rr.ridgeY - h;
        const kind = o.gable ?? 'droit';
        if (kind === 'gradins') {
          const g = steppedGable(ctx, { f: gf, eave: h, rise, steps: Math.max(3, Math.round(rise / 1.0)), mat: 'facade', t: 0.3 });
          flushWindow(ctx, gf, rectAt(o.uw / 2, 0.75, h + rise * 0.28, 0.95), { bars: true });
          if (i % 2 === 0) chimney(ctx, ux0 + o.uw * 0.5, z0 + o.depth * 0.25, 0.65, 0.8, h, g.top + 0.4, { pots: 2 });
        } else if (kind === 'cloche') {
          const top = profiledGable(ctx, { f: gf, eave: h, rise, height: rise + 0.8, mat: 'facade', t: 0.3, profile: (t) => Math.max(0.14, Math.cos(t * 1.3) ** 1.6) });
          flushWindow(ctx, gf, rectAt(o.uw / 2, 0.8, h + rise * 0.25, 1.0), { bars: true });
          if (i % 2 === 1) chimney(ctx, ux0 + o.uw * 0.5, z0 + o.depth * 0.25, 0.6, 0.8, h, top + 0.3, { pots: 2 });
        } else {
          if (ctx.lod < 2) {
            const half = o.uw / 2 + 0.1;
            const n = ctx.lod === 0 ? 6 : 3;
            for (let k = 0; k < n; k++) {
              const t0 = k / n, t1 = (k + 1) / n;
              for (const sg of [-1, 1]) fbox(ctx, 'encadrement', gf, o.uw / 2 + sg * half * (1 - t1), o.uw / 2 + sg * half * (1 - t0), h + rise * t0, h + rise * t1 + 0.07, -0.33, 0.06, 'bottom');
            }
          }
          flushWindow(ctx, gf, rectAt(o.uw / 2, 0.7, h + rise * 0.3, 0.9), { bars: true });
          if (i === 0) chimney(ctx, ux0 + o.uw * 0.5, z0 + o.depth * 0.3, 0.6, 0.8, h, h + rise + 0.5, { pots: 2 });
        }
      } else if (i === 0) {
        roofOf(ctx, s, { x0, x1: x0 + W, z0, z1, y: h, front: 'S', axis: 'x', dormers: Math.max(2, o.units), chimneys: Math.max(2, o.units - 1) });
      }
    }
  });
}

/* ================================================================== */
/* 2. Maison individuelle (pavillon, villa, maison de faubourg)         */
/* ================================================================== */

export interface PavillonOpts {
  w: number; d: number; floors: number;
  garage?: number;
  porche?: boolean;
  comble?: boolean;
  cloture?: boolean;
  aile?: { w: number; d: number };
  terrasse?: boolean;
}

export function pavillon(m: Meta, o: PavillonOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const gw = o.garage ?? 0;
    const x0 = -o.w / 2, x1 = o.w / 2;
    const z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH - 0.3;
    const floors = o.comble ? 0 : o.floors;
    const h = gH + floors * s.floorH;
    const nBays = Math.max(3, Math.round((o.w - gw) / 2.6));
    const half = Math.floor(nBays / 2);
    const pat = `${'a'.repeat(half)}p${'a'.repeat(nBays - 1 - half)}`;
    const r = body(ctx, s, {
      x0: x0 + gw, x1, z0, z1, floors, front: 'S', pattern: pat, margin: 0.5, door: half,
      rear: true, lateral: true, shop: false,
      balcony: floors > 0 && s.id !== 'colombage' ? 'saillie' : 'non',
      plinth: { h: 0.45, d: 0.06, mat: s.base },
      timbered: s.id === 'colombage',
    });
    const f = r.frames.S;
    roofOf(ctx, s, {
      x0: x0 + gw, x1, z0, z1, y: h, front: 'S',
      kind: s.roof === 'mansarde' ? 'quatre_pans' : s.roof,
      axis: 'x', dormers: o.comble ? Math.max(2, nBays - 1) : (s.dormers ? 2 : false), chimneys: 1, parapet: 0.45,
    });
    if (gw > 0) {
      const gz0 = z0 + o.d * 0.2;
      volume(ctx, {
        x0, x1: x0 + gw, z0: gz0, z1, h: gH - 0.4, wallMat: s.wall, hidden: ['E'],
        sides: {
          S: [{ kind: 'garage', r: rectAt(gw / 2, Math.min(2.6, gw - 0.8), 0.02, 2.2) }],
          W: [{ kind: 'window', r: rectAt((z1 - gz0) / 2, 0.7, 1.6, 0.8), o: { shutters: 'none', leaves: 1 } }],
        },
        plinth: { h: 0.4, d: 0.05, mat: s.base },
      });
      roofOf(ctx, s, { x0, x1: x0 + gw + 0.1, z0: gz0, z1, y: gH - 0.4, kind: s.roof === 'terrasse' ? 'terrasse' : 'quatre_pans', front: 'S', chimneys: false, dormers: false, parapet: 0.3, equipment: false, stair: false });
    }
    if (o.aile) {
      const az1 = z0, az0 = z0 - o.aile.d;
      volume(ctx, {
        x0: x1 - o.aile.w, x1, z0: az0, z1: az1, h: gH - 0.15, wallMat: s.wall, hidden: ['S'],
        sides: {
          E: [{ kind: 'window', r: rectAt(o.aile.d / 2, 1.1, 1.0, 1.4), o: { ...s.win } }],
          N: [{ kind: 'window', r: rectAt(o.aile.w / 2, 1.2, 1.0, 1.4), o: { ...s.win } }],
          W: [{ kind: 'window', r: rectAt(o.aile.d / 2, 0.8, 1.2, 1.1), o: { ...s.win, shutters: 'none' } }],
        },
        plinth: { h: 0.45, d: 0.06, mat: s.base },
      });
      roofOf(ctx, s, { x0: x1 - o.aile.w, x1, z0: az0, z1: az1, y: gH - 0.15, kind: s.roof === 'terrasse' ? 'terrasse' : 'quatre_pans', chimneys: false, dormers: false, parapet: 0.3, equipment: false, stair: false });
    }
    if (o.porche && ctx.lod < 2) {
      const uc = r.grid.us[half] ?? (o.w - gw) / 2;
      fbox(ctx, 'dalle', f, uc - 1.4, uc + 1.4, 2.7, 2.9, 0, 1.5, 'back');
      if (ctx.lod === 0) {
        for (const u of [uc - 1.25, uc + 1.25]) {
          const px = f.o[0] + f.u[0] * u + f.n[0] * 1.35;
          const pz = f.o[2] + f.u[2] * u + f.n[2] * 1.35;
          ctx.mb.cylinder(s.id === 'colombage' ? 'bois' : 'encadrement', px, 0.05, pz, 0.11, 2.7, 8, false);
        }
      }
      forecourt(ctx, x0 + gw + 1, z1, x1 - 1, z1 + 1.7, 0.05, 'soubassement');
    }
    if (o.terrasse && ctx.lod < 2) {
      forecourt(ctx, x0 + gw + 0.5, z0 - 3.0, x1 - 0.5, z0, 0.14, 'soubassement');
      fence(ctx, { o: [x1 - 0.5, 0.14, z0 - 3.0], u: [-1, 0, 0], n: [0, 0, -1], w: o.w - gw - 1, h: 1 }, 0.1, o.w - gw - 1.1, 0, 0.95, 'fer');
    }
    if (o.cloture) {
      const cf: Frame = { o: [x0, 0, z1 + 3.2], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: 2 };
      enclosure(ctx, cf, 0, o.w * 0.5, { h: 0.55, gateW: 3.0, mat: s.base, rail: true });
    }
  });
}

/* ================================================================== */
/* 3. Immeuble de rapport (R+n, commerces en pied)                      */
/* ================================================================== */

export interface ImmeubleOpts {
  w: number; d: number; floors: number;
  shop?: boolean;
  balcons?: 'filant' | 'saillie' | 'alterne' | 'loggia' | 'non';
  attique?: number;
  travees?: number;
  comble?: boolean;
  pignonsAveugles?: boolean;
}

export function immeuble(m: Meta, o: ImmeubleOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH;
    const h = gH + o.floors * s.floorH;
    const n = o.travees ?? Math.max(3, Math.round(o.w / 3.1));
    const half = Math.floor(n / 2);
    const pat = o.shop ? 'a'.repeat(n) : `${'a'.repeat(half)}p${'a'.repeat(n - 1 - half)}`;
    const spec: Parameters<typeof body>[2] = {
      x0, x1, z0, z1, floors: o.floors, front: 'S', pattern: pat, margin: 0.45,
      shop: o.shop ? { awning: true, sign: true } : false,
      door: o.shop ? false : half,
      balcony: !o.balcons || o.balcons === 'non' || o.balcons === 'loggia' ? 'non' : o.balcons,
      balconyFrom: 0,
      rear: true, lateral: !o.pignonsAveugles,
      plinth: { h: 0.6, d: 0.06, mat: s.base },
    };
    if (o.attique) spec.attic = o.attique;
    const r = body(ctx, s, spec);
    if (o.balcons === 'loggia') {
      const uw = o.w / n;
      for (let i = 1; i < n; i += 2) loggiaStack(ctx, r.frames.S, i * uw + 0.3, (i + 1) * uw - 0.3, gH + 0.1, s.floorH, o.floors, 'facade', { depth: 1.5, rail: s.rail });
    }
    if (o.comble) {
      roofOf(ctx, s, { x0, x1, z0, z1, y: r.top, kind: 'mansarde', front: 'S', dormers: Math.max(3, n - 1), chimneys: 2 });
    } else {
      roofOf(ctx, s, {
        x0, x1, z0, z1, y: o.attique ? r.top : h, front: 'S', axis: 'x',
        kind: o.attique ? 'terrasse' : s.roof,
        dormers: s.dormers ? Math.max(2, n - 2) : false, chimneys: s.chimneys ? 2 : false, parapet: 0.6,
      });
    }
  });
}

/* ================================================================== */
/* 4. Immeuble d'angle à pan coupé                                      */
/* ================================================================== */

/** Contour rectangulaire dont l'angle sud-est est coupé. */
export function chamferedRect(x0: number, z0: number, x1: number, z1: number, cut: number): [number, number][] {
  return [[x0, z0], [x1 - cut, z0], [x1, z0 + cut], [x1, z1], [x0, z1]];
}

export interface AngleOpts { w: number; d: number; floors: number; shop?: boolean; dome?: boolean; attique?: number }

/**
 * Immeuble d'angle : contour à pan coupé, façades composées segment par segment (la travée du pan coupé reçoit
 * l'entrée ou une vitrine d'angle), toiture-terrasse ou mansarde, éventuel dôme de zinc sur l'angle.
 */
export function immeubleAngle(m: Meta, o: AngleOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const cut = Math.min(4.6, Math.min(o.w, o.d) * 0.3);
    // façade principale au sud (+Z) : l'angle coupé est au sud-est
    const ring = chamferedRect(x0, z1, x1, z0, cut).map(([x, z]) => [x, z] as [number, number]);
    const pts: [number, number][] = [[x0, z1], [x1 - cut, z1], [x1, z1 - cut], [x1, z0], [x0, z0]];
    void ring;
    const gH = s.groundH;
    const fH = s.floorH;
    const h = gH + o.floors * fH;
    const lv = levels(gH, o.floors, fH);
    const frames = ringFrames(pts, 0, h);
    for (const f of frames) {
      const chamfer = Math.abs(f.w - cut * Math.SQRT2) < 0.05;
      const blind = f.n[2] < -0.5 || f.n[0] < -0.5; // façades arrière (nord / ouest) : percements simples
      const n = chamfer ? 1 : Math.max(2, Math.round(f.w / 3.1));
      const g = grid(f.w, 'a'.repeat(n), lv, { margin: chamfer ? 0.5 : 0.45 });
      const rule = blind
        ? plainRule(s)
        : styleRule(s, g, {
          shop: o.shop ? { awning: !chamfer, sign: true } : false,
          door: !o.shop && chamfer ? 0 : false,
          balcony: chamfer ? 'saillie' : 'filant', balconyFrom: 0,
        });
      const c = compose(g, rule);
      facade(ctx, f, s.wall, c.ops);
      plinthOf(ctx, s.base, f, 0.6, 0.06, c.ops.map((x) => x.r));
      corniceOf(ctx, 'encadrement', f, h, s.cornice);
      for (const d of c.decos) d(ctx, f);
      if (!blind && !chamfer) for (let k = 0; k < o.floors; k++) balcon(ctx, f, 0.4, f.w - 0.4, gH + k * fH + 0.04, { depth: 0.9, slab: 0.16, rail: s.rail, consoles: s.id === 'pierre_claire', sides: 'both' });
    }
    const corn = s.cornice.reduce((t, p) => t + p[0], 0);
    const y = h + corn;
    slab(ctx, pts, y - 0.18, 'terrasse');
    parapetRing(ctx, ringFrames(pts, 0, 1), y, 0.6, s.wall);
    if (o.dome) {
      // dôme d'angle : zinc patiné (métal peu réfléchissant, sinon il rend noir sous un ciel sombre)
      const cx = x1 - cut * 0.62, cz = z1 - cut * 0.62;
      const segs = ctx.lod === 0 ? 14 : ctx.lod === 1 ? 9 : 6;
      const base = cut * 0.92;
      ctx.mb.cylinder('dome', cx, y + 0.6, cz, base, 1.3, segs, false);
      const rings = ctx.lod === 0 ? 6 : ctx.lod === 1 ? 4 : 2;
      const R = 4.2;
      for (let k = 0; k < rings; k++) {
        const a0 = (Math.PI / 2) * (k / rings), a1 = (Math.PI / 2) * ((k + 1) / rings);
        ctx.mb.cylinder('dome', cx, y + 1.9 + Math.sin(a0) * R, cz, base * Math.cos(a0), (Math.sin(a1) - Math.sin(a0)) * R, segs, false, base * Math.cos(a1));
      }
      if (ctx.lod < 2) { ctx.mb.cylinder('dome', cx, y + 1.9 + R - 0.3, cz, 0.42, 0.8, segs, false, 0.12); ctx.mb.cylinder('garde_corps', cx, y + 2.4 + R, cz, 0.05, 1.8, 6, true); }
    } else if (ctx.lod < 2) {
      ctx.mb.box('equipement', x0 + o.w * 0.35, y - 0.16, z0 + o.d * 0.35, x0 + o.w * 0.35 + 2.4, y + 0.9, z0 + o.d * 0.35 + 1.6, 'ny');
    }
    void o.attique;
  });
}

/* ================================================================== */
/* 5. Résidence contemporaine                                           */
/* ================================================================== */

export interface ResidenceOpts { w: number; d: number; floors: number; retrait?: number; bardage?: boolean; socleCommerce?: boolean }

export function residence(m: Meta, o: ResidenceOpts): BuildingDef {
  const s = STYLES[m.style];
  return makeDef(m, (ctx: Ctx) => {
    const x0 = -o.w / 2, x1 = o.w / 2, z0 = -o.d / 2, z1 = o.d / 2;
    const gH = s.groundH;
    const fH = s.floorH;
    const retr = o.retrait ?? 1;
    const lower = Math.max(1, o.floors - retr);
    const spec: Parameters<typeof body>[2] = {
      x0, x1, z0, z1, floors: lower, front: 'S',
      pattern: 'a'.repeat(Math.max(3, Math.round(o.w / 3.4))), margin: 0.5,
      shop: o.socleCommerce ? { awning: false, sign: true } : false,
      door: o.socleCommerce ? false : 'milieu',
      balcony: 'saillie', balconyFrom: 0, rear: true, lateral: true,
      plinth: { h: 0.5, d: 0.05, mat: s.base },
    };
    if (o.bardage) spec.sideMat = { E: 'facade_b', W: 'facade_b' };
    body(ctx, s, spec);
    let y = gH + lower * fH;
    for (let k = 0; k < retr; k++) {
      const inset = 1.7 * (k + 1);
      const ax0 = x0 + inset, ax1 = x1 - inset, az0 = z0 + inset * 0.5, az1 = z1 - inset;
      if (ax1 - ax0 < 4 || az1 - az0 < 4) break;
      const g = grid(ax1 - ax0, 'a'.repeat(Math.max(2, Math.round((ax1 - ax0) / 3.4))), [{ id: 'etage', h: fH }], { margin: 0.4 });
      const c = compose(g, styleRule(s, g, { shop: false, door: false, balcony: 'non' }));
      volume(ctx, {
        x0: ax0, x1: ax1, z0: az0, z1: az1, y0: y, h: fH, wallMat: o.bardage ? 'facade_b' : 'facade',
        sides: { S: c.ops, N: compose(g, plainRule(s)).ops },
      });
      const f: Frame = { o: [ax0, y, az1], u: [1, 0, 0], n: [0, 0, 1], w: ax1 - ax0, h: fH };
      for (const d of c.decos) d(ctx, f);
      // terrasse du retrait + garde-corps
      ctx.mb.box('terrasse', ax0 - inset * 0.9, y - 0.04, az1, ax1 + inset * 0.9, y, z1 - 0.1, 'ny');
      balcon(ctx, { o: [x0, y, z1], u: [1, 0, 0], n: [0, 0, 1], w: o.w, h: 1 }, inset - 1.5, o.w - inset + 1.5, 0.02, { depth: 0.25, slab: 0.1, rail: s.rail });
      y += fH;
    }
    const fx = 1.7 * retr;
    roofOf(ctx, s, { x0: x0 + fx, x1: x1 - fx, z0: z0 + fx * 0.5, z1: z1 - fx, y, kind: 'terrasse', parapet: 0.5, front: 'S' });
  });
}

/* ================================================================== */
/* Modèles livrés                                                       */
/* ================================================================== */

const Q = (...q: QuartierTag[]): QuartierTag[] => q;
const meta = (o: Omit<Meta, 'src'>): Meta => ({ ...o, src: SRC });

export const RESIDENCES: BuildingDef[] = [
  /* --- maisons en bande ------------------------------------------- */
  rangee(meta({
    id: 'proc_bande_pignons_gradins', nameFr: 'Maisons à pignons à gradins', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 2, 380), residents: 16, density: 'moyenne', style: 'brique_pignon',
    quartiers: Q('centre_historique', 'faubourg'), mitoyen: true, tags: ['maison', 'pignon', 'brique'],
  }), { units: 3, uw: 7.4, depth: 12.5, floors: 2, perp: true, gable: 'gradins', jardinet: false }),

  rangee(meta({
    id: 'proc_bande_pignons_cloche', nameFr: 'Maisons à pignons chantournés', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 2, 390), residents: 15, density: 'moyenne', style: 'brique_pignon',
    quartiers: Q('centre_historique'), mitoyen: true, tags: ['maison', 'pignon', 'brique'],
  }), { units: 3, uw: 7.2, depth: 12.0, floors: 2, perp: true, gable: 'cloche', oriel: true }),

  rangee(meta({
    id: 'proc_bande_colombage', nameFr: 'Maisons à pans de bois', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 2, 400), residents: 14, density: 'moyenne', style: 'colombage',
    quartiers: Q('centre_historique'), mitoyen: true, tags: ['maison', 'colombage', 'patrimoine'],
  }), { units: 3, uw: 6.6, depth: 11.5, floors: 2, perp: true, gable: 'droit', encorbellement: 0.45 }),

  rangee(meta({
    id: 'proc_bande_boutiques', nameFr: 'Maisons de ville avec boutiques', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 3, 430), residents: 18, jobs: 9, density: 'forte', style: 'colombage',
    quartiers: Q('centre_historique', 'faubourg'), mitoyen: true, tags: ['maison', 'commerces', 'colombage'],
  }), { units: 3, uw: 6.9, depth: 12.0, floors: 3, perp: true, gable: 'droit', shop: true, encorbellement: 0.4 }),

  rangee(meta({
    id: 'proc_bande_faubourg', nameFr: 'Maisons de faubourg à volets', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 1, 340), residents: 12, density: 'moyenne', style: 'enduit_volets',
    quartiers: Q('faubourg', 'pavillonnaire'), mitoyen: true, tags: ['maison', 'volets', 'jardinet'],
  }), { units: 4, uw: 5.6, depth: 11.0, floors: 1, perp: false, jardinet: true }),

  rangee(meta({
    id: 'proc_bande_brique_jardinets', nameFr: 'Maisons ouvrières en brique', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 1, 330), residents: 14, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('faubourg', 'activites'), mitoyen: true, tags: ['maison', 'brique', 'ouvrier'],
  }), { units: 4, uw: 5.4, depth: 10.5, floors: 1, perp: false, jardinet: true }),

  rangee(meta({
    id: 'proc_bande_pierre_balcons', nameFr: 'Maisons de ville en pierre', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 3, 520), residents: 22, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'faubourg'), mitoyen: true, tags: ['maison', 'pierre', 'balcons'],
  }), { units: 3, uw: 7.2, depth: 12.5, floors: 3, perp: false }),

  rangee(meta({
    id: 'proc_bande_contemporaine', nameFr: 'Maisons de ville contemporaines', category: 'townhouse',
    tiles: [3, 2], ...budget(3, 2, 2, 470), residents: 16, density: 'moyenne', style: 'beton_moderne',
    quartiers: Q('faubourg', 'pavillonnaire'), mitoyen: true, tags: ['maison', 'contemporain', 'terrasse'],
  }), { units: 4, uw: 5.8, depth: 11.5, floors: 2, perp: false, jardinet: true }),

  /* --- maisons individuelles --------------------------------------- */
  pavillon(meta({
    id: 'proc_pavillon_volets', nameFr: 'Pavillon à volets et garage', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 1, 430), residents: 5, density: 'faible', style: 'enduit_volets',
    quartiers: Q('pavillonnaire'), tags: ['maison', 'garage', 'jardin'],
  }), { w: 12.5, d: 10.5, floors: 1, garage: 3.4, porche: true, cloture: true }),

  pavillon(meta({
    id: 'proc_pavillon_comble', nameFr: 'Pavillon à combles aménagés', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 1, 410), residents: 4, density: 'faible', style: 'brique_pignon',
    quartiers: Q('pavillonnaire', 'faubourg'), tags: ['maison', 'lucarnes', 'brique'],
  }), { w: 11.8, d: 9.8, floors: 1, comble: true, garage: 3.2, cloture: true }),

  pavillon(meta({
    id: 'proc_maison_pierre_aile', nameFr: 'Maison en pierre à aile', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 2, 470), residents: 6, density: 'faible', style: 'pierre_claire',
    quartiers: Q('pavillonnaire', 'faubourg'), tags: ['maison', 'pierre', 'aile'],
  }), { w: 12.0, d: 8.6, floors: 1, aile: { w: 5.2, d: 4.4 }, porche: true }),

  pavillon(meta({
    id: 'proc_maison_colombage_jardin', nameFr: 'Maison à pans de bois et jardin', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 1, 440), residents: 5, density: 'faible', style: 'colombage',
    quartiers: Q('pavillonnaire', 'centre_historique'), tags: ['maison', 'colombage', 'jardin'],
  }), { w: 11.0, d: 9.0, floors: 1, comble: true, cloture: true }),

  pavillon(meta({
    id: 'proc_villa_contemporaine', nameFr: 'Villa contemporaine à terrasse', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 2, 650), residents: 5, density: 'faible', style: 'beton_moderne',
    quartiers: Q('pavillonnaire'), tags: ['maison', 'contemporain', 'terrasse', 'piscine'],
  }), { w: 13.0, d: 10.0, floors: 1, garage: 3.6, terrasse: true }),

  pavillon(meta({
    id: 'proc_villa_verre', nameFr: 'Villa de verre sur jardin', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 2, 820), residents: 4, density: 'faible', style: 'verre_contemporain',
    quartiers: Q('pavillonnaire'), tags: ['maison', 'verre', 'contemporain'],
  }), { w: 13.2, d: 10.2, floors: 1, terrasse: true, garage: 3.4 }),

  pavillon(meta({
    id: 'proc_maison_reconstruction', nameFr: 'Maison d’après-guerre', category: 'house',
    tiles: [2, 2], ...budget(2, 2, 1, 360), residents: 5, density: 'faible', style: 'reconstruction',
    quartiers: Q('pavillonnaire', 'faubourg'), tags: ['maison', 'reconstruction'],
  }), { w: 11.2, d: 9.4, floors: 1, garage: 3.0, cloture: true }),

  /* --- immeubles de rapport ---------------------------------------- */
  immeuble(meta({
    id: 'proc_immeuble_pierre_r5', nameFr: 'Immeuble de pierre R+5', category: 'apartment_mid',
    tiles: [3, 2], ...budget(3, 2, 5, 600), residents: 58, jobs: 10, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'affaires'), mitoyen: true, tags: ['immeuble', 'pierre', 'balcons', 'commerces'],
  }), { w: 23.0, d: 14.5, floors: 5, shop: true, balcons: 'filant', comble: true }),

  immeuble(meta({
    id: 'proc_immeuble_pierre_noble', nameFr: 'Immeuble bourgeois à frontons', category: 'apartment_mid',
    tiles: [3, 2], ...budget(3, 2, 4, 620), residents: 46, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique'), mitoyen: true, tags: ['immeuble', 'pierre', 'frontons'],
  }), { w: 22.0, d: 14.0, floors: 4, shop: false, balcons: 'alterne', comble: true }),

  immeuble(meta({
    id: 'proc_immeuble_brique_r4', nameFr: 'Immeuble de brique R+4', category: 'apartment_mid',
    tiles: [3, 2], ...budget(3, 2, 4, 520), residents: 42, jobs: 6, density: 'forte', style: 'brique_pignon',
    quartiers: Q('faubourg', 'centre_historique'), mitoyen: true, tags: ['immeuble', 'brique', 'commerces'],
  }), { w: 22.5, d: 13.5, floors: 4, shop: true, balcons: 'saillie' }),

  immeuble(meta({
    id: 'proc_immeuble_faubourg_r3', nameFr: 'Immeuble de faubourg R+3', category: 'apartment_low',
    tiles: [2, 2], ...budget(2, 2, 3, 460), residents: 26, jobs: 4, density: 'moyenne', style: 'enduit_volets',
    quartiers: Q('faubourg'), mitoyen: true, tags: ['immeuble', 'volets', 'commerce'],
  }), { w: 13.6, d: 12.4, floors: 3, shop: true, balcons: 'alterne' }),

  immeuble(meta({
    id: 'proc_immeuble_reconstruction', nameFr: 'Immeuble de la Reconstruction', category: 'apartment_mid',
    tiles: [3, 2], ...budget(3, 2, 4, 450), residents: 48, jobs: 8, density: 'forte', style: 'reconstruction',
    quartiers: Q('faubourg', 'grands_ensembles'), mitoyen: true, tags: ['immeuble', 'reconstruction', 'commerces'],
  }), { w: 23.0, d: 14.0, floors: 4, shop: true, balcons: 'filant' }),

  immeuble(meta({
    id: 'proc_immeuble_loggias', nameFr: 'Immeuble à loggias', category: 'apartment_mid',
    tiles: [3, 2], ...budget(3, 2, 5, 500), residents: 54, density: 'forte', style: 'beton_moderne',
    quartiers: Q('grands_ensembles', 'faubourg'), mitoyen: true, tags: ['immeuble', 'loggias'],
  }), { w: 23.5, d: 14.0, floors: 5, balcons: 'loggia', attique: 2.8 }),

  immeuble(meta({
    id: 'proc_immeuble_atelier_brique', nameFr: 'Immeuble d’ateliers reconverti', category: 'apartment_low',
    tiles: [3, 2], ...budget(3, 2, 3, 470), residents: 24, jobs: 14, density: 'moyenne', style: 'brique_industrielle',
    quartiers: Q('activites', 'faubourg'), mitoyen: true, tags: ['immeuble', 'brique', 'ateliers', 'verrieres'],
  }), { w: 22.0, d: 14.5, floors: 3, shop: true, balcons: 'non' }),

  immeuble(meta({
    id: 'proc_immeuble_colombage_haut', nameFr: 'Grande maison à pans de bois', category: 'apartment_low',
    tiles: [2, 2], ...budget(2, 2, 3, 480), residents: 18, jobs: 5, density: 'moyenne', style: 'colombage',
    quartiers: Q('centre_historique'), mitoyen: true, tags: ['immeuble', 'colombage', 'patrimoine'],
  }), { w: 13.4, d: 12.2, floors: 3, shop: true, balcons: 'non' }),

  /* --- immeubles d'angle -------------------------------------------- */
  immeubleAngle(meta({
    id: 'proc_angle_pierre_dome', nameFr: 'Immeuble d’angle à dôme', category: 'apartment_mid',
    tiles: [3, 3], ...budget(3, 3, 5, 650), residents: 64, jobs: 16, density: 'forte', style: 'pierre_claire',
    quartiers: Q('centre_historique', 'affaires'), tags: ['immeuble', 'angle', 'dome', 'commerces'],
  }), { w: 22.6, d: 22.2, floors: 5, shop: true, dome: true }),

  immeubleAngle(meta({
    id: 'proc_angle_brique', nameFr: 'Immeuble d’angle en brique', category: 'apartment_mid',
    tiles: [3, 3], ...budget(3, 3, 4, 560), residents: 56, jobs: 12, density: 'forte', style: 'brique_pignon',
    quartiers: Q('faubourg', 'centre_historique'), tags: ['immeuble', 'angle', 'brique', 'commerces'],
  }), { w: 22.0, d: 21.6, floors: 4, shop: true }),

  immeubleAngle(meta({
    id: 'proc_angle_moderne', nameFr: 'Immeuble d’angle moderne', category: 'apartment_mid',
    tiles: [3, 3], ...budget(3, 3, 5, 520), residents: 60, jobs: 10, density: 'forte', style: 'reconstruction',
    quartiers: Q('faubourg', 'grands_ensembles'), tags: ['immeuble', 'angle', 'commerces'],
  }), { w: 22.4, d: 21.8, floors: 5, shop: true }),

  /* --- résidences contemporaines ------------------------------------ */
  residence(meta({
    id: 'proc_residence_gradins', nameFr: 'Résidence à gradins', category: 'apartment_high',
    tiles: [4, 3], ...budget(4, 3, 6, 520), residents: 120, density: 'tres_forte', style: 'beton_moderne',
    quartiers: Q('grands_ensembles', 'faubourg'), tags: ['residence', 'terrasses', 'gradins'],
  }), { w: 30.6, d: 21.0, floors: 6, retrait: 2 }),

  residence(meta({
    id: 'proc_residence_bardage', nameFr: 'Résidence à bardage bois', category: 'apartment_mid',
    tiles: [3, 2], ...budget(3, 2, 4, 540), residents: 52, jobs: 6, density: 'forte', style: 'beton_moderne',
    quartiers: Q('faubourg', 'pavillonnaire'), tags: ['residence', 'bois', 'balcons'],
  }), { w: 22.5, d: 14.0, floors: 4, retrait: 1, bardage: true, socleCommerce: true }),

  residence(meta({
    id: 'proc_residence_verre', nameFr: 'Résidence de standing vitrée', category: 'apartment_high',
    tiles: [4, 3], ...budget(4, 3, 7, 720), residents: 130, jobs: 12, density: 'tres_forte', style: 'verre_contemporain',
    quartiers: Q('affaires', 'grands_ensembles'), tags: ['residence', 'verre', 'standing'],
  }), { w: 29.6, d: 20.6, floors: 7, retrait: 2, socleCommerce: true }),
];

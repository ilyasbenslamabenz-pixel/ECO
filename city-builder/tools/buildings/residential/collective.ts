/**
 * Maisons mitoyennes (`townhouse`), petits immeubles (`apartment_low`), immeubles moyens avec commerces
 * en pied (`apartment_mid`) — modélisés avec le kit.
 */
import {
  balcony, basePalette, bays, chimney, COLORS, cornice, dormer, downpipe, fbox, flatRoof, gableRoof, hipRoof,
  mansardRoof, mast, railing, rectAt, rooftopUnit, row, shedRoof, stairHouse, subFrame, volume,
  type BuildingDef, type Ctx, type OpeningSpec,
} from '../kit/index';
import { ARDOISE } from './houses';

const SRC = 'tools/buildings/residential/collective.ts';

/* ------------------------------------------------------------------ */
/* 8. Rangée de quatre maisons mitoyennes en brique                      */
/* ------------------------------------------------------------------ */
export const mitoyennesBrique: BuildingDef = {
  id: 'mitoyennes_brique',
  nameFr: 'Rangée de maisons mitoyennes en brique',
  category: 'townhouse',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 150000,
  upkeepPerMonth: 210,
  residents: 18,
  jobs: 0,
  density: 'moyenne',
  style: 'brique_nord',
  tags: ['mitoyen', 'brique', 'ardoise', 'bow-window', 'jardinets'],
  source: `${SRC}#mitoyennesBrique`,
  palette: basePalette({
    facade: { set: 'brique_orange', color: '#e6c7b4' },
    encadrement: { set: 'pierre_taille', color: '#f0ebe1' },
    soubassement: { set: 'pierre_rustique', color: '#8f8a82' },
    toiture: { set: 'toit_ardoise', color: ARDOISE },
    poterie: { set: 'toit_tuiles', color: '#b8714f' },
    porte: { set: 'bardage_blanc', color: '#27445e' },
    porte2: { set: 'bardage_blanc', color: '#7a2830' },
    cheminee: { set: 'brique_orange', color: '#e6c7b4' },
    rive: { set: 'bardage_blanc', color: '#f4f2ec' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique orangée, portes bleue et bordeaux' },
    { id: 'sombre', nameFr: 'Brique rouge sombre, portes noires', materialOverrides: { facade: { textureSet: 'brique_rouge', color: '#ffffff' }, cheminee: { textureSet: 'brique_rouge', color: '#ffffff' }, porte: { color: COLORS.noir }, porte2: { color: '#3f6b4a' } } },
    { id: 'tuiles', nameFr: 'Brique et tuiles rouges', materialOverrides: { toiture: { textureSet: 'toit_tuiles', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const { mb } = ctx;
    const n = 4;
    const uw = 5.4;
    const W = n * uw;
    const x0 = -W / 2, x1 = W / 2, z0 = -4.6, z1 = 4.6;
    const fl = 0.45;
    const eave = 6.0;
    const tn = Math.tan((40 * Math.PI) / 180);
    const ops: OpeningSpec[] = [];
    for (let i = 0; i < n; i++) {
      const m = i % 2 === 0; // portes en miroir deux à deux
      const u0 = i * uw;
      const du = u0 + (m ? 0.95 : uw - 0.95);
      ops.push({ kind: 'door', r: rectAt(du, 1.0, fl, 2.3), o: { steps: fl, transom: 0.45, style: 'panneaux', surround: 0.14, doorMat: i % 2 ? 'porte2' : 'porte' } });
      ops.push(...row([u0 + (m ? 1.25 : uw - 1.25), u0 + (m ? 3.9 : uw - 3.9)], 1.1, 4.0, 1.5, () => ({ kind: 'window', o: { lintel: true, bars: 1, shutters: 'none' } })));
    }
    const nOps: OpeningSpec[] = [];
    for (let i = 0; i < n; i++) {
      const u0 = i * uw;
      nOps.push({ kind: 'window', r: rectAt(u0 + 1.6, 1.4, fl, 2.2), o: { sill: false, leaves: 2, shutters: 'none' } });
      nOps.push({ kind: 'window', r: rectAt(u0 + 4.0, 0.8, 1.4, 1.1), o: { lintel: true, shutters: 'none' } });
      nOps.push(...row([u0 + 1.6, u0 + 4.0], 0.9, 4.0, 1.3, () => ({ kind: 'window', o: { lintel: true, shutters: 'none' } })));
    }
    const F = volume(ctx, {
      x0, x1, z0, z1, h: eave, wallMat: 'facade',
      sides: { S: ops, N: nOps, W: [{ kind: 'window', r: rectAt(4.6, 0.8, 4.0, 1.2), o: { lintel: true } }], E: [{ kind: 'window', r: rectAt(4.6, 0.8, 4.0, 1.2), o: { lintel: true } }] },
      plinth: { h: fl, d: 0.05 },
      bands: [{ v: 3.3, h: 0.15, d: 0.04 }],
    });
    const roof = gableRoof(ctx, { x0, x1, z0, z1, y: eave, pitch: 40, axis: 'x', overhang: 0.35, verge: 0.25, gableMat: 'facade' });
    for (let i = 0; i < n; i++) {
      const u0 = i * uw;
      const m = i % 2 === 0;
      // bow-window
      const bc = x0 + u0 + (m ? 3.4 : uw - 3.4);
      const bx0 = bc - 1.4, bx1 = bc + 1.4;
      volume(ctx, {
        x0: bx0, x1: bx1, z0: z1, z1: z1 + 0.75, h: 3.15, wallMat: 'facade', hidden: ['N'],
        sides: {
          S: [{ kind: 'window', r: rectAt(1.4, 1.9, 1.0, 1.7), o: { leaves: 3, bars: 1, shutters: 'none' } }],
          E: [{ kind: 'window', r: rectAt(0.38, 0.4, 1.0, 1.7), o: { leaves: 1, shutters: 'none' } }],
          W: [{ kind: 'window', r: rectAt(0.38, 0.4, 1.0, 1.7), o: { leaves: 1, shutters: 'none' } }],
        },
        plinth: { h: fl + 0.3, d: 0.05 },
      });
      shedRoof(ctx, { x0: bx0, x1: bx1, z0: z1, z1: z1 + 0.75, yLow: 3.15, yHigh: 3.5, low: 'S', overhang: 0.12, wallMat: 'facade', thickness: 0.14 });
      // lucarne
      dormer(ctx, subFrame(F.S, 0, 0, -0.7, F.S.w, 10), u0 + (m ? 2.6 : uw - 2.6), eave + 0.7 * tn + 0.12, 1.4, 1.3, 2.6, { wallMat: 'rive', cheekMat: 'rive', roofMat: 'toiture', win: { leaves: 2, bars: 1 } });
      // muret et piliers de jardinet
      if (ctx.lod < 2) {
        const zf = z1 + 2.4;
        const gx = x0 + du(i, m);
        mb.box('facade', x0 + u0 + 0.05, 0, zf - 0.12, gx - 0.6, 0.75, zf + 0.12, 'ny');
        mb.box('facade', gx + 0.6, 0, zf - 0.12, x0 + u0 + uw - 0.05, 0.75, zf + 0.12, 'ny');
        mb.box('encadrement', x0 + u0 + 0.05, 0.75, zf - 0.15, gx - 0.6, 0.83, zf + 0.15, 'ny');
        mb.box('encadrement', gx + 0.6, 0.75, zf - 0.15, x0 + u0 + uw - 0.05, 0.83, zf + 0.15, 'ny');
        for (const px of [gx - 0.6, gx + 0.6]) mb.box('facade', px - 0.2, 0, zf - 0.2, px + 0.2, 1.2, zf + 0.2, 'ny');
        mb.box('soubassement', gx - 0.45, 0, z1, gx + 0.45, 0.05, zf, 'ny nz pz');
      }
    }
    function du(i: number, m: boolean): number { return i * uw + (m ? 0.95 : uw - 0.95); }
    for (let i = 0; i <= n; i++) chimney(ctx, x0 + i * uw + (i === 0 ? 0.4 : i === n ? -0.4 : 0), -0.6, i === 0 || i === n ? 0.6 : 0.8, 0.9, eave, roof.ridgeY + 0.75, { pots: i === 0 || i === n ? 2 : 4 });
    for (let i = 1; i < n; i += 2) downpipe(ctx, F.S, i * uw + uw, roof.eaveY);
  },
};

/* ------------------------------------------------------------------ */
/* 9. Trois maisons de ville contemporaines mitoyennes                  */
/* ------------------------------------------------------------------ */
export const mitoyennesModernes: BuildingDef = {
  id: 'mitoyennes_modernes',
  nameFr: 'Maisons de ville contemporaines mitoyennes',
  category: 'townhouse',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 165000,
  upkeepPerMonth: 220,
  residents: 14,
  jobs: 0,
  density: 'moyenne',
  style: 'contemporain',
  tags: ['mitoyen', 'toit-terrasse', 'bardage', 'brique'],
  source: `${SRC}#mitoyennesModernes`,
  palette: basePalette({
    facade: { set: 'enduit_blanc', color: '#f5f3ee' },
    facade_b: { set: 'bardage_bois', color: '#ffffff' },
    facade_c: { set: 'brique_parement', color: '#ffffff' },
    menuiserie: { set: 'bardage_blanc', color: '#33373b' },
    porte: { set: 'bardage_bois', color: '#ffffff' },
    zinc: { set: 'metal_larme', color: '#3a3d40', metalness: 1, roughness: 0.5 },
    dalle: { set: 'beton_facade', color: '#dcd8d0' },
    vegetal: { set: 'terrain_herbe', color: '#7fa05a' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Blanc, bois et brique' },
    { id: 'gris', nameFr: 'Béton, composite et brique sombre', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#e0ddd6' }, facade_b: { textureSet: 'bardage_composite', color: '#ffffff' } } },
    { id: 'clair', nameFr: 'Blanc, bois blanchi, carreaux', materialOverrides: { facade_b: { textureSet: 'bardage_blanc', color: '#e9e3d8' }, facade_c: { textureSet: 'carreaux_facade', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const { mb } = ctx;
    const uw = 6.5;
    const units = ['facade', 'facade_b', 'facade_c'];
    const heights = [9.3, 10.1, 9.3];
    const z0 = -5.0, z1 = 5.0;
    const X0 = -uw * 1.5;
    const g = { sill: false, shutters: 'none' as const, frameW: 0.05, reveal: 0.14 };
    units.forEach((mat, i) => {
      const x0 = X0 + i * uw;
      const x1 = x0 + uw;
      const h = heights[i]!;
      const rec = 1.3; // entrée en retrait
      const hidden: ('E' | 'W')[] = [];
      if (i > 0) hidden.push('W');
      if (i < 2) hidden.push('E');
      const S: OpeningSpec[] = [
        { kind: 'loggia', r: { u0: 0.4, u1: 2.3, v0: 0.05, v1: 2.75 }, o: { depth: rec, rail: 'verre', backMat: 'facade_b', win: { leaves: 1 } } },
        { kind: 'window', r: rectAt(4.4, 3.2, 0.25, 2.4), o: { ...g, leaves: 3 } },
        { kind: 'window', r: rectAt(3.25, 4.6, 3.35, 2.3), o: { ...g, leaves: 3 } },
        { kind: 'window', r: rectAt(i === 1 ? 3.25 : 2.2, i === 1 ? 4.6 : 2.6, 6.45, i === 1 ? 2.6 : 1.5), o: { ...g, leaves: 2 } },
      ];
      volume(ctx, {
        x0, x1, z0, z1, h, wallMat: mat, hidden,
        sides: {
          S,
          N: [{ kind: 'window', r: rectAt(3.25, 4.0, 0.1, 2.5), o: { ...g, leaves: 4 } }, ...row([1.8, 4.7], 1.4, 3.6, 1.6, () => ({ kind: 'window', o: g })), ...row([3.25], 2.4, 6.7, 1.5, () => ({ kind: 'window', o: g }))],
          W: i === 0 ? row([3.0, 7.0], 0.8, 3.6, 1.8, () => ({ kind: 'window', o: g })) : [],
          E: i === 2 ? row([3.0, 7.0], 0.8, 3.6, 1.8, () => ({ kind: 'window', o: g })) : [],
        },
      });
      // balconnet vitré au premier étage
      balcony(ctx, { o: [x0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w: uw, h }, 0.9, 5.6, 3.35, { depth: 0.9, rail: 'verre', slab: 0.18 });
      // toiture-terrasse avec jardin
      flatRoof(ctx, { x0, x1, z0, z1, y: h - 0.35, parapet: h, t: 0.2, wallMat: mat });
      mb.box('vegetal', x0 + 0.5, h - 0.35, z0 + 0.5, x0 + 2.6, h - 0.05, z0 + 3.5, 'ny');
      if (i === 1) stairHouse(ctx, x0 + 3.6, z0 + 0.6, x0 + 5.9, z0 + 3.0, h - 0.35, 2.5, mat);
      else railing(ctx, [x0 + 0.3, h, z1 - 0.3], [x1 - 0.3, h, z1 - 0.3], 0.9, 'verre');
      // descente d'eaux pluviales, boîte aux lettres, borne lumineuse
      downpipe(ctx, { o: [x0, 0, z1], u: [1, 0, 0], n: [0, 0, 1], w: uw, h }, i === 0 ? 0.15 : uw - 0.15, h - 0.2);
      if (ctx.lod < 2) {
        mb.box('garde_corps', x0 + 2.55, 0.9, z1 + 0.02, x0 + 2.9, 1.25, z1 + 0.14, 'nz');
        mb.cylinder('garde_corps', x0 + 0.5, 0, z1 + 1.6, 0.07, 0.8, 10, true);
      }
    });
    // séparations de jardins arrière (murets)
    if (ctx.lod < 2) for (let i = 0; i <= 3; i++) mb.box('dalle', X0 + i * uw - 0.1, 0, z0 - 3.0, X0 + i * uw + 0.1, 1.6, z0, 'ny');
  },
};

/* ------------------------------------------------------------------ */
/* 10. Petit immeuble enduit (R+3) à toit en croupe et balcons           */
/* ------------------------------------------------------------------ */
export const petitImmeubleEnduit: BuildingDef = {
  id: 'immeuble_petit_enduit',
  nameFr: 'Petit immeuble enduit à balcons',
  category: 'apartment_low',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 260000,
  upkeepPerMonth: 380,
  residents: 28,
  jobs: 0,
  density: 'moyenne',
  style: 'residence_1960',
  tags: ['immeuble', 'balcons', 'tuiles', 'volets-roulants'],
  source: `${SRC}#petitImmeubleEnduit`,
  palette: basePalette({
    facade: { set: 'enduit_creme', color: '#f6e9d3' },
    encadrement: { set: 'enduit_blanc', color: '#ffffff' },
    soubassement: { set: 'pierre_taille', color: '#a8a296' },
    dalle: { set: 'beton_facade', color: '#e8e4dc' },
    garde_corps: { set: 'metal_larme', color: '#e9e7e2', metalness: 1, roughness: 0.6 },
    porte: { set: 'bardage_blanc', color: '#4d5f6b' },
    store: { set: 'metal_rideau', color: '#e6e4de' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit crème, garde-corps blancs' },
    { id: 'saumon', nameFr: 'Enduit saumon, garde-corps sombres', materialOverrides: { facade: { color: '#f0c9ae' }, garde_corps: { color: '#33373b' } } },
    { id: 'gris', nameFr: 'Enduit gris clair, tuiles grises', materialOverrides: { facade: { textureSet: 'enduit_peint', color: '#e2e2de' }, toiture: { textureSet: 'toit_tuiles_grises', color: '#ffffff' }, poterie: { textureSet: 'toit_tuiles_grises', color: '#8c8c88' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -7.4, x1 = 7.4, z0 = -5.4, z1 = 5.4;
    const fl = 0.6;
    const fh = 2.95;
    const nF = 4;
    const eave = fl + nF * fh + 0.3;
    const us = bays(14.8, 5, 0.3);
    const win = { shutters: 'roulant' as const, surround: 0.1, leaves: 2 };
    const S: OpeningSpec[] = [];
    const N: OpeningSpec[] = [];
    for (let f = 0; f < nF; f++) {
      const v = fl + f * fh;
      us.forEach((u, i) => {
        if (f === 0 && i === 2) {
          S.push({ kind: 'door', r: rectAt(u, 1.7, 0.02, 2.75), o: { style: 'double', transom: 0.5, canopy: 'dalle', steps: 0.02 } });
          return;
        }
        if (i === 1 || i === 3) S.push({ kind: 'window', r: rectAt(u, 1.35, v + 0.02, 2.2), o: { ...win, sill: false } });
        else S.push({ kind: 'window', r: rectAt(u, 1.2, v + 0.95, 1.3), o: win });
        if (i === 2 && f > 0) N.push({ kind: 'window', r: rectAt(u, 1.0, v - fh / 2 + 1.2, 1.1), o: { surround: 0.1 } });
        else if (i !== 2) N.push({ kind: 'window', r: rectAt(u, i % 2 ? 1.35 : 1.1, i % 2 ? v + 0.02 : v + 0.95, i % 2 ? 2.2 : 1.3), o: { ...win, sill: !(i % 2) } });
      });
    }
    N.push({ kind: 'door', r: rectAt(us[2]!, 1.0, 0.02, 2.2), o: { style: 'vitree' } });
    const side = (): OpeningSpec[] => {
      const o: OpeningSpec[] = [];
      for (let f = 0; f < nF; f++) o.push(...row([3.4, 7.4], 1.0, fl + f * fh + 0.95, 1.3, () => ({ kind: 'window', o: win })));
      return o;
    };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: eave, wallMat: 'facade', sides: { S, N, E: side(), W: side() },
      plinth: { h: fl, d: 0.05 },
      bands: [{ v: fl + fh - 0.1, h: 0.12, d: 0.04 }],
    });
    for (let f = 1; f < nF; f++) {
      const v = fl + f * fh;
      for (const i of [1, 3]) {
        balcony(ctx, F.S, us[i]! - 1.35, us[i]! + 1.35, v + 0.02, { depth: 1.15, rail: 'barreaux' });
        balcony(ctx, F.N, us[i]! - 1.35, us[i]! + 1.35, v + 0.02, { depth: 1.0, rail: 'barreaux' });
      }
    }
    const roof = hipRoof(ctx, { x0, x1, z0, z1, y: eave, pitch: 28, overhang: 0.55 });
    chimney(ctx, -3.0, 0.8, 0.7, 0.6, eave, roof.ridgeY + 0.6, { pots: 3, mat: 'facade' });
    chimney(ctx, 3.0, -0.8, 0.7, 0.6, eave, roof.ridgeY + 0.6, { pots: 3, mat: 'facade' });
    downpipe(ctx, F.S, 0.2, roof.eaveY);
    downpipe(ctx, F.S, F.S.w - 0.2, roof.eaveY);
  },
};

/* ------------------------------------------------------------------ */
/* 11. Immeuble en brique des années 1930 à bow-windows                  */
/* ------------------------------------------------------------------ */
export const immeubleBrique30: BuildingDef = {
  id: 'immeuble_brique_1930',
  nameFr: 'Immeuble de briques années 1930',
  category: 'apartment_low',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 280000,
  upkeepPerMonth: 400,
  residents: 30,
  jobs: 0,
  density: 'moyenne',
  style: 'art_deco',
  tags: ['immeuble', 'brique', 'bow-windows', 'toit-terrasse'],
  source: `${SRC}#immeubleBrique30`,
  palette: basePalette({
    facade: { set: 'brique_orange', color: '#ffffff' },
    encadrement: { set: 'pierre_taille', color: '#efe9de' },
    soubassement: { set: 'pierre_taille', color: '#b6ae9f' },
    porte: { set: 'bardage_blanc', color: '#2c3338' },
    garde_corps: { set: 'metal_larme', color: '#2b2e31', metalness: 1, roughness: 0.55 },
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique orangée et pierre' },
    { id: 'rouge', nameFr: 'Brique rouge sombre', materialOverrides: { facade: { textureSet: 'brique_rouge' } } },
    { id: 'blond', nameFr: 'Brique de parement blonde', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#f2ddc4' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -7.2, x1 = 7.2, z0 = -5.6, z1 = 5.6;
    const fh = 3.0;
    const nF = 4;
    const top = nF * fh + 0.4;
    const parapet = top + 0.9;
    const win = { lintel: true, bars: 1, shutters: 'none' as const, leaves: 2, surroundMat: 'encadrement' };
    // façade principale : bow-windows aux travées 1 et 4, entrée au centre
    const us = [1.6, 4.4, 7.2, 10.0, 12.8];
    const S: OpeningSpec[] = [];
    for (let f = 0; f < nF; f++) {
      const v = f * fh;
      for (const [i, u] of us.entries()) {
        if (f === 0 && i === 2) { S.push({ kind: 'door', r: rectAt(u, 1.6, 0.25, 2.9), o: { style: 'vitree', transom: 0.6, steps: 0.25, surround: 0.3, canopy: 'dalle' } }); continue; }
        if (i === 0 || i === 4) { if (f === 0) S.push({ kind: 'window', r: rectAt(u, 1.2, 1.0, 1.4), o: win }); continue; }
        S.push({ kind: 'window', r: rectAt(u, i === 2 ? 1.0 : 1.3, v + 0.95, 1.55), o: win });
      }
    }
    const N: OpeningSpec[] = [];
    for (let f = 0; f < nF; f++) N.push(...row(us, 1.2, f * fh + 0.95, 1.5, () => ({ kind: 'window', o: win })));
    const side = (): OpeningSpec[] => { const o: OpeningSpec[] = []; for (let f = 0; f < nF; f++) o.push(...row([2.8, 8.4], 1.1, f * fh + 0.95, 1.5, () => ({ kind: 'window', o: win }))); return o; };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: parapet, wallMat: 'facade', sides: { S, N, E: side(), W: side() },
      plinth: { h: 0.9, d: 0.06, mat: 'soubassement' },
      bands: [{ v: fh - 0.1, h: 0.2, d: 0.06 }, { v: top - 0.15, h: 0.15, d: 0.05 }],
      cornice: { profile: [[0.12, 0.05], [0.18, 0.14]], v: parapet - 0.3 },
    });
    flatRoof(ctx, { x0, x1, z0, z1, y: top, parapet, t: 0.3, copingMat: 'encadrement' });
    // bow-windows verticaux (étages 1 à 3)
    for (const u of [us[0]!, us[4]!]) {
      const bx0 = x0 + u - 1.5, bx1 = x0 + u + 1.5;
      const bz1 = z1 + 0.8;
      const y0b = fh;
      const hb = (nF - 1) * fh;
      const bs: OpeningSpec[] = [];
      const be: OpeningSpec[] = [];
      for (let f = 0; f < nF - 1; f++) {
        bs.push({ kind: 'window', r: rectAt(1.5, 2.2, f * fh + 0.85, 1.6), o: { ...win, leaves: 3, lintel: false } });
        be.push({ kind: 'window', r: rectAt(0.4, 0.42, f * fh + 0.85, 1.6), o: { shutters: 'none', leaves: 1 } });
      }
      volume(ctx, { x0: bx0, x1: bx1, z0: z1, z1: bz1, y0: y0b, h: hb, wallMat: 'facade', hidden: ['N'], sides: { S: bs, E: be, W: be }, bands: Array.from({ length: nF - 2 }, (_, f) => ({ v: (f + 1) * fh - 0.1, h: 0.2, d: 0.05 })) });
      // fond de bow-window (dessous) et couronnement
      ctx.mb.quad('encadrement', [bx0, y0b, bz1], [bx0, y0b, z1], [bx1, y0b, z1], [bx1, y0b, bz1]);
      fbox(ctx, 'encadrement', { o: [bx0, 0, bz1], u: [1, 0, 0], n: [0, 0, 1], w: 3, h: 20 }, -0.1, 3.1, y0b - 0.35, y0b, -0.8, 0.08, 'back top');
      ctx.mb.box('encadrement', bx0 - 0.08, y0b + hb, z1, bx1 + 0.08, y0b + hb + 0.25, bz1 + 0.1, 'nz');
      railing(ctx, [bx0 + 0.1, y0b + hb + 0.25, bz1], [bx1 - 0.1, y0b + hb + 0.25, bz1], 0.8, 'fer');
    }
    // édicule et garde-corps de toit
    stairHouse(ctx, -1.8, -4.2, 1.8, -1.4, top, 2.6, 'facade');
    rooftopUnit(ctx, 4.2, top, -2.5, 1.6, 1.0, 0.9);
    mast(ctx, -4.5, top, -3.0, 3.2);
    downpipe(ctx, F.N, 0.25, parapet - 0.2);
    downpipe(ctx, F.N, F.N.w - 0.25, parapet - 0.2);
  },
};

/* ------------------------------------------------------------------ */
/* 12. Immeuble haussmannien (R+5 + combles) avec commerces              */
/* ------------------------------------------------------------------ */
export const haussmannien: BuildingDef = {
  id: 'immeuble_haussmannien',
  nameFr: 'Immeuble haussmannien à commerces',
  category: 'apartment_mid',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 620000,
  upkeepPerMonth: 900,
  residents: 46,
  jobs: 12,
  density: 'forte',
  style: 'haussmannien',
  tags: ['immeuble', 'pierre-de-taille', 'commerces', 'balcons-filants', 'mansarde'],
  source: `${SRC}#haussmannien`,
  frontage: [{ x: -6.0, z: 6.6, nx: 0, nz: 1, kind: 'delivery' }],
  lodDistances: [180, 700],
  palette: basePalette({
    facade: { set: 'pierre_taille', color: '#f6efe2' },
    encadrement: { set: 'pierre_taille', color: '#fbf6ec' },
    soubassement: { set: 'pierre_taille', color: '#d9d1c2' },
    toiture: { set: 'toit_ardoise', color: '#7d8590' },
    zinc: { set: 'toit_tole_ondulee', color: '#b8bcc0', metalness: 1, roughness: 0.5 },
    garde_corps: { set: 'metal_larme', color: '#1f2224', metalness: 1, roughness: 0.6 },
    menuiserie: { set: 'bardage_blanc', color: '#f6f4ef' },
    volet: { set: 'metal_rideau', color: '#e8e4dc' },
    porte: { set: 'bois_volet', color: '#9a7a5a' },
    enseigne: { set: 'enduit_blanc', color: '#2f4f45' },
    enseigne2: { set: 'enduit_blanc', color: '#7a2f2a' },
    cheminee: { set: 'enduit_creme', color: '#e7d6c0' },
    poterie: { set: 'toit_tuiles', color: '#c47f5a' },
    store: { set: 'metal_rideau', color: '#bfbcb5' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Pierre blonde, devantures vert et bordeaux' },
    { id: 'creme', nameFr: 'Pierre crème, devantures noires', materialOverrides: { facade: { color: '#ede0c9' }, enseigne: { color: '#1e2224' }, enseigne2: { color: '#3d4a6b' } } },
    { id: 'patine', nameFr: 'Pierre patinée, toit de zinc', materialOverrides: { facade: { color: '#ddd2bf' }, encadrement: { color: '#e6dccb' }, toiture: { textureSet: 'toit_tole_ondulee', color: '#a9aeb3' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -10.4, x1 = 10.4, z0 = -6.6, z1 = 6.6;
    const W = x1 - x0;
    const rdc = 4.4;
    const levels = [rdc, rdc + 3.4, rdc + 6.6, rdc + 9.7, rdc + 12.8, rdc + 15.8];
    const top = rdc + 15.8;
    const us = bays(W, 7, 0.25);
    const fr = { sill: false, leaves: 2, bars: 2, shutters: 'none' as const, surround: 0.16, keystone: true, reveal: 0.25 };
    const S: OpeningSpec[] = [];
    // rez-de-chaussée : deux boutiques et porte cochère au centre
    const shopW = us[2]! - us[0]! + 2.0;
    S.push({ kind: 'shop', r: { u0: us[0]! - 1.0, u1: us[0]! - 1.0 + shopW, v0: 0.05, v1: 3.5 }, o: { awning: true, doorAt: 'right' } });
    S.push({ kind: 'door', r: rectAt(us[3]!, 2.0, 0.05, 3.7), o: { style: 'double', transom: 0.8, surround: 0.25, doorMat: 'porte' } });
    S.push({ kind: 'shop', r: { u0: us[6]! + 1.0 - shopW, u1: us[6]! + 1.0, v0: 0.05, v1: 3.5 }, o: { awning: true, doorAt: 'left', signMat: 'enseigne2' } });
    for (let f = 1; f < levels.length; f++) {
      const lv = levels[f - 1]!;
      const h = f === 1 ? 2.75 : f === 5 ? 2.25 : 2.5;
      const railing2 = f === 2 || f === 5 ? undefined : ('fer' as const);
      S.push(...row(us, 1.25, lv + 0.08, h, () => ({ kind: 'window', o: { ...fr, railing: railing2 ?? null, keystone: f < 4 } })));
    }
    const N: OpeningSpec[] = [];
    for (let f = 0; f < levels.length - 1; f++) N.push(...row(us.filter((_, i) => i % 2 === 0), 1.1, levels[f]! + 0.9, 1.6, () => ({ kind: 'window', o: { surround: 0, shutters: 'battants', closedRatio: 0.2 } })));
    const F = volume(ctx, {
      x0, x1, z0, z1, h: top, wallMat: 'facade',
      sides: { S, N },
      sideMat: { E: 'cheminee', W: 'cheminee' },
      plinth: { h: 0.45, d: 0.04 },
      bands: [{ v: rdc - 0.3, h: 0.3, d: 0.12 }, { v: levels[1]! - 0.12, h: 0.14, d: 0.06 }, { v: levels[3]! - 0.12, h: 0.14, d: 0.06 }],
      cornice: { profile: [[0.12, 0.05], [0.16, 0.18], [0.2, 0.32], [0.1, 0.4]], v: top - 0.58 },
    });
    // bossages du rez-de-chaussée (refends horizontaux)
    if (ctx.lod === 0) for (let v = 0.9; v < rdc - 0.4; v += 0.5) {
      for (const [a, b] of [[-0.05, us[0]! - 1.05], [us[2]! + 1.05, us[3]! - 1.3], [us[3]! + 1.3, us[4]! - 1.05], [us[6]! + 1.05, W + 0.05]] as const) {
        if (b > a) fbox(ctx, 'facade', F.S, a, b, v, v + 0.03, -0.02, 0.02, 'back');
      }
    }
    // balcons filants (2e et 5e étages) en fer forgé sur consoles
    balcony(ctx, F.S, 0.1, W - 0.1, levels[1]!, { depth: 0.85, rail: 'fer', consoles: true, slabMat: 'encadrement', slab: 0.2 });
    balcony(ctx, F.S, 0.1, W - 0.1, levels[4]!, { depth: 0.7, rail: 'fer', consoles: true, slabMat: 'encadrement', slab: 0.18 });
    // combles mansardés + lucarnes
    const m = mansardRoof(ctx, { x0, x1, z0, z1, y: top, lowerH: 3.0, inset: 1.1, upperPitch: 12 });
    for (const side of [F.S, F.N]) for (const u of us) {
      const fr2 = subFrame(side, 0, 0, -0.35, side.w, 10);
      dormer(ctx, fr2, u, top + 0.9, 1.2, 1.5, 0.9, { wallMat: 'encadrement', cheekMat: 'zinc', roofMat: 'zinc', pitch: 35, win: { leaves: 2, bars: 1 } });
    }
    // souches de cheminées mitoyennes
    for (const x of [x0 + 0.45, x1 - 0.45]) for (const z of [-3.2, 0.2, 3.4]) chimney(ctx, x, z, 0.7, 2.2, top, m.top + 1.4, { pots: 5, mat: 'cheminee', capMat: 'encadrement' });
    downpipe(ctx, F.N, 0.2, top - 0.6);
    downpipe(ctx, F.N, W - 0.2, top - 0.6);
  },
};

/* ------------------------------------------------------------------ */
/* 13. Immeuble contemporain R+6 à commerces, loggias et attique         */
/* ------------------------------------------------------------------ */
export const immeubleCommercesModerne: BuildingDef = {
  id: 'immeuble_commerces_moderne',
  nameFr: 'Immeuble contemporain à commerces et loggias',
  category: 'apartment_mid',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 680000,
  upkeepPerMonth: 950,
  residents: 58,
  jobs: 18,
  density: 'forte',
  style: 'contemporain',
  tags: ['immeuble', 'commerces', 'loggias', 'attique', 'toit-terrasse'],
  source: `${SRC}#immeubleCommercesModerne`,
  frontage: [{ x: -8.0, z: -6.4, nx: 0, nz: -1, kind: 'vehicle' }, { x: 7.0, z: 6.4, nx: 0, nz: 1, kind: 'delivery' }],
  lodDistances: [180, 700],
  palette: basePalette({
    facade: { set: 'enduit_blanc', color: '#f7f6f2' },
    facade_b: { set: 'bardage_composite', color: '#ffffff' },
    accent: { set: 'enduit_blanc', color: '#d9a05b' },
    soubassement: { set: 'carreaux_facade', color: '#ffffff' },
    menuiserie: { set: 'bardage_blanc', color: '#3a3f44' },
    dalle: { set: 'beton_facade', color: '#eceae4' },
    enseigne: { set: 'enduit_blanc', color: '#2e5d7a' },
    garde_corps: { set: 'metal_larme', color: '#3a3f44', metalness: 1, roughness: 0.5 },
    store: { set: 'metal_rideau', color: '#cfcdc7' },
    vegetal: { set: 'terrain_herbe', color: '#7fa05a' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Blanc, loggias ocre' },
    { id: 'bleu', nameFr: 'Blanc, loggias bleu ardoise', materialOverrides: { accent: { color: '#5b7a99' }, enseigne: { color: '#8a3b2e' } } },
    { id: 'brique', nameFr: 'Brique et composite, loggias vertes', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#ffffff' }, accent: { color: '#7d9a6a' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -11.0, x1 = 11.0, z0 = -6.4, z1 = 6.4;
    const W = x1 - x0;
    const rdc = 4.2;
    const fh = 3.0;
    const nF = 5;
    const top = rdc + nF * fh;
    const g = { sill: false, shutters: 'roulant' as const, frameW: 0.06, reveal: 0.16, leaves: 2 };
    const us = bays(W, 6, 0.3);
    const S: OpeningSpec[] = [];
    S.push({ kind: 'shop', r: { u0: 0.4, u1: 7.4, v0: 0.05, v1: 3.4 }, o: { awning: true, doorAt: 'left' } });
    S.push({ kind: 'door', r: rectAt(W / 2, 1.8, 0.05, 2.8), o: { style: 'moderne', transom: 0.6, canopy: 'verre' } });
    S.push({ kind: 'shop', r: { u0: W - 7.4, u1: W - 0.4, v0: 0.05, v1: 3.4 }, o: { awning: false, doorAt: 'right', shutterDown: 0.3 } });
    const N: OpeningSpec[] = [];
    for (let f = 0; f < nF; f++) {
      const v = rdc + f * fh;
      us.forEach((u, i) => {
        const loggiaHere = (i + f) % 3 === 0;
        if (loggiaHere) S.push({ kind: 'loggia', r: rectAt(u, 2.9, v + 0.05, 2.75), o: { depth: 1.5, rail: 'verre', backMat: 'accent', win: { shutters: 'roulant' } } });
        else S.push({ kind: 'window', r: rectAt(u, 1.6, v + 0.15, 2.3), o: { ...g, railing: 'verre' } });
        N.push({ kind: 'window', r: rectAt(u, i % 2 ? 1.2 : 1.6, v + (i % 2 ? 0.95 : 0.15), i % 2 ? 1.4 : 2.3), o: { ...g, sill: i % 2 === 1, railing: i % 2 ? null : 'barreaux' } });
      });
    }
    N.push({ kind: 'door', r: rectAt(W / 2, 1.2, 0.05, 2.3), o: { style: 'moderne' } });
    N.push(...row([3.0, W - 3.0], 3.2, 0.05, 2.9, () => ({ kind: 'garage' })));
    const side = (): OpeningSpec[] => { const o: OpeningSpec[] = []; for (let f = 0; f < nF; f++) o.push(...row([3.2, 9.6], 1.4, rdc + f * fh + 0.15, 2.3, () => ({ kind: 'window', o: { ...g, railing: 'barreaux' } }))); return o; };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: top + 0.4, wallMat: 'facade', sides: { S, N, E: side(), W: side() },
      plinth: { h: rdc - 0.2, d: 0.03, mat: 'soubassement' },
      bands: [{ v: rdc - 0.2, h: 0.35, d: 0.12, mat: 'dalle' }],
    });
    void F;
    flatRoof(ctx, { x0, x1, z0, z1, y: top, parapet: top + 0.4, t: 0.25, copingMat: 'dalle' });
    // attique en retrait (terrasses plantées)
    const a = { x0: x0 + 2.2, x1: x1 - 2.2, z0: z0 + 1.0, z1: z1 - 2.4 };
    const aw = a.x1 - a.x0;
    volume(ctx, {
      ...a, y0: top, h: 3.1, wallMat: 'facade_b',
      sides: {
        S: row(bays(aw, 5, 0.4), 2.4, 0.1, 2.5, () => ({ kind: 'window', o: { ...g, shutters: 'none', leaves: 3 } })),
        N: row(bays(aw, 5, 0.4), 1.4, 0.9, 1.5, () => ({ kind: 'window', o: { ...g, shutters: 'none' } })),
        E: row([2.0], 1.4, 0.1, 2.5, () => ({ kind: 'window', o: { ...g, shutters: 'none' } })),
        W: row([2.0], 1.4, 0.1, 2.5, () => ({ kind: 'window', o: { ...g, shutters: 'none' } })),
      },
    });
    ctx.mb.box('dalle', a.x0 - 0.6, top + 3.1, a.z0 - 0.4, a.x1 + 0.6, top + 3.35, a.z1 + 1.2, '');
    railing(ctx, [x0 + 0.3, top + 0.4, z1 - 0.3], [x1 - 0.3, top + 0.4, z1 - 0.3], 0.7, 'verre');
    for (const sx of [x0 + 0.5, x1 - 2.0]) ctx.mb.box('vegetal', sx, top, z1 - 2.0, sx + 1.5, top + 0.55, z1 - 0.5, 'ny');
    rooftopUnit(ctx, a.x0 + 2.5, top + 3.35, a.z0 + 1.6, 2.2, 1.3, 1.1);
    rooftopUnit(ctx, a.x1 - 2.5, top + 3.35, a.z0 + 1.6, 1.6, 1.1, 0.9);
    void cornice; void gableRoof; void COLORS;
  },
};

export const COLLECTIVE: BuildingDef[] = [mitoyennesBrique, mitoyennesModernes, petitImmeubleEnduit, immeubleBrique30, haussmannien, immeubleCommercesModerne];

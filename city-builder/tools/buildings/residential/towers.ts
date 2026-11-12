/**
 * Haute densité (`apartment_high`) : barre moderne, résidence en gradins, tours résidentielles.
 */
import {
  balcony, basePalette, bays, fbox, flatRoof, mast, pilaster, railing, rectAt, rooftopUnit, row, stairHouse, volume,
  type BuildingDef, type Ctx, type Frame, type OpeningSpec, type Side,
} from '../kit/index';

const SRC = 'tools/buildings/residential/towers.ts';

/* ------------------------------------------------------------------ */
/* 14. Barre de logements R+9                                          */
/* ------------------------------------------------------------------ */
export const barreModerne: BuildingDef = {
  id: 'barre_logements_r9',
  nameFr: 'Barre de logements R+9',
  category: 'apartment_high',
  footprint: { tilesX: 5, tilesZ: 2 },
  cost: 1450000,
  upkeepPerMonth: 1900,
  residents: 210,
  jobs: 0,
  density: 'tres_forte',
  style: 'grand_ensemble',
  tags: ['immeuble', 'barre', 'balcons', 'toit-terrasse'],
  source: `${SRC}#barreModerne`,
  lodDistances: [200, 800],
  palette: basePalette({
    facade: { set: 'enduit_peint', color: '#f1efea' },
    facade_b: { set: 'enduit_blanc', color: '#c96f4a' },
    soubassement: { set: 'carreaux_facade', color: '#ffffff' },
    dalle: { set: 'beton_facade', color: '#e6e2da' },
    menuiserie: { set: 'bardage_blanc', color: '#f2f2ee' },
    store: { set: 'metal_rideau', color: '#e8e6e0' },
    porte: { set: 'bardage_blanc', color: '#3c4246' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit clair, panneaux terre cuite' },
    { id: 'bleu', nameFr: 'Enduit clair, panneaux bleus', materialOverrides: { facade_b: { color: '#4f7aa0' } } },
    { id: 'vert', nameFr: 'Béton brut, panneaux vert d’eau', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#e3e6e8' }, facade_b: { color: '#7fae9b' } } },
    { id: 'haute', nameFr: 'Enduit clair, panneaux jaunes (R+11)', heightScale: 1.18, materialOverrides: { facade_b: { color: '#d9b44a' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -19, x1 = 19, z0 = -6, z1 = 6;
    const W = x1 - x0;
    const rdc = 3.4;
    const fh = 2.85;
    const nF = 9;
    const top = rdc + nF * fh;
    const us = bays(W, 12, 0.2);
    const win = { shutters: 'roulant' as const, frameW: 0.06, reveal: 0.16, leaves: 2, sill: true };
    const S: OpeningSpec[] = [];
    const N: OpeningSpec[] = [];
    const halls = [2, 6, 10];
    us.forEach((u, i) => {
      if (halls.includes(i)) {
        S.push({ kind: 'door', r: rectAt(u, 2.2, 0.05, 2.7), o: { style: 'moderne', transom: 0.5, canopy: 'dalle' } });
        N.push({ kind: 'door', r: rectAt(u, 1.2, 0.05, 2.3), o: { style: 'moderne' } });
      } else {
        S.push({ kind: 'window', r: rectAt(u, 1.4, 1.2, 1.4), o: { ...win } });
        N.push({ kind: 'window', r: rectAt(u, 1.2, 1.2, 1.4), o: { ...win } });
      }
    });
    for (let f = 0; f < nF; f++) {
      const v = rdc + f * fh;
      us.forEach((u, i) => {
        const pair = Math.floor(i / 2);
        const bal = (pair + f) % 2 === 0;
        S.push({ kind: 'window', r: rectAt(u, bal ? 1.6 : 1.3, bal ? v + 0.05 : v + 0.9, bal ? 2.2 : 1.35), o: { ...win, sill: !bal } });
        if (halls.includes(i)) N.push({ kind: 'window', r: rectAt(u, 1.0, v - 1.0, 1.2), o: { ...win, shutters: 'none' } });
        else N.push({ kind: 'window', r: rectAt(u, i % 3 === 0 ? 1.5 : 1.1, v + 0.9, 1.35), o: win });
      });
    }
    const pign = (): OpeningSpec[] => { const o: OpeningSpec[] = []; for (let f = 0; f < nF; f++) o.push(...row([6.0], 0.9, rdc + f * fh + 0.9, 1.3, () => ({ kind: 'window', o: { ...win, shutters: 'none' } }))); return o; };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: top + 0.6, wallMat: 'facade', sides: { S, N, E: pign(), W: pign() },
      plinth: { h: rdc - 0.3, d: 0.03, mat: 'soubassement' },
      bands: [{ v: rdc - 0.3, h: 0.3, d: 0.08, mat: 'dalle' }],
    });
    // balcons par paires de travées, en damier, à allège pleine colorée
    for (let f = 1; f <= nF; f++) {
      const v = rdc + (f - 1) * fh;
      for (let p = 0; p < 6; p++) {
        if ((p + f - 1) % 2 !== 0) continue;
        const a = us[p * 2]! - 1.45;
        const b = us[p * 2 + 1]! + 1.45;
        balcony(ctx, F.S, a, b, v + 0.02, { depth: 1.3, rail: 'plein', slabMat: 'dalle', slab: 0.18, railH: 1.0 });
        if (ctx.lod < 2) fbox(ctx, 'facade_b', F.S, a + 0.02, b - 0.02, v + 0.25, v + 0.95, 1.3, 1.33, 'back');
      }
    }
    // bandes colorées sur les pignons
    for (const fr of [F.E, F.W]) pilaster(ctx, 'facade_b', fr, 9.0, 1.6, rdc, top + 0.6, 0.06);
    flatRoof(ctx, { x0, x1, z0, z1, y: top, parapet: top + 0.6, t: 0.25, copingMat: 'dalle' });
    for (const i of halls) stairHouse(ctx, x0 + us[i]! - 1.6, -3.0, x0 + us[i]! + 1.6, 0.5, top, 2.8, 'facade');
    rooftopUnit(ctx, -12, top, 2.5, 2.4, 1.2, 1.1);
    rooftopUnit(ctx, 9, top, 2.5, 2.4, 1.2, 1.1);
    mast(ctx, 1.5, top, -4.5, 4);
  },
};

/* ------------------------------------------------------------------ */
/* 15. Résidence en gradins (R+8 / R+6 / R+4) à terrasses plantées       */
/* ------------------------------------------------------------------ */
export const residenceGradins: BuildingDef = {
  id: 'residence_gradins',
  nameFr: 'Résidence en gradins à terrasses plantées',
  category: 'apartment_high',
  footprint: { tilesX: 5, tilesZ: 2 },
  cost: 1300000,
  upkeepPerMonth: 1700,
  residents: 170,
  jobs: 0,
  density: 'tres_forte',
  style: 'contemporain',
  tags: ['immeuble', 'gradins', 'terrasses', 'vegetalisation', 'brique'],
  source: `${SRC}#residenceGradins`,
  lodDistances: [200, 800],
  palette: basePalette({
    facade: { set: 'brique_parement', color: '#ffffff' },
    facade_b: { set: 'enduit_blanc', color: '#f4f2ec' },
    dalle: { set: 'beton_facade', color: '#eeebe4' },
    menuiserie: { set: 'bardage_blanc', color: '#2f3337' },
    soubassement: { set: 'beton_facade', color: '#bdb8ae' },
    vegetal: { set: 'terrain_herbe', color: '#86a85c' },
    bois: { set: 'bardage_bois', color: '#f0e0cc' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique sombre et béton blanc' },
    { id: 'claire', nameFr: 'Brique orangée', materialOverrides: { facade: { textureSet: 'brique_orange' } } },
    { id: 'bois', nameFr: 'Bardage bois et béton', materialOverrides: { facade: { textureSet: 'bardage_bois', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const z0 = -7, z1 = 7;
    const rdc = 3.3;
    const fh = 2.9;
    const blocks = [{ x0: -18, x1: -6, n: 8 }, { x0: -6, x1: 6, n: 6 }, { x0: 6, x1: 18, n: 4 }];
    const g = { sill: false, shutters: 'none' as const, frameW: 0.06, reveal: 0.18, leaves: 3 };
    blocks.forEach((b, bi) => {
      const top = rdc + b.n * fh;
      const w = b.x1 - b.x0;
      const us = bays(w, 4, 0.3);
      const S: OpeningSpec[] = [];
      const N: OpeningSpec[] = [];
      us.forEach((u, i) => {
        if (i === 1) S.push({ kind: 'door', r: rectAt(u, 1.8, 0.05, 2.6), o: { style: 'moderne', canopy: 'verre' } });
        else S.push({ kind: 'window', r: rectAt(u, 2.2, 0.6, 2.0), o: { ...g, sill: true } });
        N.push({ kind: 'window', r: rectAt(u, 1.6, 0.9, 1.6), o: { ...g, leaves: 2, sill: true } });
      });
      for (let f = 0; f < b.n; f++) {
        const v = rdc + f * fh;
        S.push(...row(us, 2.4, v + 0.05, 2.35, () => ({ kind: 'window', o: g })));
        N.push(...row(us, 1.5, v + 0.85, 1.45, () => ({ kind: 'window', o: { ...g, leaves: 2, sill: true } })));
      }
      // pignon est exposé au-dessus du bloc suivant
      const next = blocks[bi + 1];
      const exposedFrom = next ? rdc + next.n * fh + 0.4 : 0;
      const E: OpeningSpec[] = [];
      for (let f = 0; f < b.n; f++) {
        const v = rdc + f * fh;
        if (v < exposedFrom) continue;
        E.push(...row([3.5, 10.5], 1.6, v + 0.05, 2.3, () => ({ kind: 'window', o: g })));
      }
      if (!next) E.push(...Array.from({ length: b.n }, (_, f) => ({ kind: 'window' as const, r: rectAt(7, 1.4, rdc + f * fh + 0.85, 1.45), o: { ...g, leaves: 2, sill: true } })));
      const W: OpeningSpec[] = bi === 0 ? Array.from({ length: b.n }, (_, f) => ({ kind: 'window' as const, r: rectAt(7, 1.4, rdc + f * fh + 0.85, 1.45), o: { ...g, leaves: 2, sill: true } })) : [];
      const F = volume(ctx, {
        x0: b.x0, x1: b.x1, z0, z1, h: top + 0.4, wallMat: 'facade',
        hidden: bi > 0 ? ['W'] : [],
        sides: { S, N, E, W },
        plinth: { h: rdc - 0.2, d: 0.04, mat: 'soubassement' },
      });
      // balcons filants en béton blanc à garde-corps vitré
      for (let f = 0; f < b.n; f++) {
        const v = rdc + f * fh;
        balcony(ctx, F.S, 0.15, w - 0.15, v + 0.02, { depth: 1.6, rail: 'verre', slabMat: 'facade_b', slab: 0.22, sides: 'both' });
      }
      flatRoof(ctx, { x0: b.x0, x1: b.x1, z0, z1, y: top, parapet: top + 0.4, t: 0.25, copingMat: 'facade_b' });
      // terrasse plantée accessible depuis le bloc précédent (jardinières, pergola)
      if (bi > 0) {
        for (const [a, c] of [[b.x0 + 0.6, b.x0 + 4.0], [b.x1 - 4.0, b.x1 - 0.6]] as const) ctx.mb.box('vegetal', a, top, z1 - 2.6, c, top + 0.6, z1 - 0.6, 'ny');
        ctx.mb.box('vegetal', b.x0 + 0.6, top, z0 + 0.6, b.x1 - 0.6, top + 0.3, z0 + 3.0, 'ny');
        railing(ctx, [b.x0 + 0.3, top + 0.4, z1 - 0.3], [b.x1 - 0.3, top + 0.4, z1 - 0.3], 0.9, 'verre');
        if (ctx.lod < 2) {
          for (const x of [b.x0 + 5, b.x0 + 7.5]) ctx.mb.box('bois', x - 0.08, top, -0.1, x + 0.08, top + 2.6, 0.1, 'ny');
          ctx.mb.box('bois', b.x0 + 4.5, top + 2.6, -1.2, b.x0 + 8.0, top + 2.8, 1.2, '');
        }
      } else {
        rooftopUnit(ctx, b.x0 + 4, top, 0, 2.6, 1.4, 1.2);
        stairHouse(ctx, b.x0 + 7, -3.5, b.x0 + 10, -0.5, top, 2.8, 'facade_b');
      }
    });
  },
};

/* ------------------------------------------------------------------ */
/* Tours                                                                */
/* ------------------------------------------------------------------ */

/** Balcons d'angle filants sur une façade d'une tour carrée (extension à gauche, retour à droite). */
function cornerBalconies(ctx: Ctx, f: Frame, v: number, D: number, len: number): void {
  balcony(ctx, f, -D, len, v, { depth: D, rail: 'verre', slab: 0.2, sides: 'both' });
  balcony(ctx, f, f.w - len, f.w, v, { depth: D, rail: 'verre', slab: 0.2, sides: 'left' });
}

/* 16. Tour résidentielle R+17 à balcons d'angle */
export const tourBalcons: BuildingDef = {
  id: 'tour_residentielle_balcons',
  nameFr: 'Tour résidentielle à balcons d’angle (R+17)',
  category: 'apartment_high',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 2600000,
  upkeepPerMonth: 3200,
  residents: 300,
  jobs: 4,
  density: 'tres_forte',
  style: 'tour_contemporaine',
  tags: ['tour', 'balcons', 'verre', 'couronnement'],
  source: `${SRC}#tourBalcons`,
  lodDistances: [220, 900],
  palette: basePalette({
    facade: { set: 'enduit_blanc', color: '#f3f2ee' },
    facade_b: { set: 'panneaux_facade_sombres', color: '#ffffff' },
    dalle: { set: 'beton_facade', color: '#f2efe8' },
    menuiserie: { set: 'bardage_blanc', color: '#2d3135' },
    soubassement: { set: 'carreaux_facade', color: '#ffffff' },
    garde_corps: { set: 'metal_larme', color: '#2d3135', metalness: 1, roughness: 0.5 },
  }),
  variants: [
    { id: 'origine', nameFr: 'Blanc et panneaux anthracite' },
    { id: 'sable', nameFr: 'Enduit sable et bois', materialOverrides: { facade: { textureSet: 'enduit_creme', color: '#efe2cc' }, facade_b: { textureSet: 'bardage_bois', color: '#ffffff' } } },
    { id: 'beton', nameFr: 'Béton et panneaux sombres (R+20)', heightScale: 1.15, materialOverrides: { facade: { textureSet: 'beton_facade', color: '#e2ded6' } } },
  ],
  build(ctx: Ctx): void {
    const hw = 10.4;
    const x0 = -hw, x1 = hw, z0 = -hw, z1 = hw;
    const w = 2 * hw;
    const rdc = 4.5;
    const fh = 3.0;
    const nF = 17;
    const top = rdc + nF * fh;
    const D = 1.7;
    const len = 5.4;
    const g = { sill: false, shutters: 'none' as const, frameW: 0.06, reveal: 0.16, leaves: 3 };
    const mid = bays(w - 2 * len - 0.6, 3, 0).map((u) => u + len + 0.3);
    const sides = {} as Record<Side, OpeningSpec[]>;
    for (const s of ['S', 'E', 'N', 'W'] as Side[]) {
      const o: OpeningSpec[] = [];
      // hall vitré
      if (s === 'S') {
        o.push({ kind: 'door', r: rectAt(w / 2, 2.4, 0.05, 3.2), o: { style: 'moderne', transom: 0.8, canopy: 'dalle' } });
        o.push(...row([w / 2 - 4.2, w / 2 + 4.2], 4.4, 0.4, 3.4, () => ({ kind: 'window', o: { ...g, leaves: 4 } })));
      } else o.push(...row([w / 2 - 5, w / 2 + 5], 3.6, 0.9, 2.6, () => ({ kind: 'window', o: { ...g, sill: true } })));
      for (let f = 0; f < nF; f++) {
        const v = rdc + f * fh;
        o.push({ kind: 'window', r: rectAt(len / 2 - 0.2, 3.4, v + 0.05, 2.45), o: g });
        o.push({ kind: 'window', r: rectAt(w - len / 2 + 0.2, 3.4, v + 0.05, 2.45), o: g });
        o.push(...row(mid, 1.5, v + 0.8, 1.6, () => ({ kind: 'window', o: { ...g, leaves: 2, sill: true } })));
      }
      sides[s] = o;
    }
    const F = volume(ctx, {
      x0, x1, z0, z1, h: top + 1.2, wallMat: 'facade', sides,
      plinth: { h: rdc - 0.3, d: 0.03, mat: 'soubassement' },
      bands: [{ v: rdc - 0.3, h: 0.3, d: 0.1, mat: 'dalle' }],
    });
    for (const s of ['S', 'E', 'N', 'W'] as Side[]) {
      const f = F[s];
      for (let k = 1; k <= nF; k++) cornerBalconies(ctx, f, rdc + (k - 1) * fh + 0.02, D, len);
      // bandeau vertical sombre au centre (gaine / séjours)
      pilaster(ctx, 'facade_b', f, w / 2, 1.0, rdc, top + 1.2, 0.08);
    }
    flatRoof(ctx, { x0, x1, z0, z1, y: top, parapet: top + 1.2, t: 0.3, copingMat: 'dalle' });
    // couronnement : cadre en béton sur poteaux d'angle
    const cy = top + 1.2;
    const ch = 3.4;
    if (ctx.lod < 2) {
      for (const [x, z] of [[x0 + 0.5, z0 + 0.5], [x1 - 0.5, z0 + 0.5], [x0 + 0.5, z1 - 0.5], [x1 - 0.5, z1 - 0.5]] as const) ctx.mb.box('dalle', x - 0.35, cy, z - 0.35, x + 0.35, cy + ch, z + 0.35, 'ny');
    }
    ctx.mb.box('dalle', x0, cy + ch, z0, x1, cy + ch + 0.6, z0 + 0.8, '');
    ctx.mb.box('dalle', x0, cy + ch, z1 - 0.8, x1, cy + ch + 0.6, z1, '');
    ctx.mb.box('dalle', x0, cy + ch, z0 + 0.8, x0 + 0.8, cy + ch + 0.6, z1 - 0.8, 'pz nz');
    ctx.mb.box('dalle', x1 - 0.8, cy + ch, z0 + 0.8, x1, cy + ch + 0.6, z1 - 0.8, 'pz nz');
    stairHouse(ctx, -3.5, -3.5, 3.5, 3.0, top, 3.6, 'facade_b');
    rooftopUnit(ctx, -6.5, top, 6.0, 2.6, 1.4, 1.2);
    rooftopUnit(ctx, 6.5, top, -6.5, 2.0, 1.2, 1.0);
    mast(ctx, 2.0, top + 3.6, 0, 5.5);
  },
};

/* 17. Tour de brique à gradins (R+13), soubassement en pierre */
export const tourBrique: BuildingDef = {
  id: 'tour_brique_gradins',
  nameFr: 'Tour de logements en brique à gradins (R+13)',
  category: 'apartment_high',
  footprint: { tilesX: 3, tilesZ: 2 },
  cost: 2100000,
  upkeepPerMonth: 2600,
  residents: 220,
  jobs: 10,
  density: 'tres_forte',
  style: 'art_deco',
  tags: ['tour', 'brique', 'gradins', 'pierre', 'commerces'],
  source: `${SRC}#tourBrique`,
  frontage: [{ x: -7.6, z: -7.0, nx: 0, nz: -1, kind: 'vehicle' }, { x: 7.0, z: 7.0, nx: 0, nz: 1, kind: 'delivery' }],
  lodDistances: [220, 900],
  palette: basePalette({
    facade: { set: 'brique_rouge', color: '#ffffff' },
    facade_b: { set: 'brique_orange', color: '#f1d9c8' },
    encadrement: { set: 'pierre_taille', color: '#f1ebe0' },
    soubassement: { set: 'pierre_taille', color: '#d8cfbf' },
    menuiserie: { set: 'bardage_blanc', color: '#e9e6df' },
    enseigne: { set: 'enduit_blanc', color: '#3b4a3f' },
    garde_corps: { set: 'metal_larme', color: '#262a2c', metalness: 1, roughness: 0.55 },
    zinc: { set: 'toit_tole_ondulee', color: '#7f9c92', metalness: 1, roughness: 0.5 },
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique rouge, piliers clairs' },
    { id: 'blonde', nameFr: 'Brique blonde', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#f6dcc0' }, facade_b: { textureSet: 'pierre_taille', color: '#f4efe6' } } },
    { id: 'orange', nameFr: 'Brique orangée, couronnement cuivre', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' }, zinc: { color: '#b0764a' } } },
  ],
  build(ctx: Ctx): void {
    const rdc = 4.4;
    const fh = 3.0;
    const pod = { x0: -11.6, x1: 11.6, z0: -7.0, z1: 7.0 };
    const podH = rdc + fh;
    const win = { leaves: 2, shutters: 'none' as const, frameW: 0.06, reveal: 0.22, surround: 0, lintel: false };
    // socle (rez-de-chaussée commercial + 1er étage) en pierre
    const pw = pod.x1 - pod.x0;
    const pd = pod.z1 - pod.z0;
    volume(ctx, {
      ...pod, h: podH + 0.5, wallMat: 'soubassement',
      sides: {
        S: [
          { kind: 'shop', r: { u0: 0.8, u1: 8.6, v0: 0.05, v1: 3.4 }, o: { awning: true, doorAt: 'left' } },
          { kind: 'door', r: rectAt(pw / 2, 2.4, 0.05, 3.3), o: { style: 'double', transom: 0.7, surround: 0.35, canopy: 'verre' } },
          { kind: 'shop', r: { u0: pw - 8.6, u1: pw - 0.8, v0: 0.05, v1: 3.4 }, o: { awning: true, doorAt: 'right' } },
          ...row(bays(pw, 8, 0.4), 1.4, rdc + 0.8, 1.7, () => ({ kind: 'window', o: { ...win, surround: 0.14 } })),
        ],
        E: [...row(bays(pd, 4, 0.4), 1.4, 1.0, 2.0, () => ({ kind: 'window', o: win })), ...row(bays(pd, 4, 0.4), 1.4, rdc + 0.8, 1.7, () => ({ kind: 'window', o: win }))],
        W: [...row(bays(pd, 4, 0.4), 1.4, 1.0, 2.0, () => ({ kind: 'window', o: win })), ...row(bays(pd, 4, 0.4), 1.4, rdc + 0.8, 1.7, () => ({ kind: 'window', o: win }))],
        N: [...row([4, pw - 4], 3.0, 0.05, 2.8, () => ({ kind: 'garage' })), ...row(bays(pw, 8, 0.4), 1.4, rdc + 0.8, 1.7, () => ({ kind: 'window', o: win }))],
      },
      bands: [{ v: rdc - 0.25, h: 0.25, d: 0.1 }],
      cornice: { profile: [[0.15, 0.08], [0.2, 0.22]], v: podH + 0.15 },
    });
    flatRoof(ctx, { ...pod, y: podH + 0.1, parapet: podH + 0.5, t: 0.3, copingMat: 'encadrement' });
    // fût de la tour : piliers clairs, allèges en brique
    const tiers = [
      { hw: 8.4, hd: 6.0, n: 9 },
      { hw: 6.8, hd: 4.6, n: 3 },
      { hw: 5.0, hd: 3.3, n: 2 },
    ];
    let y = podH;
    tiers.forEach((t, ti) => {
      const x0 = -t.hw, x1 = t.hw, z0 = -t.hd, z1 = t.hd;
      const h = t.n * fh;
      const mk = (len: number): OpeningSpec[] => {
        const o: OpeningSpec[] = [];
        const cols = bays(len, Math.max(2, Math.round(len / 2.6)), 0.5);
        for (let f = 0; f < t.n; f++) o.push(...row(cols, 1.35, f * fh + 0.8, 1.75, () => ({ kind: 'window', o: win })));
        return o;
      };
      const F = volume(ctx, { x0, x1, z0, z1, y0: y, h: h + 0.6, wallMat: 'facade', sides: { S: mk(2 * t.hw), N: mk(2 * t.hw), E: mk(2 * t.hd), W: mk(2 * t.hd) } });
      if (ctx.lod < 2) {
        for (const s of ['S', 'E', 'N', 'W'] as Side[]) {
          const f = F[s];
          const cols = bays(f.w, Math.max(2, Math.round(f.w / 2.6)), 0.5);
          for (let i = 0; i < cols.length - 1; i++) pilaster(ctx, 'facade_b', f, (cols[i]! + cols[i + 1]!) / 2, 0.5, 0, h + 0.6, 0.12);
          pilaster(ctx, 'facade_b', f, 0.25, 0.5, 0, h + 0.6, 0.16);
          pilaster(ctx, 'facade_b', f, f.w - 0.25, 0.5, 0, h + 0.6, 0.16);
        }
      }
      flatRoof(ctx, { x0, x1, z0, z1, y: y + h + 0.1, parapet: y + h + 0.6, t: 0.3, copingMat: 'encadrement' });
      // terrasse du gradin avec garde-corps
      if (ti > 0) {
        const p = tiers[ti - 1]!;
        railing(ctx, [-p.hw + 0.35, y + 0.6, p.hd - 0.35], [p.hw - 0.35, y + 0.6, p.hd - 0.35], 0.9, 'fer');
      }
      y += h;
    });
    // couronnement : lanterne en zinc
    const ty = y + 0.6;
    ctx.mb.extrude('zinc', [[-3.2, 2.0], [3.2, 2.0], [3.2, -2.0], [-3.2, -2.0]], ty, ty + 2.6, { top: null });
    ctx.mb.polyFacing('zinc', [[-3.2, ty + 2.6, 2.0], [3.2, ty + 2.6, 2.0], [0, ty + 5.2, 0]], [0, 0.5, 1]);
    ctx.mb.polyFacing('zinc', [[3.2, ty + 2.6, -2.0], [-3.2, ty + 2.6, -2.0], [0, ty + 5.2, 0]], [0, 0.5, -1]);
    ctx.mb.polyFacing('zinc', [[3.2, ty + 2.6, 2.0], [3.2, ty + 2.6, -2.0], [0, ty + 5.2, 0]], [1, 0.5, 0]);
    ctx.mb.polyFacing('zinc', [[-3.2, ty + 2.6, -2.0], [-3.2, ty + 2.6, 2.0], [0, ty + 5.2, 0]], [-1, 0.5, 0]);
    mast(ctx, 0, ty + 5.0, 0, 3.0);
  },
};

export const TOWERS: BuildingDef[] = [barreModerne, residenceGradins, tourBalcons, tourBrique];

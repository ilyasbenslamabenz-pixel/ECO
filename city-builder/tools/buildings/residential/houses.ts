/**
 * Maisons individuelles (catégorie `house`) — styles variés, modélisés avec le kit.
 */
import {
  balcony, basePalette, bays, chimney, COLORS, cornice, door, dormer, downpipe, facade, fbox, flatRoof, flushWindow, gableRoof,
  genoise, hipRoof, plinth, quoins, railing, rectAt, row, shedRoof, sideFrame, subFrame, volume, P,
  type BuildingDef, type Ctx, type OpeningSpec, type Rect,
} from '../kit/index';

const SRC = 'tools/buildings/residential/houses.ts';
/** Teinte appliquée à l'ardoise (texture d'origine trop claire / beige). */
export const ARDOISE = '#8a929c';

/* ------------------------------------------------------------------ */
/* 1. Pavillon enduit à toit 4 pans, garage accolé                      */
/* ------------------------------------------------------------------ */
export const pavillonEnduit: BuildingDef = {
  id: 'maison_pavillon_enduit',
  nameFr: 'Pavillon enduit à toit quatre pans',
  category: 'house',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 42000,
  upkeepPerMonth: 60,
  residents: 4,
  jobs: 0,
  density: 'faible',
  style: 'pavillon',
  tags: ['maison', 'garage', 'tuiles'],
  source: `${SRC}#pavillonEnduit`,
  frontage: [{ x: 7.0, z: 4.45, nx: 0, nz: 1, kind: 'vehicle' }],
  palette: basePalette({
    facade: { set: 'enduit_blanc', color: '#f1ebdf' },
    encadrement: { set: 'enduit_blanc', color: '#fbf9f4' },
    soubassement: { set: 'pierre_rustique', color: '#cfc8bb' },
    volet: { set: 'bardage_blanc', color: COLORS.bleuPastel },
    porte: { set: 'bardage_blanc', color: '#5b6f78' },
    cheminee: { set: 'enduit_blanc', color: '#ece6da' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit blanc, volets bleu pastel' },
    { id: 'ocre', nameFr: 'Enduit ocre, volets vert basque', materialOverrides: { facade: { textureSet: 'enduit_creme', color: '#e9cf9f' }, cheminee: { textureSet: 'enduit_creme', color: '#e9cf9f' }, volet: { color: COLORS.vertBasque }, porte: { color: COLORS.vertBasque } } },
    { id: 'ardoise', nameFr: 'Toit d’ardoise, volets anthracite', materialOverrides: { toiture: { textureSet: 'toit_ardoise', color: ARDOISE }, poterie: { textureSet: 'toit_ardoise', color: '#6b6f74' }, volet: { color: COLORS.grisAnthracite }, porte: { color: COLORS.grisAnthracite }, facade: { textureSet: 'enduit_peint', color: '#e6e1d6' } } },
    { id: 'rose', nameFr: 'Enduit rosé, tuiles grises', materialOverrides: { facade: { color: COLORS.rose }, cheminee: { color: COLORS.rose }, toiture: { textureSet: 'toit_tuiles_grises' }, volet: { color: COLORS.blanc } } },
  ],
  build(ctx: Ctx): void {
    const { mb } = ctx;
    const x0 = -5.25, x1 = 5.25, z0 = -4.25, z1 = 4.25;
    const fl = 0.5; // rez-de-chaussée surélevé
    const eave = 3.45;
    const winO = { surround: 0.14, shutters: 'battants' as const, bars: 2 };
    // Façade principale
    const S = sideFrame(x0, z0, x1, z1, 0, eave, 'S');
    const sOps: OpeningSpec[] = [
      { kind: 'window', r: rectAt(1.4, 1.2, 1.35, 1.35), o: winO },
      { kind: 'door', r: rectAt(3.35, 0.98, fl, 2.2), o: { steps: fl, canopy: 'tuiles', transom: 0.35, style: 'vitree' } },
      { kind: 'window', r: rectAt(6.2, 1.2, 1.35, 1.35), o: winO },
      { kind: 'window', r: rectAt(8.6, 1.2, 1.35, 1.35), o: winO },
    ];
    facade(ctx, S, 'facade', sOps);
    plinth(ctx, 'soubassement', S, fl, 0.04, sOps.map((o) => o.r));
    // Arrière
    const N = sideFrame(x0, z0, x1, z1, 0, eave, 'N');
    const nOps: OpeningSpec[] = [
      { kind: 'window', r: rectAt(1.6, 0.6, 1.75, 0.8), o: { surround: 0.12, shutters: 'none' } },
      { kind: 'window', r: rectAt(3.6, 1.3, fl + 0.02, 2.15), o: { sill: false, leaves: 2, shutters: 'battants', surround: 0.14, railing: 'barreaux' } },
      { kind: 'window', r: rectAt(6.4, 1.2, 1.35, 1.35), o: winO },
      { kind: 'window', r: rectAt(8.9, 1.0, 1.45, 1.2), o: winO },
    ];
    facade(ctx, N, 'facade', nOps);
    plinth(ctx, 'soubassement', N, fl, 0.04, []);
    // Pignon ouest
    const W = sideFrame(x0, z0, x1, z1, 0, eave, 'W');
    const wOps: OpeningSpec[] = [
      { kind: 'window', r: rectAt(2.6, 1.0, 1.45, 1.25), o: winO },
      { kind: 'window', r: rectAt(5.9, 1.0, 1.45, 1.25), o: winO },
    ];
    facade(ctx, W, 'facade', wOps);
    plinth(ctx, 'soubassement', W, fl, 0.04, []);
    // Est : en grande partie contre le garage
    const E = sideFrame(x0, z0, x1, z1, 0, eave, 'E');
    facade(ctx, E, 'facade', [{ kind: 'window', r: rectAt(7.1, 0.8, 1.6, 1.0), o: winO }]);
    plinth(ctx, 'soubassement', E, fl, 0.04, []);
    // Toiture
    const roof = hipRoof(ctx, { x0, x1, z0, z1, y: eave, pitch: 32, overhang: 0.5 });
    chimney(ctx, -2.2, -1.6, 0.6, 0.6, eave, roof.ridgeY + 0.75, { pots: 2 });
    downpipe(ctx, S, 0.25, roof.eaveY);
    downpipe(ctx, S, S.w - 0.25, roof.eaveY);
    downpipe(ctx, N, N.w - 0.25, roof.eaveY);
    // Garage accolé (toit-terrasse)
    const g = { x0: x1, x1: x1 + 3.5, z0: -1.9, z1: 3.95 };
    const gh = 3.0;
    const GS = sideFrame(g.x0, g.z0, g.x1, g.z1, 0, gh, 'S');
    facade(ctx, GS, 'facade', [{ kind: 'garage', r: rectAt(1.75, 2.45, 0.02, 2.15) }]);
    const GE = sideFrame(g.x0, g.z0, g.x1, g.z1, 0, gh, 'E');
    facade(ctx, GE, 'facade', [{ kind: 'window', r: rectAt(3.0, 0.8, 1.3, 0.6), o: { shutters: 'none', surround: 0.12 } }]);
    const GN = sideFrame(g.x0, g.z0, g.x1, g.z1, 0, gh, 'N');
    facade(ctx, GN, 'facade', [{ kind: 'door', r: rectAt(1.6, 0.9, 0.02, 2.05), o: { style: 'panneaux' } }]);
    for (const f of [GS, GE, GN]) plinth(ctx, 'soubassement', f, 0.3, 0.03, f === GS ? [rectAt(1.75, 2.45, 0.02, 2.15)] : f === GN ? [rectAt(1.6, 0.9, 0.02, 2.05)] : []);
    flatRoof(ctx, { ...g, y: gh - 0.25, parapet: gh, t: 0.22 });
    // Bordure / allée devant le garage (dalle légèrement saillante)
    mb.box('soubassement', g.x0 + 0.2, 0, g.z1, g.x1 - 0.2, 0.04, g.z1 + 0.5, 'ny nz');
  },
};

export type { Rect };
/* ------------------------------------------------------------------ */
/* 2. Maison de briques à pignon sur rue (style Nord), bow-window       */
/* ------------------------------------------------------------------ */
export const maisonBriquePignon: BuildingDef = {
  id: 'maison_brique_pignon',
  nameFr: 'Maison de briques à pignon sur rue',
  category: 'house',
  footprint: { tilesX: 1, tilesZ: 2 },
  cost: 48000,
  upkeepPerMonth: 65,
  residents: 5,
  jobs: 0,
  density: 'faible',
  style: 'brique_nord',
  tags: ['maison', 'brique', 'ardoise', 'bow-window'],
  source: `${SRC}#maisonBriquePignon`,
  palette: basePalette({
    facade: { set: 'brique_rouge' },
    encadrement: { set: 'pierre_taille', color: '#ece6da' },
    soubassement: { set: 'pierre_rustique', color: '#9c968c' },
    toiture: { set: 'toit_ardoise', color: ARDOISE },
    poterie: { set: 'toit_ardoise', color: '#5d6166' },
    rive: { set: 'bardage_blanc', color: '#f2f0ea' },
    porte: { set: 'bardage_blanc', color: COLORS.bordeaux },
    cheminee: { set: 'brique_rouge' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique rouge sombre, porte bordeaux' },
    { id: 'orangee', nameFr: 'Brique orangée, porte verte', materialOverrides: { facade: { textureSet: 'brique_orange' }, cheminee: { textureSet: 'brique_orange' }, porte: { color: COLORS.vertBasque } } },
    { id: 'chaulee', nameFr: 'Brique peinte en blanc, tuiles', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#f3f1ec' }, toiture: { textureSet: 'toit_tuiles', color: '#ffffff' }, poterie: { textureSet: 'toit_tuiles', color: '#c77a52' }, porte: { color: COLORS.noir } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -3.6, x1 = 3.6, z0 = -5, z1 = 5;
    const fl = 0.35;
    const eave = 6.1;
    const winO = { lintel: true, bars: 1, shutters: 'none' as const, leaves: 2 };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: eave, wallMat: 'facade',
      sides: {
        S: [
          { kind: 'door', r: rectAt(1.2, 1.0, fl, 2.35), o: { steps: fl, transom: 0.45, style: 'panneaux', surround: 0.16 } },
          ...row([1.55, 5.4], 1.15, 4.15, 1.55, () => ({ kind: 'window', o: winO })),
        ],
        E: [...row([2.5, 7.0], 0.9, 1.3, 1.4, () => ({ kind: 'window', o: winO })), ...row([4.2], 0.9, 4.2, 1.4, () => ({ kind: 'window', o: winO }))],
        W: [...row([3.4], 0.9, 1.3, 1.4, () => ({ kind: 'window', o: winO })), ...row([3.4, 7.2], 0.9, 4.2, 1.4, () => ({ kind: 'window', o: winO }))],
        N: [...row([5.4], 1.15, 4.15, 1.55, () => ({ kind: 'window', o: winO }))],
      },
      plinth: { h: fl, d: 0.05 },
      bands: [{ v: 3.35, h: 0.16, d: 0.05 }],
    });
    const roof = gableRoof(ctx, { x0, x1, z0, z1, y: eave, pitch: 44, axis: 'z', overhang: 0.35, verge: 0.3, gableMat: 'facade' });
    // fenêtre de comble dans le pignon sur rue
    const gS = subFrame(F.S, 0, eave, 0, 7.2, 3);
    flushWindow(ctx, gS, rectAt(3.6, 0.85, 0.9, 1.1), {});
    flushWindow(ctx, subFrame(F.N, 0, eave, 0, 7.2, 3), rectAt(3.6, 0.7, 0.9, 0.9), {});
    // bow-window du rez-de-chaussée
    const bx0 = -0.25, bx1 = 3.05, bz1 = z1 + 0.85;
    volume(ctx, {
      x0: bx0, x1: bx1, z0: z1, z1: bz1, h: 3.1, wallMat: 'facade', hidden: ['N'],
      sides: {
        S: [{ kind: 'window', r: rectAt(1.65, 2.2, 1.0, 1.75), o: { leaves: 3, bars: 1, lintel: false, shutters: 'none' } }],
        E: [{ kind: 'window', r: rectAt(0.43, 0.42, 1.0, 1.75), o: { leaves: 1, shutters: 'none' } }],
        W: [{ kind: 'window', r: rectAt(0.43, 0.42, 1.0, 1.75), o: { leaves: 1, shutters: 'none' } }],
      },
      plinth: { h: fl + 0.25, d: 0.05 },
    });
    shedRoof(ctx, { x0: bx0, x1: bx1, z0: z1, z1: bz1, yLow: 3.1, yHigh: 3.45, low: 'S', overhang: 0.15, wallMat: 'facade', thickness: 0.16 });
    // extension arrière (cuisine) à toit mono-pente
    const ex = { x0: -3.6, x1: 0.6, z0: -8.0, z1: z0 };
    volume(ctx, {
      ...ex, h: 2.9, wallMat: 'facade', hidden: ['S'],
      sides: {
        N: [{ kind: 'window', r: rectAt(1.2, 1.4, fl, 2.2), o: { sill: false, leaves: 2, shutters: 'none' } }, { kind: 'window', r: rectAt(3.2, 0.9, 1.3, 1.1), o: winO }],
        W: [{ kind: 'door', r: rectAt(1.6, 0.95, fl, 2.15), o: { style: 'vitree', steps: fl } }],
      },
      plinth: { h: fl, d: 0.05 },
    });
    shedRoof(ctx, { ...ex, yLow: 2.9, yHigh: 3.75, low: 'N', overhang: 0.3, wallMat: 'facade' });
    chimney(ctx, 0, -3.2, 0.7, 0.55, eave, roof.ridgeY + 0.9, { pots: 2 });
    downpipe(ctx, F.E, 0.25, roof.eaveY);
    downpipe(ctx, F.W, F.W.w - 0.25, roof.eaveY);
  },
};

/* ------------------------------------------------------------------ */
/* 3. Chalet de montagne : soubassement en pierre, étage en bois, balcon */
/* ------------------------------------------------------------------ */
export const chaletBois: BuildingDef = {
  id: 'maison_chalet_bois',
  nameFr: 'Chalet bois et pierre',
  category: 'house',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 56000,
  upkeepPerMonth: 70,
  residents: 5,
  jobs: 0,
  density: 'faible',
  style: 'chalet',
  tags: ['maison', 'bois', 'montagne', 'balcon'],
  source: `${SRC}#chaletBois`,
  frontage: [{ x: -4.6, z: 0, nx: -1, nz: 0, kind: 'vehicle' }],
  palette: basePalette({
    facade: { set: 'bardage_bois', color: '#ffffff' },
    facade_b: { set: 'pierre_rustique' },
    encadrement: { set: 'bardage_bois', color: '#e8d2b8' },
    soubassement: { set: 'pierre_rustique', color: '#a9a39a' },
    toiture: { set: 'toit_tuiles_grises' },
    rive: { set: 'bardage_bois', color: '#e2c9ad' },
    menuiserie: { set: 'bardage_blanc', color: '#8a6a4c' },
    volet: { set: 'bois_volet', color: '#e6d2bd' },
    porte: { set: 'bois_volet', color: '#e9d6c0' },
    bois: { set: 'bardage_bois', color: '#f0dcc4' },
    cheminee: { set: 'pierre_rustique' },
    poterie: { set: 'toit_tuiles_grises', color: '#77797c' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Mélèze doré, tuiles grises' },
    { id: 'vieilli', nameFr: 'Bois vieilli gris, lauzes', materialOverrides: { facade: { textureSet: 'bardage_blanc', color: '#9d9488' }, rive: { textureSet: 'bardage_blanc', color: '#8f867a' }, bois: { textureSet: 'bardage_blanc', color: '#948a7e' }, toiture: { textureSet: 'toit_ardoise', color: ARDOISE } } },
    { id: 'rouge', nameFr: 'Bois lasuré rouge, volets verts', materialOverrides: { facade: { textureSet: 'bardage_blanc', color: '#a85a45' }, volet: { textureSet: 'bardage_blanc', color: COLORS.vertBasque } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -4.6, x1 = 4.6, z0 = -4.0, z1 = 4.0;
    const g = 2.75;
    const woodWin = { shutters: 'battants' as const, bars: 1, sill: true, surround: 0.1, reveal: 0.14 };
    volume(ctx, {
      x0, x1, z0, z1, h: g, wallMat: 'facade_b',
      sides: {
        S: [
          { kind: 'window', r: rectAt(1.9, 1.0, 0.95, 1.2), o: woodWin },
          { kind: 'door', r: rectAt(4.6, 1.05, 0.3, 2.15), o: { steps: 0.3, style: 'vitree', canopy: null } },
          { kind: 'window', r: rectAt(7.3, 1.0, 0.95, 1.2), o: woodWin },
        ],
        E: row([2.4, 5.6], 0.9, 1.0, 1.1, () => ({ kind: 'window', o: woodWin })),
        W: [{ kind: 'garage', r: rectAt(4.0, 2.5, 0.02, 2.2) }],
        N: row([2.5, 6.7], 0.9, 1.0, 1.1, () => ({ kind: 'window', o: woodWin })),
      },
    });
    // étage en bois légèrement en encorbellement
    const e = 0.12;
    const U = volume(ctx, {
      x0: x0 - e, x1: x1 + e, z0: z0 - e, z1: z1 + e, y0: g, h: 2.6, wallMat: 'facade',
      sides: {
        S: row([2.2, 7.2], 1.25, 0.05, 2.15, () => ({ kind: 'window', o: { sill: false, leaves: 2, bars: 1, shutters: 'battants', reveal: 0.12 } })),
        E: row([4.1], 1.0, 0.9, 1.15, () => ({ kind: 'window', o: woodWin })),
        W: row([4.1], 1.0, 0.9, 1.15, () => ({ kind: 'window', o: woodWin })),
        N: row([2.3, 6.1], 1.0, 0.9, 1.15, () => ({ kind: 'window', o: woodWin })),
      },
    });
    fbox(ctx, 'bois', U.S, -0.3, U.S.w + 0.3, -0.25, 0.0, -0.3, 0.05);
    balcony(ctx, U.S, -0.35, U.S.w + 0.35, 0.02, { depth: 1.45, rail: 'bois', slabMat: 'bois', slab: 0.22, consoles: true, deck: true });
    const roof = gableRoof(ctx, { x0: x0 - e, x1: x1 + e, z0: z0 - e, z1: z1 + e, y: g + 2.6, pitch: 26, axis: 'z', overhang: 1.0, verge: 1.7, gableMat: 'facade', timber: true, thickness: 0.24 });
    // fenêtre de pignon et croix de bois
    const gS = subFrame(U.S, 0, 2.6, 0, U.S.w, 3);
    flushWindow(ctx, gS, rectAt(U.S.w / 2, 1.3, 0.35, 0.9), { surroundMat: 'bois' });
    chimney(ctx, 1.8, -1.6, 0.8, 0.8, g + 2.6, roof.ridgeY + 0.6, { pots: 1, capMat: 'dalle' });
    // bûcher (pile de bois) contre le pignon est
    if (ctx.lod < 2) {
      const E = U.E;
      for (let i = 0; i < 4; i++) fbox(ctx, 'bois', { ...E, o: [E.o[0], 0, E.o[2]] }, 1.2, 3.4, 0.1 + i * 0.32, 0.4 + i * 0.32, 0, 0.55);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 4. Villa contemporaine : volumes décalés, toits plats, grandes baies   */
/* ------------------------------------------------------------------ */
export const villaModerne: BuildingDef = {
  id: 'maison_villa_moderne',
  nameFr: 'Villa contemporaine à toits plats',
  category: 'house',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 98000,
  upkeepPerMonth: 120,
  residents: 4,
  jobs: 0,
  density: 'faible',
  style: 'contemporain',
  tags: ['maison', 'piscine', 'toit-terrasse', 'baies'],
  source: `${SRC}#villaModerne`,
  palette: basePalette({
    facade: { set: 'enduit_blanc', color: '#f6f5f1' },
    facade_b: { set: 'bardage_bois', color: '#c99a6b' },
    menuiserie: { set: 'bardage_blanc', color: '#2e3236', roughness: 0.6 },
    porte: { set: 'bardage_bois', color: '#b98b5c' },
    zinc: { set: 'metal_larme', color: '#3a3d40', metalness: 1, roughness: 0.5 },
    soubassement: { set: 'pierre_taille', color: '#cfcac0' },
    dalle: { set: 'beton_facade', color: '#e4e1da' },
    eau: { kind: 'glass', color: '#3fa7c0' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit blanc et bardage bois' },
    { id: 'sombre', nameFr: 'Enduit blanc et panneaux sombres', materialOverrides: { facade_b: { textureSet: 'panneaux_facade_sombres', color: '#ffffff' } } },
    { id: 'beton', nameFr: 'Béton brut et bois', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#d6d3cc' } } },
  ],
  build(ctx: Ctx): void {
    const { mb } = ctx;
    const glassO = { sill: false, shutters: 'none' as const, frameW: 0.05, reveal: 0.1 };
    // rez-de-chaussée
    const A = { x0: -7.0, x1: 3.0, z0: -4.0, z1: 4.0 };
    volume(ctx, {
      ...A, h: 3.45, wallMat: 'facade',
      sides: {
        S: [
          { kind: 'window', r: rectAt(3.6, 5.6, 0.12, 2.55), o: { ...glassO, leaves: 4 } },
          { kind: 'door', r: rectAt(8.4, 1.2, 0.12, 2.5), o: { style: 'moderne', canopy: null } },
        ],
        W: [{ kind: 'window', r: rectAt(2.5, 0.6, 0.3, 2.4), o: glassO }, { kind: 'window', r: rectAt(5.5, 0.6, 0.3, 2.4), o: glassO }],
        N: [{ kind: 'window', r: rectAt(2.5, 2.6, 1.2, 1.1), o: { ...glassO, leaves: 2 } }, { kind: 'window', r: rectAt(7.0, 3.2, 0.12, 2.5), o: { ...glassO, leaves: 3 } }],
        E: [{ kind: 'window', r: rectAt(5.8, 1.6, 0.12, 2.5), o: { ...glassO, leaves: 2 } }],
      },
    });
    flatRoof(ctx, { ...A, y: 3.2, parapet: 3.45, t: 0.2 });
    // étage en porte-à-faux
    const B = { x0: -4.2, x1: 6.8, z0: -3.4, z1: 4.6 };
    volume(ctx, {
      ...B, y0: 3.2, h: 3.25, wallMat: 'facade_b',
      sides: {
        S: [{ kind: 'window', r: rectAt(4.0, 6.4, 0.6, 1.6), o: { ...glassO, leaves: 4 } }, { kind: 'window', r: rectAt(9.3, 1.2, 0.1, 2.5), o: glassO }],
        E: [{ kind: 'window', r: rectAt(4.0, 6.6, 0.1, 2.55), o: { ...glassO, leaves: 3 } }],
        N: row([2.0, 5.5, 9.0], 1.4, 0.9, 1.4, () => ({ kind: 'window', o: glassO })),
        W: [{ kind: 'window', r: rectAt(4.0, 2.0, 0.9, 1.4), o: glassO }],
      },
    });
    mb.quad('facade_b', [3.0, 3.2, B.z1], [3.0, 3.2, B.z0], [B.x1, 3.2, B.z0], [B.x1, 3.2, B.z1]);
    mb.quad('facade_b', [B.x0, 3.2, B.z1], [B.x0, 3.2, A.z1], [3.0, 3.2, A.z1], [3.0, 3.2, B.z1]);
    flatRoof(ctx, { ...B, y: 6.2, parapet: 6.45, t: 0.2 });
    // terrasse du toit du rez-de-chaussée (côté ouest) : garde-corps vitré
    railing(ctx, [A.x0 + 0.25, 3.45, A.z1 - 0.25], [B.x0 - 0.05, 3.45, A.z1 - 0.25], 1.0, 'verre');
    railing(ctx, [A.x0 + 0.25, 3.45, A.z0 + 0.25], [A.x0 + 0.25, 3.45, A.z1 - 0.25], 1.0, 'verre');
    // terrasse bois sous le porte-à-faux
    mb.box('bois', 3.0, 0, -3.4, 7.4, 0.14, 4.6, 'ny');
    // piscine
    const px0 = -6.6, px1 = -0.8, pz0 = 4.8, pz1 = 7.7;
    mb.box('soubassement', px0 - 0.4, 0, pz0 - 0.4, px1 + 0.4, 0.12, pz0, 'ny');
    mb.box('soubassement', px0 - 0.4, 0, pz1, px1 + 0.4, 0.12, pz1 + 0.4, 'ny');
    mb.box('soubassement', px0 - 0.4, 0, pz0, px0, 0.12, pz1, 'ny pz nz');
    mb.box('soubassement', px1, 0, pz0, px1 + 0.4, 0.12, pz1, 'ny pz nz');
    const prev = mb.lit; mb.lit = -1;
    mb.quad('eau', [px0, 0.06, pz1], [px1, 0.06, pz1], [px1, 0.06, pz0], [px0, 0.06, pz0]);
    mb.lit = prev;
    // auvent d'entrée
    mb.box('dalle', 3.0, 2.9, 4.6, 6.8, 3.15, 5.9, '');
    if (ctx.lod < 2) {
      // brise-soleil à lames bois devant le bandeau vitré de l'étage
      const n = ctx.lod === 0 ? 9 : 4;
      for (let i = 0; i < n; i++) {
        const y = 3.85 + (1.6 * i) / (n - 1);
        mb.box('bois', B.x0 + 0.6, y, B.z1 + 0.25, B.x0 + 7.4, y + 0.05, B.z1 + 0.45, '');
      }
      for (const x of [B.x0 + 0.55, B.x0 + 7.45]) mb.box('zinc', x - 0.04, 3.7, B.z1 + 0.02, x + 0.04, 5.6, B.z1 + 0.5, 'ny');
      // conduit de cheminée inox, échelle de piscine, bornes d'éclairage
      mb.cylinder('zinc', -1.5, 6.2, -1.8, 0.14, 1.6, 12, true);
      mb.cylinder('zinc', -1.5, 7.8, -1.8, 0.22, 0.12, 12, true, 0.2);
      for (const x of [px1 - 0.55, px1 - 0.15]) {
        mb.tube('zinc', [x, -0.3, pz0 + 0.05], [x, 0.75, pz0 + 0.05], 0.025, 6);
        mb.tube('zinc', [x, 0.75, pz0 + 0.05], [x, 0.75, pz0 - 0.3], 0.025, 6);
      }
      for (const [x, z] of [[2.6, 5.2], [4.6, 7.4], [-0.2, 5.0]] as const) mb.cylinder('garde_corps', x, 0, z, 0.08, 0.7, 10, true);
    }
    const SA = sideFrame(A.x0, A.z0, A.x1, A.z1, 0, 3.45, 'W');
    downpipe(ctx, SA, 0.2, 3.3);
    downpipe(ctx, sideFrame(B.x0, B.z0, B.x1, B.z1, 3.2, 6.45, 'N'), 0.3, 3.2);
  },
};

/* ------------------------------------------------------------------ */
/* 5. Longère en pierre : murs de moellons, lucarnes, souches aux pignons */
/* ------------------------------------------------------------------ */
export const longerePierre: BuildingDef = {
  id: 'maison_longere_pierre',
  nameFr: 'Longère en pierre à lucarnes',
  category: 'house',
  footprint: { tilesX: 2, tilesZ: 1 },
  cost: 52000,
  upkeepPerMonth: 70,
  residents: 4,
  jobs: 0,
  density: 'faible',
  style: 'longere',
  tags: ['maison', 'pierre', 'ardoise', 'lucarnes', 'rural'],
  source: `${SRC}#longerePierre`,
  palette: basePalette({
    facade: { set: 'pierre_moellons' },
    encadrement: { set: 'pierre_taille', color: '#efe8da' },
    soubassement: { set: 'pierre_rustique', color: '#b0a89a' },
    toiture: { set: 'toit_ardoise', color: ARDOISE },
    poterie: { set: 'toit_ardoise', color: '#55595e' },
    volet: { set: 'bardage_blanc', color: COLORS.grisVert },
    porte: { set: 'bois_volet', color: '#c9a27a' },
    cheminee: { set: 'pierre_moellons' },
    rive: { set: 'bardage_bois', color: '#8d7a66' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Moellons, volets gris-vert' },
    { id: 'blanche', nameFr: 'Enduit à la chaux, volets bleus', materialOverrides: { facade: { textureSet: 'enduit_creme', color: '#f1eadb' }, volet: { color: COLORS.bleuCharron } } },
    { id: 'tuiles', nameFr: 'Pierre, toit de tuiles, volets rouges', materialOverrides: { toiture: { textureSet: 'toit_tuiles', color: '#ffffff' }, poterie: { textureSet: 'toit_tuiles', color: '#c77a52' }, volet: { color: COLORS.rougeBasque } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -7.5, x1 = 7.5, z0 = -3.1, z1 = 3.1;
    const eave = 2.95;
    const w = { surround: 0.16, shutters: 'battants' as const, bars: 2, reveal: 0.3 };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: eave, wallMat: 'facade',
      sides: {
        S: [
          { kind: 'window', r: rectAt(1.6, 0.95, 0.95, 1.25), o: w },
          { kind: 'door', r: rectAt(3.4, 1.0, 0.15, 2.1), o: { style: 'vitree', surround: 0.18, steps: 0.15 } },
          { kind: 'window', r: rectAt(5.3, 0.95, 0.95, 1.25), o: w },
          { kind: 'window', r: rectAt(8.1, 0.95, 0.95, 1.25), o: w },
          { kind: 'door', r: rectAt(12.2, 2.5, 0.02, 2.55), o: { style: 'double', surround: 0.2 } },
        ],
        N: row([2.5, 6.5, 10.5, 13.4], 0.8, 1.0, 1.05, () => ({ kind: 'window', o: w })),
        E: [{ kind: 'window', r: rectAt(3.1, 0.8, 1.0, 1.05), o: w }],
        W: [{ kind: 'door', r: rectAt(3.1, 0.95, 0.15, 2.0), o: { style: 'panneaux', surround: 0.16 } }],
      },
      quoins: { mat: 'encadrement', v0: 0 },
    });
    const pitch = 45;
    const roof = gableRoof(ctx, { x0, x1, z0, z1, y: eave, pitch, axis: 'x', overhang: 0.3, verge: 0.15, gableMat: 'facade', thickness: 0.2 });
    // lucarnes à fronton
    const tn = Math.tan((pitch * Math.PI) / 180);
    const inset = 0.55;
    const vb = eave + inset * tn + 0.12;
    for (const uc of [1.6, 5.3, 8.1]) {
      const fr = subFrame(F.S, 0, 0, -inset, F.S.w, 8);
      dormer(ctx, fr, uc, vb, 1.45, 1.35, (1.35 + 1.0) / tn + 0.2, { wallMat: 'encadrement', roofMat: 'toiture', win: { bars: 1, surround: 0, leaves: 2 } });
    }
    // souches de cheminée sur les pignons
    chimney(ctx, x0 + 0.55, 0, 0.75, 0.9, eave, roof.ridgeY + 0.7, { pots: 2 });
    chimney(ctx, x1 - 0.55, 0, 0.75, 0.9, eave, roof.ridgeY + 0.7, { pots: 1 });
    // banc de pierre et soupirail
    fbox(ctx, 'encadrement', F.S, 6.2, 7.3, 0, 0.45, 0, 0.4, 'back');
    void P;
  },
};

/* ------------------------------------------------------------------ */
/* 6. Maison de ville étroite (R+2) à balconnets                        */
/* ------------------------------------------------------------------ */
export const maisonVilleEtroite: BuildingDef = {
  id: 'maison_ville_etroite',
  nameFr: 'Maison de ville étroite',
  category: 'house',
  footprint: { tilesX: 1, tilesZ: 2 },
  cost: 46000,
  upkeepPerMonth: 55,
  residents: 5,
  jobs: 0,
  density: 'moyenne',
  style: 'faubourg',
  tags: ['maison', 'ville', 'balconnets', 'ardoise'],
  source: `${SRC}#maisonVilleEtroite`,
  palette: basePalette({
    facade: { set: 'enduit_peint', color: '#e6c9b5' },
    encadrement: { set: 'enduit_blanc', color: '#faf7f0' },
    soubassement: { set: 'pierre_taille', color: '#b8b2a6' },
    toiture: { set: 'toit_ardoise', color: ARDOISE },
    poterie: { set: 'toit_ardoise', color: '#5d6166' },
    volet: { set: 'bardage_blanc', color: COLORS.blanc },
    porte: { set: 'bardage_blanc', color: '#2f4a5c' },
    cheminee: { set: 'enduit_peint', color: '#e6c9b5' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit rosé, volets blancs' },
    { id: 'vert', nameFr: 'Enduit vert d’eau, porte rouge', materialOverrides: { facade: { color: '#c6d6c8' }, cheminee: { color: '#c6d6c8' }, porte: { color: COLORS.rougeBasque } } },
    { id: 'ocre', nameFr: 'Enduit ocre jaune, volets gris', materialOverrides: { facade: { color: COLORS.ocreJaune }, cheminee: { color: COLORS.ocreJaune }, volet: { color: COLORS.grisAnthracite } } },
    { id: 'brique', nameFr: 'Brique et pierre', materialOverrides: { facade: { textureSet: 'brique_orange', color: '#ffffff' }, cheminee: { textureSet: 'brique_orange', color: '#ffffff' } } },
  ],
  build(ctx: Ctx): void {
    const x0 = -2.8, x1 = 2.8, z0 = -5.2, z1 = 5.2;
    const fh = [0, 3.3, 6.25];
    const eave = 9.2;
    const fr = { sill: false, leaves: 2, bars: 2, shutters: 'battants' as const, railing: 'fer' as const, surround: 0.13 };
    const F = volume(ctx, {
      x0, x1, z0, z1, h: eave, wallMat: 'facade',
      sides: {
        S: [
          { kind: 'door', r: rectAt(1.25, 1.1, 0.3, 2.65), o: { style: 'panneaux', transom: 0.5, steps: 0.3, surround: 0.15 } },
          { kind: 'window', r: rectAt(3.95, 1.25, 0.95, 1.85), o: { surround: 0.13, bars: 2, shutters: 'battants' } },
          ...row([1.4, 4.2], 1.1, fh[1]! + 0.05, 2.3, () => ({ kind: 'window', o: fr })),
          ...row([1.4, 4.2], 1.1, fh[2]! + 0.05, 2.2, () => ({ kind: 'window', o: fr })),
        ],
        N: [
          ...row([2.8], 1.4, 0.3, 2.3, () => ({ kind: 'window', o: { sill: false, leaves: 2, shutters: 'none' } })),
          ...row([1.4, 4.2], 1.0, fh[1]! + 0.95, 1.5, () => ({ kind: 'window', o: { surround: 0.12, shutters: 'battants' } })),
          ...row([1.4, 4.2], 1.0, fh[2]! + 0.95, 1.5, () => ({ kind: 'window', o: { surround: 0.12, shutters: 'battants' } })),
        ],
      },
      plinth: { h: 0.3, d: 0.05 },
      bands: [{ v: fh[1]! - 0.1, h: 0.16, d: 0.06 }, { v: fh[2]! - 0.1, h: 0.14, d: 0.05 }],
      cornice: { profile: [[0.12, 0.06], [0.14, 0.16], [0.1, 0.26]], v: eave - 0.36 },
    });
    const roof = gableRoof(ctx, { x0, x1, z0, z1, y: eave, pitch: 42, axis: 'x', overhang: 0.25, verge: 0.12, gableMat: 'facade' });
    const tn = Math.tan((42 * Math.PI) / 180);
    dormer(ctx, subFrame(F.S, 0, 0, -0.75, F.S.w, 12), F.S.w / 2, eave + 0.75 * tn + 0.1, 1.35, 1.4, 2.6, { wallMat: 'encadrement', roofMat: 'toiture', win: { bars: 1, leaves: 2 } });
    chimney(ctx, x0 + 0.4, -1.2, 0.6, 1.4, eave, roof.ridgeY + 0.6, { pots: 3 });
    chimney(ctx, x1 - 0.4, -1.2, 0.6, 1.4, eave, roof.ridgeY + 0.6, { pots: 2 });
    downpipe(ctx, F.S, F.S.w - 0.18, roof.eaveY);
  },
};

/* ------------------------------------------------------------------ */
/* 7. Mas provençal en L : génoise, tuiles canal, pergola               */
/* ------------------------------------------------------------------ */
export const masProvencal: BuildingDef = {
  id: 'maison_mas_provencal',
  nameFr: 'Mas provençal en L',
  category: 'house',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 64000,
  upkeepPerMonth: 75,
  residents: 6,
  jobs: 0,
  density: 'faible',
  style: 'provencal',
  tags: ['maison', 'tuiles', 'genoise', 'pergola', 'sud'],
  source: `${SRC}#masProvencal`,
  palette: basePalette({
    facade: { set: 'enduit_creme', color: '#ecd2a4' },
    encadrement: { set: 'enduit_blanc', color: '#f6efe0' },
    soubassement: { set: 'pierre_rustique', color: '#c9bba3' },
    toiture: { set: 'toit_tuiles', color: '#f0d0b8' },
    poterie: { set: 'toit_tuiles', color: '#d9926a' },
    volet: { set: 'bardage_blanc', color: COLORS.lavande },
    porte: { set: 'bardage_blanc', color: '#7d8fb3' },
    bois: { set: 'bardage_bois', color: '#f2e2cf' },
    cheminee: { set: 'enduit_creme', color: '#ecd2a4' },
    rive: { set: 'enduit_creme', color: '#ecd2a4' },
  }),
  variants: [
    { id: 'origine', nameFr: 'Ocre clair, volets lavande' },
    { id: 'rouge', nameFr: 'Ocre rouge, volets vert olive', materialOverrides: { facade: { color: COLORS.ocreRouge }, cheminee: { color: COLORS.ocreRouge }, rive: { color: COLORS.ocreRouge }, volet: { color: '#7c8a5a' }, porte: { color: '#7c8a5a' } } },
    { id: 'pierre', nameFr: 'Pierre apparente, volets bleus', materialOverrides: { facade: { textureSet: 'pierre_moellons', color: '#f3e7d2' }, volet: { color: COLORS.bleuCharron }, porte: { color: COLORS.bleuCharron } } },
  ],
  build(ctx: Ctx): void {
    const { mb } = ctx;
    const M = { x0: -6.2, x1: 6.0, z0: -3.6, z1: 3.6 };
    const eave = 5.7;
    const w = { surround: 0.12, shutters: 'battants' as const, bars: 2 };
    const F = volume(ctx, {
      ...M, h: eave, wallMat: 'facade',
      sides: {
        S: [
          { kind: 'door', r: rectAt(1.6, 1.0, 0.1, 2.2), o: { style: 'panneaux', canopy: 'tuiles', surround: 0.14 } },
          { kind: 'window', r: rectAt(3.6, 1.3, 0.1, 2.2), o: { ...w, sill: false, leaves: 2 } },
          { kind: 'window', r: rectAt(5.6, 1.3, 0.1, 2.2), o: { ...w, sill: false, leaves: 2 } },
          ...row([1.6, 3.6, 5.6], 0.95, 3.6, 1.3, () => ({ kind: 'window', o: w })),
        ],
        N: [...row([2.0, 6.0, 10.0], 0.9, 1.1, 1.2, () => ({ kind: 'window', o: w })), ...row([2.0, 6.0, 10.0], 0.9, 3.7, 1.2, () => ({ kind: 'window', o: w }))],
        W: [...row([3.6], 0.9, 1.1, 1.2, () => ({ kind: 'window', o: w })), ...row([2.4, 4.8], 0.8, 3.7, 1.1, () => ({ kind: 'window', o: w }))],
        E: [...row([1.6], 0.8, 3.7, 1.1, () => ({ kind: 'window', o: w }))],
      },
      plinth: { h: 0.35, d: 0.03 },
    });
    const roof = gableRoof(ctx, { ...M, y: eave, pitch: 21, axis: 'x', overhang: 0.42, verge: 0.12, gableMat: 'facade', thickness: 0.16 });
    genoise(ctx, F.S, eave, 2);
    genoise(ctx, F.N, eave, 2);
    // aile basse en retour d'équerre (côté est)
    const A = { x0: 1.8, x1: 6.0, z0: M.z1, z1: 8.2 };
    const ah = 3.2;
    const AF = volume(ctx, {
      ...A, h: ah, wallMat: 'facade', hidden: ['N'],
      sides: {
        S: [{ kind: 'window', r: rectAt(2.1, 1.0, 1.0, 1.2), o: w }],
        W: [{ kind: 'door', r: rectAt(2.4, 1.6, 0.05, 2.3), o: { style: 'double' } }],
        E: row([1.5, 3.3], 0.8, 1.0, 1.1, () => ({ kind: 'window', o: w })),
      },
      plinth: { h: 0.35, d: 0.03 },
    });
    gableRoof(ctx, { ...A, y: ah, pitch: 21, axis: 'z', overhang: 0.35, verge: 0.12, gableMat: 'facade', gables: [false, true], thickness: 0.16 });
    genoise(ctx, AF.W, ah, 1);
    genoise(ctx, AF.E, ah, 1);
    chimney(ctx, -3.0, -0.6, 0.7, 0.7, eave, roof.ridgeY + 0.5, { pots: 0, capMat: 'poterie' });
    // pergola bois devant la façade
    const pz = 6.6;
    if (ctx.lod < 2) {
      for (const x of [-5.8, -3.4, -1.0, 1.4]) mb.box('bois', x - 0.09, 0, pz - 0.09, x + 0.09, 2.6, pz + 0.09, 'ny');
      for (const z of [pz, M.z1 + 0.05]) mb.box('bois', -6.1, 2.6, z - 0.08, 1.7, 2.82, z + 0.08, '');
      const n = ctx.lod === 0 ? 10 : 5;
      for (let i = 0; i < n; i++) {
        const x = -5.9 + (7.4 * i) / (n - 1);
        mb.box('bois', x - 0.05, 2.82, M.z1, x + 0.05, 2.95, pz + 0.35, '');
      }
    } else {
      mb.box('bois', -6.1, 2.6, M.z1, 1.7, 2.95, pz + 0.3, 'ny');
    }
    // dallage de terrasse
    mb.box('soubassement', -6.2, 0, M.z1, 1.8, 0.08, pz + 0.4, 'ny nz');
  },
};

export const HOUSES: BuildingDef[] = [pavillonEnduit, maisonBriquePignon, chaletBois, villaModerne, longerePierre, maisonVilleEtroite, masProvencal];

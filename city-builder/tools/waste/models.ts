/**
 * Modèles ORIGINAUX du module « Déchets » (phase 2B.6), construits avec le kit de bâtiments (tools/buildings/kit) :
 * géométrie en code, UV en mètres, matériaux PBR partagés (textures externes du catalogue, aucun pixel dupliqué),
 * export GLB LOD0/1/2 quantifié. Licence CC0 (projet).
 *  - dépôt de camions-bennes (halle à 4 travées, bureaux, aire de lavage) ;
 *  - centre de tri (halle bardée, quai de déchargement, convoyeur, balles de matériaux triés) ;
 *  - incinérateur (halle de fosse, chaudière, grande cheminée dont le sommet = WASTE_MODEL_ANCHORS.chimneyTop) ;
 *  - décharge (casier sur géomembrane, digues, pont-bascule et loge, bassin de lixiviats, clôture) ;
 *  - tumulus (relief de déchets recouvert de terre, mis à l'échelle par le rendu selon le remplissage) ;
 *  - conteneurs de tri de rue (verre, papier, emballages) sur dalle.
 * Repère : mètres, Y vers le haut, façade principale (rue) vers +Z, origine au centre de l'emprise.
 */
import { flatRoof, gableRoof, rectAt, row, bays, shedRoof, volume, type BuildingDef, type Ctx, type V3 } from '../buildings/kit/index';
import { edgeFrame, factoryChimney, fbox, fence, hCylinder, lampPost, lettering, loadingDock, M, mark, npPalette, slab } from '../buildings/nonresidential/parts';
import { WASTE_MODEL_ANCHORS, WASTE_MODEL_IDS } from '../../src/shared/waste/types';
import type { AssetCategory } from '../../src/shared/catalog';

const SRC = 'tools/waste/models.ts';
const segs = (ctx: Ctx, a: number, b: number, c: number): number => (ctx.lod === 0 ? a : ctx.lod === 1 ? b : c);

/** Balle de matériaux compactés (cube cerclé). */
function bale(ctx: Ctx, mat: string, x: number, y: number, z: number, s = 1.1): void {
  ctx.mb.box(mat, x - s / 2, y, z - s / 2, x + s / 2, y + s * 0.9, z + s / 2, 'ny');
  if (ctx.lod === 0) for (const k of [0.25, 0.65]) ctx.mb.box('garde_corps', x - s / 2 - 0.01, y + s * 0.9 * k, z - s / 2 - 0.01, x + s / 2 + 0.01, y + s * 0.9 * k + 0.03, z + s / 2 + 0.01, 'ny py');
}

/** Benne ouverte (caisson amovible) : fond, parois inclinées, renforts. */
function skip(ctx: Ctx, x: number, z: number, L = 5.5, W = 2.3, H = 1.6, mat = 'benne'): void {
  const y = 0.08;
  ctx.mb.box(mat, x - L / 2, y, z - W / 2, x + L / 2, y + 0.15, z + W / 2, 'ny');
  for (const s of [-1, 1]) ctx.mb.box(mat, x - L / 2, y + 0.15, z + s * W / 2 - (s > 0 ? 0.08 : 0), x + L / 2, y + H, z + s * W / 2 + (s < 0 ? 0.08 : 0), '');
  for (const s of [-1, 1]) ctx.mb.box(mat, x + s * L / 2 - (s > 0 ? 0.08 : 0), y + 0.15, z - W / 2, x + s * L / 2 + (s < 0 ? 0.08 : 0), y + H, z + W / 2, '');
  if (ctx.lod < 2) {
    ctx.mb.box('dechets_vrac', x - L / 2 + 0.1, y + 0.15, z - W / 2 + 0.1, x + L / 2 - 0.1, y + H * 0.7, z + W / 2 - 0.1, 'ny');
    for (let k = 0; k < 4; k++) ctx.mb.box('garde_corps', x - L / 2 + 0.6 + k * (L - 1.2) / 3 - 0.06, y + 0.15, z + W / 2, x - L / 2 + 0.6 + k * (L - 1.2) / 3 + 0.06, y + H, z + W / 2 + 0.06, 'ny');
  }
}

/* ------------------------------------------------------------------ */
/* Dépôt de camions-bennes                                              */
/* ------------------------------------------------------------------ */
export const depot: BuildingDef = {
  id: WASTE_MODEL_IDS.depot,
  nameFr: 'Dépôt de camions-bennes',
  category: 'public',
  footprint: { tilesX: 4, tilesZ: 3 },
  cost: 900_000,
  upkeepPerMonth: 1500,
  residents: 0,
  jobs: 24,
  density: 'faible',
  style: 'equipement_technique',
  tags: ['public', 'dechets', 'service:dechets', 'dechets:depot', 'camions:4'],
  source: `${SRC}#depot`,
  lodDistances: [200, 700],
  frontage: [{ x: -4, z: 12, nx: 0, nz: 1, kind: 'delivery' }],
  palette: npPalette({
    facade: M('bardage_composite', '#e7ecea'),
    facade_b: M('enduit_peint', '#4f8a4b'),
    toiture: M('toit_bac_acier', '#c9cdd0'),
    porte_garage: M('porte_garage', '#dfe4e2'),
    menuiserie: M('metal_rideau', '#3a4a40', { metalness: 0.8, roughness: 0.5 }),
    lettres: M('enduit_blanc', '#ffffff'),
    benne: M('metal_conteneur', '#3d7a3a'),
    dechets_vrac: M('terrain_gravier', '#7d6f5c'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Bardage clair, bandeau vert propreté' },
    { id: 'gris', nameFr: 'Bardage gris, bandeau bleu', materialOverrides: { facade: { color: '#b9bec2' }, facade_b: { color: '#2f62b0' } } },
  ],
  build(ctx: Ctx): void {
    // Sol de la parcelle (emprise complète : origine centrée).
    slab(ctx, 'beton', -15.6, -11.6, 15.6, 11.6, 0, 0.08);
    // Halle à 4 travées de remisage (portes sectionnelles sur la cour).
    const x0 = -15.2, x1 = 6.8, z0 = -11.2, z1 = 1.8, H = 6.2;
    const W = x1 - x0;
    const us = bays(W, 4, 0.5);
    volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S: us.map((u) => ({ kind: 'garage' as const, r: rectAt(u, 4.0, 0.08, 4.6) })),
        W: row(bays(z1 - z0, 3, 0.8), 1.6, 3.6, 1.2),
        N: row(bays(W, 5, 0.8), 1.8, 3.8, 1.0),
      },
      plinth: { h: 0.4, d: 0.04, mat: 'beton' },
      bands: [{ v: H - 1.0, h: 0.9, d: 0.06, mat: 'facade_b' }],
    });
    shedRoof(ctx, { x0, x1, z0, z1, yLow: H, yHigh: H + 1.2, low: 'S', overhang: 0.4, roofMat: 'toiture', wallMat: 'facade' });
    const fs = edgeFrame(x0, z1 + 0.07, x1, z1 + 0.07, 0, H);
    lettering(ctx, 'lettres', fs, 'PROPRETE URBAINE', W / 2, H - 0.85, 0.55, 0.02, 0.05);
    // Bureaux et vestiaires (R+1) à l'est.
    const ox0 = 7.4, ox1 = 15.2, oz0 = -11.2, oz1 = -1.0;
    volume(ctx, {
      x0: ox0, x1: ox1, z0: oz0, z1: oz1, h: 6.6, wallMat: 'facade_b',
      sides: {
        S: [{ kind: 'door', r: rectAt(2.0, 1.2, 0.08, 2.3), o: { style: 'vitree', canopy: 'dalle' } }, ...row([4.4, 6.4], 1.3, 1.0, 1.5), ...row(bays(ox1 - ox0, 3, 0.5), 1.3, 4.0, 1.5)],
        E: [0, 1].flatMap((f) => row(bays(oz1 - oz0, 3, 0.6), 1.3, 1.0 + f * 3.0, 1.5)),
      },
      hidden: ['W'], plinth: { h: 0.4, d: 0.04, mat: 'beton' },
    });
    flatRoof(ctx, { x0: ox0, x1: ox1, z0: oz0, z1: oz1, y: 6.6, parapet: 7.1, wallMat: 'facade_b' });
    // Cour : marquages de stationnement des bennes, aire de lavage, bennes de réserve, lampadaires.
    for (let k = 0; k < 4; k++) mark(ctx, us[k]! + x0 - 0.06, 2.2, us[k]! + x0 + 0.06, 8.6, 0.09, 'marquage_j');
    slab(ctx, 'dallage', 7.6, 0.4, 15.2, 6.6, 0.08, 0.06);
    if (ctx.lod < 2) {
      ctx.mb.box('acier', 7.8, 0.14, 0.6, 8.0, 4.4, 0.8);
      ctx.mb.box('acier', 14.8, 0.14, 0.6, 15.0, 4.4, 0.8);
      ctx.mb.box('acier', 7.8, 4.4, 0.6, 15.0, 4.6, 0.8);
    }
    skip(ctx, 11.4, 9.2);
    lampPost(ctx, -14.6, 0.08, 10.8, 7, [1, 0, 0]);
    lampPost(ctx, 2.0, 0.08, 10.8, 7, [-1, 0, 0]);
    if (ctx.lod < 2) {
      fence(ctx, [-15.5, 0.08, 11.5], [-6.5, 0.08, 11.5], 1.8);
      fence(ctx, [-15.5, 0.08, -11.5], [-15.5, 0.08, 11.5], 1.8);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Centre de tri                                                        */
/* ------------------------------------------------------------------ */
export const centreTri: BuildingDef = {
  id: WASTE_MODEL_IDS.tri,
  nameFr: 'Centre de tri des déchets',
  category: 'public',
  footprint: { tilesX: 5, tilesZ: 4 },
  cost: 1_800_000,
  upkeepPerMonth: 2500,
  residents: 0,
  jobs: 40,
  density: 'moyenne',
  style: 'equipement_technique',
  tags: ['public', 'dechets', 'recyclage', 'service:dechets', 'dechets:tri', 'capacite_jour:30000'],
  source: `${SRC}#centreTri`,
  lodDistances: [220, 800],
  frontage: [{ x: 8, z: 16, nx: 0, nz: 1, kind: 'delivery' }],
  palette: npPalette({
    facade: M('bardage_composite', '#dfe6e3'),
    facade_b: M('bardage_composite', '#6aa36a'),
    toiture: M('toit_bac_acier', '#c2c7ca'),
    lettres: M('enduit_blanc', '#ffffff'),
    balle_verte: M('metal_conteneur', '#5b8f45'),
    balle_bleue: M('metal_conteneur', '#3f6fae'),
    balle_jaune: M('metal_conteneur', '#d9b43a'),
    convoyeur: M('metal_rideau', '#6f7a72', { metalness: 0.7 }),
    benne: M('metal_conteneur', '#3d7a3a'),
    dechets_vrac: M('terrain_gravier', '#8a7b66'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Bardage clair et vert' },
    { id: 'bleu', nameFr: 'Bardage clair et bleu', materialOverrides: { facade_b: { color: '#4f7fb5' } } },
  ],
  build(ctx: Ctx): void {
    slab(ctx, 'beton', -19.6, -15.6, 19.6, 15.6, 0, 0.08);
    // Grande halle de tri (charpente à deux pans), bande colorée basse.
    const x0 = -19.0, x1 = 9.0, z0 = -15.0, z1 = 5.0, H = 9.0;
    const W = x1 - x0;
    const F = volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S: [{ kind: 'blind', r: rectAt(5.0, 5.0, 1.2, 4.8) }, { kind: 'blind', r: rectAt(12.0, 5.0, 1.2, 4.8) }, ...row(bays(W, 7, 1.0).slice(3), 2.0, 6.2, 1.4)],
        E: row(bays(z1 - z0, 4, 1.0), 2.2, 6.0, 1.4),
        N: row(bays(W, 8, 1.0), 2.2, 6.0, 1.4),
        W: [{ kind: 'door', r: rectAt(3, 1.2, 0.08, 2.3), o: { style: 'moderne' } }],
      },
      plinth: { h: 0.6, d: 0.04, mat: 'beton' },
      bands: [{ v: 0.6, h: 3.0, d: 0.03, mat: 'facade_b' }],
    });
    loadingDock(ctx, F.S, rectAt(5.0, 5.0, 1.2, 4.8), 1.2);
    loadingDock(ctx, F.S, rectAt(12.0, 5.0, 1.2, 4.8), 1.2);
    gableRoof(ctx, { x0, x1, z0, z1, y: H, pitch: 12, axis: 'x', overhang: 0.5, verge: 0.3, gableMat: 'facade' });
    const fs = edgeFrame(x0, z1 + 0.05, x1, z1 + 0.05, 0, H);
    lettering(ctx, 'lettres', fs, 'CENTRE DE TRI', W / 2 + 4, H - 1.3, 0.8, 0.02, 0.06);
    // Bâtiment de stockage des balles (ouvert), convoyeur incliné depuis la halle.
    const sx0 = 10.0, sx1 = 19.0, sz0 = -15.0, sz1 = -2.0;
    for (const x of [sx0 + 0.2, sx1 - 0.2]) for (const z of [sz0 + 0.2, (sz0 + sz1) / 2, sz1 - 0.2]) ctx.mb.box('acier', x - 0.18, 0.08, z - 0.18, x + 0.18, 6.0, z + 0.18, 'ny');
    shedRoof(ctx, { x0: sx0, x1: sx1, z0: sz0, z1: sz1, yLow: 6.0, yHigh: 6.8, low: 'E', overhang: 0.3, roofMat: 'toiture', wallMat: 'facade' });
    ctx.mb.box('facade', sx0, 0.08, sz0, sx1, 6.0, sz0 + 0.2, '');
    const mats = ['balle_verte', 'balle_bleue', 'balle_jaune'];
    const nx = ctx.lod === 2 ? 2 : 5, nz = ctx.lod === 2 ? 3 : 8;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lv = (i + j) % 3 === 0 ? 2 : 1;
      for (let k = 0; k < lv; k++) bale(ctx, mats[(i + j + k) % 3]!, sx0 + 1.4 + i * (7 / Math.max(1, nx - 1)) * 0.95, 0.08 + k * 1.0, sz0 + 1.4 + j * (10 / Math.max(1, nz - 1)) * 0.95, ctx.lod === 2 ? 1.6 : 1.1);
    }
    hCylinder(ctx, 'convoyeur', [6.0, 6.5, -6.0], [12.5, 4.5, -6.0], 0.6, segs(ctx, 10, 6, 4), true);
    if (ctx.lod < 2) for (const x of [8.5, 11.0]) ctx.mb.box('acier', x - 0.12, 0.08, -6.12, x + 0.12, 5.4, -5.88, 'ny');
    // Cour : bennes de refus, marquages.
    skip(ctx, -12.0, 12.0);
    skip(ctx, 14.0, 12.0, 5.5, 2.3, 1.6);
    mark(ctx, -19.0, 7.0, 19.0, 7.15, 0.09, 'marquage');
    lampPost(ctx, -2.0, 0.08, 14.6, 7, [0, 0, -1]);
  },
};

/* ------------------------------------------------------------------ */
/* Incinérateur (unité de valorisation énergétique)                     */
/* ------------------------------------------------------------------ */
export const incinerateur: BuildingDef = {
  id: WASTE_MODEL_IDS.incinerateur,
  nameFr: 'Incinérateur (valorisation énergétique)',
  category: 'public',
  footprint: { tilesX: 5, tilesZ: 4 },
  cost: 4_500_000,
  upkeepPerMonth: 5000,
  residents: 0,
  jobs: 35,
  density: 'moyenne',
  style: 'equipement_technique',
  tags: ['public', 'dechets', 'energie', 'cheminee', 'service:dechets', 'dechets:incinerateur', 'capacite_jour:60000'],
  source: `${SRC}#incinerateur`,
  lodDistances: [260, 1000],
  frontage: [{ x: -10, z: 16, nx: 0, nz: 1, kind: 'delivery' }],
  palette: npPalette({
    facade: M('beton_facade', '#d6d3cc'),
    facade_b: M('panneaux_facade_sombres', '#9aa3a8'),
    toiture: M('toit_bac_acier', '#b3b8bb'),
    cheminee: M('beton_facade', '#cfcbc3'),
    lettres: M('enduit_blanc', '#ffffff'),
    tuyau: M('metal_rideau', '#8f989d', { metalness: 0.9, roughness: 0.4 }),
    rayure: M('enduit_peint', '#c8412f'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton clair, caissons gris' },
    { id: 'cuivre', nameFr: 'Béton clair, caissons cuivrés', materialOverrides: { facade_b: { color: '#b07a52' } } },
  ],
  build(ctx: Ctx): void {
    slab(ctx, 'beton', -19.6, -15.6, 19.6, 15.6, 0, 0.08);
    // Hall de déchargement et fosse (bas, sur la rue).
    const hx0 = -19.0, hx1 = -3.0, hz0 = -12.0, hz1 = 4.0;
    const F = volume(ctx, {
      x0: hx0, x1: hx1, z0: hz0, z1: hz1, h: 12.0, wallMat: 'facade',
      sides: { S: [{ kind: 'blind', r: rectAt(5.0, 5.0, 0.08, 5.5) }, { kind: 'blind', r: rectAt(11.5, 5.0, 0.08, 5.5) }], W: row(bays(hz1 - hz0, 4, 1.0), 1.4, 8.5, 2.0) },
      plinth: { h: 0.6, d: 0.04, mat: 'beton' },
    });
    for (const u of [5.0, 11.5]) {
      fbox(ctx, 'store', F.S, u - 2.5, u + 2.5, 0.08, 5.5, -0.15, -0.05, 'back');
      fbox(ctx, 'facade_b', F.S, u - 3.2, u + 3.2, 5.5, 6.3, 0, 1.8, 'back');
    }
    flatRoof(ctx, { x0: hx0, x1: hx1, z0: hz0, z1: hz1, y: 12.0, parapet: 12.6, wallMat: 'facade' });
    // Chaudière et traitement des fumées (haut volume en caissons sombres).
    const bx0 = -3.0, bx1 = 15.0, bz0 = -14.5, bz1 = 2.0, BH = 22.0;
    volume(ctx, {
      x0: bx0, x1: bx1, z0: bz0, z1: bz1, h: BH, wallMat: 'facade_b',
      sides: { S: row(bays(bx1 - bx0, 6, 1.0), 1.4, 16.0, 3.5), E: row(bays(bz1 - bz0, 5, 1.0), 1.4, 16.0, 3.5) },
      hidden: ['W'], plinth: { h: 0.6, d: 0.04, mat: 'beton' },
      bands: [{ v: 12.0, h: 0.4, d: 0.08, mat: 'facade' }],
    });
    gableRoof(ctx, { x0: bx0, x1: bx1, z0: bz0, z1: bz1, y: BH, pitch: 10, axis: 'x', overhang: 0.4, gableMat: 'facade_b' });
    const fs = edgeFrame(bx0, bz1 + 0.05, bx1, bz1 + 0.05, 0, BH);
    lettering(ctx, 'lettres', fs, 'VALORISATION', (bx1 - bx0) / 2, 13.0, 1.2, 0.02, 0.08);
    // Grande cheminée (sommet = WASTE_MODEL_ANCHORS.chimneyTop), bagues rouges, conduit de fumées.
    const [cx, cy, cz] = WASTE_MODEL_ANCHORS.chimneyTop;
    factoryChimney(ctx, cx, cz, 0, cy - 1.1, 2.0, 1.3, 'cheminee');
    if (ctx.lod < 2) for (const y of [cy - 6, cy - 3.5]) ctx.mb.cylinder('rayure', cx, y, cz, 1.42, 1.0, segs(ctx, 20, 12, 8), false, 1.38);
    hCylinder(ctx, 'tuyau', [bx1 - 1.0, 18.0, cz], [cx - 1.6, 18.0, cz], 0.9, segs(ctx, 12, 8, 5), true);
    // Aérocondenseurs et transformateur à l'est, au sol.
    if (ctx.lod < 2) {
      for (let k = 0; k < 3; k++) {
        const x = 2.0 + k * 4.0;
        ctx.mb.box('acier', x - 1.6, 0.08, 6.0, x + 1.6, 4.0, 9.5, 'ny');
        ctx.mb.cylinder('garde_corps', x, 4.0, 7.75, 1.3, 0.3, segs(ctx, 16, 10, 6), true);
      }
    }
    ctx.mb.box('equipement', 15.0, 0.08, 6.0, 18.5, 3.2, 10.0, 'ny');
    skipYard(ctx);
  },
};
function skipYard(ctx: Ctx): void {
  mark(ctx, -19.0, 8.0, -3.0, 8.15, 0.09, 'marquage_j');
  lampPost(ctx, -11.0, 0.08, 14.5, 8, [0, 0, -1]);
  lampPost(ctx, 8.0, 0.08, 14.5, 8, [0, 0, -1]);
  if (ctx.lod < 2) fence(ctx, [-19.5, 0.08, 15.5], [-17.0, 0.08, 15.5], 2.0);
}

/* ------------------------------------------------------------------ */
/* Décharge (installation de stockage)                                  */
/* ------------------------------------------------------------------ */
export const decharge: BuildingDef = {
  id: WASTE_MODEL_IDS.decharge,
  nameFr: 'Décharge contrôlée',
  category: 'public',
  footprint: { tilesX: 8, tilesZ: 8 },
  cost: 1_200_000,
  upkeepPerMonth: 1200,
  residents: 0,
  jobs: 8,
  density: 'faible',
  style: 'equipement_technique',
  tags: ['public', 'dechets', 'service:dechets', 'dechets:decharge', 'capacite_totale:3000000'],
  source: `${SRC}#decharge`,
  lodDistances: [260, 900],
  frontage: [{ x: 20, z: 32, nx: 0, nz: 1, kind: 'delivery' }],
  palette: npPalette({
    facade: M('bardage_blanc', '#e9e6dc'),
    toiture: M('toit_bac_acier', '#c2c6c8'),
    terre: M('terrain_terre', '#a48a6a'),
    membrane: M('sol_beton_brut', '#2b2d2e', { roughness: 0.6 }),
    eau: M('enduit_peint', '#4d6b5c', { roughness: 0.15 }),
    lettres: M('enduit_peint', '#2f5c3a'),
  }),
  variants: [{ id: 'origine', nameFr: 'Casier sur géomembrane, digues en terre' }],
  build(ctx: Ctx): void {
    // Plate-forme en grave (emprise complète).
    slab(ctx, 'gravier', -31.6, -31.6, 31.6, 31.6, 0, 0.06);
    // Casier : fond en géomembrane, digues trapézoïdales en terre (le tumulus se forme dessus).
    const [mx, mz] = WASTE_MODEL_ANCHORS.moundCenter;
    const hw = 27, hd = 23, dh = 2.2, dw = 3.0;
    slab(ctx, 'membrane', mx - hw, mz - hd, mx + hw, mz + hd, 0.06, 0.05);
    const berm = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
      // Digue le long de A->B, talus vers l'intérieur (n) et l'extérieur.
      const o: V3 = [nx * dw, 0, nz * dw];
      const A0: V3 = [ax - o[0], 0.06, az - o[2]], B0: V3 = [bx - o[0], 0.06, bz - o[2]];
      const A1: V3 = [ax - o[0] * 0.35, dh, az - o[2] * 0.35], B1: V3 = [bx - o[0] * 0.35, dh, bz - o[2] * 0.35];
      const A2: V3 = [ax + o[0] * 0.35, dh, az + o[2] * 0.35], B2: V3 = [bx + o[0] * 0.35, dh, bz + o[2] * 0.35];
      const A3: V3 = [ax + o[0], 0.06, az + o[2]], B3: V3 = [bx + o[0], 0.06, bz + o[2]];
      ctx.mb.polyFacing('terre', [A0, B0, B1, A1], [-nx, 1, -nz]);
      ctx.mb.polyFacing('terre', [A1, B1, B2, A2], [0, 1, 0]);
      ctx.mb.polyFacing('terre', [A2, B2, B3, A3], [nx, 1, nz]);
    };
    berm(mx - hw, mz - hd, mx + hw, mz - hd, 0, 1);
    berm(mx - hw, mz + hd, mx + hw, mz + hd, 0, -1);
    berm(mx - hw, mz - hd, mx - hw, mz + hd, 1, 0);
    berm(mx + hw, mz - hd, mx + hw, mz + hd, -1, 0);
    // Piste d'accès et pont-bascule, loge de contrôle à l'entrée (+Z).
    slab(ctx, 'sol', 14, 21, 26, 31.6, 0.06, 0.06);
    ctx.mb.box('acier', 17.0, 0.12, 23.5, 23.0, 0.35, 26.5, 'ny');
    const lx0 = 24.0, lx1 = 30.0, lz0 = 26.0, lz1 = 30.5;
    volume(ctx, {
      x0: lx0, x1: lx1, z0: lz0, z1: lz1, h: 3.2, wallMat: 'facade',
      sides: { W: row([2.25], 2.4, 1.0, 1.4), S: [{ kind: 'door', r: rectAt(4.5, 1.0, 0.06, 2.2), o: { style: 'moderne' } }, ...row([1.6], 1.6, 1.0, 1.4)] },
      plinth: { h: 0.3, d: 0.03, mat: 'beton' },
    });
    flatRoof(ctx, { x0: lx0 - 0.3, x1: lx1 + 0.3, z0: lz0 - 0.3, z1: lz1 + 0.3, y: 3.2, parapet: 3.5, wallMat: 'facade' });
    lettering(ctx, 'lettres', edgeFrame(lx0, lz1 + 0.31, lx1, lz1 + 0.31, 0, 3.5), 'CONTROLE', (lx1 - lx0) / 2, 2.55, 0.4, 0.02, 0.04);
    // Bassin de lixiviats (eau sombre, rebord).
    const px = -22, pz = 25;
    slab(ctx, 'beton', px - 7, pz - 4.5, px + 7, pz + 4.5, 0.06, 0.25);
    slab(ctx, 'eau', px - 6.4, pz - 3.9, px + 6.4, pz + 3.9, 0.31, 0.02);
    // Mâts d'éclairage du casier (hauteur ≥ 4 m : silhouette lisible de loin) et clôture périphérique.
    for (const [x, z] of [[-30, -30], [30, -30], [-30, 18], [30, 18]] as const) lampPost(ctx, x, 0.06, z, 9, [-Math.sign(x), 0, -Math.sign(z)]);
    if (ctx.lod < 2) {
      lightFence(ctx, [-31.5, -31.5], [31.5, -31.5]);
      lightFence(ctx, [-31.5, -31.5], [-31.5, 31.5]);
      lightFence(ctx, [31.5, -31.5], [31.5, 20.0]);
      lightFence(ctx, [-31.5, 31.5], [13.0, 31.5]);
    }
  },
};

/** Clôture légère de grand linéaire : poteaux tous les 5 m, deux lisses (treillis non modélisé). */
function lightFence(ctx: Ctx, a: [number, number], b: [number, number], h = 2.0): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(L / 5));
  const along = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
    ctx.mb.box('garde_corps', x - 0.05, 0.06, z - 0.05, x + 0.05, 0.06 + h, z + 0.05, 'ny');
  }
  for (const y of [0.5, h - 0.1]) {
    if (along) ctx.mb.box('garde_corps', Math.min(a[0], b[0]), y, a[1] - 0.02, Math.max(a[0], b[0]), y + 0.05, a[1] + 0.02, '');
    else ctx.mb.box('garde_corps', a[0] - 0.02, y, Math.min(a[1], b[1]), a[0] + 0.02, y + 0.05, Math.max(a[1], b[1]), '');
  }
}

/* ------------------------------------------------------------------ */
/* Tumulus (relief de déchets recouverts), échelle 1/5                  */
/* ------------------------------------------------------------------ */
/** Le modèle mesure 1/MOUND_MODEL_SCALE du tumulus plein ; le rendu le met à l'échelle (remplissage). */
export const MOUND_MODEL_SCALE = WASTE_MODEL_ANCHORS.moundModelScale;
export const tumulus: BuildingDef = {
  id: WASTE_MODEL_IDS.tumulus,
  nameFr: 'Tumulus de décharge',
  category: 'public', // remplacée par `prop` à l'export (WASTE_DECOR_CATEGORY)
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 0,
  upkeepPerMonth: 0,
  residents: 0,
  jobs: 0,
  density: 'faible',
  style: 'decharge',
  tags: ['dechets', 'decor', 'tumulus'],
  source: `${SRC}#tumulus`,
  lodDistances: [250, 900],
  palette: npPalette({
    terre: M('terrain_terre', '#8f7a5e'),
    couverture: M('terrain_herbe', '#7d8a4e'),
    dechets_vrac: M('terrain_gravier', '#9a8f7c'),
    bache: M('sol_beton_brut', '#33383a', { roughness: 0.55 }),
  }),
  variants: [{ id: 'origine', nameFr: 'Terre de couverture' }],
  build(ctx: Ctx): void {
    const [W, D, H] = WASTE_MODEL_ANCHORS.moundSize.map((v) => v / MOUND_MODEL_SCALE) as [number, number, number];
    const nx = segs(ctx, 18, 10, 6), nz = segs(ctx, 16, 9, 5);
    // Hauteur : plateau légèrement bombé, talus en pente douce (super-ellipse), relief déterministe au LOD0.
    const hAt = (u: number, v: number): number => {
      const d = Math.pow(Math.pow(Math.abs(u), 3.2) + Math.pow(Math.abs(v), 3.2), 1 / 3.2);
      const t = Math.min(1, Math.max(0, (1 - d) / 0.42));
      const s = t * t * (3 - 2 * t);
      const bump = ctx.lod === 0 ? 0.05 * Math.sin(u * 9.1 + v * 3.7) * Math.cos(v * 7.3 - u * 2.1) * s : 0;
      return H * (s * (0.92 + 0.08 * (1 - d)) + bump);
    };
    const P = (i: number, j: number): V3 => {
      const u = -1 + (2 * i) / nx, v = -1 + (2 * j) / nz;
      return [u * W / 2, Math.max(0, hAt(u, v)), v * D / 2];
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const ym = (a[1] + b[1] + c[1] + d[1]) / 4;
      const mat = ym < H * 0.12 ? 'terre' : ym > H * 0.85 ? 'dechets_vrac' : ((i * 7 + j * 3) % 5 === 0 && ctx.lod < 2 ? 'couverture' : 'terre');
      ctx.mb.polyFacing(mat, [a, b, c, d], [0, 1, 0]);
    }
    // Bâche de couverture partielle sur le flanc nord (LOD0/1).
    if (ctx.lod < 2) {
      const y = (u: number, v: number): number => Math.max(0, hAt(u, v)) + 0.03;
      const pts: V3[] = [[-0.5 * W / 2, y(-0.5, -0.55), -0.55 * D / 2], [0.1 * W / 2, y(0.1, -0.55), -0.55 * D / 2], [0.1 * W / 2, y(0.1, -0.2), -0.2 * D / 2], [-0.5 * W / 2, y(-0.5, -0.2), -0.2 * D / 2]];
      ctx.mb.polyFacing('bache', pts, [0, 1, 0]);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Conteneurs de tri de rue (point d'apport volontaire)                 */
/* ------------------------------------------------------------------ */
export const conteneurs: BuildingDef = {
  id: WASTE_MODEL_IDS.conteneurs,
  nameFr: 'Conteneurs de tri (verre, papier, emballages)',
  category: 'public', // remplacée par `street_furniture` à l'export (WASTE_DECOR_CATEGORY)
  footprint: { tilesX: 1, tilesZ: 1 },
  cost: 0,
  upkeepPerMonth: 0,
  residents: 0,
  jobs: 0,
  density: 'faible',
  style: 'mobilier_urbain',
  tags: ['dechets', 'mobilier', 'tri', 'conteneurs'],
  source: `${SRC}#conteneurs`,
  lodDistances: [80, 300],
  palette: npPalette({
    verre: M('metal_conteneur', '#3f7d45'),
    papier: M('metal_conteneur', '#3a64a8'),
    emballages: M('metal_conteneur', '#e0b62f'),
    couvercle: M('metal_rideau', '#5d6266', { metalness: 0.6 }),
    trappe: M('sol_beton_brut', '#1d1f20'),
    lettres: M('enduit_blanc', '#ffffff'),
  }),
  variants: [{ id: 'origine', nameFr: 'Trois flux' }],
  build(ctx: Ctx): void {
    slab(ctx, 'beton', -2.4, -0.9, 2.4, 0.9, 0, 0.1);
    const flows: [string, number][] = [['verre', -1.55], ['papier', 0], ['emballages', 1.55]];
    for (const [mat, x] of flows) {
      const w = 1.4, d = 1.3, h = 1.45;
      ctx.mb.box(mat, x - w / 2, 0.1, -d / 2, x + w / 2, 0.1 + h, d / 2, 'ny');
      // Toit en bâtière arrondie (LOD0 : cylindre couché ; sinon prisme).
      if (ctx.lod === 0) hCylinder(ctx, 'couvercle', [x - w / 2, 0.1 + h, 0], [x + w / 2, 0.1 + h, 0], d / 2, 10, true);
      else ctx.mb.polyFacing('couvercle', [[x - w / 2, 0.1 + h, -d / 2], [x + w / 2, 0.1 + h, -d / 2], [x + w / 2, 0.1 + h + 0.3, 0], [x - w / 2, 0.1 + h + 0.3, 0]], [0, 1, -1]);
      if (ctx.lod === 1) ctx.mb.polyFacing('couvercle', [[x - w / 2, 0.1 + h + 0.3, 0], [x + w / 2, 0.1 + h + 0.3, 0], [x + w / 2, 0.1 + h, d / 2], [x - w / 2, 0.1 + h, d / 2]], [0, 1, 1]);
      // Trappe d'introduction (face rue +Z) et levier de levage sur le toit.
      if (ctx.lod < 2) {
        const f = edgeFrame(x - w / 2, d / 2 + 0.005, x + w / 2, d / 2 + 0.005, 0.1, h);
        if (mat === 'verre') { ctx.mb.cylinder('trappe', x, 0.1 + h * 0.7, d / 2 - 0.05, 0.16, 0.08, 10, true); }
        else fbox(ctx, 'trappe', f, w / 2 - 0.35, w / 2 + 0.35, h * 0.62, h * 0.74, 0, 0.02, 'back');
        if (ctx.lod === 0) ctx.mb.box('couvercle', x - 0.06, 0.1 + h + d / 2 - 0.05, -0.06, x + 0.06, 0.1 + h + d / 2 + 0.35, 0.06, 'ny');
      }
      if (ctx.lod === 0) for (const s of [-1, 1]) ctx.mb.box('couvercle', x + s * (w / 2 - 0.12) - 0.06, 0.1, d / 2 - 0.02, x + s * (w / 2 - 0.12) + 0.06, 0.1 + h, d / 2 + 0.04, 'ny');
    }
  },
};

export const WASTE_BUILDINGS: BuildingDef[] = [depot, centreTri, incinerateur, decharge, tumulus, conteneurs];

/** Modèles de décor (non constructibles) : le kit ne connaît que les catégories de bâtiments. */
export const WASTE_DECOR_CATEGORY: Record<string, AssetCategory> = {
  [WASTE_MODEL_IDS.tumulus]: 'prop',
  [WASTE_MODEL_IDS.conteneurs]: 'street_furniture',
};

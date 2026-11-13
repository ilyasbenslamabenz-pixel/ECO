/**
 * Modèles ORIGINAUX du service de l'eau (phase 2B.5), construits avec le kit procédural de bâtiments
 * (tools/buildings/kit, briques de tools/buildings/nonresidential/parts.ts — importées, non modifiées) :
 *  - station de pompage (maison des pompes en brique, conduite d'aspiration vers l'arrière, ponts roulants) ;
 *  - usine de potabilisation (halle des filtres, deux décanteurs circulaires, cuves de réactifs, tuyauteries) ;
 *  - château d'eau (fût béton, cuve tronconique et cylindrique, coupole, échelle, garde-corps) ;
 *  - station d'épuration (bassins d'aération, clarificateur à pont racleur, digesteur, bâtiment d'exploitation) ;
 *  - émissaire (regard de rejet, conduite et tête d'ouvrage à clapet, armoire, clôture).
 * Convention du kit : Y vers le haut, façade principale (côté rue) vers +Z, LOD 0 complet / 1 allégé / 2 silhouettes.
 */
import { bays, flatRoof, gableRoof, rectAt, row, volume, type BuildingDef, type Ctx, type V3 } from '../buildings/kit/index';
import { dome, fence, hCylinder, lampPost, lettering, M, npPalette, railingSimple, signPanel, slab, spire } from '../buildings/nonresidential/parts';

const SRC = 'tools/water-network/models.ts';

/** Rôles propres au service de l'eau (ajoutés à la palette des équipements). */
const WATER_ROLES = {
  eau: M('enduit_peint', '#2f86a0', { roughness: 0.12 }),
  cone: M('beton_facade', '#f3efe8'),
  eau_usee: M('enduit_peint', '#6b6a4a', { roughness: 0.3 }),
  conduite: M('metal_rideau', '#2f6f9f', { metalness: 0.7, roughness: 0.45 }),
  conduite_b: M('metal_rideau', '#7c5a3a', { metalness: 0.6, roughness: 0.5 }),
  beton: M('beton_facade', '#cfcac0'),
  beton_b: M('sol_beton_brut', '#b9b4aa'),
  vanne: M('enduit_peint', '#c8372d', { roughness: 0.5 }),
  passerelle: M('metal_larme', '#9aa0a4', { metalness: 0.9, roughness: 0.5 }),
};

const seg = (ctx: Ctx, hi: number, mid: number, lo: number): number => (ctx.lod === 0 ? hi : ctx.lod === 1 ? mid : lo);

/** Bassin circulaire : paroi béton, plan d'eau, margelle. */
function roundBasin(ctx: Ctx, x: number, z: number, r: number, h: number, water = 'eau'): void {
  const n = seg(ctx, 28, 16, 10);
  ctx.mb.cylinder('beton', x, 0, z, r, h, n, false);
  ctx.mb.cylinder(water, x, h - 0.35, z, r - 0.25, 0.01, n, true);
  if (ctx.lod < 2) ctx.mb.cylinder('beton_b', x, h, z, r + 0.15, 0.12, n, true, r + 0.15);
}

/** Bassin rectangulaire (paroi + plan d'eau) ; `bubbles` : rangées de diffuseurs d'aération (LOD0). */
function rectBasin(ctx: Ctx, x0: number, z0: number, x1: number, z1: number, h: number, water: string, bubbles = 0): void {
  const t = 0.3;
  ctx.mb.box('beton', x0, 0, z0, x1, h, z0 + t, 'ny');
  ctx.mb.box('beton', x0, 0, z1 - t, x1, h, z1, 'ny');
  ctx.mb.box('beton', x0, 0, z0 + t, x0 + t, h, z1 - t, 'ny pz nz');
  ctx.mb.box('beton', x1 - t, 0, z0 + t, x1, h, z1 - t, 'ny pz nz');
  ctx.mb.box(water, x0 + t, h - 0.4, z0 + t, x1 - t, h - 0.39, z1 - t, 'ny px nx pz nz');
  if (ctx.lod === 0 && bubbles > 0) {
    for (let k = 1; k <= bubbles; k++) {
      const z = z0 + ((z1 - z0) * k) / (bubbles + 1);
      for (let x = x0 + 1.2; x < x1 - 1; x += 1.6) ctx.mb.cylinder('beton_b', x, h - 0.39, z, 0.28, 0.03, 6, true);
    }
  }
}

/** Passerelle métallique (caillebotis + garde-corps des deux côtés). */
function walkway(ctx: Ctx, A: V3, B: V3, w = 1.1): void {
  const dx = B[0] - A[0], dz = B[2] - A[2];
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * (w / 2), nz = (dx / L) * (w / 2);
  const y = A[1];
  ctx.mb.poly('passerelle', [[A[0] - nx, y, A[2] - nz], [B[0] - nx, y, B[2] - nz], [B[0] + nx, y, B[2] + nz], [A[0] + nx, y, A[2] + nz]]);
  if (ctx.lod < 2) {
    railingSimple(ctx, [A[0] - nx, y, A[2] - nz], [B[0] - nx, y, B[2] - nz], 1.0);
    railingSimple(ctx, [A[0] + nx, y, A[2] + nz], [B[0] + nx, y, B[2] + nz], 1.0);
  }
}

/** Volant de vanne (roue rouge) sur un axe vertical. */
function valve(ctx: Ctx, x: number, y: number, z: number): void {
  if (ctx.lod === 2) return;
  ctx.mb.cylinder('garde_corps', x, y, z, 0.06, 0.6, 6, false);
  ctx.mb.cylinder('vanne', x, y + 0.6, z, 0.32, 0.06, seg(ctx, 12, 8, 6), true);
}

/* ------------------------------------------------------------------ */
/* 1. Station de pompage                                                */
/* ------------------------------------------------------------------ */
export const stationPompage: BuildingDef = {
  id: 'eau_station_pompage',
  nameFr: 'Station de pompage',
  category: 'public',
  footprint: { tilesX: 3, tilesZ: 3 },
  cost: 420_000,
  upkeepPerMonth: 650,
  residents: 0,
  jobs: 6,
  density: 'faible',
  style: 'equipement_eau',
  tags: ['public', 'eau', 'pompage', 'captage', 'service:eau', 'reseau:eau'],
  source: `${SRC}#stationPompage`,
  lodDistances: [180, 700],
  palette: npPalette({
    ...WATER_ROLES,
    facade: M('brique_rouge', '#ffffff'),
    soubassement: M('pierre_taille', '#b8b0a2'),
    encadrement: M('pierre_taille', '#e6dfd2'),
    toiture: M('toit_ardoise', '#ffffff'),
    menuiserie: M('metal_rideau', '#2f4a5c', { metalness: 0.7, roughness: 0.5 }),
    porte: M('metal_rideau', '#2f4a5c', { metalness: 0.6 }),
    enseigne: M('enduit_blanc', '#f1ece2'),
    lettres: M('enduit_peint', '#2f4a5c'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Brique rouge, ardoise' },
    { id: 'pierre', nameFr: 'Moellons et tuiles', materialOverrides: { facade: { textureSet: 'pierre_moellons', color: '#e9e2d4' }, toiture: { textureSet: 'toit_tuiles' } } },
    { id: 'enduit', nameFr: 'Enduit clair, menuiseries vertes', materialOverrides: { facade: { textureSet: 'enduit_creme' }, menuiserie: { color: '#3f6b4a' }, porte: { color: '#3f6b4a' } } },
  ],
  build(ctx) {
    // Maison des pompes : 14 × 9 m, 7 m sous corniche, hautes baies cintrées.
    const x0 = -9, x1 = 5, z0 = -4, z1 = 5, H = 7;
    const win = { shutters: 'none' as const, leaves: 2, bars: 4, transom: 1.0, frameMat: 'menuiserie', surround: 0.2, keystone: true, reveal: 0.25 };
    const us = bays(x1 - x0, 4, 0.8);
    volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S: us.map((u, i) => (i === 1 ? { kind: 'door' as const, r: rectAt(u, 2.4, 0.05, 3.4), o: { style: 'double' as const, transom: 0.8, surround: 0.2 } } : { kind: 'window' as const, r: rectAt(u, 1.6, 1.2, 4.2), o: win })),
        E: row(bays(z1 - z0, 2, 0.8), 1.5, 1.2, 4.0, () => ({ kind: 'window', o: win })),
        W: row(bays(z1 - z0, 2, 0.8), 1.5, 1.2, 4.0, () => ({ kind: 'window', o: win })),
        N: row(bays(x1 - x0, 3, 1.2), 1.4, 2.4, 2.6, () => ({ kind: 'window', o: win })),
      },
      plinth: { h: 0.7, d: 0.06 }, ...(ctx.lod === 0 ? { quoins: { v0: 0.7 } } : {}),
      bands: [{ v: 5.6, h: 0.22, d: 0.07 }], cornice: { profile: [[0.12, 0.08], [0.2, 0.16]] },
    });
    gableRoof(ctx, { x0, x1, z0, z1, y: H + 0.24, pitch: 32, axis: 'x', overhang: 0.4, verge: 0.25, gableMat: 'facade' });
    // Fronton d'enseigne.
    const F = volume(ctx, { x0: -4.6, x1: 0.6, z0: z1, z1: z1 + 0.25, h: 0.01, wallMat: 'enseigne', hidden: ['S', 'E', 'N', 'W'] });
    signPanel(ctx, F.S, 'POMPAGE', 2.6, 5.75, 0.62, { plate: 'enseigne', letters: 'lettres' });
    // Annexe électrique (toit terrasse) à l'est.
    volume(ctx, { x0: x1, x1: x1 + 5.5, z0: -1, z1: 5, h: 4.2, wallMat: 'facade', hidden: ['W'], sides: { S: [{ kind: 'door', r: rectAt(2.6, 1.3, 0.05, 2.3), o: { style: 'panneaux' } }], E: row([3], 1.2, 1.4, 1.4, () => ({ kind: 'window', o: { ...win, transom: 0, leaves: 1 } })) }, plinth: { h: 0.5, d: 0.05 } });
    flatRoof(ctx, { x0: x1, x1: x1 + 5.5, z0: -1, z1: 5, y: 4.0, parapet: 4.4, wallMat: 'facade' });
    // Transformateur et armoire sur dalle.
    slab(ctx, 'beton_b', x1 + 1, -4.6, x1 + 5.2, -1.4, 0, 0.15);
    ctx.mb.box('equipement', x1 + 1.6, 0.15, -4.1, x1 + 3.4, 1.9, -2.2);
    if (ctx.lod < 2) for (let k = 0; k < 3; k++) ctx.mb.box('equipement', x1 + 3.6, 0.3 + k * 0.5, -4.0, x1 + 4.6, 0.4 + k * 0.5, -2.3);
    // Conduites d'aspiration vers l'arrière (rivière), sorties de refoulement vers la rue.
    const pr = 0.45, pn = seg(ctx, 14, 8, 6);
    for (const px of [-6.5, -2.5]) {
      hCylinder(ctx, 'conduite', [px, 0.9, z0], [px, 0.9, -11.6], pr, pn, true);
      if (ctx.lod < 2) {
        for (const pz of [-6.5, -9.5]) { ctx.mb.box('beton', px - 0.7, 0, pz - 0.3, px + 0.7, 0.5, pz + 0.3); }
        valve(ctx, px, 1.35, -7.8);
        ctx.mb.cylinder('conduite', px, 0.45, -8.4, 0.62, 0.9, pn, true); // corps de vanne
      }
    }
    hCylinder(ctx, 'conduite', [2.6, 1.1, z1], [2.6, 1.1, 10.8], 0.38, pn, true);
    ctx.mb.box('beton', 1.9, 0, 9.6, 3.3, 1.4, 11.2);
    // Cour gravillonnée, clôture arrière, lampadaire.
    slab(ctx, 'gravier', -11.6, -11.6, 11.6, z0, 0, 0.05);
    if (ctx.lod < 2) {
      fence(ctx, [-11.6, 0, -11.6], [11.6, 0, -11.6], 1.8);
      fence(ctx, [-11.6, 0, -11.6], [-11.6, 0, z0], 1.8);
      fence(ctx, [11.6, 0, -11.6], [11.6, 0, -4.8], 1.8);
      lampPost(ctx, -10.4, 0.05, 9.8, 6, [1, 0, 0]);
    }
    slab(ctx, 'dallage', -9, z1, 11, 11.4, 0, 0.06);
  },
};

/* ------------------------------------------------------------------ */
/* 2. Usine de potabilisation                                           */
/* ------------------------------------------------------------------ */
export const usinePotabilisation: BuildingDef = {
  id: 'eau_usine_potabilisation',
  nameFr: 'Usine de potabilisation',
  category: 'public',
  footprint: { tilesX: 5, tilesZ: 4 },
  cost: 1_350_000,
  upkeepPerMonth: 1600,
  residents: 0,
  jobs: 22,
  density: 'moyenne',
  style: 'equipement_eau',
  tags: ['public', 'eau', 'potabilisation', 'traitement', 'service:eau', 'reseau:eau'],
  source: `${SRC}#usinePotabilisation`,
  lodDistances: [220, 900],
  palette: npPalette({
    ...WATER_ROLES,
    facade: M('bardage_composite', '#e7ebee'),
    facade_b: M('beton_facade', '#d9d4ca'),
    soubassement: M('beton_facade', '#bdb7ad'),
    encadrement: M('metal_rideau', '#3d6f99', { metalness: 0.6 }),
    menuiserie: M('metal_rideau', '#3d6f99', { metalness: 0.7, roughness: 0.45 }),
    porte: M('metal_rideau', '#3d6f99'),
    enseigne: M('enduit_peint', '#2d5f8a'),
    lettres: M('enduit_blanc', '#f5f7f8'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Bardage gris clair, menuiseries bleues' },
    { id: 'brique', nameFr: 'Parement brique', materialOverrides: { facade: { textureSet: 'brique_parement', color: '#ffffff' } } },
    { id: 'sombre', nameFr: 'Panneaux sombres, menuiseries cuivre', materialOverrides: { facade: { textureSet: 'panneaux_facade_sombres', color: '#ffffff' }, menuiserie: { color: '#9a6a3c' }, encadrement: { color: '#9a6a3c' } } },
  ],
  build(ctx) {
    // Halle des filtres (24 × 10 m, 8 m), bandeau vitré continu.
    const x0 = -19.4, x1 = 4.6, z0 = 3.4, z1 = 15.4, H = 8;
    const us = bays(x1 - x0, 8, 0.6);
    const glazing = { shutters: 'none' as const, leaves: 3, bars: 2, transom: 0, frameMat: 'menuiserie', surround: 0.08, reveal: 0.2 };
    volume(ctx, {
      x0, x1, z0, z1, h: H, wallMat: 'facade',
      sides: {
        S: us.map((u, i) => (i === 3 ? { kind: 'door' as const, r: rectAt(u, 2.6, 0.05, 3.0), o: { style: 'vitree' as const, canopy: 'dalle', surround: 0.12 } } : { kind: 'window' as const, r: rectAt(u, 2.2, 3.2, 3.6), o: glazing })),
        N: row(bays(x1 - x0, 6, 0.8), 2.0, 3.4, 3.0, () => ({ kind: 'window', o: glazing })),
        W: row(bays(z1 - z0, 3, 0.8), 2.0, 3.4, 3.0, () => ({ kind: 'window', o: glazing })),
        E: [{ kind: 'door', r: rectAt(4, 3.6, 0.05, 4.2), o: { style: 'double' } }],
      },
      plinth: { h: 1.0, d: 0.04 }, bands: [{ v: 2.6, h: 0.3, d: 0.06, mat: 'facade_b' }],
    });
    flatRoof(ctx, { x0, x1, z0, z1, y: H - 0.2, parapet: H + 0.5, wallMat: 'facade' });
    if (ctx.lod < 2) for (let k = 0; k < 3; k++) ctx.mb.box('equipement', x0 + 3 + k * 6, H - 0.2, z0 + 3, x0 + 5.2 + k * 6, H + 1.2, z0 + 5.4);
    const F = volume(ctx, { x0, x1, z0: z1, z1: z1 + 0.2, h: 0.01, wallMat: 'enseigne', hidden: ['S', 'E', 'N', 'W'] });
    signPanel(ctx, F.S, 'EAU POTABLE', (x1 - x0) / 2, H - 1.4, 0.8, { plate: 'enseigne', letters: 'lettres' });
    // Deux décanteurs circulaires à l'arrière, passerelle d'accès.
    roundBasin(ctx, -13, -8.5, 6.2, 2.4);
    roundBasin(ctx, 1.5, -8.5, 6.2, 2.4);
    if (ctx.lod < 2) {
      for (const cx of [-13, 1.5]) {
        walkway(ctx, [cx - 6.2, 2.5, -8.5], [cx + 6.2, 2.5, -8.5]);
        ctx.mb.cylinder('passerelle', cx, 2.4, -8.5, 0.7, 0.8, 10, true);
      }
    }
    // Tuyauterie de liaison décanteurs -> halle.
    const pn = seg(ctx, 12, 8, 6);
    hCylinder(ctx, 'conduite', [-13, 1.2, -2.3], [-13, 1.2, z0], 0.4, pn, true);
    hCylinder(ctx, 'conduite', [1.5, 1.2, -2.3], [1.5, 1.2, z0], 0.4, pn, true);
    hCylinder(ctx, 'conduite', [-13, 1.2, -1.2], [1.5, 1.2, -1.2], 0.4, pn, true);
    // Cuves de réactifs et silo de charbon actif à l'est.
    for (const [cx, cz, r, h] of [[10.5, -11.5, 1.6, 6.5], [15, -11.5, 1.6, 6.5], [12.8, -6.6, 1.3, 5]] as const) {
      ctx.mb.cylinder('facade_b', cx, 0, cz, r, h, pn, false);
      dome(ctx, 'zinc', cx, h, cz, r, pn, seg(ctx, 4, 3, 2), 0.35);
    }
    if (ctx.lod < 2) {
      ctx.mb.box('beton_b', 8.6, 0, -14.4, 17.4, 0.6, -4.6);
      railingSimple(ctx, [8.6, 0.6, -4.6], [17.4, 0.6, -4.6], 0.9);
    }
    // Bâtiment des réactifs (toit à un pan simplifié) et réservoir d'eau traitée enterré (dalle + évents).
    volume(ctx, { x0: 7.4, x1: 18.6, z0: 3.4, z1: 11.4, h: 5, wallMat: 'facade_b', sides: { S: [{ kind: 'door', r: rectAt(3.2, 3.0, 0.05, 3.4), o: { style: 'double' } }, ...row([8.0], 1.6, 1.6, 1.6, () => ({ kind: 'window' as const, o: { ...glazing, leaves: 2 } }))] }, plinth: { h: 0.6, d: 0.04 } });
    flatRoof(ctx, { x0: 7.4, x1: 18.6, z0: 3.4, z1: 11.4, y: 4.8, parapet: 5.2, wallMat: 'facade_b' });
    slab(ctx, 'gazon', -19.6, -1.4, 6.4, 2.6, 0, 0.3);
    if (ctx.lod < 2) for (let k = 0; k < 5; k++) ctx.mb.cylinder('zinc', -17 + k * 5, 0.3, 0.6, 0.25, 0.9, 8, true);
    // Voirie interne et clôture.
    slab(ctx, 'sol', -19.6, z1, 19.6, 15.8, 0, 0.05);
    if (ctx.lod < 2) {
      fence(ctx, [-19.6, 0, -15.6], [19.6, 0, -15.6], 2.0);
      fence(ctx, [-19.6, 0, -15.6], [-19.6, 0, z0], 2.0);
      fence(ctx, [19.6, 0, -15.6], [19.6, 0, z1], 2.0);
      lampPost(ctx, 6.2, 0.05, 14.6, 7, [-1, 0, 0]);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 3. Château d'eau                                                     */
/* ------------------------------------------------------------------ */
export const chateauEau: BuildingDef = {
  id: 'eau_chateau_eau',
  nameFr: 'Château d\'eau',
  category: 'public',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 380_000,
  upkeepPerMonth: 300,
  residents: 0,
  jobs: 1,
  density: 'faible',
  style: 'equipement_eau',
  tags: ['public', 'eau', 'reservoir', 'chateau_eau', 'repere', 'service:eau', 'reseau:eau'],
  source: `${SRC}#chateauEau`,
  lodDistances: [260, 1100],
  palette: npPalette({
    ...WATER_ROLES,
    facade: M('beton_facade', '#e4dfd5'),
    facade_b: M('enduit_peint', '#7fa9c2'),
    porte: M('metal_rideau', '#41617a'),
    lettres: M('enduit_peint', '#2e536e'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton clair, cuve bleu ciel' },
    { id: 'blanc', nameFr: 'Cuve blanche à bandeau bleu', materialOverrides: { facade_b: { textureSet: 'enduit_blanc', color: '#f4f4f0' } } },
    { id: 'terre', nameFr: 'Béton ocré, cuve sable', materialOverrides: { facade: { color: '#e2cfae' }, facade_b: { color: '#d8b98a' } } },
  ],
  build(ctx) {
    const n = seg(ctx, 32, 18, 10);
    // Socle et local technique.
    slab(ctx, 'dallage', -7.8, -7.8, 7.8, 7.8, 0, 0.1);
    volume(ctx, { x0: -3.4, x1: 3.4, z0: -3.4, z1: 3.4, y0: 0.1, h: 3.4, wallMat: 'facade', sides: { S: [{ kind: 'door', r: rectAt(3.4, 1.3, 0.05, 2.4), o: { style: 'panneaux' } }] }, plinth: { h: 0.4, d: 0.04 } });
    flatRoof(ctx, { x0: -3.4, x1: 3.4, z0: -3.4, z1: 3.4, y: 3.4, parapet: 3.7, wallMat: 'facade' });
    // Fût.
    ctx.mb.cylinder('facade', 0, 3.5, 0, 2.1, 19.5, n, false, 1.9);
    if (ctx.lod === 0) for (let k = 0; k < 6; k++) ctx.mb.cylinder('beton_b', 0, 6 + k * 3, 0, 1.96 - k * 0.02, 0.12, n, false);
    // Cône de transition, cuve, bandeau, coupole.
    ctx.mb.cylinder('cone', 0, 23, 0, 1.9, 4.2, n, false, 6.6);
    ctx.mb.cylinder('facade_b', 0, 27.2, 0, 6.6, 5.4, n, false);
    ctx.mb.cylinder('encadrement', 0, 32.6, 0, 6.85, 0.35, n, true, 6.85);
    dome(ctx, 'facade', 0, 32.95, 0, 6.6, n, seg(ctx, 6, 4, 2), 0.32);
    spire(ctx, 'zinc', 0, 35.0, 0, 0.6, 1.4, seg(ctx, 10, 8, 6));
    // Garde-corps de la coursive.
    if (ctx.lod < 2) {
      const k = seg(ctx, 24, 12, 8);
      for (let i = 0; i < k; i++) {
        const a0 = (i / k) * Math.PI * 2, a1 = ((i + 1) / k) * Math.PI * 2;
        railingSimple(ctx, [Math.cos(a0) * 6.8, 32.95, Math.sin(a0) * 6.8], [Math.cos(a1) * 6.8, 32.95, Math.sin(a1) * 6.8], 1.0);
      }
    }
    // Échelle à crinoline le long du fût (face nord).
    if (ctx.lod < 2) {
      for (const sx of [-0.25, 0.25]) ctx.mb.box('garde_corps', sx - 0.03, 3.7, -2.25, sx + 0.03, 23.2, -2.19);
      if (ctx.lod === 0) for (let y = 4; y < 23; y += 0.6) ctx.mb.box('garde_corps', -0.25, y, -2.24, 0.25, y + 0.03, -2.2);
    }
    // Lettrage sur la cuve (face sud).
    const F = volume(ctx, { x0: -3.6, x1: 3.6, z0: 6.55, z1: 6.62, y0: 29, h: 1.2, wallMat: 'facade_b', hidden: ['S', 'E', 'N', 'W'] });
    lettering(ctx, 'lettres', F.S, 'EAU', 3.6, 0.15, 0.95, 0.04, 0.05);
    // Conduite d'alimentation enterrée (regard) et clôture basse.
    ctx.mb.box('beton_b', 3.8, 0.1, -1, 5.6, 0.5, 1);
    if (ctx.lod < 2) {
      fence(ctx, [-7.6, 0, -7.6], [7.6, 0, -7.6], 1.6);
      fence(ctx, [-7.6, 0, -7.6], [-7.6, 0, 7.6], 1.6);
      fence(ctx, [7.6, 0, -7.6], [7.6, 0, 7.6], 1.6);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 4. Station d'épuration                                               */
/* ------------------------------------------------------------------ */
export const stationEpuration: BuildingDef = {
  id: 'eau_station_epuration',
  nameFr: 'Station d\'épuration',
  category: 'public',
  footprint: { tilesX: 6, tilesZ: 5 },
  cost: 1_600_000,
  upkeepPerMonth: 1900,
  residents: 0,
  jobs: 18,
  density: 'moyenne',
  style: 'equipement_eau',
  tags: ['public', 'eau', 'assainissement', 'epuration', 'service:assainissement', 'reseau:egouts', 'odeurs:1'],
  source: `${SRC}#stationEpuration`,
  lodDistances: [240, 950],
  palette: npPalette({
    ...WATER_ROLES,
    facade: M('enduit_creme', '#efe6d4'),
    facade_b: M('beton_facade', '#d0cabe'),
    toiture: M('toit_bac_acier', '#8f9a8c'),
    menuiserie: M('metal_rideau', '#4f6b3e', { metalness: 0.6 }),
    porte: M('metal_rideau', '#4f6b3e'),
    enseigne: M('enduit_peint', '#4f6b3e'),
    lettres: M('enduit_blanc', '#f6f4ec'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Enduit crème, menuiseries vert olive' },
    { id: 'bois', nameFr: 'Bardage bois', materialOverrides: { facade: { textureSet: 'bardage_bois', color: '#e8d2b4' } } },
    { id: 'beton', nameFr: 'Béton brut, menuiseries rouges', materialOverrides: { facade: { textureSet: 'beton_facade', color: '#dad6cf' }, menuiserie: { color: '#9e3b2c' }, porte: { color: '#9e3b2c' } } },
  ],
  build(ctx) {
    // Bâtiment d'exploitation (prétraitement + laboratoire) côté rue.
    const glazing = { shutters: 'none' as const, leaves: 2, bars: 2, transom: 0, frameMat: 'menuiserie', surround: 0.1, reveal: 0.2 };
    volume(ctx, {
      x0: -23.4, x1: -5.4, z0: 9.4, z1: 19.4, h: 6, wallMat: 'facade',
      sides: {
        S: [{ kind: 'door', r: rectAt(4, 1.6, 0.05, 2.6), o: { style: 'vitree', canopy: 'dalle', surround: 0.12 } }, ...row([8.5, 11.5, 14.5], 1.8, 1.4, 1.8, () => ({ kind: 'window' as const, o: glazing }))],
        E: [{ kind: 'door', r: rectAt(5, 3.6, 0.05, 4.0), o: { style: 'double' } }],
        W: row(bays(10, 2, 1), 1.6, 1.4, 1.8, () => ({ kind: 'window', o: glazing })),
      },
      plinth: { h: 0.6, d: 0.04 }, bands: [{ v: 4.6, h: 0.2, d: 0.05 }],
    });
    gableRoof(ctx, { x0: -23.4, x1: -5.4, z0: 9.4, z1: 19.4, y: 6.2, pitch: 18, axis: 'x', overhang: 0.5, verge: 0.3, gableMat: 'facade' });
    const F = volume(ctx, { x0: -23.4, x1: -5.4, z0: 19.4, z1: 19.6, h: 0.01, wallMat: 'enseigne', hidden: ['S', 'E', 'N', 'W'] });
    signPanel(ctx, F.S, 'EPURATION', 9, 3.6, 0.7, { plate: 'enseigne', letters: 'lettres' });
    // Deux bassins d'aération (boues activées), passerelles.
    rectBasin(ctx, -23.4, -19.4, -11.4, -1.4, 3.2, 'eau_usee', 5);
    rectBasin(ctx, -10.4, -19.4, 1.6, -1.4, 3.2, 'eau_usee', 5);
    if (ctx.lod < 2) {
      walkway(ctx, [-23.4, 3.3, -10.4], [1.6, 3.3, -10.4], 1.2);
      ctx.mb.box('passerelle', -11.4, 3.2, -19.4, -10.4, 3.3, -1.4);
    }
    // Clarificateur circulaire à pont racleur tournant.
    roundBasin(ctx, 13.5, -8, 9.2, 2.8, 'eau');
    if (ctx.lod < 2) {
      ctx.mb.cylinder('beton', 13.5, 2.8, -8, 1.1, 0.6, 12, true);
      walkway(ctx, [13.5, 3.3, -8], [22.6, 3.3, -8], 1.3);
      ctx.mb.box('equipement', 21.6, 3.3, -8.7, 22.7, 4.3, -7.3);
    }
    // Digesteur de boues (cylindre + coupole) et gazomètre.
    const n = seg(ctx, 24, 14, 10);
    ctx.mb.cylinder('facade_b', 8, 0, 10.5, 4.6, 7.5, n, false);
    dome(ctx, 'zinc', 8, 7.5, 10.5, 4.6, n, seg(ctx, 6, 4, 2), 0.42);
    ctx.mb.cylinder('facade', 17.6, 0, 12.5, 3, 4.2, n, false);
    dome(ctx, 'zinc', 17.6, 4.2, 12.5, 3, n, seg(ctx, 5, 3, 2), 0.3);
    if (ctx.lod < 2) {
      // Escalier hélicoïdal simplifié et garde-corps du digesteur.
      railingSimple(ctx, [3.4, 7.5, 10.5], [12.6, 7.5, 10.5], 1.0);
      for (let k = 0; k < 8; k++) ctx.mb.box('passerelle', 2.6, k * 0.95, 10 - 0.5 + (k % 2) * 0.2, 3.4, k * 0.95 + 0.08, 11.5);
    }
    // Conduites entre ouvrages.
    const pn = seg(ctx, 10, 8, 6);
    hCylinder(ctx, 'conduite_b', [-14, 1.0, 9.4], [-14, 1.0, -1.4], 0.42, pn, true);
    hCylinder(ctx, 'conduite_b', [1.6, 1.0, -8], [4.3, 1.0, -8], 0.42, pn, true);
    hCylinder(ctx, 'conduite_b', [13.5, 0.8, 1.2], [13.5, 0.8, 6], 0.32, pn, true);
    hCylinder(ctx, 'conduite', [22.8, 0.8, -12], [23.6, 0.8, -19.6], 0.36, pn, true); // rejet épuré vers le milieu naturel
    // Voirie, haie et clôture.
    slab(ctx, 'sol', -23.6, 19.4, 23.6, 19.8, 0, 0.05);
    slab(ctx, 'gravier', -4.8, 1.0, 3.6, 9.0, 0, 0.05);
    if (ctx.lod < 2) {
      fence(ctx, [-23.6, 0, -19.7], [23.6, 0, -19.7], 2.0);
      fence(ctx, [-23.6, 0, -19.7], [-23.6, 0, 9.0], 2.0);
      fence(ctx, [23.6, 0, -19.7], [23.6, 0, 19.0], 2.0);
      lampPost(ctx, -3.2, 0.05, 18.6, 7, [1, 0, 0]);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 5. Émissaire                                                         */
/* ------------------------------------------------------------------ */
export const emissaire: BuildingDef = {
  id: 'eau_emissaire',
  nameFr: 'Émissaire de rejet',
  category: 'public',
  footprint: { tilesX: 2, tilesZ: 2 },
  cost: 120_000,
  upkeepPerMonth: 90,
  residents: 0,
  jobs: 0,
  density: 'faible',
  style: 'equipement_eau',
  tags: ['public', 'eau', 'assainissement', 'emissaire', 'rejet', 'service:assainissement', 'reseau:egouts'],
  source: `${SRC}#emissaire`,
  lodDistances: [150, 600],
  palette: npPalette({
    ...WATER_ROLES,
    facade: M('beton_facade', '#cfc9be'),
    porte: M('metal_rideau', '#5d6b73'),
  }),
  variants: [
    { id: 'origine', nameFr: 'Béton' },
    { id: 'pierre', nameFr: 'Parement de pierre', materialOverrides: { facade: { textureSet: 'pierre_rustique', color: '#ddd5c5' } } },
    { id: 'brique', nameFr: 'Brique, conduite verte', materialOverrides: { facade: { textureSet: 'brique_rouge', color: '#ffffff' }, conduite_b: { color: '#3f6b4a' } } },
  ],
  build(ctx) {
    const pn = seg(ctx, 16, 10, 6);
    // Regard de visite et chambre de mise en charge (côté rue).
    slab(ctx, 'beton_b', -7.6, 1.5, 7.6, 7.6, 0, 0.12);
    volume(ctx, { x0: -2.6, x1: 2.6, z0: 2.4, z1: 6.4, y0: 0.12, h: 1.6, wallMat: 'facade', plinth: { h: 0.3, d: 0.03 } });
    flatRoof(ctx, { x0: -2.6, x1: 2.6, z0: 2.4, z1: 6.4, y: 1.72, parapet: 1.72 });
    if (ctx.lod < 2) for (const x of [-1.2, 1.2]) ctx.mb.cylinder('garde_corps', x, 1.72, 4.4, 0.45, 0.06, 12, true);
    // Armoire de télésurveillance.
    ctx.mb.box('equipement', 4.2, 0.12, 4.2, 5.6, 1.7, 5.1);
    // Conduite de rejet descendant vers l'arrière (berge), tête d'ouvrage et clapet.
    hCylinder(ctx, 'conduite_b', [0, 0.9, 2.4], [0, 0.4, -5.4], 0.55, pn, true);
    ctx.mb.box('facade', -3.4, 0, -7.6, 3.4, 2.4, -5.4);
    ctx.mb.box('facade', -3.4, 0, -7.6, -2.8, 1.6, -4.0);
    ctx.mb.box('facade', 2.8, 0, -7.6, 3.4, 1.6, -4.0);
    ctx.mb.cylinder('conduite_b', 0, 0.4 - 0.7, -7.65, 0.75, 0.0, pn, false);
    hCylinder(ctx, 'garde_corps', [0, 0.4, -7.6], [0, 0.4, -7.75], 0.72, pn, true); // clapet anti-retour
    // Enrochements au pied de l'ouvrage.
    if (ctx.lod < 2) {
      for (let k = 0; k < (ctx.lod === 0 ? 9 : 4); k++) {
        const x = -3 + (k % 5) * 1.5 + (k > 4 ? 0.7 : 0), z = -7.2 + (k > 4 ? 0.6 : 0);
        ctx.mb.box('beton_b', x - 0.45, 0, z - 0.35, x + 0.4, 0.45 + (k % 3) * 0.12, z + 0.3);
      }
      fence(ctx, [-7.6, 0, -4.6], [-7.6, 0, 7.4], 1.4);
      fence(ctx, [7.6, 0, -4.6], [7.6, 0, 7.4], 1.4);
      fence(ctx, [-7.6, 0, -4.6], [-3.6, 0, -4.6], 1.4);
      fence(ctx, [3.6, 0, -4.6], [7.6, 0, -4.6], 1.4);
      railingSimple(ctx, [-3.4, 2.4, -5.5], [3.4, 2.4, -5.5], 1.0);
    }
  },
};

export const WATER_MODELS: BuildingDef[] = [stationPompage, usinePotabilisation, chateauEau, stationEpuration, emissaire];
